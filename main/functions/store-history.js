import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import {
    PISI_STORE_HISTORY_FILES,
    PISI_STORE_HISTORY_INTERVAL_MS,
    createPisiStoreHistoryScheduler,
    listPisiStoreHistory,
    readPisiStoreHistoryVersion,
    resolvePisiStoreHistoryTarget,
    snapshotPisiStoreFile,
    summarizePisiStoreContent
} from './store-history-core.js';
import { diffPisiStoreVersion } from './store-history-diff-core.js';

// Canonical store history in the running app: snapshots are taken from the
// atomic write path (before a store file is overwritten, at most once per
// five minutes per store) and when the project closes or the app quits.
// Restores run inside an atomic mutation, keep a before-restore snapshot and,
// for tasks, write missing task blocks back into their notes.

const domain = modules['main.domainCommandQuery'];
const electronIpc = modules['main.electronIpc'];
const filesystemCore = modules['main.filesystemCore'];
const historyState = { scheduler: null, root: null, busy: false, mapIds: new Map() };
const PISI_STORE_KINDS = new Set(Object.values(PISI_STORE_HISTORY_FILES));

function getPisiStoreHistoryInterval() {
    // Test-only override; production always uses five minutes.
    const override = !app.isPackaged ? Number(process.env.PISI_TEST_STORE_HISTORY_INTERVAL_MS) : NaN;
    return Number.isFinite(override) && override >= 0 ? override : PISI_STORE_HISTORY_INTERVAL_MS;
}

function readCachedPisiMapId(filePath) {
    const key = path.resolve(filePath);
    if (historyState.mapIds.has(key)) return historyState.mapIds.get(key);
    let id = null;
    try {
        id = JSON.parse(fs.readFileSync(key, 'utf8'))?.pisi?.id || null;
    } catch {
        id = null;
    }
    if (id) historyState.mapIds.set(key, id);
    return id;
}

function getPisiStoreHistoryScheduler(root) {
    if (historyState.scheduler && historyState.root === root) return historyState.scheduler;
    flushPisiStoreHistory('project-change');
    historyState.root = root;
    historyState.mapIds.clear();
    historyState.scheduler = createPisiStoreHistoryScheduler({
        interval: getPisiStoreHistoryInterval(),
        lastSnapshotAt: (target) => listPisiStoreHistory(root, target.key)[0]?.capturedAt || null,
        snapshot: (target, reason) => snapshotPisiStoreFile(root, target, { reason, writeFileAtomic: filesystemCore.writeFileAtomic })
    });
    return historyState.scheduler;
}

/** Atomic write listener: snapshot a store's previous state when due. */
function handlePisiStoreHistoryWrite(targetPath) {
    const root = globalThis.activeProjectFolder;
    if (!root || historyState.busy) return null;
    const relative = path.relative(root, targetPath);
    if (!relative || relative.startsWith('..') || relative.startsWith('.pisi-history')) return null;
    const target = resolvePisiStoreHistoryTarget(root, targetPath, { readMapId: readCachedPisiMapId });
    if (!target) return null;
    historyState.busy = true;
    try {
        return getPisiStoreHistoryScheduler(root).beforeWrite(target);
    } catch (error) {
        console.warn('[PISI] Depo geçmişi alınamadı:', error?.message || error);
        return null;
    } finally {
        historyState.busy = false;
    }
}

/** Snapshots the latest state of every store changed since its last snapshot. */
function flushPisiStoreHistory(reason = 'close') {
    const scheduler = historyState.scheduler;
    if (!scheduler) return [];
    historyState.busy = true;
    try {
        return scheduler.flush(reason);
    } catch (error) {
        console.warn('[PISI] Depo geçmişi kapanışta alınamadı:', error?.message || error);
        return [];
    } finally {
        historyState.busy = false;
    }
}

function getPisiActiveHistoryProject() {
    const root = globalThis.activeProjectFolder;
    if (!root) throw new Error('Açık proje yok.');
    return root;
}

/** The history target for a payload: { store: 'tasks'|'relationships'|..., mapPath? }. */
function resolvePisiStoreHistoryPayload(payload = {}) {
    const root = getPisiActiveHistoryProject();
    const store = String(payload.store || '');
    if (store === 'map') {
        const mapPath = electronIpc.assertProjectPath(payload.mapPath, { type: 'file', extensions: ['.map'] });
        const target = resolvePisiStoreHistoryTarget(root, mapPath, { readMapId: readCachedPisiMapId });
        if (!target) throw new Error('Harita kimliği okunamadı.');
        return { root, target };
    }
    if (!PISI_STORE_KINDS.has(store)) throw new Error('Bilinmeyen geçmiş türü.');
    const relativePath = Object.keys(PISI_STORE_HISTORY_FILES).find((file) => PISI_STORE_HISTORY_FILES[file] === store);
    return { root, target: { key: store, kind: store, filePath: path.join(root, relativePath), relativePath } };
}

function readPisiCurrentStore(target) {
    try {
        return JSON.parse(fs.readFileSync(target.filePath, 'utf8'));
    } catch {
        return null;
    }
}

function listPisiStoreHistoryForPayload(payload = {}) {
    const { root, target } = resolvePisiStoreHistoryPayload(payload);
    const current = readPisiCurrentStore(target);
    return {
        ok: true,
        key: target.key,
        current: { summary: current ? summarizePisiStoreContent(target.kind, current) : '' },
        versions: listPisiStoreHistory(root, target.key).map((entry) => ({
            historyId: entry.historyId,
            capturedAt: entry.capturedAt,
            reason: entry.reason,
            summary: entry.preview,
            size: entry.size
        }))
    };
}

function previewPisiStoreHistoryForPayload(payload = {}) {
    const { root, target } = resolvePisiStoreHistoryPayload(payload);
    const version = readPisiStoreHistoryVersion(root, target.key, String(payload.historyId || ''));
    if (!version.ok) return version;
    return {
        ok: true,
        historyId: version.historyId,
        capturedAt: version.capturedAt,
        diff: diffPisiStoreVersion(target.kind, readPisiCurrentStore(target), version.data)
    };
}

function escapePisiTaskText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** A task block in the quick-capture format, with the task's own block id and tag (so its id stays the same). */
function makePisiRestoredTaskBlock(task) {
    const tag = escapePisiTaskText(String(task.todoTag || `todo.${task.priority || 3}.none`).toLowerCase());
    const status = task.status === 'done' ? 'done' : 'todo';
    const done = status === 'done' ? ' <span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="done" contenteditable="false">done</span>' : '';
    return (
        `<div class="pisi-editor-block" data-pisi-block-id="${escapePisiTaskText(task.source.blockId)}">` +
        `<span class="pisi-todo-source" data-pisi-todo-for="${tag}">${escapePisiTaskText(task.title)}</span> ` +
        `<span class="pisi-user-tag" data-pisi-tag="${tag}" data-pisi-todo-status="${status}" contenteditable="false">${tag}</span>${done}</div>`
    );
}

/**
 * After tasks.json is restored: a task whose block is missing from its source
 * note gets the block back (appended to the note). Notes that no longer exist
 * are left alone; Project Integrity reports their tasks.
 */
function restorePisiTaskProjections(root, data) {
    const byNote = new Map();
    for (const task of Array.isArray(data?.tasks) ? data.tasks : []) {
        const stored = task?.source?.nodePath;
        if (!stored || !task.source.blockId) continue;
        const nodePath = path.isAbsolute(stored) ? stored : path.resolve(root, stored);
        if (!byNote.has(nodePath)) byNote.set(nodePath, []);
        byNote.get(nodePath).push(task);
    }
    const restoredBlocks = [];
    for (const [nodePath, tasks] of byNote) {
        if (!fs.existsSync(nodePath)) continue;
        const document = modules['main.mapStore'].getPisiDocument(nodePath);
        if (!document?.ok) continue;
        let content = String(document.data.content || '');
        const added = tasks.filter((task) => !content.includes(`data-pisi-block-id="${task.source.blockId}"`));
        if (!added.length) continue;
        content = [content.trim(), ...added.map(makePisiRestoredTaskBlock)].filter(Boolean).join('\n');
        filesystemCore.writePisiDocument(nodePath, { ...document.data, content });
        restoredBlocks.push(...added.map((task) => ({ taskId: task.id, nodePath })));
    }
    return restoredBlocks;
}

/** history.store.restore.v1 — runs inside the project atomic mutation. */
function restorePisiStoreHistoryForPayload(payload = {}) {
    const { root, target } = resolvePisiStoreHistoryPayload(payload);
    const version = readPisiStoreHistoryVersion(root, target.key, String(payload.historyId || ''));
    if (!version.ok) return version;
    if (!version.data) return { ok: false, code: 'HISTORY_VERSION_UNREADABLE', error: 'Bu sürüm okunamıyor; geri yüklenemez.' };
    const scheduler = getPisiStoreHistoryScheduler(root);
    historyState.busy = true;
    try {
        const before = fs.existsSync(target.filePath) ? scheduler.snapshotNow(target, 'before-restore') : { ok: true, skipped: true };
        if (!before.ok) return before;
        let text = version.raw;
        if (target.kind === 'map') {
            // Like note history: restore the map's content, keep its current identity, title and sidecar.
            const current = readPisiCurrentStore(target);
            if (current?.pisi?.id && current.pisi.id !== version.data?.pisi?.id) return { ok: false, error: 'Sürüm başka bir haritaya ait.' };
            text = JSON.stringify({ ...version.data, pisi: { ...(current?.pisi || version.data.pisi), updatedAt: new Date().toISOString() } }, null, 2) + '\n';
        }
        fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
        filesystemCore.writeFileAtomic(target.filePath, text, { backup: true });
        const restoredBlocks = target.kind === 'tasks' ? restorePisiTaskProjections(root, version.data) : [];
        if (target.kind === 'tasks') modules['main.reminderService']?.handlePisiReminderTasksChanged?.();
        return { ok: true, key: target.key, restoredHistoryId: version.historyId, beforeRestoreHistoryId: before.historyId || null, restoredBlocks };
    } finally {
        historyState.busy = false;
    }
}

/** Maps with a store history: their key, current path and title (if the map still exists). */
async function listPisiMapHistoryForPayload() {
    const root = getPisiActiveHistoryProject();
    const storesFolder = path.join(root, '.pisi-history', 'stores');
    const keys = fs.existsSync(storesFolder) ? fs.readdirSync(storesFolder).filter((name) => name.startsWith('map-')) : [];
    const maps = await modules['main.projectRead'].runPisiProjectRead('walk', { root, options: { order: 'dfs', skipHidden: true, pattern: '\\.map$' } });
    const byId = new Map();
    for (const mapPath of maps) {
        const id = readCachedPisiMapId(mapPath);
        if (id) byId.set(id, mapPath);
    }
    return {
        ok: true,
        maps: keys.map((key) => {
            const mapId = key.slice(4);
            const mapPath = byId.get(mapId) || null;
            const versions = listPisiStoreHistory(root, key);
            return {
                key,
                mapId,
                mapPath,
                title: mapPath ? path.basename(mapPath, '.map') : mapId,
                versions: versions.length,
                lastCapturedAt: versions[0]?.capturedAt || null
            };
        })
    };
}

function installPisiStoreHistory() {
    filesystemCore.addPisiAtomicWriteListener(handlePisiStoreHistoryWrite);
    domain.registerPisiDomainQuery('history.store.list.v1', listPisiStoreHistoryForPayload);
    domain.registerPisiDomainQuery('history.store.preview.v1', previewPisiStoreHistoryForPayload);
    domain.registerPisiDomainQuery('history.maps.list.v1', listPisiMapHistoryForPayload);
    domain.registerPisiDomainCommand('history.store.restore.v1', restorePisiStoreHistoryForPayload);
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('history.store.restore.v1');
    app.on('before-quit', () => flushPisiStoreHistory('quit'));
}

const moduleApi = {
    handlePisiStoreHistoryWrite,
    flushPisiStoreHistory,
    restorePisiStoreHistoryForPayload,
    restorePisiTaskProjections,
    installPisiStoreHistory
};

registerMainModule('main.storeHistory', moduleApi);
installPisiStoreHistory();
