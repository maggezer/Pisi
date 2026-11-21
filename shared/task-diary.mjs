// A day's tasks and the task section of its diary note (docs/task-plan.md
// §3.2.2, §3.2.3). The section is derived from tasks.json by one rule, so every
// device writes the same bytes for the same tasks (GV15). It carries task ids
// only; the editor draws the heading and the rows. It is never read back as
// tasks: readPisiDiaryTaskSection only tells whether a note's section is the
// one the rule gives.

import { getPisiLocalDay, getPisiTaskLatestCompletion, normalizePisiTaskDay } from './task-model.mjs';
import { PISI_DIARY_TASKS_BLOCK_TYPE, PISI_DIARY_TASKS_CLASS, findPisiElements } from './task-blocks.mjs';
import { isPisiTaskId } from './ids.mjs';

const TASK_REF = /\sdata-pisi-task-ref="([^"]*)"/g;

/** The block id of a day's task section. */
export const getPisiDiaryTaskSectionBlockId = (date) => `blk_diary-tasks-${date}`;

const completionsOf = (task) => (Array.isArray(task?.completions) ? task.completions : []);

/**
 * The day a task that does not repeat was completed on: `completedOn`, else
 * (a version 1 record) the local day of `completedAt`. Null when not done.
 */
export function getPisiTaskCompletedDay(task) {
    if (task?.status !== 'done') return null;
    return normalizePisiTaskDay(task.completedOn) ?? getPisiLocalDay(task.completedAt);
}

/**
 * Every day whose diary section lists the task, sorted: the day of its diary
 * (`diaryDate`), its due day and each day it was completed on.
 */
export function getPisiTaskDays(task) {
    if (!task || !isPisiTaskId(task.id)) return [];
    const days = new Set();
    for (const day of [normalizePisiTaskDay(task.diaryDate), normalizePisiTaskDay(task.dueDate), getPisiTaskCompletedDay(task)]) {
        if (day) days.add(day);
    }
    for (const entry of completionsOf(task)) {
        const day = normalizePisiTaskDay(entry?.date);
        if (day) days.add(day);
    }
    return [...days].sort();
}

const byCreation = (a, b) => {
    const createdA = String(a.createdAt ?? '');
    const createdB = String(b.createdAt ?? '');
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Task ids of a day's section in section order (created first, then id); each id once. */
export function listPisiDiaryTaskIds(date, tasks) {
    const day = normalizePisiTaskDay(date);
    if (!day) return [];
    const seen = new Set();
    const listed = [];
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task || seen.has(task.id) || !getPisiTaskDays(task).includes(day)) continue;
        seen.add(task.id);
        listed.push(task);
    }
    return listed.sort(byCreation).map((task) => task.id);
}

/** The section ids of every day that has one: a Map of day -> ids, in section order. */
export function groupPisiTasksByDay(tasks) {
    const byDay = new Map();
    const seen = new Set();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task || seen.has(task.id)) continue;
        seen.add(task.id);
        for (const day of getPisiTaskDays(task)) {
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(task);
        }
    }
    return new Map([...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, list]) => [day, list.sort(byCreation).map((task) => task.id)]));
}

/**
 * How a task looks on a day's diary (§3.2.2), or null when it is not on that day:
 * - `{ state: 'done', at, dueDate, locked }`: completed that day. For a
 *   repeating task `locked` is true unless it is the latest completion, the
 *   only one that can be taken back (§3.2.3).
 * - `{ state: 'open', status }` / `{ state: 'done', at, locked: false }`: due that day.
 * - `{ state: 'dated', status, dueDate }`: lives in that diary, dated another day (or undated).
 */
export function getPisiTaskStateOnDay(task, date) {
    const day = normalizePisiTaskDay(date);
    if (!day || !task) return null;
    const onDay = completionsOf(task).filter((entry) => entry?.date === day);
    if (onDay.length) {
        const entry = onDay.reduce((latest, item) => (String(item.at) > String(latest.at) ? item : latest));
        const latest = getPisiTaskLatestCompletion(task);
        const locked = !latest || latest.at !== entry.at || latest.dueDate !== (entry.dueDate ?? null) || latest.date !== entry.date;
        return { state: 'done', at: entry.at, dueDate: entry.dueDate ?? null, locked };
    }
    if (getPisiTaskCompletedDay(task) === day)
        return { state: 'done', at: task.completedAt ?? null, dueDate: normalizePisiTaskDay(task.dueDate), locked: false };
    if (normalizePisiTaskDay(task.dueDate) === day) {
        return task.status === 'done' ? { state: 'done', at: task.completedAt ?? null, dueDate: day, locked: false } : { state: 'open', status: task.status };
    }
    if (normalizePisiTaskDay(task.diaryDate) === day) return { state: 'dated', status: task.status, dueDate: normalizePisiTaskDay(task.dueDate) };
    return null;
}

/**
 * Open tasks due before `today`, for the group drawn above today's section;
 * never written to a file. Tasks already in today's section are left out.
 * Oldest due day first, then the higher priority, then the id.
 */
export function listPisiOverdueTasks(tasks, today) {
    const day = normalizePisiTaskDay(today);
    if (!day) return [];
    return (Array.isArray(tasks) ? tasks : [])
        .filter((task) => {
            const due = normalizePisiTaskDay(task?.dueDate);
            return due && due < day && task.status !== 'done' && !getPisiTaskDays(task).includes(day);
        })
        .sort((a, b) => (a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : (b.priority ?? 3) - (a.priority ?? 3) || (a.id < b.id ? -1 : 1)));
}

/**
 * The HTML of a day's section, byte for byte the same on every platform; ''
 * when the day has no task (then the diary has no section). Invalid and
 * repeated ids are dropped.
 */
export function makePisiDiaryTaskSectionHtml(date, ids) {
    const day = normalizePisiTaskDay(date);
    if (!day) throw new TypeError(`invalid day: ${date}`);
    const refs = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((id) => isPisiTaskId(id))));
    if (!refs.length) return '';
    const rows = refs.map((id) => `\n    <div data-pisi-task-ref="${id}"></div>`).join('');
    return `<div class="pisi-editor-block ${PISI_DIARY_TASKS_CLASS}" data-pisi-block-id="${getPisiDiaryTaskSectionBlockId(day)}" data-pisi-block-type="${PISI_DIARY_TASKS_BLOCK_TYPE}" contenteditable="false">${rows}\n</div>`;
}

const isSection = (attributes) => attributes['data-pisi-block-type'] === PISI_DIARY_TASKS_BLOCK_TYPE;

function findSections(content) {
    return findPisiElements(content, isSection, PISI_DIARY_TASKS_BLOCK_TYPE);
}

/**
 * What a diary note's task section holds, for drawing and for the Integrity
 * check, never as tasks (GV15): `{ count, taskIds, blockId, last }`, where
 * `count` is the number of sections (0 or 1 when the note follows the rule),
 * `taskIds` the ids of every section in order and `last` whether the section
 * is the note's last block. Null when the markup cannot be followed.
 */
export function readPisiDiaryTaskSection(html) {
    const content = String(html ?? '');
    const sections = findSections(content);
    if (!sections) return null;
    const taskIds = [];
    for (const section of sections) {
        for (const match of content.slice(section.openEnd, section.innerEnd).matchAll(TASK_REF)) {
            if (isPisiTaskId(match[1]) && !taskIds.includes(match[1])) taskIds.push(match[1]);
        }
    }
    const lastSection = sections.at(-1);
    return {
        count: sections.length,
        taskIds,
        blockId: sections[0]?.attributes['data-pisi-block-id'] ?? null,
        last: Boolean(lastSection) && !content.slice(lastSection.end).trim()
    };
}

/**
 * The diary note with the section the rule gives for `ids`: one section, the
 * last block; none when `ids` is empty. Every other byte stays. A section that
 * is already right (and last) gives back `html` itself, so an unchanged diary
 * is not written (V4). Null when the markup cannot be followed.
 */
export function replacePisiDiaryTaskSection(html, date, ids) {
    const content = String(html ?? '');
    const section = makePisiDiaryTaskSectionHtml(date, ids);
    const sections = findSections(content);
    if (!sections) return null;
    const lastSection = sections.at(-1);
    const lastIsTail = Boolean(lastSection) && !content.slice(lastSection.end).trim();
    if (sections.length === 1 && lastIsTail && content.slice(lastSection.start, lastSection.end) === section) return content;

    // A single section at the end is replaced where it is; anything else is taken out and the section goes to the end.
    if (sections.length === 1 && lastIsTail) return content.slice(0, lastSection.start) + section + content.slice(lastSection.end);
    let result = content;
    for (const item of [...sections].reverse()) result = result.slice(0, item.start) + result.slice(item.end);
    return result + section;
}

/**
 * Which diary sections a change of one task touches (§3.2.2, GV5):
 * `{ added, removed, days }`, sorted days the task joins and leaves and their
 * union. `before` is null for a new task, `after` null for a removed one. A
 * change of title, status, priority, time or reminder touches no day.
 */
export function getPisiTaskDayChanges(before, after) {
    const old = new Set(getPisiTaskDays(before));
    const next = new Set(getPisiTaskDays(after));
    const added = [...next].filter((day) => !old.has(day)).sort();
    const removed = [...old].filter((day) => !next.has(day)).sort();
    return { added, removed, days: [...added, ...removed].sort() };
}

/**
 * The calendar marks (§3.6): for each day with a section, how many of its
 * tasks are open and done on that day. A task living in that diary but dated
 * elsewhere counts by its own status.
 */
export function getPisiTaskCalendarSummary(tasks) {
    const byId = new Map((Array.isArray(tasks) ? tasks : []).filter(Boolean).map((task) => [task.id, task]));
    const summary = new Map();
    for (const [day, ids] of groupPisiTasksByDay(tasks)) {
        const entry = { total: 0, open: 0, completed: 0 };
        for (const id of ids) {
            const state = getPisiTaskStateOnDay(byId.get(id), day);
            const done = state?.state === 'done' || (state?.state === 'dated' && state.status === 'done');
            entry.total += 1;
            if (done) entry.completed += 1;
            else entry.open += 1;
        }
        summary.set(day, entry);
    }
    return summary;
}
