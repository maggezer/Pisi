// What editing a task in the detail sheet changes in its record. Pure: each
// function returns the fields to pass to the task repo, or null when nothing
// would change.
//
// A task that lives in a note block takes its title, priority and date from
// the todo mark in that note, which mobile cannot edit (rule V8). Changing
// them only in tasks.json would not show on the desktop, so for those tasks
// only the status can be changed here (pisi-error.md §5d).

import { PISI_TASK_REPEATS, PISI_TASK_STATUSES } from '../../../../shared/task-model.mjs';
import { getPisiTaskCalendarIsoDate } from '../../../../shared/task-views.mjs';
import { getTaskTime } from '../pisi/day-model.mjs';

export const PISI_TASK_STATUS_VALUES = Object.freeze([...PISI_TASK_STATUSES]);
export const PISI_TASK_PRIORITY_VALUES = Object.freeze([5, 4, 3, 2, 1]);
export const PISI_TASK_REPEAT_VALUES = Object.freeze([...PISI_TASK_REPEATS]);
/** The desktop's reminder choices (renderer/tags/pisi-todo-third-model.mjs). */
export const PISI_TASK_REMINDER_MODES = Object.freeze(['none', 'due-morning', 'day-before', 'three-days-before']);

const ALL_FIELDS = Object.freeze(['title', 'status', 'priority', 'date', 'time', 'reminderAt', 'reminderMode', 'repeat']);
const NOTE_TASK_FIELDS = Object.freeze(['status']);
const RECORD_FIELDS = Object.freeze({
    title: ['title'],
    status: ['status'],
    priority: ['priority'],
    date: ['dueDate', 'scheduledAt', 'deadline'],
    time: ['scheduledAt'],
    reminderAt: ['reminderAt'],
    reminderMode: ['reminderMode'],
    repeat: ['repeat']
});

export const isNoteTask = (task) => Boolean(task?.source?.blockId);

/** The detail fields that can be changed for this task. */
export const getEditableTaskFields = (task) => (isNoteTask(task) ? NOTE_TASK_FIELDS : ALL_FIELDS);

/** `patch` without the record fields this task may not change here; null when nothing is left. */
export function limitTaskPatch(task, patch) {
    const allowed = new Set(getEditableTaskFields(task).flatMap((field) => RECORD_FIELDS[field]));
    const entries = Object.entries(patch ?? {}).filter(([key]) => allowed.has(key));
    return entries.length ? Object.fromEntries(entries) : null;
}

// A task whose day comes from its deadline alone: it has no planned day.
const isDeadlineTask = (task) => !task.scheduledAt && Boolean(task.deadline);

/**
 * Moves the task to `isoDate`, keeping its time of day, or takes its date away
 * (`null`). The field the day came from is the one that moves: the planned
 * day, or the deadline of a task that has only a deadline.
 */
export function getTaskDatePatch(task, isoDate) {
    if ((getPisiTaskCalendarIsoDate(task) ?? null) === (isoDate ?? null)) return null;
    if (!isoDate) return { dueDate: '', scheduledAt: '', deadline: '' };
    const withTime = (stamp) => (String(stamp).length > 10 ? `${isoDate}${String(stamp).slice(10)}` : isoDate);
    if (isDeadlineTask(task)) return { dueDate: isoDate, deadline: withTime(task.deadline) };
    return task.scheduledAt ? { dueDate: isoDate, scheduledAt: withTime(task.scheduledAt) } : { dueDate: isoDate };
}

/** Sets the planned time of day (`HH:mm`) or removes it (empty). A task without a day has no time. */
export function getTaskTimePatch(task, time) {
    const day = getPisiTaskCalendarIsoDate(task);
    const next = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || '')) ? time : null;
    if (!day || (getTaskTime(task) ?? null) === next) return null;
    return { scheduledAt: next ? `${day}T${next}` : day };
}

/** A new title, with the white space the store would fold; null when it is empty or unchanged. */
export function getTaskTitlePatch(task, text) {
    const title = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return title && title !== task.title ? { title } : null;
}

/** The reminder instant (`YYYY-MM-DDTHH:mm`, local time) or none (empty). */
export function getTaskReminderPatch(task, value) {
    const next = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || '')) ? String(value).slice(0, 16) : '';
    return next === String(task.reminderAt || '') ? null : { reminderAt: next };
}

/** One of the choice fields: `priority`, `repeat` or `reminderMode`. */
export function getTaskChoicePatch(task, field, value) {
    const next = field === 'priority' ? Number(value) : value;
    const current = field === 'reminderMode' ? task.reminderMode || 'none' : field === 'repeat' ? task.repeat || 'none' : task[field];
    return current === next ? null : { [field]: next };
}
