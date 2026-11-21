import * as path from 'node:path';
import * as storageLayer from './storage.js';
import { modules, registerMainModule } from '../module-registry.js';
import { makePisiTaskStoreData, readPisiTaskStore as readPisiTaskStoreDocument } from '../../shared/task-model.mjs';

// `.pisi/tasks.json` (docs/task-plan.md §3.1): the only place a task field is
// stored (GV1). Versions 1 and 2 are read, version 2 is written. A file that
// cannot be read stays as it is and the tasks are read-only (GV11). The record
// rules live in shared/task-model.mjs; the commands that change tasks are in
// task-service.js, which re-reads the file before every write (GV4).

const PISI_TASK_STORE_VERSION = 2;
const PISI_TASK_STORE_DIR = '.pisi';
const PISI_TASK_STORE_FILE = 'tasks.json';
const PISI_TASK_STORE_KEY = `${PISI_TASK_STORE_DIR}/${PISI_TASK_STORE_FILE}`;

// The last read per project, reused while the file's size and time stay the same.
const pisiTaskStoreCache = new Map();

function getPisiTaskStorage(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder);
}

function getPisiTaskStorePath(projectFolder) {
    return path.join(path.resolve(projectFolder), PISI_TASK_STORE_DIR, PISI_TASK_STORE_FILE);
}

function getPisiTaskStoreCacheKey(projectFolder) {
    const resolved = path.resolve(String(projectFolder || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getPisiTaskStoreSignature(storage) {
    const stat = storage.stat(PISI_TASK_STORE_KEY);
    if (!stat.ok || !stat.stat) return 'missing';
    return `${stat.stat.size}:${stat.stat.mtimeMs}`;
}

/**
 * The store as it is on disk: `{ ok: true, readOnly: false, version, data, tasks }`
 * (`data` the whole document, `tasks` the records as stored), or, for a file
 * that cannot be read, `{ ok: true, readOnly: true, error, tasks: [] }`.
 * `fresh: true` skips the cache (every write path uses it).
 */
function readPisiTaskStoreState(projectFolder, { fresh = false } = {}) {
    const storage = getPisiTaskStorage(projectFolder);
    const cacheKey = getPisiTaskStoreCacheKey(projectFolder);
    const signature = getPisiTaskStoreSignature(storage);
    const cached = pisiTaskStoreCache.get(cacheKey);
    if (!fresh && cached && cached.signature === signature) return cached.state;

    let state;
    if (signature === 'missing') {
        state = { ok: true, readOnly: false, missing: true, version: PISI_TASK_STORE_VERSION, data: null, tasks: [] };
    } else {
        const result = storage.readJson(PISI_TASK_STORE_KEY, { allowMissing: true });
        const read = result.ok && !result.missing ? readPisiTaskStoreDocument(result.data) : { ok: false, error: result.error || 'missing' };
        state = read.ok
            ? { ok: true, readOnly: false, missing: false, version: read.version, data: result.data, tasks: read.tasks }
            : { ok: true, readOnly: true, missing: false, error: `Görev deposu okunamadı: ${read.error}`, version: null, data: null, tasks: [] };
    }
    pisiTaskStoreCache.set(cacheKey, { signature, state });
    return state;
}

/** The records as stored; throws when the file cannot be read (callers that must not write over it). */
function readPisiTaskStore(projectFolder) {
    const state = readPisiTaskStoreState(projectFolder, { fresh: true });
    if (state.readOnly) {
        const error = new Error(state.error);
        error.code = 'TASK_STORE_READ_ONLY';
        throw error;
    }
    return state;
}

/**
 * Writes `tasks` as the store's records: version 2, every other top-level key
 * of `state.data` kept (GV12). Refuses a store that could not be read (GV11).
 */
function writePisiTaskStore(projectFolder, state, tasks, { now = new Date() } = {}) {
    if (state?.readOnly) {
        const error = new Error(state.error || 'Görev deposu salt okunur.');
        error.code = 'TASK_STORE_READ_ONLY';
        throw error;
    }
    const storage = getPisiTaskStorage(projectFolder);
    const ensured = storage.ensureDirectory(PISI_TASK_STORE_DIR, { hidden: true });
    if (!ensured.ok) throw new Error(ensured.error || 'Görev deposu klasörü oluşturulamadı.');
    const data = makePisiTaskStoreData(state?.data, Array.isArray(tasks) ? tasks : [], { now });
    const written = storage.writeJson(PISI_TASK_STORE_KEY, data, { backup: true, newline: true, hiddenParent: true });
    if (!written.ok) throw new Error(written.error || 'Görev deposu yazılamadı.');
    pisiTaskStoreCache.delete(getPisiTaskStoreCacheKey(projectFolder));
    // Reminders are planned from tasks.json; a write re-plans them.
    modules['main.reminderService']?.handlePisiReminderTasksChanged?.();
    return { ok: true, readOnly: false, missing: false, version: PISI_TASK_STORE_VERSION, data, tasks: data.tasks };
}

function forgetPisiTaskStoreCache(projectFolder) {
    if (projectFolder) pisiTaskStoreCache.delete(getPisiTaskStoreCacheKey(projectFolder));
    else pisiTaskStoreCache.clear();
}

const moduleApi = {
    PISI_TASK_STORE_VERSION,
    PISI_TASK_STORE_KEY,
    getPisiTaskStorePath,
    readPisiTaskStoreState,
    readPisiTaskStore,
    writePisiTaskStore,
    forgetPisiTaskStoreCache
};

registerMainModule('main.taskStore', moduleApi);
