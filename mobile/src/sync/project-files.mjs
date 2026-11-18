// The project as the sync engine sees it on the phone (docs/sync-plan.md §3.6
// step 2, §3.8). The tree is walked once; after that every write goes through
// the ProjectWriter, so its `fileChanged` events say which files to look at
// again. Remote changes are written with `applyExternal`/`removeExternal`,
// never over a file a screen holds unsaved edits of (SV4) and, with `expected`,
// never over a file that changed after the engine read it. Such a file is
// reported as skipped and its remote change waits for the next turn.
// Attachments and other binary files are "lazy" (fetched when opened, S6):
// they are not listed here and never written by a turn. An attachment the
// user opens is written with `writeLazy`; one deleted on the desktop goes with
// `removeLazy`.

import { checkPisiSyncPath, getPisiSyncFileClass, isPisiSyncExcludedPath } from '../../../shared/sync-paths.mjs';
import { utf8Decode, utf8Encode } from '../../../shared/sync-crypto.mjs';
import { joinKey } from '../data/drivers/keys.mjs';
import { readTextOrNull } from '../data/json-file.mjs';

/** Files the phone holds only once they are opened: attachments and other files (S6). */
export const isLazySyncPath = (path) => {
    const fileClass = getPisiSyncFileClass(path);
    return fileClass === 'asset' || fileClass === 'other';
};

/** Standard base64 of bytes, in slices so a large attachment does not overflow the call stack. */
export function bytesToBase64(bytes) {
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
}

export function createSyncProjectFiles({ project, lazy = isLazySyncPath }) {
    const { driver, writer } = project;
    // path → { size, mtimeMs } of every listed file; null until the first walk.
    let known = null;
    const stale = new Set();
    // Files written by the app after the last list(): a remote change to them waits for the next turn.
    const changedSinceList = new Set();
    // Text the engine read in this turn: what a remote change is merged against.
    const seen = new Map();

    const stop = writer.onFileChanged((key, info) => {
        if (info?.removed) {
            known?.delete(key);
            stale.delete(key);
        } else stale.add(key);
        if (info?.source !== 'sync') changedSinceList.add(key);
    });

    const listable = (path) => checkPisiSyncPath(path).ok && !lazy(path);

    async function walk(folder, out) {
        const entries = await driver.list(folder).catch(() => []);
        for (const entry of entries) {
            const key = joinKey(folder, entry.name);
            if (entry.type === 'directory') {
                if (!isPisiSyncExcludedPath(`${key}/`)) await walk(key, out);
            } else if (listable(key)) {
                const stat = await driver.stat(key);
                if (stat?.type === 'file') out.set(key, { size: stat.size, mtimeMs: stat.mtime });
            }
        }
    }

    async function restat(key) {
        const before = known.get(key);
        const stat = listable(key) ? await driver.stat(key) : null;
        if (stat?.type !== 'file') return known.delete(key);
        // A new write always looks new to the engine's hash cache, even within the clock's resolution.
        const mtimeMs = before && stat.mtime <= before.mtimeMs ? before.mtimeMs + 1 : stat.mtime;
        known.set(key, { size: stat.size, mtimeMs });
    }

    return {
        /** `[{ path, size, mtimeMs }]` of the files the engine syncs. */
        async list() {
            seen.clear();
            changedSinceList.clear();
            if (!known) {
                known = new Map();
                stale.clear();
                await walk('', known);
            } else {
                const keys = [...stale];
                stale.clear();
                for (const key of keys) await restat(key);
            }
            return [...known].map(([path, meta]) => ({ path, size: meta.size, mtimeMs: meta.mtimeMs }));
        },

        /** A file's bytes (UTF-8 of its text), or null when it is missing. */
        async read(path) {
            const text = await readTextOrNull(driver, path);
            if (text === null) return null;
            seen.set(path, text);
            return utf8Encode(text);
        },

        /**
         * Writes the turn's files one by one through the writer. Returns
         * `{ skipped }`: the paths whose write was refused (held dirty, changed
         * since it was read, read-only or not valid text).
         */
        async apply(writes) {
            const skipped = [];
            for (const write of writes) {
                const { path } = write;
                if (changedSinceList.has(path) || lazy(path)) {
                    skipped.push(path);
                    continue;
                }
                const expected = seen.has(path) ? seen.get(path) : await readTextOrNull(driver, path);
                let result;
                if (write.op === 'remove') result = await writer.removeExternal(path, { expected: expected ?? undefined });
                else {
                    let text;
                    try {
                        text = utf8Decode(write.bytes);
                    } catch {
                        skipped.push(path);
                        continue;
                    }
                    result = await writer.applyExternal(path, text, { expected });
                }
                if (!result.written && result.reason !== 'unchanged') skipped.push(path);
                else seen.set(path, write.op === 'remove' ? null : utf8Decode(write.bytes));
            }
            return { skipped };
        },

        /** Writes a downloaded attachment (bytes already checked against its blob id and digest). */
        async writeLazy(path, bytes) {
            let text = null;
            try {
                text = utf8Decode(bytes);
            } catch {
                text = null;
            }
            const result = await writer.applyExternalBytes(path, bytesToBase64(bytes), { text });
            return result.written || result.reason === 'unchanged';
        },

        /** Removes an attachment the desktop deleted, when the phone had downloaded it. Resolves true when it was removed. */
        async removeLazy(path) {
            if (!lazy(path) || !(await driver.exists(path))) return false;
            const result = await writer.removeExternal(path);
            return Boolean(result.written);
        },

        /** Forgets the walk, so the next list() reads the tree again (a new binding). */
        reset() {
            known = null;
        },

        destroy: () => stop()
    };
}
