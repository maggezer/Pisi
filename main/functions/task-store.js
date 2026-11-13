import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as storageLayer from './storage.js';
import { modules, registerMainModule } from '../module-registry.js';
import { formatPisiSourceTaskId, formatPisiTaskId, normalizePisiTaskId, normalizePisiTaskIdentityPath } from '../../shared/ids.mjs';
import { normalizePisiFirstClassTaskIso, normalizePisiTaskRecord, parsePisiTaskDueDateFromTag, parsePisiTaskPriority } from '../../shared/task-model.mjs';

const PISI_TASK_STORE_VERSION = 1;
const PISI_TASK_STORE_DIR = '.pisi';
const PISI_TASK_STORE_FILE = 'tasks.json';
const PISI_TASK_STORE_KEY = `${PISI_TASK_STORE_DIR}/${PISI_TASK_STORE_FILE}`;

function getPisiTaskStorage(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder);
}

function getPisiTaskStoreDirectory(projectFolder) {
    return path.join(path.resolve(projectFolder), PISI_TASK_STORE_DIR);
}

function getPisiTaskStorePath(projectFolder) {
    return path.join(getPisiTaskStoreDirectory(projectFolder), PISI_TASK_STORE_FILE);
}

function isPisiTaskPathInsideProject(projectFolder, targetPath) {
    if (!projectFolder || !targetPath) return false;
    const root = path.resolve(projectFolder);
    const resolved = path.resolve(targetPath);
    const relative = path.relative(root, resolved);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizePisiTaskStoredPath(projectFolder, targetPath) {
    if (!targetPath) return null;
    const raw = String(targetPath).trim();
    if (!raw) return null;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectFolder, raw.replace(/\//g, path.sep));
    if (!isPisiTaskPathInsideProject(projectFolder, resolved)) {
        throw new Error('Görev kaynağı proje klasörünün dışında olamaz.');
    }
    return path.relative(path.resolve(projectFolder), resolved).replace(/\\/g, '/');
}

function hydratePisiTaskStoredPath(projectFolder, storedPath) {
    if (!storedPath) return null;
    const resolved = path.resolve(projectFolder, String(storedPath).replace(/\//g, path.sep));
    return isPisiTaskPathInsideProject(projectFolder, resolved) ? resolved : null;
}

function ensurePisiTaskStoreDirectory(projectFolder) {
    const storage = getPisiTaskStorage(projectFolder);
    const ensured = storage.ensureDirectory(PISI_TASK_STORE_DIR, { hidden: true });
    if (!ensured.ok) {
        throw new Error(ensured.error || 'Görev deposu klasörü oluşturulamadı.');
    }
    return ensured.path;
}

function readPisiTaskStore(projectFolder) {
    const storage = getPisiTaskStorage(projectFolder);
    const result = storage.readJson(PISI_TASK_STORE_KEY, { allowMissing: true });
    if (result.missing) {
        return {
            version: PISI_TASK_STORE_VERSION,
            updatedAt: null,
            tasks: []
        };
    }
    if (!result.ok || !result.data || !Array.isArray(result.data.tasks)) {
        throw new Error(`Görev deposu okunamadı: ${result.error || 'Geçersiz tasks.json'}`);
    }
    return {
        version: PISI_TASK_STORE_VERSION,
        updatedAt: result.data.updatedAt || null,
        tasks: result.data.tasks.filter((task) => task && typeof task === 'object')
    };
}

function writePisiTaskStore(projectFolder, store) {
    ensurePisiTaskStoreDirectory(projectFolder);
    const storage = getPisiTaskStorage(projectFolder);
    const data = {
        version: PISI_TASK_STORE_VERSION,
        updatedAt: new Date().toISOString(),
        tasks: Array.isArray(store?.tasks) ? store.tasks : []
    };
    const written = storage.writeJson(PISI_TASK_STORE_KEY, data, {
        backup: true,
        newline: true,
        hiddenParent: true
    });
    if (!written.ok) {
        throw new Error(written.error || 'Görev deposu yazılamadı.');
    }
    // Reminders are planned from tasks.json; a write re-plans them.
    modules['main.reminderService']?.handlePisiReminderTasksChanged?.();
    return data;
}

// The task record rules (ids, dates, status, repeat, dependencies, field order)
// live in shared/task-model.mjs and shared/ids.mjs, which the mobile app uses
// as well. Randomness, the clock and path resolution stay here.

function normalizePisiFirstClassTaskId(value) {
    return normalizePisiTaskId(value) || formatPisiTaskId(crypto.randomUUID());
}

function normalizePisiFirstClassTask(projectFolder, payload = {}, existing = null) {
    return normalizePisiTaskRecord(payload, existing, {
        now: new Date(),
        makeUuid: () => crypto.randomUUID(),
        normalizeStoredPath: (targetPath) => normalizePisiTaskStoredPath(projectFolder, targetPath)
    });
}

function hydratePisiFirstClassTask(projectFolder, task) {
    return {
        ...task,
        source: {
            ...(task.source || {}),
            nodePath: hydratePisiTaskStoredPath(projectFolder, task.source?.nodePath),
            mapPath: hydratePisiTaskStoredPath(projectFolder, task.source?.mapPath)
        }
    };
}

function listPisiFirstClassTasks(projectFolder) {
    const store = readPisiTaskStore(projectFolder);
    return {
        ok: true,
        version: store.version,
        updatedAt: store.updatedAt,
        tasks: store.tasks.map((task) => hydratePisiFirstClassTask(projectFolder, task))
    };
}

function upsertPisiFirstClassTask(projectFolder, payload = {}) {
    const store = readPisiTaskStore(projectFolder);
    const requestedId = String(payload.id || '').trim();
    const index = requestedId ? store.tasks.findIndex((task) => task.id === requestedId) : -1;
    const existing = index >= 0 ? store.tasks[index] : null;
    const task = normalizePisiFirstClassTask(projectFolder, payload, existing);
    if (index >= 0) store.tasks[index] = task;
    else store.tasks.push(task);
    writePisiTaskStore(projectFolder, store);
    return {
        ok: true,
        created: index < 0,
        task: hydratePisiFirstClassTask(projectFolder, task)
    };
}

function updatePisiFirstClassTask(projectFolder, taskId, patch = {}) {
    const store = readPisiTaskStore(projectFolder);
    const index = store.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { ok: false, error: 'Görev bulunamadı.' };
    const current = store.tasks[index];
    const task = normalizePisiFirstClassTask(projectFolder, { ...current, ...patch, id: taskId }, current);
    store.tasks[index] = task;
    writePisiTaskStore(projectFolder, store);
    return { ok: true, task: hydratePisiFirstClassTask(projectFolder, task) };
}

function deletePisiFirstClassTask(projectFolder, taskId) {
    const store = readPisiTaskStore(projectFolder);
    const next = store.tasks.filter((task) => task.id !== taskId);
    if (next.length === store.tasks.length) return { ok: true, removed: false };
    store.tasks = next;
    writePisiTaskStore(projectFolder, store);
    return { ok: true, removed: true };
}

function syncPisiFirstClassTaskIndex(projectFolder, payload = {}) {
    const store = readPisiTaskStore(projectFolder);
    const byId = new Map(store.tasks.map((task) => [task.id, task]));
    const incoming = Array.isArray(payload.tasks) ? payload.tasks : [];
    const seen = new Set();
    let created = 0;
    let updated = 0;

    for (const item of incoming) {
        if (!item || typeof item !== 'object') continue;
        const id = normalizePisiFirstClassTaskId(item.id);
        const existing = byId.get(id) || null;
        const task = normalizePisiFirstClassTask(projectFolder, { ...item, id }, existing);
        byId.set(id, task);
        seen.add(id);
        if (existing) updated += 1;
        else created += 1;
    }

    if (payload.complete === true && payload.pruneMissing !== false) {
        for (const [id, task] of byId) {
            if (!seen.has(id) && task.source?.nodePath && task.source?.blockId) {
                byId.delete(id);
            }
        }
    }

    store.tasks = Array.from(byId.values());
    writePisiTaskStore(projectFolder, store);
    return {
        ok: true,
        created,
        updated,
        tasks: store.tasks.map((task) => hydratePisiFirstClassTask(projectFolder, task))
    };
}

function getPisiTaskIdForSource(nodePath, blockId, todoTag) {
    return formatPisiSourceTaskId(normalizePisiTaskIdentityPath(nodePath, process.platform === 'win32'), blockId, todoTag);
}

function registerQuickCapturedTask(projectFolder, payload, result) {
    const sourceTask = result?.task;
    if (!sourceTask?.nodePath || !sourceTask?.blockId || !sourceTask?.todoTag) {
        return result;
    }
    const taskId = getPisiTaskIdForSource(sourceTask.nodePath, sourceTask.blockId, sourceTask.todoTag);
    const deadline = normalizePisiFirstClassTaskIso(payload?.deadline || sourceTask.deadline || '');
    const dueDate = normalizePisiFirstClassTaskIso(
        payload?.dueDate || (deadline ? deadline.slice(0, 10) : '') || parsePisiTaskDueDateFromTag(sourceTask.todoTag) || '',
        false
    );
    const stored = upsertPisiFirstClassTask(projectFolder, {
        id: taskId,
        title: payload?.text || '',
        status: 'todo',
        priority: parsePisiTaskPriority(sourceTask.todoTag, payload?.priority),
        dueDate,
        scheduledAt: payload?.scheduledAt || sourceTask.scheduledAt || null,
        deadline,
        reminderAt: payload?.reminderAt || null,
        reminderMode: payload?.reminderMode || 'none',
        durationMinutes: payload?.durationMinutes || sourceTask.durationMinutes || 0,
        actualMinutes: payload?.actualMinutes || 0,
        repeat: payload?.repeat || 'none',
        completionOffsetDays: payload?.completionOffsetDays || null,
        manualOrder: Date.now(),
        todoTag: sourceTask.todoTag,
        source: {
            nodePath: sourceTask.nodePath,
            blockId: sourceTask.blockId,
            mapPath: payload?.mapPath || null,
            nodeTitle: sourceTask.nodeTitle || '',
            mapTitle: payload?.mapTitle || ''
        }
    });
    if (stored.ok) {
        result.task = {
            ...sourceTask,
            ...stored.task,
            taskId: stored.task.id
        };
    }
    return result;
}

function installPisiFirstClassTaskCaptureBridge() {
    const taskCapture = modules['main.taskCapture'];
    if (!taskCapture || typeof taskCapture.quickAddPisiTask !== 'function') {
        throw new Error('Task capture module bulunamadı.');
    }
    const originalQuickAddPisiTask = taskCapture.quickAddPisiTask;

    taskCapture.quickAddPisiTask = function firstClassQuickAdd(projectFolder, payload = {}) {
        try {
            const operation = String(payload?.op || 'add')
                .trim()
                .toLowerCase();
            if (operation === 'list') return listPisiFirstClassTasks(projectFolder);
            if (operation === 'upsert') {
                return upsertPisiFirstClassTask(projectFolder, payload.task || payload);
            }
            if (operation === 'update') {
                return updatePisiFirstClassTask(projectFolder, String(payload.taskId || payload.id || ''), payload.patch || payload.task || {});
            }
            if (operation === 'delete') {
                return deletePisiFirstClassTask(projectFolder, String(payload.taskId || payload.id || ''));
            }
            if (operation === 'sync-index') {
                return syncPisiFirstClassTaskIndex(projectFolder, payload);
            }

            const result = originalQuickAddPisiTask(projectFolder, payload);
            return result?.ok ? registerQuickCapturedTask(projectFolder, payload, result) : result;
        } catch (error) {
            return { ok: false, error: error.message };
        }
    };
}

const moduleApi = {
    PISI_TASK_STORE_VERSION,
    getPisiTaskStorePath,
    readPisiTaskStore,
    writePisiTaskStore,
    listPisiFirstClassTasks,
    upsertPisiFirstClassTask,
    updatePisiFirstClassTask,
    deletePisiFirstClassTask,
    syncPisiFirstClassTaskIndex,
    getPisiTaskIdForSource,
    installPisiFirstClassTaskCaptureBridge
};

registerMainModule('main.taskStore', moduleApi);
installPisiFirstClassTaskCaptureBridge();
