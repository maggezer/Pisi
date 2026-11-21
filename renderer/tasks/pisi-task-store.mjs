import { registerModule } from '../core/module-registry.mjs';

// The renderer's task store (docs/task-plan.md §3.5). It lists the tasks of
// the project once (task.list.v1) and then only applies the records the main
// process sends with `pisi:tasks-changed`. It is a cache (GV1): nothing here
// is ever written back. Surfaces listen to `pisi:task-store-updated`.

const pisiTaskStoreState = {
    projectFolder: null,
    loaded: false,
    loading: null,
    readOnly: false,
    error: null,
    byId: new Map(),
    unsubscribe: null
};

function samePisiTaskProject(left, right) {
    const normalize = (value) => {
        const text = String(value || '')
            .replace(/[\\/]+/g, '/')
            .replace(/\/+$/, '');
        return window.pisiEnvironment?.platform === 'linux' ? text : text.toLowerCase();
    };
    return Boolean(left) && Boolean(right) && normalize(left) === normalize(right);
}

function dispatchPisiTaskStoreUpdated(detail) {
    document.dispatchEvent(new CustomEvent('pisi:task-store-updated', { detail }));
}

function getPisiTasks() {
    return [...pisiTaskStoreState.byId.values()];
}

function getPisiTask(taskId) {
    return pisiTaskStoreState.byId.get(String(taskId || '')) || null;
}

function isPisiTaskStoreReadOnly() {
    return pisiTaskStoreState.readOnly === true;
}

function isPisiTaskStoreLoaded() {
    return pisiTaskStoreState.loaded && samePisiTaskProject(pisiTaskStoreState.projectFolder, window.currentProjectFolder);
}

/** Lists the project's tasks (once per project unless `force`). */
async function loadPisiTaskStore({ force = false } = {}) {
    const projectFolder = window.currentProjectFolder || null;
    if (!projectFolder) {
        pisiTaskStoreState.projectFolder = null;
        pisiTaskStoreState.loaded = false;
        pisiTaskStoreState.byId = new Map();
        dispatchPisiTaskStoreUpdated({ changedIds: [], removedIds: [], reset: true });
        return getPisiTasks();
    }
    if (!force && isPisiTaskStoreLoaded()) return getPisiTasks();
    if (!force && pisiTaskStoreState.loading && samePisiTaskProject(pisiTaskStoreState.projectFolder, projectFolder)) return pisiTaskStoreState.loading;

    pisiTaskStoreState.projectFolder = projectFolder;
    const loading = (async () => {
        const result = await window.pisiDomain?.query?.('task.list.v1', { projectFolder });
        if (!samePisiTaskProject(projectFolder, window.currentProjectFolder)) return getPisiTasks();
        if (!result?.ok) {
            pisiTaskStoreState.error = result?.error || 'Görevler okunamadı.';
            pisiTaskStoreState.readOnly = true;
            pisiTaskStoreState.byId = new Map();
        } else {
            pisiTaskStoreState.error = result.readOnly ? result.error || 'Görevler okunamadı.' : null;
            pisiTaskStoreState.readOnly = result.readOnly === true;
            pisiTaskStoreState.byId = new Map((Array.isArray(result.tasks) ? result.tasks : []).map((task) => [task.id, task]));
        }
        pisiTaskStoreState.loaded = true;
        dispatchPisiTaskStoreUpdated({ changedIds: [...pisiTaskStoreState.byId.keys()], removedIds: [], reset: true });
        return getPisiTasks();
    })();
    pisiTaskStoreState.loading = loading;
    try {
        return await loading;
    } finally {
        if (pisiTaskStoreState.loading === loading) pisiTaskStoreState.loading = null;
    }
}

/** Applies one `pisi:tasks-changed` event: only its records change. */
function applyPisiTasksChanged(payload = {}) {
    if (!samePisiTaskProject(payload.projectFolder, window.currentProjectFolder)) return;
    if (!pisiTaskStoreState.loaded) {
        void loadPisiTaskStore({ force: true });
        return;
    }
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const removedIds = Array.isArray(payload.removedIds) ? payload.removedIds : [];
    for (const task of tasks) if (task?.id) pisiTaskStoreState.byId.set(task.id, task);
    for (const id of removedIds) pisiTaskStoreState.byId.delete(id);
    dispatchPisiTaskStoreUpdated({
        changedIds: tasks.map((task) => task.id),
        removedIds,
        source: payload.source || 'local',
        deferredDiaryDays: Array.isArray(payload.deferredDiaryDays) ? payload.deferredDiaryDays : []
    });
}

/**
 * Takes the records a task command returned at once, before its
 * `pisi:tasks-changed` event arrives, so that the editor that ran the command
 * reads the result in the same turn (a diary section, the undo history). No
 * update event is sent: the surfaces redraw once, on the main process's event,
 * which brings the same records.
 */
function rememberPisiTaskRecords({ tasks = [], removedIds = [] } = {}) {
    if (!pisiTaskStoreState.loaded) return;
    for (const task of Array.isArray(tasks) ? tasks : []) if (task?.id) pisiTaskStoreState.byId.set(task.id, task);
    for (const id of Array.isArray(removedIds) ? removedIds : []) pisiTaskStoreState.byId.delete(id);
}

function initializePisiTaskStore() {
    if (pisiTaskStoreState.unsubscribe || !window.pisiTasks?.onChanged) return;
    pisiTaskStoreState.unsubscribe = window.pisiTasks.onChanged(applyPisiTasksChanged);
    document.addEventListener('pisi:project-loaded', () => {
        pisiTaskStoreState.loaded = false;
        void loadPisiTaskStore({ force: true });
    });
    if (window.currentProjectFolder) void loadPisiTaskStore({ force: true });
}

initializePisiTaskStore();

const moduleApi = {
    pisiTaskStoreState,
    getPisiTasks,
    getPisiTask,
    isPisiTaskStoreReadOnly,
    isPisiTaskStoreLoaded,
    loadPisiTaskStore,
    applyPisiTasksChanged,
    rememberPisiTaskRecords
};

registerModule('tasks.store', moduleApi);

export { getPisiTasks, getPisiTask, isPisiTaskStoreReadOnly, isPisiTaskStoreLoaded, loadPisiTaskStore, applyPisiTasksChanged, rememberPisiTaskRecords };
