import { buildPisiSearchAccelerator } from '../search/pisi-search-core.mjs';

const PISI_PROJECTION_WRITE_WINDOW_MS = 3500;

const pisiSourceOfTruthState = {
    projectKey: '',
    projectionWriteUntil: 0,
    projectionSyncPromise: null,
    diarySignature: ''
};

function getPisiSourceProjectKey() {
    const raw = String(window.currentProjectFolder || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    return window.pisiEnvironment?.platform === 'win32' ? raw.toLowerCase() : raw;
}

function ensurePisiSourceProjectState() {
    const key = getPisiSourceProjectKey();
    if (key === pisiSourceOfTruthState.projectKey) return key;
    pisiSourceOfTruthState.projectKey = key;
    pisiSourceOfTruthState.projectionWriteUntil = 0;
    pisiSourceOfTruthState.projectionSyncPromise = null;
    pisiSourceOfTruthState.diarySignature = '';
    return key;
}

function markPisiTaskProjectionWriteIntent() {
    ensurePisiSourceProjectState();
    pisiSourceOfTruthState.projectionWriteUntil = Date.now() + PISI_PROJECTION_WRITE_WINDOW_MS;
}

function hasPisiTaskProjectionWriteIntent() {
    return Date.now() <= pisiSourceOfTruthState.projectionWriteUntil;
}

function stripPisiTaskProjectionFields(task = {}) {
    const { embeddedTaskId: _embeddedTaskId, legacyMissionId: _legacyMissionId, ...canonicalTask } = task;
    return canonicalTask;
}

function getPisiTaskProjectionSnapshot() {
    const blocks = Array.isArray(window.pisiTagsPanelState?.missionIndex) ? [...window.pisiTagsPanelState.missionIndex] : [];
    if (typeof window.buildPisiTasksFromLegacyIndex !== 'function') return [];
    return window.buildPisiTasksFromLegacyIndex(blocks).map(stripPisiTaskProjectionFields);
}

async function refreshCanonicalPisiTasks() {
    if (typeof window.refreshPisiFirstClassTaskStore === 'function') {
        return window.refreshPisiFirstClassTaskStore({ syncLegacy: false });
    }
    return null;
}

async function syncControlledPisiTaskProjection(reason = 'ui') {
    ensurePisiSourceProjectState();
    if (!window.currentProjectFolder || !window.pisiProject?.quickAddTask) {
        return { ok: false, error: 'Aktif proje yok.' };
    }
    if (window.pisiTagsPanelState?.missionIndexComplete !== true) {
        return { ok: false, incomplete: true };
    }
    if (pisiSourceOfTruthState.projectionSyncPromise) {
        return pisiSourceOfTruthState.projectionSyncPromise;
    }

    const projectFolder = window.currentProjectFolder;
    const projectKey = getPisiSourceProjectKey();
    const tasks = getPisiTaskProjectionSnapshot();

    const promise = (async () => {
        const result = await window.pisiProject.quickAddTask(projectFolder, {
            op: 'sync-index',
            allowProjectionWrite: true,
            projectionReason: reason,
            complete: true,
            pruneMissing: true,
            tasks
        });
        if (result?.ok && projectKey === getPisiSourceProjectKey()) {
            await refreshCanonicalPisiTasks();
        }
        return result;
    })().finally(() => {
        if (projectKey === getPisiSourceProjectKey()) {
            pisiSourceOfTruthState.projectionSyncPromise = null;
        }
    });

    pisiSourceOfTruthState.projectionSyncPromise = promise;
    return promise;
}

function isPisiControlledMissionRefresh(reason) {
    if (reason === 'status-change' || reason === 'completion-change') {
        return true;
    }
    return reason === 'panel-refresh' && hasPisiTaskProjectionWriteIntent();
}

function bindPisiTaskProjectionWriteIntents() {
    const markFromPanel = (event) => {
        if (!event.target?.closest?.('#pisi-missions-panel')) return;
        markPisiTaskProjectionWriteIntent();
    };
    document.addEventListener('change', markFromPanel, true);
    document.addEventListener('drop', markFromPanel, true);
    document.addEventListener(
        'input',
        (event) => {
            if (event.target?.closest?.('#center-node-editor-content, #node-modal-content')) {
                markPisiTaskProjectionWriteIntent();
            }
        },
        true
    );
    document.addEventListener(
        'click',
        (event) => {
            if (!event.target?.closest?.('#pisi-missions-panel')) return;
            if (event.target.closest('.pisi-mission-check, .pisi-third-chip-remove, .pisi-mission-drag-handle')) {
                markPisiTaskProjectionWriteIntent();
            }
        },
        true
    );
}

function getPisiCanonicalTaskDate(task = {}) {
    const scheduled = String(task.scheduledAt || '').slice(0, 10);
    const due = String(task.dueDate || '').slice(0, 10);
    const deadline = String(task.deadline || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(scheduled) ? scheduled : /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : deadline;
}

function getPisiCanonicalDiaryEntries() {
    const tasks = Array.isArray(window.pisiFirstClassTaskState?.tasks) ? window.pisiFirstClassTaskState.tasks : [];

    return tasks
        .filter((task) => task?.id && task.status !== 'done')
        .map((task) => {
            const date = getPisiCanonicalTaskDate(task);
            if (!date) return null;
            const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
            return {
                date,
                tag: task.todoTag || `todo.${task.priority || 3}.none`,
                priority: Number(task.priority) || 3,
                status: task.status || 'todo',
                repeat: task.repeat || 'none',
                parentId: dependencies.join('|'),
                manualOrder: Number(task.manualOrder),
                nodePath: task.source?.nodePath || `task:${task.id}`,
                nodeTitle: task.source?.nodeTitle || 'Task',
                blockId: task.id,
                text: task.title || ''
            };
        })
        .filter(Boolean);
}

async function syncPisiDiaryFromCanonicalTasks(_index, options = {}) {
    ensurePisiSourceProjectState();
    if (options.complete !== true) {
        return {
            ok: false,
            incomplete: true,
            error: 'Eksik task projection diary ile eşitlenmedi.'
        };
    }
    if (!window.currentProjectFolder || !window.pisiProject?.syncDiaryMissions) {
        return null;
    }

    const projectKey = getPisiSourceProjectKey();
    const entries = getPisiCanonicalDiaryEntries();
    const signature = `${projectKey}:${JSON.stringify(entries)}`;
    if (signature === pisiSourceOfTruthState.diarySignature) return null;

    const result = await window.pisiProject.syncDiaryMissions(window.currentProjectFolder, { entries, complete: true });
    if (result?.ok && projectKey === getPisiSourceProjectKey()) {
        pisiSourceOfTruthState.diarySignature = signature;
        await window.refreshPisiCalendarDates?.();
    }
    return result;
}

function installPisiCanonicalDiaryProjection() {
    if (typeof window.syncPisiDiaryFromMissionIndex !== 'function') return false;
    window.syncPisiDiaryFromMissionIndex = syncPisiDiaryFromCanonicalTasks;
    if (window.Pisi?.calendar) {
        window.Pisi.calendar.syncFromMissionIndex = syncPisiDiaryFromCanonicalTasks;
    }
    return true;
}

function makePisiCanonicalTaskSearchRecord(task = {}) {
    const nodePath = task.source?.nodePath || null;
    const fileName = nodePath ? String(nodePath).split(/[\\/]/).pop() : '';
    return {
        id: `task:${task.id}`,
        kind: 'task',
        taskId: task.id,
        nodePath,
        nodeTitle: task.source?.nodeTitle || 'Task',
        title: task.title || '',
        fileName,
        blockId: task.source?.blockId || null,
        mapPath: task.source?.mapPath || null,
        mapTitle: task.source?.mapTitle || '',
        todoTag: task.todoTag || '',
        status: task.status || 'todo',
        sourceText: task.title || '',
        preview: task.title || '',
        searchFields: [
            { kind: 'task', value: task.title || '' },
            { kind: 'tag', value: task.todoTag || '' },
            { kind: 'status', value: task.status || '' }
        ]
    };
}

function projectCanonicalPisiTasksIntoSearchIndex(index) {
    if (!index || !Array.isArray(index.records)) return index;
    const tasks = Array.isArray(window.pisiFirstClassTaskState?.tasks) ? window.pisiFirstClassTaskState.tasks : [];
    const records = [...index.records.filter((record) => record?.kind !== 'task'), ...tasks.map(makePisiCanonicalTaskSearchRecord)];
    index.records = records;
    index.accelerator = buildPisiSearchAccelerator(records);
    if (index.performance) {
        index.performance.recordCount = records.length;
        index.performance.gramCount = index.accelerator.gramCount;
    }
    index.taskAuthority = '.pisi/tasks.json';
    return index;
}

function bindPisiCanonicalSearchProjection() {
    document.addEventListener('pisi:search-index-ready', (event) => {
        projectCanonicalPisiTasksIntoSearchIndex(event.detail?.index);
    });
    document.addEventListener('pisi:task-store-updated', () => {
        window.invalidatePisiSearchIndex?.('task-store', ['.pisi/tasks.json']);
    });
}

function bindPisiSourceOfTruthEvents() {
    bindPisiTaskProjectionWriteIntents();
    bindPisiCanonicalSearchProjection();

    document.addEventListener('pisi:mission-index-updated', (event) => {
        ensurePisiSourceProjectState();
        if (event.detail?.complete !== true) return;
        const reason = String(event.detail?.reason || '');
        if (isPisiControlledMissionRefresh(reason)) {
            void syncControlledPisiTaskProjection(reason);
        }
    });

    document.addEventListener('pisi:task-store-updated', () => {
        ensurePisiSourceProjectState();
        void syncPisiDiaryFromCanonicalTasks(null, { complete: true });
    });

    document.addEventListener('DOMContentLoaded', () => {
        ensurePisiSourceProjectState();
        installPisiCanonicalDiaryProjection();
    });
}

window.syncControlledPisiTaskProjection = syncControlledPisiTaskProjection;
window.projectCanonicalPisiTasksIntoSearchIndex = projectCanonicalPisiTasksIntoSearchIndex;

bindPisiSourceOfTruthEvents();

export {};
