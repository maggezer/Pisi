// Pure rules of editing tasks in the note editor (docs/task-plan.md G3). No
// DOM and no I/O: the editor modules (pisi-task-block, pisi-task-diary,
// pisi-task-editing, pisi-task-clipboard) use them and the tests import them
// directly.

import { PISI_TASK_TITLE_MAX_LENGTH } from '../../shared/task-model.mjs';
import { isPisiTaskId } from '../../shared/ids.mjs';

/** The clipboard type that carries the task records of a copied or cut selection. */
export const PISI_TASK_CLIPBOARD_TYPE = 'application/x-pisi-tasks';

/** The fields a note's undo history keeps for each task in it. */
export const PISI_TASK_HISTORY_FIELDS = Object.freeze([
    'title',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'completions'
]);

// Fields a copy of a task takes over (a copy is open and has no completions).
const COPY_FIELDS = Object.freeze([
    'title',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'durationMinutes'
]);

/**
 * The text of a title field while it is edited: one line (line breaks and
 * tabs become spaces), at most the title length. Spaces are kept so that the
 * caret does not jump while typing; the stored title is cleanPisiTaskTitle.
 */
export function normalizePisiTaskTitleDraft(value) {
    return String(value ?? '')
        .replace(/[\r\n\t\u00a0\u2028\u2029]+/g, ' ')
        .replace(/\u200b/g, '')
        .slice(0, PISI_TASK_TITLE_MAX_LENGTH);
}

/** The title as tasks.json stores it: one line, spaces collapsed, trimmed (shared/task-model.mjs rule). */
export function cleanPisiTaskTitle(value) {
    return normalizePisiTaskTitleDraft(value).replace(/\s+/g, ' ').trim().slice(0, PISI_TASK_TITLE_MAX_LENGTH);
}

/** Is the whole text of a paragraph the task shortcut (`[]` or `[ ]`, typed before a space)? */
export function isPisiTaskShortcutMarker(text) {
    return /^\[[ \u00a0]?\]$/.test(
        String(text ?? '')
            .replace(/\u200b/g, '')
            .trim()
    );
}

/** Splits a title at a caret offset: the part that stays and the part that goes to the next task. */
export function splitPisiTaskTitle(text, offset) {
    const value = String(text ?? '');
    const at = Math.max(0, Math.min(value.length, Number.isInteger(offset) ? offset : value.length));
    return { before: value.slice(0, at), after: value.slice(at) };
}

/** The fields of a copy of `task` (`task.create.v1`): a done task is copied open. */
export function makePisiTaskCopyFields(task) {
    const fields = {};
    for (const field of COPY_FIELDS) if (task && task[field] !== undefined) fields[field] = task[field];
    if (fields.status === 'done') fields.status = 'todo';
    return fields;
}

function pickHistoryFields(task) {
    const fields = {};
    for (const field of PISI_TASK_HISTORY_FIELDS) {
        const value = task?.[field];
        fields[field] = field === 'completions' ? (Array.isArray(value) ? value.map((entry) => ({ ...entry })) : []) : (value ?? null);
    }
    return fields;
}

/**
 * The state of a task as a history step keeps it; `draftTitle` (the text of
 * its title field, when the user is typing) wins over the stored title.
 * Null when there is no record.
 */
export function pickPisiTaskHistoryFields(task, draftTitle = null) {
    if (!task) return null;
    const fields = pickHistoryFields(task);
    if (typeof draftTitle === 'string') fields.title = cleanPisiTaskTitle(draftTitle);
    return fields;
}

/** A stable text of a history task state, for comparing two steps. */
export function makePisiTaskHistoryKey(tasks) {
    if (!tasks) return '';
    return JSON.stringify(
        Object.keys(tasks)
            .sort()
            .map((id) => [id, tasks[id]])
    );
}

const completionKey = (entry) => `${entry?.date ?? ''}|${entry?.dueDate ?? ''}|${entry?.at ?? ''}`;
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What brings the tasks of a note back to an undo/redo step (§G3.6).
 * `current` and `target` map task ids to pickPisiTaskHistoryFields states
 * (null: no record). Returns:
 * - `reopen`: `[{ taskId, completion }]`: a completion the step did not have
 *   (`completion` is the entry of a repeating task, or `{ status }`);
 * - `complete`: task ids the step had completed;
 * - `updates`: `[{ taskId, patch }]` for one `task.batch.v1`;
 * - `restore`: ids the step has but that have no record now (the Trash brings them back);
 * - `gone`: ids that have a record but that the step does not have.
 * A completion change is never written as fields: complete and reopen keep the
 * diary days and `completions` by their own rule.
 */
export function planPisiTaskHistoryRestore(current = {}, target = {}) {
    const plan = { reopen: [], complete: [], updates: [], restore: [], gone: [] };
    for (const [taskId, wanted] of Object.entries(target || {})) {
        if (!wanted) continue;
        const now = current?.[taskId];
        if (!now) {
            plan.restore.push(taskId);
            continue;
        }
        const skip = new Set(['completions']);
        if (wanted.repeat === 'none' && now.repeat === 'none') {
            const wasDone = wanted.status === 'done';
            const isDone = now.status === 'done';
            if (isDone && !wasDone) {
                plan.reopen.push({ taskId, completion: { status: wanted.status } });
                skip.add('status');
            } else if (!isDone && wasDone) {
                plan.complete.push(taskId);
                skip.add('status');
            }
        } else if (wanted.repeat !== 'none' && now.repeat !== 'none') {
            const wantedKeys = new Set(wanted.completions.map(completionKey));
            const nowKeys = new Set(now.completions.map(completionKey));
            const extra = now.completions.filter((entry) => !wantedKeys.has(completionKey(entry)));
            const missing = wanted.completions.filter((entry) => !nowKeys.has(completionKey(entry)));
            if (extra.length === 1 && !missing.length) {
                plan.reopen.push({ taskId, completion: extra[0] });
                for (const field of ['status', 'dueDate', 'reminderAt']) skip.add(field);
            } else if (missing.length === 1 && !extra.length) {
                plan.complete.push(taskId);
                for (const field of ['status', 'dueDate', 'reminderAt']) skip.add(field);
            }
        }
        const patch = {};
        for (const field of PISI_TASK_HISTORY_FIELDS) {
            if (skip.has(field)) continue;
            if (field === 'status' && wanted.status === 'done') continue;
            if (!sameValue(wanted[field], now[field])) patch[field] = wanted[field];
        }
        if (Object.keys(patch).length) plan.updates.push({ taskId, patch });
    }
    for (const taskId of Object.keys(current || {})) {
        if (current[taskId] && !(target && target[taskId])) plan.gone.push(taskId);
    }
    return plan;
}

/** The clipboard text of copied tasks: their records, the project they come from and whether they were cut. */
export function makePisiTaskClipboardPayload({ projectFolder, tasks, cut = false }) {
    const records = (Array.isArray(tasks) ? tasks : []).filter((task) => task && isPisiTaskId(task.id));
    return JSON.stringify({ version: 1, projectFolder: String(projectFolder || ''), cut: cut === true, tasks: records });
}

/** Reads makePisiTaskClipboardPayload; null when the text is not one. */
export function readPisiTaskClipboardPayload(text) {
    if (!text) return null;
    let data;
    try {
        data = JSON.parse(String(text));
    } catch {
        return null;
    }
    if (!data || data.version !== 1 || !Array.isArray(data.tasks)) return null;
    const tasks = new Map();
    for (const task of data.tasks) if (task && isPisiTaskId(task.id)) tasks.set(task.id, task);
    return { projectFolder: typeof data.projectFolder === 'string' ? data.projectFolder : '', cut: data.cut === true, tasks };
}

/**
 * What a pasted task block becomes (§3.3, GV7):
 * - `keep`: the id stays. A cut task of this project that has no record now:
 *   it is in the Trash, and the note save brings it back to this note.
 * - `copy`: a new task with the copied fields. The task is still live (a copy),
 *   or the clipboard comes from another project.
 * - `drop`: nothing to copy from: the block is not pasted.
 * `sameProject(a, b)` compares project folders.
 */
export function decidePisiPastedTask({ taskId, payload, projectFolder, liveTask, sameProject = (a, b) => a === b }) {
    const fromHere = !payload || sameProject(payload.projectFolder, projectFolder);
    const copied = payload?.tasks?.get(taskId) || null;
    if (!fromHere) return copied ? 'copy' : 'drop';
    if (liveTask) return 'copy';
    if (payload?.cut && copied) return 'keep';
    return copied ? 'copy' : 'drop';
}

/** One line of plain clipboard text for a task: `- [ ] Title` / `- [x] Title`. */
export function formatPisiTaskPlainLine(task, done = task?.status === 'done') {
    return `- [${done ? 'x' : ' '}] ${cleanPisiTaskTitle(task?.title)}`;
}
