import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    PISI_VERSION_HISTORY_FORMAT_VERSION,
    getPisiVersionHistoryEntries,
    isPisiVersionHistoryId,
    readPisiVersionHistorySnapshotFile,
    writePisiVersionHistorySnapshot
} from './version-history-core.js';

// Version history for canonical project stores (tasks, relationships,
// properties, saved views, templates) and maps, on the note-history format:
// gzip snapshots plus index.json under .pisi-history/stores/<key>/. Each
// snapshot keeps the store file's exact text so a restore writes back exactly
// what was there. Maps are keyed by their Pisi id, so renames and moves keep
// one history. No Electron; unit-tested.

export const PISI_STORE_HISTORY_INTERVAL_MS = 5 * 60 * 1000;
const MiB = 1024 * 1024;

/** Retention per store (docs/version-history-cost.md). The newest version is always kept. */
export const PISI_STORE_HISTORY_BUDGETS = Object.freeze({
    tasks: { maxVersions: 50, maxBytes: 24 * MiB },
    relationships: { maxVersions: 50, maxBytes: 24 * MiB },
    properties: { maxVersions: 50, maxBytes: 24 * MiB },
    views: { maxVersions: 30, maxBytes: 4 * MiB },
    templates: { maxVersions: 30, maxBytes: 4 * MiB },
    map: { maxVersions: 30, maxBytes: 8 * MiB }
});

/** The fixed store files, relative to the project root (forward slashes). */
/** @type {Readonly<Record<string, string>>} */
export const PISI_STORE_HISTORY_FILES = Object.freeze({
    '.pisi/tasks.json': 'tasks',
    '.pisi/relationships.json': 'relationships',
    '.pisi/properties.json': 'properties',
    '.pisi-views.json': 'views',
    '.pisi-templates.json': 'templates'
});

const PISI_MAP_ID = /^map_[A-Za-z0-9_-]{1,80}$/;

export function getPisiStoreHistoryDirectory(projectFolder, key) {
    return path.join(path.resolve(projectFolder), '.pisi-history', 'stores', key);
}

function toRelative(projectFolder, filePath) {
    const relative = path.relative(path.resolve(projectFolder), path.resolve(filePath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join('/');
}

/**
 * The history target of a project file, or null. Maps need their id, read
 * from the file (`readMapId` may be injected for tests).
 * @returns {{ key: string, kind: string, filePath: string, relativePath: string, mapId?: string } | null}
 */
export function resolvePisiStoreHistoryTarget(projectFolder, filePath, options = {}) {
    const relativePath = toRelative(projectFolder, filePath);
    if (!relativePath) return null;
    const fixed = PISI_STORE_HISTORY_FILES[relativePath];
    if (fixed) return { key: fixed, kind: fixed, filePath: path.resolve(filePath), relativePath };
    if (!relativePath.toLowerCase().endsWith('.map')) return null;
    // Maps inside hidden folders (trash, history, sync) are not live maps.
    if (relativePath.split('/').some((part) => part.startsWith('.'))) return null;
    const readMapId = options.readMapId || readPisiMapId;
    const mapId = readMapId(filePath);
    if (!PISI_MAP_ID.test(String(mapId || ''))) return null;
    return { key: `map-${mapId}`, kind: 'map', filePath: path.resolve(filePath), relativePath, mapId };
}

function readPisiMapId(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))?.pisi?.id || null;
    } catch {
        return null;
    }
}

/** True when a store may be snapshotted again: never before, or the interval has passed. */
export function isPisiStoreSnapshotDue(lastSnapshotAt, now, interval = PISI_STORE_HISTORY_INTERVAL_MS) {
    const last = Date.parse(String(lastSnapshotAt || ''));
    return !Number.isFinite(last) || now - last >= interval;
}

/** A short summary of a store's content for the history list ("14 görev"). */
export function summarizePisiStoreContent(kind, data) {
    if (kind === 'tasks') return `${Array.isArray(data?.tasks) ? data.tasks.length : 0} görev`;
    if (kind === 'relationships') return `${Array.isArray(data?.relationships) ? data.relationships.length : 0} bağlantı`;
    if (kind === 'map') return `${Array.isArray(data?.map?.nodes) ? data.map.nodes.length : 0} not kartı`;
    if (kind === 'properties') return `${Array.isArray(data?.properties) ? data.properties.length : Object.keys(data?.properties || {}).length} özellik`;
    if (kind === 'views') return `${Array.isArray(data?.views) ? data.views.length : 0} görünüm`;
    if (kind === 'templates') return `${Array.isArray(data?.templates) ? data.templates.length : 0} şablon`;
    return '';
}

export function getPisiStoreHistoryBudget(kind) {
    return PISI_STORE_HISTORY_BUDGETS[kind] || PISI_STORE_HISTORY_BUDGETS.map;
}

/** Newest entries first. */
export function listPisiStoreHistory(projectFolder, key) {
    const directory = getPisiStoreHistoryDirectory(projectFolder, key);
    if (!fs.existsSync(directory)) return [];
    return getPisiVersionHistoryEntries(directory);
}

/**
 * Snapshots the current text of a store file. Identical content (same hash as
 * any retained version) is skipped.
 * @param {string} projectFolder
 * @param {{ key: string, kind: string, filePath: string, relativePath: string }} target
 * @param {{ reason?: string, now?: number, writeFileAtomic?: Function }} [options]
 */
export function snapshotPisiStoreFile(projectFolder, target, options = {}) {
    if (!target || !fs.existsSync(target.filePath)) return { ok: true, skipped: true, missing: true };
    const raw = fs.readFileSync(target.filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const directory = getPisiStoreHistoryDirectory(projectFolder, target.key);
    const existingEntries = fs.existsSync(directory) ? getPisiVersionHistoryEntries(directory) : [];
    if (existingEntries.some((entry) => entry.hash === hash)) return { ok: true, skipped: true, duplicate: true };
    let data = null;
    try {
        data = JSON.parse(raw);
    } catch {
        // A broken store is still worth keeping as text; it has no summary.
    }
    const snapshot = {
        version: PISI_VERSION_HISTORY_FORMAT_VERSION,
        kind: 'store',
        key: target.key,
        storeKind: target.kind,
        reason: String(options.reason || 'auto').slice(0, 80),
        capturedAt: new Date(options.now ?? Date.now()).toISOString(),
        path: target.relativePath,
        hash,
        summary: data ? summarizePisiStoreContent(target.kind, data) : '',
        raw
    };
    const written = writePisiVersionHistorySnapshot(directory, snapshot, {
        ...getPisiStoreHistoryBudget(target.kind),
        existingEntries,
        writeFileAtomic: options.writeFileAtomic
    });
    return { ok: true, historyId: written.historyId, retainedVersions: written.retention.keep.length, storageBytes: written.retention.bytes };
}

/** One stored version: its text, parsed data (or null) and metadata. */
export function readPisiStoreHistoryVersion(projectFolder, key, historyId) {
    if (!isPisiVersionHistoryId(historyId)) return { ok: false, error: 'Geçersiz sürüm kimliği.' };
    const result = readPisiVersionHistorySnapshotFile(path.join(getPisiStoreHistoryDirectory(projectFolder, key), historyId));
    if (!result.ok || result.data?.kind !== 'store' || result.data.key !== key) return { ok: false, error: result.error || 'Sürüm bulunamadı.' };
    let data = null;
    try {
        data = JSON.parse(result.data.raw);
    } catch {
        data = null;
    }
    return { ok: true, historyId, capturedAt: result.data.capturedAt, reason: result.data.reason, path: result.data.path, raw: result.data.raw, data };
}

/**
 * When store snapshots are taken. Before a store file is overwritten, its
 * current text is snapshotted if the store has no snapshot within the
 * interval, so the state before a change can be restored. The store is then
 * dirty; `flush` (project close, quit) snapshots every dirty store's latest
 * state. At most one automatic snapshot per store per interval.
 * @param {{ now?: () => number, interval?: number, lastSnapshotAt: (target: object) => string | null,
 *   snapshot: (target: object, reason: string) => { ok: boolean, historyId?: string, skipped?: boolean } }} options
 */
export function createPisiStoreHistoryScheduler(options) {
    const now = options.now || (() => Date.now());
    const interval = options.interval ?? PISI_STORE_HISTORY_INTERVAL_MS;
    const lastByKey = new Map();
    const dirty = new Map();

    const lastSnapshot = (target) => {
        if (!lastByKey.has(target.key)) lastByKey.set(target.key, options.lastSnapshotAt(target) || null);
        return lastByKey.get(target.key);
    };
    const take = (target, reason) => {
        const result = options.snapshot(target, reason);
        if (result?.ok && result.historyId) lastByKey.set(target.key, new Date(now()).toISOString());
        return result;
    };

    return {
        /** Called right before `target.filePath` is overwritten. */
        beforeWrite(target) {
            let result = null;
            if (isPisiStoreSnapshotDue(lastSnapshot(target), now(), interval)) result = take(target, 'auto');
            dirty.set(target.key, target);
            return result;
        },
        /** Snapshots the latest state of every store written since its last snapshot. */
        flush(reason = 'close') {
            const results = [];
            for (const target of dirty.values()) results.push(take(target, reason));
            dirty.clear();
            return results;
        },
        /** Snapshots one store now, whatever the interval (e.g. before a restore). */
        snapshotNow(target, reason) {
            return take(target, reason);
        },
        dirtyKeys: () => [...dirty.keys()]
    };
}
