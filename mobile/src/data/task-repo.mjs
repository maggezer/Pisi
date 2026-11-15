// Tasks. `.pisi/tasks.json` is the only authority (rule V5): it is never
// rebuilt from a list held in memory. Every change re-reads the file inside
// the write queue and replaces just the one record. Record rules come from
// shared/task-model.mjs, the same code the desktop task store runs.

import { formatPisiTodoTag, getNextPisiTodoDate, getPisiTodayIsoDate, getPisiTodoRepeatOption, normalizePisiTaskRecord } from '../../../shared/task-model.mjs';
import { getPisiTaskCalendarIsoDate, getPisiTaskTodoTag, parsePisiTodoTagValue } from '../../../shared/task-views.mjs';
import { normalizeKey } from './drivers/keys.mjs';
import { PisiReadOnlyError, parseJsonText, readTextOrNull, serializeStore } from './json-file.mjs';

export const PISI_TASK_STORE_KEY = '.pisi/tasks.json';
const STORE_VERSION = 1;

/** Stored form of a note or map path: a project-relative key, or null. Throws when it points outside the project. */
function normalizeStoredPath(value) {
    const raw = String(value ?? '').trim();
    return raw ? normalizeKey(raw) : null;
}

function parseStore(text) {
    const parsed = parseJsonText(text);
    if (parsed.status === 'missing') return { status: 'missing', data: { version: STORE_VERSION, updatedAt: null, tasks: [] } };
    if (parsed.status === 'ok' && !Array.isArray(parsed.data.tasks)) return { status: 'corrupt', error: 'tasks is not a list' };
    return parsed;
}

const sameRecord = (a, b) => JSON.stringify({ ...a, updatedAt: null }) === JSON.stringify({ ...b, updatedAt: null });

export function createTaskRepo({ driver, writer, now, makeUuid }) {
    const corrupt = (error) => {
        writer.markReadOnly(PISI_TASK_STORE_KEY, error);
        return new PisiReadOnlyError(PISI_TASK_STORE_KEY, error);
    };

    // Unknown fields of a stored record survive (V3): the normalized fields are laid over the record as it is on disk.
    function normalize(payload, existing) {
        const task = { ...existing, ...normalizePisiTaskRecord(payload, existing, { now: now(), makeUuid, normalizeStoredPath }) };
        // The desktop lists a task under its todo tag. A task that lives in a note block
        // takes the tag from that block; any other task gets the tag of its own date and priority.
        if (payload.todoTag === undefined && !task.source?.blockId) {
            const day = getPisiTaskCalendarIsoDate(task);
            if (!existing && day && !task.dueDate) task.dueDate = day;
            task.todoTag = formatPisiTodoTag(task.priority, day || 'none') ?? task.todoTag;
        }
        return task;
    }

    /**
     * Re-reads the store, lets `change(tasks)` edit the task list in place and
     * writes the file back when a record really changed. `change` returns the
     * value to resolve with, or `{ skip: true, ... }` to leave the file alone.
     */
    async function mutate(change) {
        let outcome = null;
        await writer.update(PISI_TASK_STORE_KEY, (text) => {
            const store = parseStore(text);
            if (store.status === 'corrupt') throw corrupt(store.error);
            const tasks = store.data.tasks.slice();
            outcome = change(tasks);
            if (outcome.skip) return null;
            // Existing top-level fields keep their place and value; only these three are set.
            return serializeStore({ ...store.data, version: STORE_VERSION, updatedAt: now().toISOString(), tasks });
        });
        return outcome;
    }

    function upsertInto(tasks, payload) {
        const requestedId = String(payload.id || '').trim();
        const index = requestedId ? tasks.findIndex((task) => task && task.id === requestedId) : -1;
        const existing = index >= 0 ? tasks[index] : null;
        const task = normalize(payload, existing);
        if (existing && sameRecord(existing, task)) return { ok: true, created: false, changed: false, task: existing, skip: true };
        if (index >= 0) tasks[index] = task;
        else tasks.push(task);
        return { ok: true, created: index < 0, changed: true, task };
    }

    return {
        /** The tasks as stored. A corrupt store is reported, marked read-only and left untouched (V7). */
        async list() {
            const store = parseStore(await readTextOrNull(driver, PISI_TASK_STORE_KEY));
            if (store.status === 'corrupt') {
                writer.markReadOnly(PISI_TASK_STORE_KEY, store.error);
                return { ok: false, corrupt: true, readOnly: true, error: store.error, tasks: [] };
            }
            return {
                ok: true,
                readOnly: false,
                updatedAt: store.data.updatedAt ?? null,
                tasks: store.data.tasks.filter((task) => task && typeof task === 'object')
            };
        },

        /** Creates a task, or updates the one with `payload.id`. An unchanged task is not written (V4). */
        upsert(payload = {}) {
            if (!payload.id && !String(payload.title ?? payload.text ?? '').trim()) return Promise.resolve({ ok: false, error: 'empty-title' });
            return mutate((tasks) => upsertInto(tasks, payload));
        },

        /** Sets the status of an existing task. Unknown ids change nothing. */
        setStatus(taskId, status) {
            return mutate((tasks) => {
                if (!tasks.some((task) => task && task.id === taskId)) return { ok: false, notFound: true, skip: true };
                return upsertInto(tasks, { id: taskId, status });
            });
        },

        /** Changes fields of an existing task. Unknown ids change nothing; an unchanged task is not written (V4). */
        update(taskId, patch = {}) {
            return mutate((tasks) => {
                if (!tasks.some((task) => task && task.id === taskId)) return { ok: false, notFound: true, skip: true };
                return upsertInto(tasks, { ...patch, id: taskId });
            });
        },

        /**
         * Completes a task. A repeating task is marked done and its next
         * occurrence is added as a new task without a source note, with the
         * date the desktop rule gives (getNextPisiTodoDate).
         */
        complete(taskId) {
            return mutate((tasks) => {
                const current = tasks.find((task) => task && task.id === taskId);
                if (!current) return { ok: false, notFound: true, skip: true };
                if (current.status === 'done') return { ok: true, changed: false, task: current, next: null, skip: true };
                const done = upsertInto(tasks, { id: taskId, status: 'done' });
                const repeat = getPisiTodoRepeatOption(current.repeat).value;
                if (repeat === 'none') return { ...done, next: null };

                const finishDate = parsePisiTodoTagValue(getPisiTaskTodoTag(current), now())?.finishDate ?? null;
                const nextDate = getNextPisiTodoDate(finishDate, repeat, now(), current.completionOffsetDays);
                const nextIso = nextDate ? getPisiTodayIsoDate(nextDate) : null;
                const todoTag = nextIso ? formatPisiTodoTag(done.task.priority, nextIso) : null;
                if (!todoTag) return { ...done, next: null };
                const next = normalize(
                    {
                        title: current.title,
                        status: 'todo',
                        priority: done.task.priority,
                        dueDate: nextIso,
                        scheduledAt: nextIso,
                        reminderMode: current.reminderMode,
                        durationMinutes: current.durationMinutes,
                        repeat,
                        completionOffsetDays: current.completionOffsetDays,
                        manualOrder: Number.isFinite(current.manualOrder) ? current.manualOrder + 1 : undefined,
                        todoTag
                    },
                    null
                );
                tasks.push(next);
                return { ...done, next };
            });
        },

        /**
         * Takes back a `complete()` the user has just undone: the task returns
         * to `status`, and the occurrence that completing a repeating task
         * added (`next`, as `complete()` returned it) is taken out again while
         * it is still exactly that record. A record changed since then stays.
         */
        undoComplete(taskId, { status = 'todo', next = null } = {}) {
            return mutate((tasks) => {
                if (!tasks.some((task) => task && task.id === taskId)) return { ok: false, notFound: true, skip: true };
                const restored = upsertInto(tasks, { id: taskId, status: status === 'done' ? 'todo' : status });
                const nextIndex = next?.id ? tasks.findIndex((task) => task && task.id === next.id) : -1;
                const removed = nextIndex >= 0 && JSON.stringify(tasks[nextIndex]) === JSON.stringify(next);
                if (removed) tasks.splice(nextIndex, 1);
                return {
                    ok: true,
                    changed: Boolean(restored.changed) || removed,
                    task: restored.task,
                    removedNext: removed,
                    skip: !restored.changed && !removed
                };
            });
        }
    };
}
