// Tasks, version 2 (docs/task-plan.md §3.1, G8). `.pisi/tasks.json` is the
// only authority (V5, GV1): it is never rebuilt from a list held in memory.
// Every change re-reads the file inside the write queue and replaces just the
// records it changes (GV4). The record rules, completing and reopening come
// from shared/task-model.mjs, the code the desktop task service runs (GV13).
//
// Every task has a place: a day's diary (`diaryDate`) or a note (`noteId`).
// When the days of a task change, the diary sections of those days are
// written in the same writer job (task-days.mjs, GV5, GV15). A field change
// (title, status, priority, time, reminder) writes no note. The phone never
// deletes a task (V9) and never moves one; a task block is put into a note by
// the note editor, which saves the note itself.

import {
    findPisiTaskDependencyCycle,
    completePisiTask,
    isSamePisiTask,
    makePisiTaskStoreData,
    normalizePisiTask,
    readPisiTask,
    readPisiTaskStore,
    reopenPisiTask
} from '../../../shared/task-model.mjs';
import { normalizePisiDiaryIsoDate } from '../../../shared/diary-rules.mjs';
import { PisiReadOnlyError, parseJsonText, readTextOrNull, serializeStore } from './json-file.mjs';
import { writeTaskDays } from './task-days.mjs';

export const PISI_TASK_STORE_KEY = '.pisi/tasks.json';

// The fields a request may give, as the desktop's task.create.v1 / task.update.v1 take them.
const CREATE_FIELDS = Object.freeze([
    'id',
    'title',
    'tags',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'dependencies',
    'manualOrder',
    'durationMinutes',
    'actualMinutes'
]);
const UPDATE_FIELDS = Object.freeze(CREATE_FIELDS.filter((field) => field !== 'id'));

function pick(source, fields) {
    const picked = {};
    for (const field of fields) if (source && source[field] !== undefined) picked[field] = source[field];
    return picked;
}

/** `{ status: 'missing' | 'ok', data, tasks }` or `{ status: 'corrupt', error }` for the store text. */
function parseStore(text) {
    const parsed = parseJsonText(text);
    if (parsed.status === 'missing') return { status: 'missing', data: null, tasks: [] };
    if (parsed.status === 'corrupt') return parsed;
    const store = readPisiTaskStore(parsed.data);
    return store.ok ? { status: 'ok', data: parsed.data, tasks: store.tasks } : { status: 'corrupt', error: store.error };
}

function cycleError(tasks, task) {
    if (!task.dependencies?.length) return null;
    if (findPisiTaskDependencyCycle(tasks, task.id, task.dependencies)) return { ok: false, error: 'dependency-cycle' };
    const known = new Set(tasks.map((item) => item?.id));
    return task.dependencies.every((id) => known.has(id)) ? null : { ok: false, error: 'dependency-missing' };
}

export function createTaskRepo({ driver, writer, now, makeUuid }) {
    const corrupt = (error) => {
        writer.markReadOnly(PISI_TASK_STORE_KEY, error);
        return new PisiReadOnlyError(PISI_TASK_STORE_KEY, error);
    };

    /**
     * One task command as one writer job: re-reads the store, lets
     * `change(tasks, clock)` edit the record list in place and, when it
     * returns `pairs` (`[{ before, after }]`), writes tasks.json and then the
     * diary sections of the days those changes touch. `change` returns
     * `{ result, pairs }`; without `pairs` nothing is written.
     */
    function command(change) {
        return writer.run(async (tx) => {
            const store = parseStore(await tx.read(PISI_TASK_STORE_KEY));
            if (store.status === 'corrupt') throw corrupt(store.error);
            const tasks = store.tasks.slice();
            const clock = now();
            const { result, pairs } = change(tasks, clock);
            if (!pairs?.length) return result;
            await tx.write(PISI_TASK_STORE_KEY, serializeStore(makePisiTaskStoreData(store.data, tasks, { now: clock })));
            const days = await writeTaskDays(tx, tasks, pairs, { writer, now: () => clock, makeUuid });
            return { ...result, days };
        });
    }

    /** Applies `next(record)` to the stored task `taskId`; `next` returns a task-model result. */
    function changeOne(taskId, next) {
        return command((tasks, clock) => {
            const index = tasks.findIndex((task) => task && task.id === taskId);
            if (index < 0) return { result: { ok: false, notFound: true } };
            const before = tasks[index];
            const outcome = next(before, tasks, clock);
            if (!outcome.ok) return { result: outcome };
            if (!outcome.changed) return { result: { ...outcome, task: readPisiTask(before) } };
            tasks[index] = outcome.task;
            return { result: { ...outcome, task: readPisiTask(outcome.task) }, pairs: [{ before, after: outcome.task }] };
        });
    }

    return {
        /**
         * The tasks, each read the way the desktop reads a stored record
         * (readPisiTask; unknown and old fields stay on the copy). A corrupt
         * store is reported, marked read-only and left untouched (V7, GV11).
         */
        async list() {
            const store = parseStore(await readTextOrNull(driver, PISI_TASK_STORE_KEY));
            if (store.status === 'corrupt') {
                writer.markReadOnly(PISI_TASK_STORE_KEY, store.error);
                return { ok: false, corrupt: true, readOnly: true, error: store.error, tasks: [] };
            }
            return {
                ok: true,
                readOnly: writer.isReadOnly(PISI_TASK_STORE_KEY),
                updatedAt: store.data?.updatedAt ?? null,
                tasks: store.tasks.map(readPisiTask).filter(Boolean)
            };
        },

        /**
         * Creates a task in `target`: `{ diaryDate }` (a day's diary; the task is
         * due that day unless `fields` says otherwise, §1.4) or `{ noteId }` (a
         * note; the caller puts the task block into the note). The diary of each
         * day the task joins gets the task in its section, and is created when
         * missing. Resolves `{ ok, created, task, days }` or `{ ok: false, errors }`.
         */
        create(fields = {}, target = {}) {
            const diaryDate = target.diaryDate === undefined || target.diaryDate === null ? null : normalizePisiDiaryIsoDate(target.diaryDate);
            if (!diaryDate && !target.noteId) return Promise.resolve({ ok: false, error: 'target-required' });
            const payload = pick(fields, CREATE_FIELDS);
            if (diaryDate) {
                payload.diaryDate = diaryDate;
                if (payload.dueDate === undefined) payload.dueDate = diaryDate;
            } else {
                payload.noteId = target.noteId;
            }
            if (payload.title === undefined) payload.title = '';
            return command((tasks, clock) => {
                if (payload.id !== undefined && tasks.some((task) => task?.id === payload.id)) return { result: { ok: false, error: 'id-exists' } };
                const normalized = normalizePisiTask(payload, null, { now: clock, makeUuid });
                if (!normalized.ok) return { result: normalized };
                const blocked = cycleError(tasks, normalized.task);
                if (blocked) return { result: blocked };
                tasks.push(normalized.task);
                return {
                    result: { ok: true, created: true, changed: true, task: readPisiTask(normalized.task) },
                    pairs: [{ before: null, after: normalized.task }]
                };
            });
        },

        /**
         * Changes fields of a task (not its place). An invalid value is an error,
         * an unchanged task is not written (V4), an unknown id changes nothing.
         * A repeating task is completed with `complete`, not by its status.
         */
        update(taskId, patch = {}) {
            const fields = pick(patch, UPDATE_FIELDS);
            return changeOne(taskId, (before, tasks, clock) => {
                const normalized = normalizePisiTask(fields, before, { now: clock, makeUuid });
                if (!normalized.ok) return normalized;
                if (fields.dependencies !== undefined) {
                    const blocked = cycleError(tasks, normalized.task);
                    if (blocked) return blocked;
                }
                return { ok: true, changed: !isSamePisiTask(readPisiTask(before), normalized.task), task: normalized.task };
            });
        },

        /**
         * Completes a task today (§3.2.3): a task that does not repeat becomes
         * done; a repeating one records the completion and moves on to its next
         * occurrence. `completion` in the result is what `reopen` needs to take
         * it back.
         */
        complete(taskId) {
            return changeOne(taskId, (before, tasks, clock) => completePisiTask(before, { now: clock }));
        },

        /**
         * Takes a completion back (§3.2.3): `completion` (`{ date, dueDate, at,
         * status? }`), else the latest. Only the latest completion of a
         * repeating task can be taken back; an earlier one gives
         * `{ ok: false, error: 'locked' }`. A done task that does not repeat
         * opens again.
         */
        reopen(taskId, completion = null) {
            return changeOne(taskId, (before, tasks, clock) => reopenPisiTask(before, completion, { now: clock }));
        }
    };
}
