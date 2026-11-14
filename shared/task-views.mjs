// Task view rules shared by desktop and mobile: which bucket a task date
// falls into (overdue / today / upcoming / later / undated), the date filters
// built on it, what a todo tag says about a task, and which calendar day a
// task belongs to. Option labels are the desktop's source strings.

import { getPisiTodoPriorityOption, normalizePisiTodoTagValue } from './task-model.mjs';

export const PISI_TODO_FILTER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'all', label: 'Tümü' }),
    Object.freeze({ value: 'today', label: 'Bugün' }),
    Object.freeze({ value: 'upcoming', label: 'Yaklaşan' }),
    Object.freeze({ value: 'overdue', label: 'Geciken' }),
    Object.freeze({ value: 'undated', label: 'Tarihsiz' })
]);

export function getPisiTodoFilterOption(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return PISI_TODO_FILTER_OPTIONS.find((item) => item.value === normalized) || PISI_TODO_FILTER_OPTIONS[0];
}

export function getPisiTodoDateBucket(finishDate, now = new Date()) {
    if (!(finishDate instanceof Date) || Number.isNaN(finishDate.getTime())) {
        return 'undated';
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const due = new Date(finishDate);
    due.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor((due.getTime() - today.getTime()) / 86400000);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft === 0) return 'today';
    if (daysLeft <= 7) return 'upcoming';
    return 'later';
}

export function matchesPisiTodoFilter(todo, filterValue, now = new Date()) {
    const filter = getPisiTodoFilterOption(filterValue).value;
    if (filter === 'all') return true;
    return getPisiTodoDateBucket(todo?.finishDate, now) === filter;
}

export function parsePisiTodoTagValue(tag, now = new Date()) {
    const normalized = normalizePisiTodoTagValue(tag);
    const match = normalized.match(/^todo\.([1-9])\.(?:(\d{2})-(\d{2})-(\d{2}|\d{4})|none)$/);

    if (!match) return null;

    const rawPriority = Number(match[1]);
    const priority = Math.min(rawPriority, 5);
    const priorityOption = getPisiTodoPriorityOption(priority);
    let finishDate = null;

    if (match[2]) {
        const day = Number(match[2]);
        const month = Number(match[3]);
        const year = match[4].length === 2 ? 2000 + Number(match[4]) : Number(match[4]);
        finishDate = new Date(year, month - 1, day);

        if (finishDate.getFullYear() !== year || finishDate.getMonth() !== month - 1 || finishDate.getDate() !== day) {
            return null;
        }

        finishDate.setHours(0, 0, 0, 0);
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const daysLeft = finishDate ? Math.floor((finishDate.getTime() - today.getTime()) / 86400000) : null;

    return {
        tag: normalized,
        rawPriority,
        priority,
        priorityLabel: priorityOption.label,
        legacyPriority: rawPriority > 5,
        finishDate,
        daysLeft,
        dateBucket: getPisiTodoDateBucket(finishDate, now),
        workorder: finishDate ? daysLeft / priority : Number.POSITIVE_INFINITY
    };
}

/** The todo tag a task is listed under; a task without one is undated. */
export function getPisiTaskTodoTag(task) {
    return String(task?.todoTag || `todo.${task?.priority || 3}.none`);
}

/**
 * The calendar day (YYYY-MM-DD) a canonical task is counted on: its scheduled
 * day, else its due date, else its deadline. Null when none of them is a date.
 */
export function getPisiTaskCalendarIsoDate(task) {
    const isoDay = /^\d{4}-\d{2}-\d{2}$/;
    const scheduled = String(task.scheduledAt || '').slice(0, 10);
    if (isoDay.test(scheduled)) return scheduled;
    const due = String(task.dueDate || '').slice(0, 10);
    if (isoDay.test(due)) return due;
    const deadline = String(task.deadline || '').slice(0, 10);
    return isoDay.test(deadline) ? deadline : null;
}
