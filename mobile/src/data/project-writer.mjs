// Every write to the project goes through here (docs/mobile-plan.md §3.3).
// - One queue: writes run one after another, never interleaved.
// - V4: a file whose content would not change is not written.
// - V6: write a temporary file, rename it over the target, read the target back.
// - V7: a file marked read-only (corrupt JSON) is never written.
// - After each write `fileChanged(key, { source })` is emitted. No sync metadata is stored.
// - Changes from outside (sync, docs/sync-plan.md S4) come in through
//   `applyExternal` and `removeExternal`: the same queue and rules, never over
//   a file a screen holds unsaved edits of (SV4), and their events say
//   `source: 'sync'` so that nothing sends them back.

import { isPisiManagedSidecarFolder } from '../../../shared/document-naming.mjs';
import { baseName, joinKey, normalizeKey, parentKey } from './drivers/keys.mjs';
import { PisiReadOnlyError, parseJsonText, readTextOrNull } from './json-file.mjs';

// `.tasks.json.mobile-<token>.tmp`: the desktop ignores `*.tmp`, and the
// `mobile-` part keeps recovery away from temporary files it did not create.
const TEMP_NAME = /^\.(.+)\.mobile-[A-Za-z0-9-]+\.tmp$/;

// Sidecar folders of attachments (image/, file/, paint/): their files are binary.
const BINARY_FOLDERS = new Set(['image', 'file', 'paint']);

const isJsonTarget = (name) => /\.(json|node|map)$/i.test(name);
const isDocument = (name) => /\.(node|map)$/i.test(name);

/** The managed sidecar folder (`inv_…`, `nd_…`) a note or map document names, next to it, or null. */
function sidecarOf(key, text) {
    if (!isDocument(key) || text === null) return null;
    const parsed = parseJsonText(text);
    const sidecar = parsed.status === 'ok' ? parsed.data.pisi?.sidecar : null;
    return typeof sidecar === 'string' && !/[\\/]/.test(sidecar) && isPisiManagedSidecarFolder(sidecar) ? joinKey(parentKey(key), sidecar) : null;
}

/**
 * `documents` (data/open-documents.mjs) says which files a screen holds
 * unsaved edits of; outside changes to those are refused and listed as deferred.
 */
export function createProjectWriter({ driver, makeToken, documents = null, onError = () => {} }) {
    const listeners = new Set();
    const readOnly = new Map();
    let tail = Promise.resolve();

    function enqueue(job) {
        const run = tail.then(job);
        tail = run.catch(() => {});
        return run;
    }

    function emit(key, info = { source: 'local' }) {
        for (const listener of listeners) {
            try {
                listener(key, info);
            } catch (error) {
                onError(error);
            }
        }
    }

    async function writeNow(key, text, current, info) {
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
        emit(key, info);
        return { written: true, key };
    }

    /**
     * Why an outside change of `key` may not be applied now, or null. `current`
     * is the file's text (null when missing); `expected`, when given, is the
     * text the caller merged against.
     */
    function refusal(key, current, expected) {
        if (readOnly.has(key)) return 'read-only';
        if (documents?.isDirty(key)) return 'dirty';
        if (expected !== undefined && current !== expected) return 'changed';
        return null;
    }

    function refuse(key, reason) {
        // A file that waits for the user (unsaved edits) or for a new merge is tried again later.
        if (reason === 'dirty' || reason === 'changed') documents?.markDeferred(key, reason);
        return { written: false, key, reason };
    }

    /**
     * Removes `folder` when nothing but empty folders is left in it. Resolves
     * true when it is gone. Files are never removed here.
     */
    async function removeEmptyTree(folder) {
        const entries = await driver.list(folder).catch(() => null);
        if (!entries) return false;
        for (const entry of entries) {
            if (entry.type !== 'directory' || !(await removeEmptyTree(joinKey(folder, entry.name)))) return false;
        }
        return driver.removeDirectory(folder);
    }

    /** True when a note or map next to `folder` names it as its sidecar: then the folder stays, even empty (SV6). */
    async function isOwned(folder) {
        const parent = parentKey(folder);
        const entries = await driver.list(parent).catch(() => []);
        for (const entry of entries) {
            if (entry.type !== 'file' || !isDocument(entry.name)) continue;
            const key = joinKey(parent, entry.name);
            if (sidecarOf(key, await readTextOrNull(driver, key)) === folder) return true;
        }
        return false;
    }

    const removeIfOrphaned = async (folder) => !(await isOwned(folder)) && removeEmptyTree(folder);

    /**
     * After a remote delete: the document's own sidecar folder and the managed
     * sidecar folders the file was in go once they are empty and no document
     * names them any more.
     */
    async function tidyAfterRemove(key, sidecar) {
        if (sidecar) await removeIfOrphaned(sidecar);
        for (let folder = parentKey(key); folder; folder = parentKey(folder)) {
            if (!isPisiManagedSidecarFolder(baseName(folder))) continue;
            if (!(await removeIfOrphaned(folder))) break;
        }
    }

    return {
        /** Writes `text` to `key` unless the file already holds exactly that text. */
        writeText(key, text) {
            const clean = normalizeKey(key);
            return enqueue(async () => writeNow(clean, String(text), await readTextOrNull(driver, clean), { source: 'local' }));
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
                return writeNow(clean, String(next), current, { source: 'local' });
            });
        },

        /**
         * A file's new content from outside the app (sync). Written like any
         * other file (queue, atomic, verified), but only when the file is not
         * held dirty by a screen, is not read-only and, with `expected`, still
         * holds the text the caller merged against. Text that is not a JSON
         * object is never written to a `.node`, `.map` or `.json` file (SV10).
         * A note or map gets its empty managed sidecar folder, since folders
         * themselves are not synced (SV6). Resolves with `{ written, key, reason? }`;
         * `reason` is 'unchanged', 'dirty', 'changed', 'read-only' or 'invalid'.
         */
        applyExternal(key, text, { expected } = {}) {
            const clean = normalizeKey(key);
            const body = String(text);
            return enqueue(async () => {
                if (isJsonTarget(baseName(clean)) && parseJsonText(body).status !== 'ok') return refuse(clean, 'invalid');
                const current = await readTextOrNull(driver, clean);
                const reason = refusal(clean, current, expected);
                if (reason) return refuse(clean, reason);
                documents?.clearDeferred(clean);
                if (current === body) return { written: false, key: clean, reason: 'unchanged' };
                const sidecar = sidecarOf(clean, body);
                if (sidecar && !(await driver.exists(sidecar))) await driver.mkdir(sidecar);
                return writeNow(clean, body, current, { source: 'sync' });
            });
        },

        /**
         * A binary file from outside the app: an attachment downloaded when it
         * was opened (docs/sync-plan.md S6 step 4). `base64` is its bytes. The
         * same queue, temporary file and rename as text; the bytes are read back
         * and compared afterwards. A JSON attachment (a Sheet's model) comes with
         * its `text` too, which must parse. Only a file that is missing is written (an attachment's
         * name is its content's digest, so one that exists is already right).
         * Resolves with `{ written, key, reason? }`.
         */
        applyExternalBytes(key, base64, { text = null } = {}) {
            const clean = normalizeKey(key);
            return enqueue(async () => {
                if (!clean || typeof driver.writeBase64 !== 'function') return refuse(clean, 'invalid');
                // A Sheet's model (`sheet/<hash>.json`) is JSON: its `text` must read as JSON like any other file (SV10).
                if (isJsonTarget(baseName(clean)) && (text === null || parseJsonText(String(text)).status !== 'ok')) return refuse(clean, 'invalid');
                if (readOnly.has(clean)) return refuse(clean, 'read-only');
                if (await driver.exists(clean)) return { written: false, key: clean, reason: 'unchanged' };
                const parent = parentKey(clean);
                if (parent) await driver.mkdir(parent);
                const temp = joinKey(parent, `.${baseName(clean)}.mobile-${makeToken()}.tmp`);
                try {
                    await driver.writeBase64(temp, String(base64));
                    await driver.rename(temp, clean);
                } catch (error) {
                    await driver.remove(temp).catch(() => {});
                    throw error;
                }
                // Read back as base64: the browser's store reports the size of the base64 text, not of the bytes.
                if ((await driver.readBase64(clean).catch(() => null)) !== String(base64)) {
                    await driver.remove(clean).catch(() => {});
                    throw new Error(`Write could not be verified: ${clean}`);
                }
                emit(clean, { source: 'sync' });
                return { written: true, key: clean };
            });
        },

        /**
         * A file deleted outside the app (on the desktop). The same conditions as
         * applyExternal; a missing file is 'unchanged'. Afterwards the managed
         * sidecar folders left empty are removed, the document's own included.
         * Only this path removes folders: mobile itself never deletes (V9).
         */
        removeExternal(key, { expected } = {}) {
            const clean = normalizeKey(key);
            return enqueue(async () => {
                const stat = await driver.stat(clean);
                if (stat?.type === 'directory' || !clean) return refuse(clean, 'invalid');
                const textual = isDocument(clean) || expected !== undefined;
                const current = stat && textual ? await readTextOrNull(driver, clean) : null;
                const reason = refusal(clean, current, expected === undefined || !stat ? undefined : expected);
                if (reason) return refuse(clean, reason);
                documents?.clearDeferred(clean);
                if (!stat) return { written: false, key: clean, reason: 'unchanged' };
                await driver.remove(clean);
                if (await driver.exists(clean)) throw new Error(`Remove could not be verified: ${clean}`);
                emit(clean, { source: 'sync', removed: true });
                await tidyAfterRemove(clean, sidecarOf(clean, current));
                return { written: true, key: clean, removed: true };
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
                        return writeNow(clean, String(text), await readTextOrNull(driver, clean), { source: 'local' });
                    }
                })
            );
        },

        /** Resolves when every write queued so far has finished. */
        flush() {
            return tail;
        },

        /** `listener(key, { source: 'local' | 'sync', removed? })` runs after a file was written or removed. */
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
                    // A downloaded attachment that was cut off is fetched again; it is never finished from its temporary file.
                    const binary = BINARY_FOLDERS.has(baseName(directory));
                    const text = names.has(match[1]) || binary ? null : await readTextOrNull(driver, temp);
                    const complete = text !== null && (!isJsonTarget(match[1]) || parseJsonText(text).status === 'ok');
                    if (complete) {
                        await driver.rename(temp, target);
                        names.add(match[1]);
                        emit(target, { source: 'local' });
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
