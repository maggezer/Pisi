// What the Pisi tab shows for one day, worked out from the stored tasks and
// the diary days. Pure: no DOM and no storage. Which day a task belongs to
// and what "overdue" means come from shared/task-views.mjs, the rules the
// desktop uses; the Turkish date parser is the desktop's too.

import { PISI_TURKISH_MONTHS, parsePisiTurkishDateExpression } from '../../../../shared/date-parser.mjs';
import { getPisiTodayIsoDate } from '../../../../shared/task-model.mjs';
import { getPisiTaskCalendarIsoDate, getPisiTodoDateBucket } from '../../../../shared/task-views.mjs';
import { isoToDate, shiftIsoDate } from '../../ui/dates.mjs';

export const PISI_WHEEL_RADIUS = 45;
const MONTH_NAMES = Object.keys(PISI_TURKISH_MONTHS);

/** `HH:mm` of a task that is planned for a time of day, else null. */
export function getTaskTime(task) {
    const match = /T(\d{2}:\d{2})/.exec(String(task?.scheduledAt || ''));
    return match ? match[1] : null;
}

/** The note a task came from: its stored title, else the file name without the extension. */
export function getTaskSourceTitle(task) {
    const title = String(task?.source?.nodeTitle || '').trim();
    if (title) return title;
    const path = String(task?.source?.nodePath || '');
    return (
        path
            .split('/')
            .at(-1)
            .replace(/\.node$/i, '') || null
    );
}

/** The local day a done task was completed on, or null. */
function getCompletedDay(task) {
    const completed = new Date(task.completedAt || '');
    return Number.isNaN(completed.getTime()) ? null : getPisiTodayIsoDate(completed);
}

// Planned times first, in order; then the higher priority (5 is the highest); then the user's own order.
function byTimeThenPriority(a, b) {
    const timeA = getTaskTime(a.task);
    const timeB = getTaskTime(b.task);
    if (timeA !== timeB) {
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA < timeB ? -1 : 1;
    }
    return b.task.priority - a.task.priority || (a.task.manualOrder ?? 0) - (b.task.manualOrder ?? 0);
}

/**
 * The task groups of the selected day:
 * - `overdue`: open tasks of earlier days, filled only when the selected day is today;
 * - `day`: open tasks of the selected day;
 * - `done`: finished tasks of the selected day, and tasks finished on it.
 * Every entry is `{ task, day }`, `day` being the task's calendar day.
 */
export function groupDayTasks(tasks, { selectedDate, today }) {
    const groups = { overdue: [], day: [], done: [] };
    const now = isoToDate(today);
    for (const task of tasks) {
        const day = getPisiTaskCalendarIsoDate(task);
        const entry = { task, day };
        if (task.status === 'done') {
            if (day === selectedDate || getCompletedDay(task) === selectedDate) groups.done.push(entry);
        } else if (day === selectedDate) {
            groups.day.push(entry);
        } else if (selectedDate === today && day && getPisiTodoDateBucket(isoToDate(day), now) === 'overdue') {
            groups.overdue.push(entry);
        }
    }
    groups.overdue.sort((a, b) => (a.day === b.day ? byTimeThenPriority(a, b) : a.day < b.day ? -1 : 1));
    groups.day.sort(byTimeThenPriority);
    groups.done.sort((a, b) => String(b.task.completedAt || '').localeCompare(String(a.task.completedAt || '')));
    return groups;
}

/** Days that get a dot on the date wheel and in the date picker: open tasks, and a diary file. */
export function getDayMarks(tasks, diaryDates) {
    const taskDays = new Set();
    for (const task of tasks) {
        const day = task.status === 'done' ? null : getPisiTaskCalendarIsoDate(task);
        if (day) taskDays.add(day);
    }
    return { tasks: taskDays, diary: new Set(diaryDates) };
}

/** The days on the wheel: `radius` days on each side of `anchor`, oldest first. */
export function getWheelDays(anchor, radius = PISI_WHEEL_RADIUS) {
    return Array.from({ length: radius * 2 + 1 }, (_, index) => shiftIsoDate(anchor, index - radius));
}

/**
 * Reads the "add task" line. The whole line stays the title, as on the
 * desktop, where the date expression is not cut out of the text either. When
 * the line names no day, the selected day is used: the same parser reads the
 * line again with that day written out, so a time in the line ("10:00") and
 * a repeat ("her gün") still apply.
 * Returns null for an empty line, else `{ payload, day, time, deadline, repeat }`.
 */
export function parseTaskDraft(text, { selectedDate, now }) {
    const title = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!title) return null;
    let parsed = parsePisiTurkishDateExpression(title, now);
    if (!parsed.scheduledAt && !parsed.deadline) {
        const day = isoToDate(selectedDate);
        parsed = parsePisiTurkishDateExpression(`${title} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`, now);
    }
    const stamp = parsed.scheduledAt || parsed.deadline || selectedDate;
    return {
        payload: {
            title,
            scheduledAt: parsed.scheduledAt,
            deadline: parsed.deadline,
            reminderAt: parsed.reminderAt,
            repeat: parsed.repeat,
            completionOffsetDays: parsed.completionOffsetDays
        },
        day: stamp.slice(0, 10),
        time: stamp.length > 10 ? stamp.slice(11, 16) : null,
        deadline: !parsed.scheduledAt && Boolean(parsed.deadline),
        repeat: parsed.repeat
    };
}
