// Paths of the sync system (docs/sync-protocol.md §4.5, docs/sync-plan.md §3.3,
// rule SV7). One place says which project paths are synced, which ones are
// unsafe, how a path is folded into the input of its fid, and which class a
// file belongs to. Looking at the disk (symbolic links, paths that resolve
// outside the project, file sizes) stays with the caller.

import { isPisiManagedSidecarFolder } from './document-naming.mjs';

export const PISI_SYNC_FILE_CLASSES = Object.freeze(['node', 'map', 'authority', 'json', 'marker', 'asset', 'other']);
export const PISI_SYNC_AUTHORITY_PATHS = Object.freeze(['.pisi/tasks.json', '.pisi/relationships.json', '.pisi/properties.json']);
export const PISI_SYNC_DIARY_MARKER = 'diary/.pisi-diary';
export const PISI_SYNC_ASSET_FOLDERS = Object.freeze(['image', 'file', 'paint', 'sheet']);
// Default of GET /v1/info limits.maxBlobBytes (sealed size).
export const PISI_SYNC_DEFAULT_MAX_BLOB_BYTES = 64 * 1024 * 1024;

const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;
// Folders that are never synced, wherever they are in the project.
const EXCLUDED_ANYWHERE = new Set(['.git', 'node_modules', '.pisi.lock']);
// Folders and files that are never synced at the project root (docs/sync-plan.md §3.3).
const EXCLUDED_ROOT_FOLDERS = new Set(['.pisi-sync', '.pisi-history']);
// `backups` (atomic write and corrupt-file backups) and `sync-trash` (the closed legacy sync) are device-local recovery data.
const EXCLUDED_PISI_ENTRIES = new Set(['mutations', 'trash', 'backups', 'sync-trash', 'sync-state.json', 'reminder-state.json']);
const EXCLUDED_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const EXCLUDED_FILE_PATTERNS = Object.freeze([/\.tmp$/i, /^\..*\.mobile-.*\.tmp$/i, /\.pisi-backup$/i, /^~\$/]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_INVALID = /[<>:"|?*]/;
const ASSET_FILE_NAME = /^([0-9a-f]{64})(?:\.[A-Za-z0-9]{1,16})?$/;
const DIARY_FILE = /^diary\/(\d{4})-(\d{2})-(\d{2})\.node$/;

/** Byte length of a string in UTF-8, without TextEncoder. */
export function getUtf8ByteLength(value) {
    let bytes = 0;
    for (const char of String(value)) {
        const code = char.codePointAt(0);
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
}

function hasLoneSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}

/**
 * Checks the text of a project-relative path (§4.5). Returns `{ ok: true, path }`
 * with the NFC form, or `{ ok: false, reason }`. Reasons: `type`, `empty`,
 * `backslash`, `absolute`, `control`, `encoding`, `dot-segment`,
 * `empty-segment`, `windows-character`, `trailing`, `segment-too-long`,
 * `path-too-long`, `excluded`.
 */
export function checkPisiSyncPath(value) {
    if (typeof value !== 'string') return { ok: false, reason: 'type' };
    if (!value) return { ok: false, reason: 'empty' };
    if (value.includes('\\')) return { ok: false, reason: 'backslash' };
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return { ok: false, reason: 'absolute' };
    if (CONTROL_CHARACTERS.test(value)) return { ok: false, reason: 'control' };
    if (hasLoneSurrogate(value)) return { ok: false, reason: 'encoding' };
    const path = value.normalize('NFC');
    if (getUtf8ByteLength(path) > MAX_PATH_BYTES) return { ok: false, reason: 'path-too-long' };
    for (const segment of path.split('/')) {
        if (!segment) return { ok: false, reason: 'empty-segment' };
        if (segment === '.' || segment === '..') return { ok: false, reason: 'dot-segment' };
        if (WINDOWS_INVALID.test(segment)) return { ok: false, reason: 'windows-character' };
        if (/[ .]$/.test(segment)) return { ok: false, reason: 'trailing' };
        if (getUtf8ByteLength(segment) > MAX_SEGMENT_BYTES) return { ok: false, reason: 'segment-too-long' };
    }
    if (isPisiSyncExcludedPath(path)) return { ok: false, reason: 'excluded' };
    return { ok: true, path };
}

/** The NFC form of a safe, synced path, or null (§4.5). */
export function normalizePisiSyncPath(value) {
    const checked = checkPisiSyncPath(value);
    return checked.ok ? checked.path : null;
}

/**
 * Whether a path (a file, or a folder given with or without a trailing '/')
 * is kept out of sync by docs/sync-plan.md §3.3. Only the text is judged.
 */
export function isPisiSyncExcludedPath(value) {
    const segments = String(value || '')
        .normalize('NFC')
        .split('/')
        .filter(Boolean);
    if (!segments.length) return true;
    const lower = segments.map((segment) => segment.toLowerCase());
    if (lower.some((segment) => EXCLUDED_ANYWHERE.has(segment))) return true;
    if (EXCLUDED_ROOT_FOLDERS.has(lower[0])) return true;
    if (lower[0] === '.pisi' && lower.length > 1 && EXCLUDED_PISI_ENTRIES.has(lower[1])) return true;
    const name = segments.at(-1);
    if (EXCLUDED_FILE_NAMES.has(name.toLowerCase())) return true;
    return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * The input of a path's fid: NFC(NFC(path).toLowerCase()), with JavaScript's
 * locale-independent case folding (§4.5). Paths that differ only in case
 * share a key, so they are the same file on every device.
 */
export function getPisiSyncPathKey(path) {
    return String(path).normalize('NFC').toLowerCase().normalize('NFC');
}

/** The content address of an attachment path (`…/image/<sha256>.png`): the hex digest, or null. */
export function getPisiSyncAssetDigest(path) {
    const name = String(path).split('/').at(-1);
    return ASSET_FILE_NAME.exec(name)?.[1] ?? null;
}

/** Index of the managed `inv_…` note sidecar that holds `path` as an attachment, or -1. */
function findAssetSidecar(segments) {
    for (let index = segments.length - 3; index >= 0; index -= 1) {
        const folder = segments[index];
        if (folder.startsWith('inv_') && isPisiManagedSidecarFolder(folder) && PISI_SYNC_ASSET_FOLDERS.includes(segments[index + 1])) return index;
    }
    return -1;
}

/**
 * Class of a synced file (docs/sync-plan.md §3.3): `node`, `map`,
 * `authority`, `json`, `marker`, `asset` or `other`. It decides how the file
 * is merged and whether the phone downloads it at once.
 */
export function getPisiSyncFileClass(path) {
    const value = String(path).normalize('NFC');
    const lower = value.toLowerCase();
    const segments = value.split('/');
    const name = lower.split('/').at(-1);
    if (lower.endsWith('.node')) return 'node';
    if (lower.endsWith('.map')) return 'map';
    if (PISI_SYNC_AUTHORITY_PATHS.includes(lower)) return 'authority';
    if (lower === PISI_SYNC_DIARY_MARKER) return 'marker';
    if ((segments.length === 2 && lower.startsWith('.pisi/') && name.endsWith('.json')) || /^\.pisi-[^/]*\.json$/.test(name)) return 'json';
    if (findAssetSidecar(segments) >= 0 && getPisiSyncAssetDigest(value)) return 'asset';
    return 'other';
}

/** Whether the content of a class is JSON that can be merged three ways (rule SV10 applies to it). */
export function isPisiSyncMergeableClass(fileClass) {
    return fileClass === 'node' || fileClass === 'map' || fileClass === 'authority' || fileClass === 'json';
}

/** Whether a class is gzip-compressed before it is sealed (docs/sync-protocol.md §4.4). */
export function isPisiSyncCompressedClass(fileClass) {
    return isPisiSyncMergeableClass(fileClass);
}

/** The date of a diary note path (`diary/YYYY-MM-DD.node`), or null. */
export function getPisiSyncDiaryDate(path) {
    const match = DIARY_FILE.exec(String(path).normalize('NFC'));
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Folder of a path ('' for the project root). */
export function getPisiSyncParentPath(path) {
    const value = String(path);
    const slash = value.lastIndexOf('/');
    return slash < 0 ? '' : value.slice(0, slash);
}

/** `folder/name`, or `name` at the root. */
export function joinPisiSyncPath(folder, name) {
    return folder ? `${folder}/${name}` : name;
}

/**
 * Groups of paths that fold to the same key (§4.5). Neither path of a group is
 * sent: the caller shows them as PATH_COLLISION. Each group is sorted.
 */
export function findPisiSyncPathCollisions(paths) {
    const byKey = new Map();
    for (const path of paths) {
        const key = getPisiSyncPathKey(path);
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key).add(String(path).normalize('NFC'));
    }
    return [...byKey.values()]
        .filter((group) => group.size > 1)
        .map((group) => [...group].sort())
        .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}
