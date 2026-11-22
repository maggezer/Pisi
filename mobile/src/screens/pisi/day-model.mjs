// What the Pisi tab shows for one day, worked out from the stored tasks and
// the diary days. Pure: no DOM and no storage. The day's tasks are its diary
// section (docs/task-plan.md §3.2.2): living in that day's diary, due that day
// or completed that day, each with its state on that day; today adds the open
// tasks that are overdue. These rules come from shared/task-diary.mjs, the
// desktop's (GV13); the Turkish date parser is the desktop's too.

import { PISI_TURKISH_MONTHS, parsePisiTurkishDateExpression } from '../../../../shared/date-parser.mjs';
import { PISI_TASK_REPEATS, normalizePisiTaskDay } from '../../../../shared/task-model.mjs';
import { getPisiTaskCalendarSummary, getPisiTaskStateOnDay, listPisiDiaryTaskIds, listPisiOverdueTasks } from '../../../../shared/task-diary.mjs';
import { isoToDate, shiftIsoDate } from '../../ui/dates.mjs';

export const PISI_WHEEL_RADIUS = 45;
const MONTH_NAMES = Object.keys(PISI_TURKISH_MONTHS);

/** `HH:mm` of a task that is due at a time of day, else null. */
export function getTaskTime(task) {
    return task?.dueDate && /^\d{2}:\d{2}$/.test(String(task.dueTime || '')) ? task.dueTime : null;
}

// Times of day first, in order; then the higher priority (5 is the highest); then the user's own order.
export function byTimeThenPriority(a, b) {
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
 * - `overdue`: open tasks due before today, filled only when the selected day is today;
 * - `day`: the open tasks of the day's section (due that day, or living in
 *   that day's diary with another day or none, shown with their own day);
 * - `done`: the tasks done on that day, the last one first.
 * Every entry is `{ task, day, state }`: `day` the task's own day,
 * `state` its state on the selected day (getPisiTaskStateOnDay; `locked` on a
 * past completion of a repeating task that can no longer be taken back).
 */
export function groupDayTasks(tasks, { selectedDate, today }) {
    const groups = { overdue: [], day: [], done: [] };
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const id of listPisiDiaryTaskIds(selectedDate, tasks)) {
        const task = byId.get(id);
        const state = getPisiTaskStateOnDay(task, selectedDate);
        if (!state) continue;
        const entry = { task, day: normalizePisiTaskDay(task.dueDate), state };
        if (state.state === 'done' || task.status === 'done') groups.done.push(entry);
        else groups.day.push(entry);
    }
    if (selectedDate === today) {
        for (const task of listPisiOverdueTasks(tasks, today)) groups.overdue.push({ task, day: task.dueDate, state: { state: 'open', status: task.status } });
    }
    // The day's own tasks first, then those living in its diary with another day; each by time and priority.
    const own = (entry) => (entry.day === selectedDate ? 0 : 1);
    groups.day.sort((a, b) => own(a) - own(b) || byTimeThenPriority(a, b));
    groups.done.sort((a, b) => String(b.state.at || '').localeCompare(String(a.state.at || '')));
    return groups;
}

/** Days that get a dot on the date wheel and in the date picker: open tasks on that day (the calendar's rule), and a diary file. */
export function getDayMarks(tasks, diaryDates) {
    const taskDays = new Set();
    for (const [day, entry] of getPisiTaskCalendarSummary(tasks)) if (entry.open > 0) taskDays.add(day);
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
 * a repeat ("her gün") still apply. Without a selected day (the Tasks tab) a
 * line that names no day stays undated, unless it gives a time of day: that
 * is today.
 * Returns null for an empty line, else `{ payload, day, time, repeat }`:
 * `payload` holds the version 2 fields of the new task (§3.1; the day is
 * `dueDate`, the time `dueTime`) and `day` is null for an undated task.
 */
export function parseTaskDraft(text, { selectedDate = null, now }) {
    const title = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!title) return null;
    let parsed = parsePisiTurkishDateExpression(title, now);
    if (!parsed.scheduledAt && !parsed.deadline) {
        const day = selectedDate ? isoToDate(selectedDate) : new Date(now);
        const dated = parsePisiTurkishDateExpression(`${title} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`, now);
        if (selectedDate || String(dated.scheduledAt || dated.deadline || '').length > 10) parsed = dated;
    }
    const stamp = String(parsed.scheduledAt || parsed.deadline || selectedDate || '');
    const day = normalizePisiTaskDay(stamp.slice(0, 10));
    const time = day && /^T\d{2}:\d{2}/.test(stamp.slice(10)) ? stamp.slice(11, 16) : null;
    const repeat = PISI_TASK_REPEATS.has(parsed.repeat) ? parsed.repeat : 'none';
    const reminderAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(parsed.reminderAt || '')) ? parsed.reminderAt.slice(0, 16) : null;
    return {
        payload: {
            title,
            dueDate: day,
            dueTime: time,
            reminderAt,
            repeat,
            completionOffsetDays: repeat === 'after-completion' ? (parsed.completionOffsetDays ?? 1) : null
        },
        day,
        time,
        repeat
    };
}

const paragraphsOf = (text) =>
    String(text ?? '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
        .filter((paragraph) => paragraph.trim());

/**
 * The day's text when it changed on disk (another device) while text typed
 * here was not saved yet. `base` is the text both started from. Nothing is
 * lost (SV3): when only one side changed, that side is the result; otherwise
 * the text on disk comes first and every paragraph typed here that is in
 * neither the base nor the disk follows it.
 */
export function mergeDiaryText({ base, local, remote }) {
    if (local === base || local === remote) return remote;
    if (remote === base) return local;
    const known = new Set([...paragraphsOf(base), ...paragraphsOf(remote)]);
    const added = paragraphsOf(local).filter((paragraph) => !known.has(paragraph));
    return [...paragraphsOf(remote), ...added].join('\n\n');
}
