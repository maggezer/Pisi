// Which days of the Calendar tab carry a mark (docs/mobile-plan.md M8). Pure:
// no DOM and no storage. The rule is the desktop calendar's
// (`getCalendarTaskSummaryByDate` in renderer/calendar/pisi-calendar-ui.mjs):
// every task with a calendar day counts on that day, done or not, and a day
// is told apart by whether any of its tasks is still open. The day of a task
// comes from shared/task-views.mjs. Diary days are the days that have a
// diary file.

import { getPisiTaskCalendarIsoDate } from '../../../../shared/task-views.mjs';

/**
 * `{ tasks, tasksDone, diary }`, each a set of ISO days: days with an open
 * task, days whose tasks are all done, and days with a diary file.
 */
export function getCalendarMarks(tasks, diaryDates) {
    const open = new Set();
    const counted = new Set();
    for (const task of tasks) {
        const day = getPisiTaskCalendarIsoDate(task);
        if (!day) continue;
        counted.add(day);
        if (String(task.status || 'todo').toLowerCase() !== 'done') open.add(day);
    }
    const tasksDone = new Set([...counted].filter((day) => !open.has(day)));
    return { tasks: open, tasksDone, diary: new Set(diaryDates) };
}

/** `YYYY-MM` of an ISO day. */
export const monthOf = (isoDate) => String(isoDate).slice(0, 7);
