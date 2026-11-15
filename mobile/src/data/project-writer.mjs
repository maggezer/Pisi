// Every write to the project goes through here (docs/mobile-plan.md §3.3).
// - One queue: writes run one after another, never interleaved.
// - V4: a file whose content would not change is not written.
// - V6: write a temporary file, rename it over the target, read the target back.
// - V7: a file marked read-only (corrupt JSON) is never written.
// - After each write `fileChanged(key)` is emitted. No sync metadata is stored.

import { baseName, joinKey, normalizeKey, parentKey } from './drivers/keys.mjs';
import { PisiReadOnlyError, parseJsonText, readTextOrNull } from './json-file.mjs';

// `.tasks.json.mobile-<token>.tmp`: the desktop ignores `*.tmp`, and the
// `mobile-` part keeps recovery away from temporary files it did not create.
const TEMP_NAME = /^\.(.+)\.mobile-[A-Za-z0-9-]+\.tmp$/;

const isJsonTarget = (name) => /\.(json|node|map)$/i.test(name);

export function createProjectWriter({ driver, makeToken, onError = () => {} }) {
    const listeners = new Set();
    const readOnly = new Map();
    let tail = Promise.resolve();

    function enqueue(job) {
        const run = tail.then(job);
        tail = run.catch(() => {});
        return run;
    }

    function emit(key) {
        for (const listener of listeners) {
            try {
                listener(key);
            } catch (error) {
                onError(error);
            }
        }
    }

    async function writeNow(key, text, current) {
        if (readOnly.has(key)) throw new PisiReadOnlyError(key, readOnly.get(key));
        if (current === text) return { written: false, key };
        const parent = parentKey(key);
        if (parent) await driver.mkdir(parent);
        const temp = joinKey(parent, `.${baseName(key)}.mobile-${makeToken()}.tmp`);
        try {
            await driver.writeText(temp, text);
            await driver.rename(temp, key);
        } catch (error) {
            await driver.remove(temp).catch(() => {});
            throw error;
        }
        if ((await driver.readText(key)) !== text) throw new Error(`Write could not be verified: ${key}`);
        emit(key);
        return { written: true, key };
    }

    return {
        /** Writes `text` to `key` unless the file already holds exactly that text. */
        writeText(key, text) {
            const clean = normalizeKey(key);
            return enqueue(async () => writeNow(clean, String(text), await readTextOrNull(driver, clean)));
        },

        /**
         * Read-modify-write inside the queue: the file is read right before
         * `change(currentText)` runs (null when missing), so a change is always
         * applied to what is on disk now (V5). `change` returns the new text, or
         * null to leave the file alone; what it throws rejects the update.
         */
        update(key, change) {
            const clean = normalizeKey(key);
            return enqueue(async () => {
                if (readOnly.has(clean)) throw new PisiReadOnlyError(clean, readOnly.get(clean));
                const current = await readTextOrNull(driver, clean);
                const next = await change(current);
                if (next === null || next === undefined) return { written: false, key: clean };
                return writeNow(clean, String(next), current);
            });
        },

        /**
         * Runs several steps as one queued job, so no other write lands between
         * them (creating a note: pick a free name, write the file, make its
         * folder). `job` gets `{ read, exists, write, mkdir }`; `write` follows
         * the same rules as writeText.
         */
        run(job) {
            return enqueue(() =>
                job({
                    read: (key) => readTextOrNull(driver, normalizeKey(key)),
                    exists: (key) => driver.exists(normalizeKey(key)),
                    mkdir: (key) => driver.mkdir(normalizeKey(key)),
                    write: async (key, text) => {
                        const clean = normalizeKey(key);
                        return writeNow(clean, String(text), await readTextOrNull(driver, clean));
                    }
                })
            );
        },

        /** Resolves when every write queued so far has finished. */
        flush() {
            return tail;
        },

        onFileChanged(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        markReadOnly(key, reason = 'corrupt') {
            readOnly.set(normalizeKey(key), reason);
        },
        isReadOnly: (key) => readOnly.has(normalizeKey(key)),
        getReadOnlyFiles: () => [...readOnly.keys()].sort(),
        clearReadOnly: () => readOnly.clear(),

        /**
         * Tidies the temporary files an interrupted write left in one folder.
         * If the target is missing and the temporary file is complete, the write
         * is finished (rename); otherwise the leftover is removed. Either way the
         * target ends up as the full before or the full after state.
         */
        recoverDirectory(directoryKey, entries = null) {
            const directory = normalizeKey(directoryKey);
            return enqueue(async () => {
                const listed = entries ?? (await driver.list(directory).catch(() => []));
                const names = new Set(listed.map((entry) => entry.name));
                let recovered = 0;
                for (const entry of listed) {
                    const match = entry.type === 'file' ? TEMP_NAME.exec(entry.name) : null;
                    if (!match) continue;
                    const temp = joinKey(directory, entry.name);
                    const target = joinKey(directory, match[1]);
                    const text = names.has(match[1]) ? null : await readTextOrNull(driver, temp);
                    const complete = text !== null && (!isJsonTarget(match[1]) || parseJsonText(text).status === 'ok');
                    if (complete) {
                        await driver.rename(temp, target);
                        names.add(match[1]);
                        emit(target);
                    } else {
                        await driver.remove(temp);
                    }
                    recovered += 1;
                }
                return recovered;
            });
        }
    };
}
