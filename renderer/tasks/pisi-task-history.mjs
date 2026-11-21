import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS, PISI_TASK_BLOCK_CLASS } from '../../shared/task-blocks.mjs';
import { makePisiTaskHistoryKey, pickPisiTaskHistoryFields, planPisiTaskHistoryRestore } from './pisi-task-edit-core.mjs';
import { getPisiNoteOfEditor, pisiTaskTitleDrafts } from './pisi-task-view.mjs';

// The tasks of a note in its undo history (docs/task-plan.md G3.6). Every step
// keeps the fields of the tasks the note shows (its blocks, its diary rows).
// Going to a step brings them back with task commands: field changes in one
// task.batch.v1, a completion with task.reopen.v1 / task.complete.v1 (so the
// diary days follow their rule), a task this editor sent to the Trash with
// trash.restore.v1. A block that comes back into a note brings its task back
// through the note save (the save takes it out of the Trash).

/** The ids a note shows: its task blocks and the rows of its diary section. */
function listPisiEditorTaskIds(editor) {
    const ids = new Set();
    editor?.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`).forEach((block) => ids.add(block.dataset.pisiTaskId));
    const section = editor?.querySelector(`:scope > .${PISI_DIARY_TASKS_CLASS}`);
    if (section) {
        for (const id of String(section.dataset.pisiTaskIds || '').split(',')) if (id) ids.add(id);
        section.querySelectorAll('[data-pisi-task-row]').forEach((row) => ids.add(row.dataset.pisiTaskRow));
    }
    return [...ids];
}

/** The history state of an editor's tasks: `{ [taskId]: fields | null }`; null without a store. */
function capturePisiTaskHistoryState(editor) {
    if (!editor || !window.isPisiTaskStoreLoaded?.()) return null;
    const state = {};
    for (const id of listPisiEditorTaskIds(editor)) {
        const task = window.getPisiTask?.(id);
        state[id] = pickPisiTaskHistoryFields(task, pisiTaskTitleDrafts.has(id) ? pisiTaskTitleDrafts.get(id) : null);
    }
    return state;
}

function makePisiTaskHistoryKeyOf(tasks) {
    return makePisiTaskHistoryKey(tasks);
}

async function runPisiTaskHistoryPlan(editor, plan) {
    const run = (name, payload) => window.runPisiTaskCommand?.(name, payload, { quiet: true });
    for (const taskId of plan.restore) {
        const trashId = window.getPisiTaskTrashId?.(taskId);
        if (!trashId) continue;
        const result = await window.pisiDomain?.command?.('trash.restore.v1', {
            projectFolder: window.currentProjectFolder,
            trashId,
            openPaths: window.getPisiOpenDocumentPaths?.() || []
        });
        if (result?.ok) {
            window.forgetPisiTaskTrashId?.(taskId);
            await window.applyPisiTaskDeferred?.(result.deferred);
        }
    }
    for (const { taskId, completion } of plan.reopen) await run('task.reopen.v1', { taskId, completion });
    for (const taskId of plan.complete) await run('task.complete.v1', { taskId });
    if (plan.updates.length) {
        const result = await run('task.batch.v1', { updates: plan.updates });
        if (!result?.ok) window.pisiNotifyError?.(window.pisiT?.('Görev değişikliği kaydedilemedi.') ?? 'Görev değişikliği kaydedilemedi.');
    }
    // A diary task made in this editor goes when its making is undone (a note's block goes with the save).
    const day = getPisiNoteOfEditor(editor)?.diaryDate;
    for (const taskId of plan.gone) {
        const task = window.getPisiTask?.(taskId);
        if (day && task?.diaryDate === day && window.wasPisiTaskCreatedInEditor?.(taskId)) {
            const result = await run('task.delete.v1', { taskId });
            if (result?.ok && result.trashId) window.rememberPisiTaskTrashId?.(taskId, result.trashId);
        }
    }
    for (const { taskId, patch } of plan.updates) {
        if (typeof patch.title === 'string' && window.getPisiTask?.(taskId)?.title === patch.title) pisiTaskTitleDrafts.delete(taskId);
    }
}

/**
 * Brings the tasks from the step `from` to the step `to`. Titles show the
 * step's text at once (as drafts) while the commands run.
 */
function restorePisiTaskHistoryState(editor, from, to) {
    if (!to || !window.isPisiTaskStoreLoaded?.()) return null;
    const current = {};
    for (const id of new Set([...Object.keys(from || {}), ...Object.keys(to)])) {
        const task = window.getPisiTask?.(id);
        current[id] = pickPisiTaskHistoryFields(task, pisiTaskTitleDrafts.has(id) ? pisiTaskTitleDrafts.get(id) : null);
    }
    const plan = planPisiTaskHistoryRestore(current, to);
    for (const { taskId, patch } of plan.updates) if (typeof patch.title === 'string') pisiTaskTitleDrafts.set(taskId, patch.title);
    for (const id of Object.keys(to)) if (!plan.updates.some((update) => update.taskId === id && 'title' in update.patch)) pisiTaskTitleDrafts.delete(id);
    const empty = !plan.restore.length && !plan.reopen.length && !plan.complete.length && !plan.updates.length && !plan.gone.length;
    if (!empty) void runPisiTaskHistoryPlan(editor, plan);
    return plan;
}

const moduleApi = {
    capturePisiTaskHistoryState,
    restorePisiTaskHistoryState,
    makePisiTaskHistoryKey: makePisiTaskHistoryKeyOf
};

registerModule('tasks.history', moduleApi);

export { capturePisiTaskHistoryState, restorePisiTaskHistoryState };
