// The lists of the Tasks tab, worked out from the stored tasks. Pure: no DOM
// and no storage. The buckets are the desktop's (shared/task-views.mjs):
// today, the next seven days, later, overdue and undated. A task's day is the
// one the Pisi tab uses, so the two tabs never disagree about a task.

import { getPisiTaskCalendarIsoDate, getPisiTodoDateBucket } from '../../../../shared/task-views.mjs';
import { isoToDate } from '../../ui/dates.mjs';
import { byTimeThenPriority } from '../pisi/day-model.mjs';

export const PISI_TASK_VIEWS = Object.freeze(['today', 'upcoming', 'overdue', 'inbox', 'done']);
export const PISI_DEFAULT_TASK_VIEW = 'today';
/** How many rows a list shows before "show more". */
export const PISI_TASK_PAGE_SIZE = 100;

const byDayThenTime = (a, b) => (a.day === b.day ? byTimeThenPriority(a, b) : a.day < b.day ? -1 : 1);
const byPriorityThenOrder = (a, b) => b.task.priority - a.task.priority || (a.task.manualOrder ?? 0) - (b.task.manualOrder ?? 0);

/**
 * Every task in exactly one list, as `{ task, day }` entries:
 * - `today`, `week` (the desktop's "upcoming": 1–7 days ahead), `later`,
 *   `overdue` and `inbox` (no day) hold open tasks;
 * - `done` holds finished tasks, the last finished first.
 */
export function buildTaskLists(tasks, { today }) {
    const lists = { today: [], week: [], later: [], overdue: [], inbox: [], done: [] };
    const now = isoToDate(today);
    for (const task of tasks) {
        const day = getPisiTaskCalendarIsoDate(task);
        const entry = { task, day };
        if (task.status === 'done') {
            lists.done.push(entry);
            continue;
        }
        const bucket = getPisiTodoDateBucket(day ? isoToDate(day) : null, now);
        lists[bucket === 'upcoming' ? 'week' : bucket === 'undated' ? 'inbox' : bucket].push(entry);
    }
    lists.today.sort(byTimeThenPriority);
    lists.week.sort(byDayThenTime);
    lists.later.sort(byDayThenTime);
    lists.overdue.sort(byDayThenTime);
    lists.inbox.sort(byPriorityThenOrder);
    lists.done.sort((a, b) => String(b.task.completedAt || '').localeCompare(String(a.task.completedAt || '')));
    return lists;
}

/** The number on each view's chip. */
export function getTaskViewCounts(lists) {
    return {
        today: lists.today.length,
        upcoming: lists.week.length + lists.later.length,
        overdue: lists.overdue.length,
        inbox: lists.inbox.length,
        done: lists.done.length
    };
}

/**
 * The groups a view shows, empty ones left out. "Upcoming" has two: the next
 * seven days, which is the desktop's list, and everything after that, which
 * the desktop shows only under "all".
 */
export function getTaskViewGroups(lists, view) {
    const groups = view === 'upcoming' ? ['week', 'later'] : [view];
    return groups.map((id) => ({ id, entries: lists[id] ?? [] })).filter((group) => group.entries.length);
}

/** The view a single task is listed in. */
export function getTaskView(task, { today }) {
    const lists = buildTaskLists([task], { today });
    return PISI_TASK_VIEWS.find((view) => getTaskViewGroups(lists, view).length) ?? PISI_DEFAULT_TASK_VIEW;
}
