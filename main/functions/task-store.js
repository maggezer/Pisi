'use strict';

const path = require('path');
const crypto = require('crypto');
const storageLayer = require('./storage');
const { modules, registerMainModule } = require('../module-registry');

const PISI_TASK_STORE_VERSION = 1;
const PISI_TASK_STORE_DIR = '.pisi';
const PISI_TASK_STORE_FILE = 'tasks.json';
const PISI_TASK_STORE_KEY = `${PISI_TASK_STORE_DIR}/${PISI_TASK_STORE_FILE}`;
const PISI_TASK_STATUSES = new Set(['todo', 'doing', 'waiting', 'blocked', 'done']);
const PISI_TASK_REPEATS = new Set([
    'none', 'daily', 'weekdays', 'weekly', 'biweekly',
    'monthly', 'after-completion'
]);

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
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function normalizePisiTaskStoredPath(projectFolder, targetPath) {
    if (!targetPath) return null;
    const raw = String(targetPath).trim();
    if (!raw) return null;
    const resolved = path.isAbsolute(raw)
        ? path.resolve(raw)
        : path.resolve(projectFolder, raw.replace(/\//g, path.sep));
    if (!isPisiTaskPathInsideProject(projectFolder, resolved)) {
        throw new Error('Görev kaynağı proje klasörünün dışında olamaz.');
    }
    return path.relative(path.resolve(projectFolder), resolved).replace(/\\/g, '/');
}

function hydratePisiTaskStoredPath(projectFolder, storedPath) {
    if (!storedPath) return null;
    const resolved = path.resolve(
        projectFolder,
        String(storedPath).replace(/\//g, path.sep)
    );
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
        throw new Error(
            `Görev deposu okunamadı: ${result.error || 'Geçersiz tasks.json'}`
        );
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
    return data;
}

function normalizePisiFirstClassTaskId(value) {
    const raw = String(value || '').trim();
    if (/^task_[A-Za-z0-9._:-]{4,180}$/.test(raw)) return raw;
    return `task_${crypto.randomUUID()}`;
}

function normalizePisiFirstClassTaskIso(value, allowTime = true) {
    const raw = String(value || '').trim();
    const expression = allowTime
        ? /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/
        : /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = raw.match(expression);
    if (!match) return null;
    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0)
    );
    if (
        date.getFullYear() !== Number(match[1]) ||
        date.getMonth() !== Number(match[2]) - 1 ||
        date.getDate() !== Number(match[3])
    ) return null;
    return raw;
}

function normalizePisiFirstClassTaskStatus(value, completed = false) {
    if (completed === true) return 'done';
    const status = String(value || 'todo').trim().toLowerCase();
    return PISI_TASK_STATUSES.has(status) ? status : 'todo';
}

function normalizePisiFirstClassTaskRepeat(value) {
    const repeat = String(value || 'none').trim().toLowerCase();
    return PISI_TASK_REPEATS.has(repeat) ? repeat : 'none';
}

function normalizePisiFirstClassDependencies(value, taskId) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter((item) => /^task_[A-Za-z0-9._:-]{4,180}$/.test(item))))
        .filter((item) => item !== taskId);
}

function normalizePisiFirstClassSource(projectFolder, source = {}, fallback = {}) {
    const nodePath = source.nodePath || fallback.nodePath || null;
    const mapPath = source.mapPath || fallback.mapPath || null;
    return {
        nodePath: normalizePisiTaskStoredPath(projectFolder, nodePath),
        blockId: String(source.blockId || fallback.blockId || '').trim() || null,
        mapPath: normalizePisiTaskStoredPath(projectFolder, mapPath),
        nodeTitle: String(source.nodeTitle || fallback.nodeTitle || '').trim(),
        mapTitle: String(source.mapTitle || fallback.mapTitle || '').trim()
    };
}

function normalizePisiFirstClassTask(projectFolder, payload = {}, existing = null) {
    const now = new Date().toISOString();
    const id = existing?.id || normalizePisiFirstClassTaskId(payload.id);
    const priority = Math.max(1, Math.min(5, Number(
        payload.priority ?? existing?.priority ?? 3
    ) || 3));
    const status = normalizePisiFirstClassTaskStatus(
        payload.status ?? existing?.status ?? 'todo',
        payload.completed === true
    );
    const dueDate = normalizePisiFirstClassTaskIso(
        payload.dueDate ?? existing?.dueDate ?? '',
        false
    );
    const scheduledAt = normalizePisiFirstClassTaskIso(
        payload.scheduledAt ?? existing?.scheduledAt ?? ''
    );
    const deadline = normalizePisiFirstClassTaskIso(
        payload.deadline ?? existing?.deadline ?? ''
    );
    const reminderAt = normalizePisiFirstClassTaskIso(
        payload.reminderAt ?? existing?.reminderAt ?? ''
    );
    const title = String(
        payload.title ?? payload.text ?? existing?.title ?? ''
    ).replace(/\s+/g, ' ').trim();
    const repeat = normalizePisiFirstClassTaskRepeat(
        payload.repeat ?? existing?.repeat ?? 'none'
    );
    const durationMinutes = Math.max(0, Math.min(
        1440,
        Number(payload.durationMinutes ?? existing?.durationMinutes ?? 0) || 0
    ));
    const actualMinutes = Math.max(0, Math.min(
        100000,
        Number(payload.actualMinutes ?? existing?.actualMinutes ?? 0) || 0
    ));
    const completionOffsetDays = Math.max(0, Math.min(
        3650,
        Number(payload.completionOffsetDays ?? existing?.completionOffsetDays ?? 0) || 0
    ));
    const rawOrder = Number(payload.manualOrder ?? existing?.manualOrder ?? Date.now());
    const manualOrder = Number.isFinite(rawOrder) ? rawOrder : Date.now();
    const todoTag = String(
        payload.todoTag ?? existing?.todoTag ?? `todo.${priority}.none`
    ).trim().toLowerCase();
    const reminderMode = String(
        payload.reminderMode ?? existing?.reminderMode ?? 'none'
    ).trim().toLowerCase() || 'none';
    const source = normalizePisiFirstClassSource(
        projectFolder,
        payload.source || {},
        existing?.source || {}
    );

    return {
        id,
        title,
        status,
        priority,
        dueDate,
        scheduledAt,
        deadline,
        reminderAt,
        reminderMode,
        durationMinutes,
        actualMinutes,
        repeat,
        completionOffsetDays: completionOffsetDays || null,
        dependencies: normalizePisiFirstClassDependencies(
            payload.dependencies ?? existing?.dependencies ?? [],
            id
        ),
        manualOrder,
        todoTag,
        source,
        createdAt: existing?.createdAt || payload.createdAt || now,
        updatedAt: now,
        completedAt: status === 'done'
            ? (payload.completedAt || existing?.completedAt || now)
            : null
    };
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
    const index = requestedId
        ? store.tasks.findIndex((task) => task.id === requestedId)
        : -1;
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
    const task = normalizePisiFirstClassTask(
        projectFolder,
        { ...current, ...patch, id: taskId },
        current
    );
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
        const task = normalizePisiFirstClassTask(
            projectFolder,
            { ...item, id },
            existing
        );
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

function normalizePisiTaskIdentityPath(value) {
    const normalized = String(value || '').replace(/[\\/]+/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function hashPisiTaskIdentity(value) {
    const input = String(value || '');
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        hashA ^= code;
        hashA = Math.imul(hashA, 0x01000193) >>> 0;
        hashB ^= (code + index) >>> 0;
        hashB = Math.imul(hashB, 0x85ebca6b) >>> 0;
    }
    return `${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

function getPisiTaskIdForSource(nodePath, blockId, todoTag) {
    const key = [
        normalizePisiTaskIdentityPath(nodePath),
        String(blockId || ''),
        String(todoTag || '')
    ].map(encodeURIComponent).join('::');
    return `task_source_${hashPisiTaskIdentity(key)}`;
}

function parsePisiTaskPriority(todoTag, fallback = 3) {
    const match = String(todoTag || '').match(/^todo\.([1-5])\./i);
    return match ? Number(match[1]) : Math.max(1, Math.min(5, Number(fallback) || 3));
}

function parsePisiTaskDueDateFromTag(todoTag) {
    const match = String(todoTag || '').match(
        /^todo\.[1-5]\.(\d{2})-(\d{2})-(\d{4})$/i
    );
    return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function registerQuickCapturedTask(projectFolder, payload, result) {
    const sourceTask = result?.task;
    if (!sourceTask?.nodePath || !sourceTask?.blockId || !sourceTask?.todoTag) {
        return result;
    }
    const taskId = getPisiTaskIdForSource(
        sourceTask.nodePath,
        sourceTask.blockId,
        sourceTask.todoTag
    );
    const deadline = normalizePisiFirstClassTaskIso(
        payload?.deadline || sourceTask.deadline || ''
    );
    const dueDate = normalizePisiFirstClassTaskIso(
        payload?.dueDate || (deadline ? deadline.slice(0, 10) : '') ||
            parsePisiTaskDueDateFromTag(sourceTask.todoTag) || '',
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
            const operation = String(payload?.op || 'add').trim().toLowerCase();
            if (operation === 'list') return listPisiFirstClassTasks(projectFolder);
            if (operation === 'upsert') {
                return upsertPisiFirstClassTask(projectFolder, payload.task || payload);
            }
            if (operation === 'update') {
                return updatePisiFirstClassTask(
                    projectFolder,
                    String(payload.taskId || payload.id || ''),
                    payload.patch || payload.task || {}
                );
            }
            if (operation === 'delete') {
                return deletePisiFirstClassTask(
                    projectFolder,
                    String(payload.taskId || payload.id || '')
                );
            }
            if (operation === 'sync-index') {
                return syncPisiFirstClassTaskIndex(projectFolder, payload);
            }

            const result = originalQuickAddPisiTask(projectFolder, payload);
            return result?.ok
                ? registerQuickCapturedTask(projectFolder, payload, result)
                : result;
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
