// Which days of the Calendar tab carry a mark (docs/mobile-plan.md M8). Pure:
// no DOM and no storage. The rule is the desktop calendar's
// (`getCalendarTaskSummaryByDate` in renderer/calendar/pisi-calendar-ui.mjs),
// the day rule of the diary task section (docs/task-plan.md §3.2.2, G5): a day
// counts the tasks its diary section lists (living in that diary, due that day
// or completed that day), each with its state on that day, and a day is told
// apart by whether any of them is still open there. Both come from
// shared/task-diary.mjs (GV13). Diary days are the days that have a diary file.

import { getPisiTaskCalendarSummary } from '../../../../shared/task-diary.mjs';
import { readPisiTask } from '../../../../shared/task-model.mjs';

/**
 * `{ tasks, tasksDone, diary }`, each a set of ISO days: days with an open
 * task, days whose tasks are all done, and days with a diary file.
 */
export function getCalendarMarks(tasks, diaryDates) {
    const open = new Set();
    const tasksDone = new Set();
    // Records as stored (version 1 or 2): read leniently, the way the desktop store reads them.
    for (const [day, entry] of getPisiTaskCalendarSummary(tasks.map(readPisiTask).filter(Boolean))) {
        if (entry.open > 0) open.add(day);
        else if (entry.total > 0) tasksDone.add(day);
    }
    return { tasks: open, tasksDone, diary: new Set(diaryDates) };
}

/** `YYYY-MM` of an ISO day. */
export const monthOf = (isoDate) => String(isoDate).slice(0, 7);
