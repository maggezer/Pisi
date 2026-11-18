// Rules of the first transfer of a project (docs/sync-plan.md S6): which
// project is still only its skeleton, which files a phone needs first, and how
// the files of a large turn are cut into batches.

import { parsePisiSyncJsonBytes } from './sync-actions.mjs';
import { getPisiSyncFileClass, getPisiSyncPathKey } from './sync-paths.mjs';

// Record lists of the authority and JSON files; a skeleton file has none.
const RECORD_KEYS = Object.freeze(['tasks', 'relationships', 'definitions', 'views', 'templates']);
// Actions that download the remote content of a file.
const FETCHING = new Set(['pull', 'merge', 'rename-merge', 'delete-with-copy', 'conflict-copy']);

export const PISI_SYNC_APPLY_BATCH = Object.freeze({ files: 50, bytes: 16 * 1024 * 1024 });

/**
 * True when a file of a project holds nothing of the user: the diary marker,
 * or an authority or JSON file with no records. A file that is not JSON is not
 * a skeleton file.
 */
export function isPisiSyncSkeletonFile(path, bytes) {
    const fileClass = getPisiSyncFileClass(path);
    if (fileClass === 'marker') return true;
    if (fileClass !== 'authority' && fileClass !== 'json') return false;
    const value = parsePisiSyncJsonBytes(bytes);
    if (!value) return false;
    return !RECORD_KEYS.some((key) => Array.isArray(value[key]) && value[key].length);
}

/**
 * True when a project is only its skeleton (empty `.pisi/` files and
 * `diary/.pisi-diary`). `files` lists `{ path }` of the project's synced
 * files and `read(path)` gives a file's bytes.
 */
export async function isPisiSyncSkeletonProject(files, read) {
    for (const file of files) {
        const fileClass = getPisiSyncFileClass(file.path);
        if (fileClass !== 'marker' && fileClass !== 'authority' && fileClass !== 'json') return false;
        if (!isPisiSyncSkeletonFile(file.path, fileClass === 'marker' ? null : await read(file.path))) return false;
    }
    return true;
}

/** `YYYY-MM-DD` of `date` on the device's clock. */
export function getPisiSyncLocalDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The files a phone's Pisi tab needs first: the authorities, the diary marker and today's diary entry (S6 step 2). */
export function isPisiSyncFirstPriorityPath(path, today) {
    const fileClass = getPisiSyncFileClass(path);
    if (fileClass === 'authority' || fileClass === 'marker') return true;
    return getPisiSyncPathKey(path) === getPisiSyncPathKey(`diary/${today}.node`);
}

/** The plain size an action downloads (0 when it downloads nothing). */
export function getPisiSyncActionDownloadSize(action) {
    if (!FETCHING.has(action.type)) return 0;
    const size = action.change?.meta?.size ?? action.from?.size ?? 0;
    return Number.isSafeInteger(size) && size > 0 ? size : 0;
}

export const isPisiSyncFetchingAction = (action) => FETCHING.has(action.type);

/**
 * Cuts a turn's sorted actions into batches that are written one after
 * another: at most `files` downloads or `bytes` downloaded bytes each. With
 * `priority(path)`, the actions of those paths come first, in a batch of their
 * own. Actions that download nothing join the batch they fall in.
 */
export function splitPisiSyncApplyBatches(actions, { files = PISI_SYNC_APPLY_BATCH.files, bytes = PISI_SYNC_APPLY_BATCH.bytes, priority = null } = {}) {
    const first = priority ? actions.filter((action) => action.path && priority(action.path)) : [];
    const rest = priority ? actions.filter((action) => !(action.path && priority(action.path))) : actions;
    const batches = first.length ? [first] : [];
    let current = [];
    let count = 0;
    let size = 0;
    for (const action of rest) {
        const fetching = isPisiSyncFetchingAction(action);
        const actionSize = getPisiSyncActionDownloadSize(action);
        if (fetching && current.length && (count + 1 > files || (size && size + actionSize > bytes))) {
            batches.push(current);
            current = [];
            count = 0;
            size = 0;
        }
        current.push(action);
        if (fetching) {
            count += 1;
            size += actionSize;
        }
    }
    if (current.length) batches.push(current);
    return batches;
}
