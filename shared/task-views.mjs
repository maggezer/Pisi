// Task view rules shared by desktop and mobile: which bucket a task date
// falls into (overdue / today / upcoming / later / undated), the date filters
// built on it, what a todo tag says about a task, and which calendar day a
// task belongs to. Option labels are the desktop's source strings.

import { getPisiTaskDaysBetween, getPisiTodoPriorityOption, normalizePisiTaskDay, normalizePisiTodoTagValue } from './task-model.mjs';
import { getPisiTaskCalendarSummary } from './task-diary.mjs';

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

// ---------------------------------------------------------------------------
// Version 2 views (docs/task-plan.md §3.6). A task's day is its `dueDate` and
// nothing else (GK1). `today` is a `YYYY-MM-DD` given by the caller.

export { getPisiTaskCalendarSummary };

export const PISI_TASK_DATE_FILTERS = Object.freeze(['all', 'today', 'upcoming', 'overdue', 'undated']);
export const PISI_TASK_SORT_MODES = Object.freeze(['workorder', 'priority', 'manual', 'date', 'status']);
const STATUS_WEIGHT = Object.freeze({ doing: 0, todo: 1, waiting: 2, blocked: 3 });

/** The day of a task: its due day, or null for an undated task. */
export function getPisiTaskDay(task) {
    return normalizePisiTaskDay(task?.dueDate);
}

/** Days from today to the task's day (negative when overdue), or null when undated. */
export function getPisiTaskDaysLeft(task, today) {
    const day = getPisiTaskDay(task);
    return day ? getPisiTaskDaysBetween(today, day) : null;
}

/** overdue, today, upcoming (1–7 days), later or undated. The status does not matter. */
export function getPisiTaskBucket(task, today) {
    const left = getPisiTaskDaysLeft(task, today);
    if (left === null) return 'undated';
    if (left < 0) return 'overdue';
    if (left === 0) return 'today';
    return left <= 7 ? 'upcoming' : 'later';
}

const priorityOf = (task) => (Number.isInteger(task?.priority) && task.priority >= 1 && task.priority <= 5 ? task.priority : 3);

/** The desktop's work order: days left divided by priority; Infinity for an undated task. */
export function getPisiTaskWorkOrder(task, today) {
    const left = getPisiTaskDaysLeft(task, today);
    return left === null ? Number.POSITIVE_INFINITY : left / priorityOf(task);
}

const compareIds = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The comparator of a sort mode (§3.6, the panel's current rules): done tasks
 * last; `manual`, `date`, `priority` and `status` first compare their own key;
 * every mode then follows the work order (overdue first, then days left and
 * priority), then the day, the higher priority and the id.
 */
export function getPisiTaskComparator(mode = 'workorder', today) {
    return (a, b) => {
        const doneA = a.status === 'done';
        if (doneA !== (b.status === 'done')) return doneA ? 1 : -1;
        if (mode === 'manual') {
            const orderA = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.POSITIVE_INFINITY;
            const orderB = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.POSITIVE_INFINITY;
            if (orderA !== orderB) return orderA < orderB ? -1 : 1;
        }
        if (mode === 'date') {
            const dayA = getPisiTaskDay(a) ?? '9999-99-99';
            const dayB = getPisiTaskDay(b) ?? '9999-99-99';
            if (dayA !== dayB) return dayA < dayB ? -1 : 1;
        }
        if (mode === 'priority' && priorityOf(a) !== priorityOf(b)) return priorityOf(b) - priorityOf(a);
        if (mode === 'status') {
            const difference = (STATUS_WEIGHT[a.status] ?? 9) - (STATUS_WEIGHT[b.status] ?? 9);
            if (difference) return difference;
        }
        const orderA = getPisiTaskWorkOrder(a, today);
        const orderB = getPisiTaskWorkOrder(b, today);
        if (orderA !== orderB) return orderA < orderB ? -1 : 1;
        const dayA = getPisiTaskDay(a) ?? '9999-99-99';
        const dayB = getPisiTaskDay(b) ?? '9999-99-99';
        if (dayA !== dayB) return dayA < dayB ? -1 : 1;
        return priorityOf(b) - priorityOf(a) || compareIds(a, b);
    };
}

/** A sorted copy of `tasks`. An unknown mode is the work order ("Öncelikli", the default view). */
export function sortPisiTasks(tasks, { mode = 'workorder', today }) {
    const known = PISI_TASK_SORT_MODES.includes(mode) ? mode : 'workorder';
    return [...(Array.isArray(tasks) ? tasks : [])].sort(getPisiTaskComparator(known, today));
}

/**
 * The tasks a view shows: `dateFilter` is a bucket (or `all`), `status` a
 * status (or `all`); done tasks only with `showCompleted`.
 */
export function filterPisiTasks(tasks, { dateFilter = 'all', status = 'all', showCompleted = false, today }) {
    const filter = PISI_TASK_DATE_FILTERS.includes(dateFilter) ? dateFilter : 'all';
    return (Array.isArray(tasks) ? tasks : []).filter((task) => {
        if (!task) return false;
        if (!showCompleted && task.status === 'done') return false;
        if (filter !== 'all' && getPisiTaskBucket(task, today) !== filter) return false;
        return status === 'all' || task.status === status;
    });
}

/**
 * Dependencies of every task: a Map of id -> `{ missing, open, blocked,
 * effectiveStatus }`. A task waiting on an open task is `blocked`.
 */
export function getPisiTaskDependencyState(tasks) {
    const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
    const byId = new Map(list.map((task) => [task.id, task]));
    const states = new Map();
    for (const task of list) {
        const ids = Array.isArray(task.dependencies) ? task.dependencies : [];
        const missing = ids.filter((id) => !byId.has(id));
        const open = ids.filter((id) => byId.has(id) && byId.get(id).status !== 'done');
        states.set(task.id, { missing, open, blocked: open.length > 0, effectiveStatus: open.length ? 'blocked' : task.status });
    }
    return states;
}

/**
 * The counts of the progress view: total, open, completed and its rate (%),
 * blocked by a dependency, overdue, open tasks by effective status and by
 * priority, and the completed occurrences of repeating tasks.
 */
export function getPisiTaskProgress(tasks, today) {
    const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
    const dependencies = getPisiTaskDependencyState(list);
    const byStatus = { todo: 0, doing: 0, waiting: 0, blocked: 0 };
    const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let completed = 0;
    let blocked = 0;
    let overdue = 0;
    let occurrences = 0;
    for (const task of list) {
        occurrences += Array.isArray(task.completions) ? task.completions.length : 0;
        if (task.status === 'done') {
            completed += 1;
            continue;
        }
        const state = dependencies.get(task.id);
        if (state.blocked) blocked += 1;
        if (getPisiTaskBucket(task, today) === 'overdue') overdue += 1;
        if (state.effectiveStatus in byStatus) byStatus[state.effectiveStatus] += 1;
        byPriority[priorityOf(task)] += 1;
    }
    const total = list.length;
    return {
        total,
        open: total - completed,
        completed,
        rate: total ? Math.round((completed / total) * 100) : 0,
        blocked,
        overdue,
        byStatus,
        byPriority,
        completedOccurrences: occurrences
    };
}
