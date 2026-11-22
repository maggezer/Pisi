import {
    PISI_TASK_REMINDER_MODES,
    PISI_TASK_REPEATS,
    addPisiTaskDays,
    getPisiTaskDaysBetween,
    normalizePisiTaskDay,
    normalizePisiTaskTags
} from '../../shared/task-model.mjs';
import {
    PISI_TASK_DATE_FILTERS,
    PISI_TASK_SORT_MODES,
    filterPisiTasks,
    getPisiTaskBucket,
    getPisiTaskComparator,
    getPisiTaskDay,
    sortPisiTasks
} from '../../shared/task-views.mjs';
import { cleanPisiTaskTitle } from './pisi-task-edit-core.mjs';

// The rules of the task panel and the task workspace (docs/task-plan.md G4)
// without the DOM: what a view shows and in which order, which cards change,
// how the kanban, the month and the timeline are laid out, and what the Quick
// Add form and the detail window send to the task service. The bucket, filter,
// sort and progress rules themselves are shared/task-views.mjs (GV13).

export const PISI_TASK_PANEL_VIEWS = Object.freeze(['list', 'kanban', 'calendar', 'timeline', 'stats']);
export const PISI_TASK_KANBAN_STATUSES = Object.freeze(['todo', 'doing', 'waiting', 'blocked']);
export const PISI_TASK_PANEL_STATUSES = Object.freeze(['all', 'todo', 'doing', 'waiting', 'blocked']);
/** Cards drawn at once; "Daha fazla göster" adds as many again. */
export const PISI_TASK_PANEL_PAGE = 200;
/** Cards a kanban column draws at once. */
export const PISI_TASK_KANBAN_PAGE = 100;
/** Tasks a day of the month view lists before "+N". */
export const PISI_TASK_CALENDAR_DAY_LIMIT = 4;
export const PISI_TASK_TIMELINE_SPAN = 30;

const MONTH = /^(\d{4})-(\d{2})$/;

/**
 * The view preferences with every unknown value replaced by its default.
 * @param {Record<string, any>} [prefs]
 */
export function normalizePisiTaskPanelPrefs(prefs = {}) {
    /** @type {Record<string, any>} */
    const source = prefs && typeof prefs === 'object' ? prefs : {};
    return {
        view: PISI_TASK_PANEL_VIEWS.includes(source.view) ? source.view : 'list',
        dateFilter: PISI_TASK_DATE_FILTERS.includes(source.dateFilter) ? source.dateFilter : 'all',
        status: PISI_TASK_PANEL_STATUSES.includes(source.status) ? source.status : 'all',
        sort: PISI_TASK_SORT_MODES.includes(source.sort) ? source.sort : 'workorder',
        showCompleted: source.showCompleted === true,
        month: MONTH.test(String(source.month || '')) ? source.month : null
    };
}

/**
 * What a list shows (`visible`, sorted), the number of tasks each date filter
 * would show with the other choices kept (`counts`), and the number of done
 * tasks. The default view, "Öncelikli", is the work order of the open tasks.
 */
export function getPisiTaskPanelModel(tasks, prefs, today) {
    const chosen = normalizePisiTaskPanelPrefs(prefs);
    const all = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.id);
    const counts = {};
    for (const dateFilter of PISI_TASK_DATE_FILTERS) {
        counts[dateFilter] = filterPisiTasks(all, { dateFilter, status: chosen.status, showCompleted: chosen.showCompleted, today }).length;
    }
    const shown = filterPisiTasks(all, { dateFilter: chosen.dateFilter, status: chosen.status, showCompleted: chosen.showCompleted, today });
    return {
        prefs: chosen,
        visible: sortPisiTasks(shown, { mode: chosen.sort, today }),
        counts,
        completedCount: all.filter((task) => task.status === 'done').length,
        total: all.length
    };
}

/**
 * The text a card is drawn from. A card whose signature did not change is
 * kept as it is; only cards with a new signature are drawn again (§3.5).
 * @param {any} task
 * @param {{ today?: string, place?: string, blocked?: boolean, manual?: boolean }} [options]
 */
export function getPisiTaskCardSignature(task, { today = '', place = '', blocked = false, manual = false } = {}) {
    if (!task) return '';
    return JSON.stringify([
        task.title,
        task.tags || [],
        task.status,
        task.priority,
        task.dueDate,
        task.dueTime,
        task.repeat,
        task.reminderMode,
        task.reminderAt,
        task.noteId,
        task.diaryDate,
        getPisiTaskBucket(task, today),
        place,
        blocked,
        manual
    ]);
}

/** Open tasks by their stored status, for the kanban columns (a done task is in none). */
export function groupPisiTasksForKanban(tasks, today) {
    const columns = Object.fromEntries(PISI_TASK_KANBAN_STATUSES.map((status) => [status, []]));
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (task?.id && columns[task.status]) columns[task.status].push(task);
    }
    const compare = getPisiTaskComparator('workorder', today);
    for (const status of PISI_TASK_KANBAN_STATUSES) columns[status].sort(compare);
    return columns;
}

/** The month (`YYYY-MM`) of a day. */
export function getPisiTaskMonthOf(day) {
    const normalized = normalizePisiTaskDay(day);
    return normalized ? normalized.slice(0, 7) : null;
}

/** The month `by` months after `month`. */
export function shiftPisiTaskMonth(month, by) {
    const match = MONTH.exec(String(month || ''));
    if (!match) return null;
    const index = Number(match[1]) * 12 + Number(match[2]) - 1 + by;
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The 42 days of a month view (weeks start on Monday): `{ day, inMonth,
 * today, tasks }`, the tasks on their day (`dueDate`) in the work order, and
 * the undated tasks apart.
 */
export function getPisiTaskMonthCells(month, tasks, today) {
    const match = MONTH.exec(String(month || ''));
    if (!match) return { cells: [], undated: [] };
    const first = `${match[1]}-${match[2]}-01`;
    const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = addPisiTaskDays(first, -weekday);
    const byDay = new Map();
    const undated = [];
    const compare = getPisiTaskComparator('workorder', today);
    for (const task of [...(Array.isArray(tasks) ? tasks : [])].sort(compare)) {
        const day = getPisiTaskDay(task);
        if (!day) {
            undated.push(task);
            continue;
        }
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(task);
    }
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
        const day = addPisiTaskDays(start, index);
        cells.push({ day, inMonth: day.startsWith(`${match[1]}-${match[2]}`), today: day === today, tasks: byDay.get(day) || [] });
    }
    return { cells, undated };
}

/**
 * The rows of the timeline: every dated task with its days from today and its
 * place on a track of `span` days (0–100, clamped; `overdue` before today,
 * `later` after the span), by day and then the work order; and the undated tasks.
 */
export function getPisiTaskTimelineRows(tasks, today, span = PISI_TASK_TIMELINE_SPAN) {
    const compare = getPisiTaskComparator('date', today);
    const rows = [];
    const undated = [];
    for (const task of [...(Array.isArray(tasks) ? tasks : [])].sort(compare)) {
        const day = getPisiTaskDay(task);
        if (!day) {
            undated.push(task);
            continue;
        }
        const offset = getPisiTaskDaysBetween(today, day);
        rows.push({ task, day, offset, position: (Math.max(0, Math.min(span, offset)) / span) * 100, overdue: offset < 0, later: offset > span });
    }
    return { rows, undated };
}

/** The repeat a Turkish date expression names, for the form's repeat field. */
export function getPisiQuickAddRepeat(parsed) {
    const repeat = PISI_TASK_REPEATS.has(parsed?.repeat) ? parsed.repeat : 'none';
    return { repeat, completionOffsetDays: repeat === 'after-completion' ? Math.max(1, Number(parsed?.completionOffsetDays) || 1) : null };
}

/** The day and time a parsed Turkish date expression gives: `{ dueDate, dueTime }`. */
export function getPisiQuickAddDay(parsed) {
    const iso = String(parsed?.scheduledAt || parsed?.deadline || '');
    const dueDate = normalizePisiTaskDay(iso.slice(0, 10));
    const dueTime = dueDate && /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : null;
    return { dueDate, dueTime };
}

/**
 * The task the Quick Add form creates (§1.4): the title, the day and time of
 * the Turkish date expression (no date, no day), the priority, the repeat
 * field and the reminder. A reminder mode needs a day; "hatırlat" in the
 * expression gives an exact reminder. Returns `{ task }` or `{ error }`.
 */
export function readPisiQuickAddTask(values = {}, parsed = null) {
    const title = cleanPisiTaskTitle(values.title);
    if (!title) return { error: 'empty-title' };
    const { dueDate, dueTime } = getPisiQuickAddDay(parsed);
    const repeat = PISI_TASK_REPEATS.has(values.repeat) ? values.repeat : 'none';
    const reminderAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(parsed?.reminderAt || '')) ? parsed.reminderAt.slice(0, 16) : null;
    const mode = PISI_TASK_REMINDER_MODES.includes(values.reminderMode) ? values.reminderMode : 'none';
    const priority = Math.max(1, Math.min(5, Math.round(Number(values.priority)) || 3));
    return {
        task: {
            title,
            priority,
            dueDate,
            dueTime,
            repeat,
            completionOffsetDays: repeat === 'after-completion' ? Math.max(1, Math.min(3650, Math.round(Number(values.completionOffsetDays)) || 1)) : null,
            reminderMode: dueDate ? mode : 'none',
            reminderAt
        }
    };
}

const DETAIL_FIELDS = Object.freeze([
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
    'durationMinutes',
    'actualMinutes',
    'completions'
]);

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const wholeNumber = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value)) || 0));

/**
 * The `task.update.v1` patch of the detail window: only the fields whose
 * value differs from the record. A done task keeps its status (it is taken
 * back with its checkbox); the time needs a day; the day count belongs only to
 * `after-completion`. Returns `{ patch, changed }` or `{ error }`.
 */
export function readPisiTaskDetailPatch(task, values = {}) {
    if (!task?.id) return { error: 'no-task' };
    const title = cleanPisiTaskTitle(values.title);
    const dueDate = normalizePisiTaskDay(values.dueDate);
    const dueTime = dueDate && /^\d{2}:\d{2}$/.test(String(values.dueTime || '')) ? values.dueTime : null;
    const repeat = PISI_TASK_REPEATS.has(values.repeat) ? values.repeat : 'none';
    const reminderAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(values.reminderAt || '')) ? String(values.reminderAt).slice(0, 16) : null;
    const status = task.status === 'done' || !PISI_TASK_KANBAN_STATUSES.includes(values.status) ? task.status : values.status;
    const next = {
        title,
        tags: Array.isArray(values.tags) ? normalizePisiTaskTags(values.tags) : normalizePisiTaskTags(task.tags),
        status,
        priority: Math.max(1, Math.min(5, Math.round(Number(values.priority)) || 3)),
        dueDate,
        dueTime,
        repeat,
        completionOffsetDays: repeat === 'after-completion' ? Math.max(1, Math.min(3650, Math.round(Number(values.completionOffsetDays)) || 1)) : null,
        reminderMode: PISI_TASK_REMINDER_MODES.includes(values.reminderMode) ? values.reminderMode : 'none',
        reminderAt,
        dependencies: Array.from(new Set((Array.isArray(values.dependencies) ? values.dependencies : []).filter((id) => id && id !== task.id))),
        durationMinutes: wholeNumber(values.durationMinutes, 1440),
        actualMinutes: wholeNumber(values.actualMinutes, 100000),
        completions: Array.isArray(values.completions) ? values.completions : Array.isArray(task.completions) ? task.completions : []
    };
    const patch = {};
    for (const field of DETAIL_FIELDS) {
        const before = field === 'dependencies' || field === 'completions' || field === 'tags' ? task[field] || [] : task[field];
        if (!sameValue(before, next[field])) patch[field] = next[field];
    }
    return { patch, changed: Object.keys(patch).length > 0 };
}

/**
 * The place the detail window's place field names, as a `task.move.v1`
 * target, or null when it is the task's own place. `value` is `diary:<day>`
 * or `note:<id>` with `notePath`.
 */
export function readPisiTaskDetailPlace(task, value, notePath = null) {
    const text = String(value || '');
    const diary = /^diary:(\d{4}-\d{2}-\d{2})$/.exec(text);
    if (diary) return task?.diaryDate === diary[1] ? null : { diaryDate: diary[1] };
    const note = /^note:(.+)$/.exec(text);
    if (note && notePath) return task?.noteId === note[1] ? null : { noteId: note[1], notePath };
    return null;
}

/** The value of the place field for a task's own place. */
export function getPisiTaskPlaceValue(task) {
    if (task?.noteId) return `note:${task.noteId}`;
    if (task?.diaryDate) return `diary:${task.diaryDate}`;
    return '';
}
