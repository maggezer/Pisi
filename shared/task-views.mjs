// Task view rules shared by desktop and mobile: which bucket a task date
// falls into (overdue / today / upcoming / later / undated), the date filters
// built on it and what a todo tag says about a task. Option labels are the
// desktop's source strings. A version 2 task's day is its `dueDate` (below).

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
    // A task's day and work order are read once per comparator, not once per comparison.
    const keys = new Map();
    const keyOf = (task) => {
        let key = keys.get(task);
        if (!key) {
            key = { order: getPisiTaskWorkOrder(task, today), day: getPisiTaskDay(task) ?? '9999-99-99' };
            keys.set(task, key);
        }
        return key;
    };
    return (a, b) => {
        const doneA = a.status === 'done';
        if (doneA !== (b.status === 'done')) return doneA ? 1 : -1;
        if (mode === 'manual') {
            const orderA = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.POSITIVE_INFINITY;
            const orderB = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.POSITIVE_INFINITY;
            if (orderA !== orderB) return orderA < orderB ? -1 : 1;
        }
        const keyA = keyOf(a);
        const keyB = keyOf(b);
        if (mode === 'date' && keyA.day !== keyB.day) return keyA.day < keyB.day ? -1 : 1;
        if (mode === 'priority' && priorityOf(a) !== priorityOf(b)) return priorityOf(b) - priorityOf(a);
        if (mode === 'status') {
            const difference = (STATUS_WEIGHT[a.status] ?? 9) - (STATUS_WEIGHT[b.status] ?? 9);
            if (difference) return difference;
        }
        if (keyA.order !== keyB.order) return keyA.order < keyB.order ? -1 : 1;
        if (keyA.day !== keyB.day) return keyA.day < keyB.day ? -1 : 1;
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

export const PISI_TASK_MANUAL_ORDER_STEP = 1024;

/**
 * The `manualOrder` changes that make `ordered` (tasks in the order the user
 * left them) the manual order, as `[{ taskId, patch: { manualOrder } }]`.
 * When the other tasks are already in a strictly rising order only `movedId`
 * gets a value, between its neighbours; otherwise the list is numbered again
 * in steps of PISI_TASK_MANUAL_ORDER_STEP and only the values that change are
 * returned. A list already in its order gives no change.
 */
export function getPisiTaskManualOrderUpdates(ordered, movedId = null) {
    const list = (Array.isArray(ordered) ? ordered : []).filter((task) => task?.id);
    const value = (task) => (Number.isFinite(task.manualOrder) ? task.manualOrder : null);
    const rising = (items) => items.every((task, index) => value(task) !== null && (index === 0 || value(task) > value(items[index - 1])));
    if (rising(list)) return [];
    const at = movedId ? list.findIndex((task) => task.id === movedId) : -1;
    if (at >= 0 && rising(list.filter((task) => task.id !== movedId))) {
        const before = at > 0 ? value(list[at - 1]) : null;
        const after = at < list.length - 1 ? value(list[at + 1]) : null;
        let next = null;
        if (before !== null && after !== null) next = before + (after - before) / 2;
        else if (before !== null) next = before + PISI_TASK_MANUAL_ORDER_STEP;
        else if (after !== null) next = after - PISI_TASK_MANUAL_ORDER_STEP;
        else next = PISI_TASK_MANUAL_ORDER_STEP;
        if (Number.isFinite(next) && (before === null || next > before) && (after === null || next < after)) {
            return [{ taskId: movedId, patch: { manualOrder: next } }];
        }
    }
    const updates = [];
    list.forEach((task, index) => {
        const next = (index + 1) * PISI_TASK_MANUAL_ORDER_STEP;
        if (value(task) !== next) updates.push({ taskId: task.id, patch: { manualOrder: next } });
    });
    return updates;
}

/** A copy of `ordered` with the task `taskId` moved `by` places (−1 up, +1 down); null when it cannot move. */
export function movePisiTaskInOrder(ordered, taskId, by) {
    const list = Array.isArray(ordered) ? [...ordered] : [];
    const from = list.findIndex((task) => task?.id === taskId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return null;
    const [task] = list.splice(from, 1);
    list.splice(to, 0, task);
    return list;
}
