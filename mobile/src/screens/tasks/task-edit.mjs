// What editing a task in the detail sheet changes in its record. Pure: each
// function returns the version 2 fields to pass to the task repo
// (docs/task-plan.md §3.1), or null when nothing would change. Every task is
// edited the same way: a task that lives in a note keeps only its id in the
// note, so its title, day and the rest are changed in tasks.json like any
// other (G8; pisi-error.md §5d).

import { PISI_TASK_REMINDER_MODES, PISI_TASK_REPEATS, PISI_TASK_STATUSES, normalizePisiTaskDay } from '../../../../shared/task-model.mjs';
import { getTaskTime } from '../pisi/day-model.mjs';

export const PISI_TASK_STATUS_VALUES = Object.freeze([...PISI_TASK_STATUSES]);
export const PISI_TASK_PRIORITY_VALUES = Object.freeze([5, 4, 3, 2, 1]);
export const PISI_TASK_REPEAT_VALUES = Object.freeze([...PISI_TASK_REPEATS]);
export { PISI_TASK_REMINDER_MODES };

/** Moves the task to `isoDate` (its time of day stays) or takes its day away (`null`, the time goes with it). */
export function getTaskDatePatch(task, isoDate) {
    const next = isoDate ? normalizePisiTaskDay(isoDate) : null;
    if (isoDate && !next) return null;
    return (normalizePisiTaskDay(task.dueDate) ?? null) === next ? null : { dueDate: next };
}

/** Sets the time of day (`HH:mm`) or removes it (empty). A task without a day has no time. */
export function getTaskTimePatch(task, time) {
    const next = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || '')) ? time : null;
    if (!normalizePisiTaskDay(task.dueDate) || (getTaskTime(task) ?? null) === next) return null;
    return { dueTime: next };
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
    const next = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || '')) ? String(value).slice(0, 16) : null;
    return next === (task.reminderAt || null) ? null : { reminderAt: next };
}

/** One of the choice fields: `priority`, `repeat` or `reminderMode`. */
export function getTaskChoicePatch(task, field, value) {
    const next = field === 'priority' ? Number(value) : value;
    const current = field === 'reminderMode' ? task.reminderMode || 'none' : field === 'repeat' ? task.repeat || 'none' : task[field];
    return current === next ? null : { [field]: next };
}
