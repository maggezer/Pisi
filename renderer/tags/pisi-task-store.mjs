import { registerModule } from '../core/module-registry.mjs';
import { getPisiTodoRepeatOption, parsePisiTodoTagValue } from './pisi-todo-utils.mjs';

const PISI_TASK_STORE_SYNC_DELAY = 40;
const PISI_TASK_EDITOR_SYNC_DELAY = 320;

const pisiFirstClassTaskState = {
    projectKey: '',
    tasks: [],
    byId: new Map(),
    syncing: false,
    queued: false,
    refreshTimer: null,
    editorTimer: null,
    patchedMissionIdentity: false,
    fileSystemUnsubscribe: null
};

function normalizePisiFirstClassPath(value) {
    if (typeof window.normalizeClientPathForTags === 'function') {
        return window.normalizeClientPathForTags(value);
    }
    return String(value || '').replace(/[\\/]+/g, '/');
}

function normalizePisiFirstClassTag(value) {
    if (typeof window.normalizePisiUserTag === 'function') {
        return window.normalizePisiUserTag(value).toLowerCase();
    }
    return String(value || '')
        .trim()
        .replace(/^(?:\.\.|\/|#)/, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '')
        .toLowerCase();
}

function makePisiFirstClassTaskId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `task_${uuid}`;
    return `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function escapePisiTaskStoreHtml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPisiTaskIdFromHtml(html = '') {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const block = template.content.querySelector('[data-pisi-task-id]');
    const tag = template.content.querySelector('.pisi-user-tag[data-pisi-task-id]');
    return String(block?.dataset?.pisiTaskId || tag?.dataset?.pisiTaskId || '').trim();
}

function getPisiTaskTagMetadata(block, todoTag) {
    const template = document.createElement('template');
    template.innerHTML = String(block?.html || '');
    const target = normalizePisiFirstClassTag(todoTag);
    const tag =
        Array.from(template.content.querySelectorAll('.pisi-user-tag[data-pisi-tag]')).find(
            (element) => normalizePisiFirstClassTag(element.dataset.pisiTag || element.textContent || '') === target
        ) || null;
    const reminderClass = Array.from(tag?.classList || []).find((className) => {
        return className.startsWith('pisi-todo-reminder-');
    });
    return {
        scheduledAt: String(tag?.dataset?.pisiTodoScheduledAt || ''),
        deadline: String(tag?.dataset?.pisiTodoDeadline || ''),
        reminderAt: String(tag?.dataset?.pisiTodoReminderAt || ''),
        reminderMode: String(reminderClass || '').replace('pisi-todo-reminder-', '') || 'none',
        durationMinutes: Number(tag?.dataset?.pisiTodoDurationMinutes) || 0,
        actualMinutes: Number(tag?.dataset?.pisiTodoActualMinutes) || 0,
        taskId: String(tag?.dataset?.pisiTaskId || '')
    };
}

function formatPisiFirstClassDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getPisiTaskProjectionTitle(block, todoTag) {
    const source = String(block?.todoSources?.[todoTag] || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (source) return source;
    let text = String(block?.text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (todoTag) text = text.replace(todoTag, ' ');
    return text
        .replace(/\bdone\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPisiTaskDependencies(rawValue) {
    const raw = String(rawValue || '');
    if (!raw.startsWith('dep:')) return [];
    return Array.from(
        new Set(
            raw
                .slice(4)
                .split('|')
                .map((value) => {
                    try {
                        return decodeURIComponent(value);
                    } catch {
                        return '';
                    }
                })
                .filter(Boolean)
                .filter((id) => String(id).startsWith('task_'))
        )
    );
}

function buildPisiTasksFromProjection(blocks = []) {
    const entries = [];
    const usedTaskIds = new Set();

    for (const block of blocks) {
        const todoTags = (Array.isArray(block?.tags) ? block.tags : []).map(normalizePisiFirstClassTag).filter((tag) => Boolean(parsePisiTodoTagValue(tag)));
        for (const todoTag of todoTags) {
            const metadata = getPisiTaskTagMetadata(block, todoTag);
            const taskId = String(metadata.taskId || block?.taskId || getPisiTaskIdFromHtml(block?.html) || '').trim();
            if (!taskId || !getPisiFirstClassTask(taskId)) {
                throw new Error('Görev projection kaydı canonical görev kimliği içermiyor.');
            }
            if (usedTaskIds.has(taskId)) {
                throw new Error('Görev projection kaydında yinelenen görev kimliği.');
            }
            usedTaskIds.add(taskId);
            entries.push({ block, todoTag, taskId, metadata });
        }
    }

    return entries.map((entry) => {
        const { block, todoTag, taskId, metadata } = entry;
        const todo = parsePisiTodoTagValue(todoTag);
        const doneFor = new Set((Array.isArray(block?.doneFor) ? block.doneFor : []).map(normalizePisiFirstClassTag));
        const completed = doneFor.has(todoTag);
        const status = completed ? 'done' : String(block?.todoStates?.[todoTag] || 'todo').toLowerCase();
        const parentValue = block?.todoParents?.[todoTag] || '';
        const rawOrder = Number(block?.todoOrders?.[todoTag]);
        const rawOffset = Number(block?.todoCompletionOffsets?.[todoTag]);

        return {
            id: taskId,
            title: getPisiTaskProjectionTitle(block, todoTag),
            status,
            priority: todo?.priority || 3,
            dueDate: metadata.deadline ? metadata.deadline.slice(0, 10) : metadata.scheduledAt ? null : formatPisiFirstClassDate(todo?.finishDate),
            scheduledAt: metadata.scheduledAt || null,
            deadline: metadata.deadline || null,
            reminderAt: metadata.reminderAt || null,
            reminderMode: metadata.reminderMode || 'none',
            durationMinutes: metadata.durationMinutes || 0,
            actualMinutes: metadata.actualMinutes || 0,
            repeat: getPisiTodoRepeatOption(block?.todoRepeats?.[todoTag]).value,
            completionOffsetDays: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : null,
            dependencies: getPisiTaskDependencies(parentValue),
            manualOrder: Number.isFinite(rawOrder) ? rawOrder : Date.now(),
            todoTag,
            source: {
                nodePath: block?.nodePath || null,
                blockId: block?.blockId || null,
                mapPath: block?.mapPath || null,
                nodeTitle: block?.nodeTitle || '',
                mapTitle: block?.mapTitle || ''
            }
        };
    });
}

function setPisiTaskReferenceOnBlock(block, taskId, todoTag = '', dependencies = null) {
    if (!block || !taskId) return false;
    let changed = block.dataset.pisiTaskId !== taskId;
    block.dataset.pisiTaskId = taskId;
    const target = normalizePisiFirstClassTag(todoTag);
    for (const tag of block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')) {
        if (target && normalizePisiFirstClassTag(tag.dataset.pisiTag || tag.textContent || '') !== target) continue;
        if (tag.dataset.pisiTaskId !== taskId) {
            tag.dataset.pisiTaskId = taskId;
            changed = true;
        }
        if (Array.isArray(dependencies)) {
            const parent = dependencies.length ? `dep:${dependencies.map((id) => encodeURIComponent(id)).join('|')}` : '';
            if (String(tag.dataset.pisiTodoParent || '') !== parent) {
                if (parent) tag.dataset.pisiTodoParent = parent;
                else delete tag.dataset.pisiTodoParent;
                changed = true;
            }
        }
    }
    return changed;
}

function makePisiTaskSyntheticHtml(task, todoTag) {
    const sourceText = escapePisiTaskStoreHtml(task?.title || '');
    const taskId = escapePisiTaskStoreHtml(task?.id || '');
    const blockId = escapePisiTaskStoreHtml(task?.source?.blockId || '');
    const tag = escapePisiTaskStoreHtml(todoTag);
    const dependencies = Array.isArray(task?.dependencies) ? task.dependencies : [];
    const parent = dependencies.length ? `dep:${dependencies.map((id) => encodeURIComponent(id)).join('|')}` : '';
    const attrs = [
        `data-pisi-tag="${tag}"`,
        `data-pisi-task-id="${taskId}"`,
        `data-pisi-todo-status="${escapePisiTaskStoreHtml(task?.status === 'done' ? 'todo' : task?.status || 'todo')}"`,
        `data-pisi-todo-repeat="${escapePisiTaskStoreHtml(task?.repeat || 'none')}"`,
        `data-pisi-todo-order="${Number(task?.manualOrder) || 0}"`
    ];
    if (parent) attrs.push(`data-pisi-todo-parent="${escapePisiTaskStoreHtml(parent)}"`);
    if (task?.scheduledAt) attrs.push(`data-pisi-todo-scheduled-at="${escapePisiTaskStoreHtml(task.scheduledAt)}"`);
    if (task?.deadline) attrs.push(`data-pisi-todo-deadline="${escapePisiTaskStoreHtml(task.deadline)}"`);
    if (task?.reminderAt) attrs.push(`data-pisi-todo-reminder-at="${escapePisiTaskStoreHtml(task.reminderAt)}"`);
    if (Number(task?.durationMinutes) > 0) attrs.push(`data-pisi-todo-duration-minutes="${Number(task.durationMinutes)}"`);
    if (Number(task?.actualMinutes) > 0) attrs.push(`data-pisi-todo-actual-minutes="${Number(task.actualMinutes)}"`);
    if (Number(task?.completionOffsetDays) > 0) {
        attrs.push(`data-pisi-todo-completion-offset-days="${Number(task.completionOffsetDays)}"`);
    }
    const reminderClass = task?.reminderMode && task.reminderMode !== 'none' ? ` pisi-todo-reminder-${escapePisiTaskStoreHtml(task.reminderMode)}` : '';
    return [
        `<div class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-task-id="${taskId}">`,
        `<span class="pisi-todo-source" data-pisi-todo-for="${tag}">${sourceText}</span> `,
        `<span class="pisi-user-tag pisi-task-metadata${reminderClass}" ${attrs.join(' ')}>${tag}</span>`,
        '</div>'
    ].join('');
}

function taskToPisiMissionBlock(task) {
    const todoTag = String(task?.todoTag || `todo.${task?.priority || 3}.none`);
    const completed = task?.status === 'done';
    const dependencies = Array.isArray(task?.dependencies) ? task.dependencies : [];
    const parent = dependencies.length ? `dep:${dependencies.map((id) => encodeURIComponent(id)).join('|')}` : '';
    return {
        taskId: task.id,
        blockId: task?.source?.blockId || `task-block-${task.id}`,
        nodePath: task?.source?.nodePath || null,
        nodeTitle: task?.source?.nodeTitle || 'Task',
        mapPath: task?.source?.mapPath || null,
        mapTitle: task?.source?.mapTitle || '',
        tags: [todoTag],
        todoStates: { [todoTag]: completed ? 'todo' : task?.status || 'todo' },
        todoSources: { [todoTag]: task?.title || '' },
        todoParents: { [todoTag]: parent },
        todoRepeats: { [todoTag]: task?.repeat || 'none' },
        todoOrders: { [todoTag]: Number(task?.manualOrder) || 0 },
        todoCompletionOffsets: Number(task?.completionOffsetDays) > 0 ? { [todoTag]: Number(task.completionOffsetDays) } : {},
        doneFor: completed ? [todoTag] : [],
        text: task?.title || '',
        html: makePisiTaskSyntheticHtml(task, todoTag)
    };
}

function patchPisiMissionIdentity() {
    if (pisiFirstClassTaskState.patchedMissionIdentity) return;
    const second = window.Pisi?.modules?.['tags.todoSecondRelease'];
    if (!second || typeof second.enhancePisiMissionSecondRelease !== 'function') return;
    const original = second.enhancePisiMissionSecondRelease;
    second.enhancePisiMissionSecondRelease = function firstClassMissionEnhancer(mission, block) {
        const enhanced = original(mission, block);
        const taskId = String(block?.taskId || mission?.taskId || '').trim();
        if (taskId) {
            enhanced.taskId = taskId;
            enhanced.missionId = taskId;
        }
        return enhanced;
    };
    pisiFirstClassTaskState.patchedMissionIdentity = true;
}

function setPisiFirstClassTaskCache(tasks = []) {
    pisiFirstClassTaskState.tasks = Array.isArray(tasks) ? tasks : [];
    pisiFirstClassTaskState.byId = new Map(pisiFirstClassTaskState.tasks.map((task) => [task.id, task]));
}

function getPisiFirstClassTask(taskId) {
    return pisiFirstClassTaskState.byId.get(String(taskId || '')) || null;
}

function installPisiFirstClassMissionIndex(tasks = []) {
    const state = window.pisiTagsPanelState;
    if (!state) return;
    state.missionIndex = tasks.map(taskToPisiMissionBlock);
    state.missionIndexComplete = true;
    state.missionLoading = false;
    state.missionError = null;
    state.missionLastSyncedAt = Date.now();
    window.renderPisiMissionsPanel?.();
    if (typeof window.syncPisiDiaryFromMissionIndex === 'function') {
        void window.syncPisiDiaryFromMissionIndex(state.missionIndex, { complete: true });
    }
    document.dispatchEvent(
        new CustomEvent('pisi:task-store-updated', {
            detail: { count: tasks.length, syncedAt: state.missionLastSyncedAt }
        })
    );
}

async function refreshPisiFirstClassTaskStore() {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder || !window.pisiProject?.quickAddTask) {
        setPisiFirstClassTaskCache([]);
        return { ok: false, tasks: [] };
    }
    if (pisiFirstClassTaskState.syncing) {
        pisiFirstClassTaskState.queued = true;
        return { ok: true, queued: true, tasks: pisiFirstClassTaskState.tasks };
    }

    pisiFirstClassTaskState.syncing = true;
    const projectKey = normalizePisiFirstClassPath(projectFolder);
    pisiFirstClassTaskState.projectKey = projectKey;
    try {
        patchPisiMissionIdentity();
        const result = await window.pisiProject.quickAddTask(projectFolder, { op: 'list' });
        if (!result?.ok) {
            throw new Error(result?.error || 'Görev deposu okunamadı.');
        }
        if (projectKey !== normalizePisiFirstClassPath(window.currentProjectFolder)) {
            return { ok: false, stale: true, tasks: [] };
        }
        setPisiFirstClassTaskCache(result.tasks || []);
        installPisiFirstClassMissionIndex(pisiFirstClassTaskState.tasks);
        return { ok: true, tasks: pisiFirstClassTaskState.tasks };
    } catch (error) {
        console.error('[PISI] First-class task store sync error:', error);
        const state = window.pisiTagsPanelState;
        if (state) state.missionError = error.message || 'Görev deposu eşitlenemedi.';
        return { ok: false, error: error.message, tasks: pisiFirstClassTaskState.tasks };
    } finally {
        pisiFirstClassTaskState.syncing = false;
        if (pisiFirstClassTaskState.queued) {
            pisiFirstClassTaskState.queued = false;
            schedulePisiFirstClassTaskRefresh();
        }
    }
}

function schedulePisiFirstClassTaskRefresh() {
    clearTimeout(pisiFirstClassTaskState.refreshTimer);
    pisiFirstClassTaskState.refreshTimer = setTimeout(() => {
        pisiFirstClassTaskState.refreshTimer = null;
        void refreshPisiFirstClassTaskStore();
    }, PISI_TASK_STORE_SYNC_DELAY);
}

function getPisiEditorNodeContext(editor) {
    if (editor?.id === 'center-node-editor-content' && window.activeCenterNode?.path) {
        return {
            nodePath: window.activeCenterNode.path,
            nodeTitle: window.activeCenterNode.metadata?.title || window.activeCenterNode.item?.displayName || 'Node',
            mapPath: window.activeMapPath || null,
            mapTitle: ''
        };
    }
    if (editor?.id === 'node-modal-content' && window.activeModalNode?.path) {
        return {
            nodePath: window.activeModalNode.path,
            nodeTitle: window.activeModalNode.metadata?.title || window.activeModalNode.item?.displayName || 'Node',
            mapPath: window.activeMapPath || null,
            mapTitle: ''
        };
    }
    return null;
}

function buildPisiTaskFromEditorBlock(block, context) {
    const tags = Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []);
    const tagElement = tags.find((tag) => parsePisiTodoTagValue(normalizePisiFirstClassTag(tag.dataset.pisiTag || tag.textContent || '')));
    if (!tagElement || !context?.nodePath) return null;
    const todoTag = normalizePisiFirstClassTag(tagElement.dataset.pisiTag || tagElement.textContent || '');
    const todo = parsePisiTodoTagValue(todoTag);
    if (!todo) return null;
    const taskId = String(block.dataset.pisiTaskId || tagElement.dataset.pisiTaskId || '').trim() || makePisiFirstClassTaskId();
    setPisiTaskReferenceOnBlock(block, taskId, todoTag);
    const source = block.querySelector('.pisi-todo-source[data-pisi-todo-for]');
    const done = Array.from(tags).some((tag) => {
        if (normalizePisiFirstClassTag(tag.dataset.pisiTag || tag.textContent) !== 'done') {
            return false;
        }
        const doneFor = normalizePisiFirstClassTag(tag.dataset.pisiDoneFor || '');
        return doneFor === todoTag;
    });
    const reminderClass = Array.from(tagElement.classList).find((className) => {
        return className.startsWith('pisi-todo-reminder-');
    });
    const rawParent = String(tagElement.dataset.pisiTodoParent || '');
    const dependencies = rawParent.startsWith('dep:')
        ? rawParent
              .slice(4)
              .split('|')
              .map((value) => {
                  try {
                      return decodeURIComponent(value);
                  } catch {
                      return '';
                  }
              })
              .filter((id) => id.startsWith('task_'))
        : [];

    return {
        id: taskId,
        title: String(source?.textContent || block.textContent || '')
            .replace(/\s+/g, ' ')
            .replace(todoTag, ' ')
            .replace(/\bdone\b/gi, ' ')
            .trim(),
        status: done ? 'done' : String(tagElement.dataset.pisiTodoStatus || 'todo').toLowerCase(),
        priority: todo.priority,
        dueDate: tagElement.dataset.pisiTodoDeadline
            ? String(tagElement.dataset.pisiTodoDeadline).slice(0, 10)
            : tagElement.dataset.pisiTodoScheduledAt
              ? null
              : formatPisiFirstClassDate(todo.finishDate),
        scheduledAt: tagElement.dataset.pisiTodoScheduledAt || null,
        deadline: tagElement.dataset.pisiTodoDeadline || null,
        reminderAt: tagElement.dataset.pisiTodoReminderAt || null,
        reminderMode: String(reminderClass || '').replace('pisi-todo-reminder-', '') || 'none',
        durationMinutes: Number(tagElement.dataset.pisiTodoDurationMinutes) || 0,
        actualMinutes: Number(tagElement.dataset.pisiTodoActualMinutes) || 0,
        repeat: getPisiTodoRepeatOption(tagElement.dataset.pisiTodoRepeat).value,
        completionOffsetDays: Number(tagElement.dataset.pisiTodoCompletionOffsetDays) || null,
        dependencies,
        manualOrder: Number(tagElement.dataset.pisiTodoOrder) || Date.now(),
        todoTag,
        source: {
            ...context,
            blockId: block.dataset.pisiBlockId || null
        }
    };
}

async function syncPisiEditorTasks(editor) {
    const projectFolder = window.currentProjectFolder;
    const context = getPisiEditorNodeContext(editor);
    if (!projectFolder || !context || !window.pisiProject?.quickAddTask) return;
    const tasks = Array.from(editor.querySelectorAll('.pisi-editor-block'))
        .filter((block) => !block.closest('.pisi-diary-managed-block'))
        .map((block) => buildPisiTaskFromEditorBlock(block, context))
        .filter(Boolean);
    if (!tasks.length) return;
    const result = await window.pisiProject.quickAddTask(projectFolder, {
        op: 'sync-index',
        complete: false,
        pruneMissing: false,
        tasks
    });
    if (result?.ok) {
        schedulePisiFirstClassTaskRefresh();
    }
}

function handlePisiEditorInputForTasks(event) {
    const editor =
        event.target?.closest?.('#center-node-editor-content, #node-modal-content') ||
        (event.target?.matches?.('#center-node-editor-content, #node-modal-content') ? event.target : null);
    if (!editor) return;

    const context = getPisiEditorNodeContext(editor);
    if (!context) return;
    for (const block of editor.querySelectorAll('.pisi-editor-block')) {
        if (block.closest('.pisi-diary-managed-block')) continue;
        buildPisiTaskFromEditorBlock(block, context);
    }

    clearTimeout(pisiFirstClassTaskState.editorTimer);
    pisiFirstClassTaskState.editorTimer = setTimeout(() => {
        pisiFirstClassTaskState.editorTimer = null;
        void syncPisiEditorTasks(editor);
    }, PISI_TASK_EDITOR_SYNC_DELAY);
}

function bindPisiFirstClassTaskStore() {
    patchPisiMissionIdentity();
    document.addEventListener('input', handlePisiEditorInputForTasks, true);
    document.addEventListener('pisi:mission-index-updated', (event) => {
        if (event.detail?.complete === true && window.currentProjectFolder) {
            schedulePisiFirstClassTaskRefresh();
        }
    });
    if (!pisiFirstClassTaskState.fileSystemUnsubscribe) {
        pisiFirstClassTaskState.fileSystemUnsubscribe =
            window.pisiProject?.onFileSystemChanged?.((payload = {}) => {
                const paths = Array.isArray(payload.changedPaths) ? payload.changedPaths : [];
                if (!paths.some((filePath) => /[\\/]\.pisi[\\/]tasks\.json$/i.test(String(filePath || '')))) {
                    return;
                }
                schedulePisiFirstClassTaskRefresh();
            }) || null;
    }

    if (window.currentProjectFolder) {
        schedulePisiFirstClassTaskRefresh();
    }
}

const moduleApi = {
    pisiFirstClassTaskState,
    makePisiFirstClassTaskId,
    buildPisiTasksFromProjection,
    taskToPisiMissionBlock,
    getPisiFirstClassTask,
    refreshPisiFirstClassTaskStore,
    schedulePisiFirstClassTaskRefresh,
    bindPisiFirstClassTaskStore
};

registerModule('tags.taskStore', moduleApi);

bindPisiFirstClassTaskStore();

export {
    bindPisiFirstClassTaskStore,
    buildPisiTasksFromProjection,
    getPisiFirstClassTask,
    makePisiFirstClassTaskId,
    pisiFirstClassTaskState,
    refreshPisiFirstClassTaskStore,
    schedulePisiFirstClassTaskRefresh,
    taskToPisiMissionBlock
};
