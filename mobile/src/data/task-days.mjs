// The task section of the diaries a task change touches (docs/task-plan.md
// §3.2.2, GV5, GV15). The section is derived from tasks.json by the rule in
// shared/task-diary.mjs, the code the desktop task service runs, so both
// write the same bytes. Only the days a change adds or removes are looked at;
// a day's diary is created when a task joins that day and it has none. The
// section is never read back as tasks.
//
// Runs inside the TaskRepo's writer job, after tasks.json was written: should
// the app stop half way, a section is behind the rule until the next change
// of that day or the desktop's Integrity repair (there is no journal across
// files on the phone; the section is derived, tasks.json is the authority).

import { getPisiDiaryNodeKey } from '../../../shared/diary-rules.mjs';
import { readPisiTask, readPisiTaskStore } from '../../../shared/task-model.mjs';
import { getPisiTaskDayChanges, listPisiDiaryTaskIds, replacePisiDiaryTaskSection } from '../../../shared/task-diary.mjs';
import { createDiaryFile } from './diary-file.mjs';
import { parseJsonText, serializeDocument } from './json-file.mjs';

/** The days `pairs` (`[{ before, after }]`, stored records or null) join and leave. */
export function getTaskDayChanges(pairs) {
    const days = new Set();
    const create = new Set();
    for (const { before, after } of pairs) {
        const change = getPisiTaskDayChanges(before ? readPisiTask(before) : null, after ? readPisiTask(after) : null);
        for (const day of change.days) days.add(day);
        for (const day of change.added) create.add(day);
    }
    return { days: [...days].sort(), create };
}

/**
 * The task records of tasks.json as `tx` reads it, or null when the file is
 * missing or cannot be read (then no section is written: GV11).
 */
export async function readTaskRecords(tx, key) {
    const parsed = parseJsonText(await tx.read(key));
    if (parsed.status !== 'ok') return null;
    const store = readPisiTaskStore(parsed.data);
    return store.ok ? store.tasks : null;
}

/** The content of a day's new diary: the desktop's empty diary, then the day's section. */
export function makeDiaryContentWithSection(empty, day, records) {
    const tasks = (records ?? []).map(readPisiTask).filter(Boolean);
    return replacePisiDiaryTaskSection(empty, day, listPisiDiaryTaskIds(day, tasks)) ?? empty;
}

/**
 * Writes the section of every day `pairs` touch from `records` (tasks.json
 * after the change). `writer` tells which files are read-only. Resolves with
 * `{ days, written, created, skipped }`, each a sorted list of days; a day
 * whose diary cannot be read or followed is skipped, never overwritten.
 */
export async function writeTaskDays(tx, records, pairs, { writer, now, makeUuid }) {
    const { days, create } = getTaskDayChanges(pairs);
    const tasks = records.map(readPisiTask).filter(Boolean);
    const outcome = { days, written: [], created: [], skipped: [] };
    for (const day of days) {
        const key = getPisiDiaryNodeKey(day);
        const ids = listPisiDiaryTaskIds(day, tasks);
        const text = await tx.read(key);
        if (text === null) {
            if (!ids.length || !create.has(day)) continue;
            await createDiaryFile(tx, day, (empty) => makeDiaryContentWithSection(empty, day, records), { now, makeUuid });
            outcome.created.push(day);
            continue;
        }
        const parsed = parseJsonText(text);
        if (writer.isReadOnly(key) || parsed.status !== 'ok' || !parsed.data.pisi) {
            outcome.skipped.push(day);
            continue;
        }
        const content = String(parsed.data.content ?? '');
        const next = replacePisiDiaryTaskSection(content, day, ids);
        if (next === null) {
            outcome.skipped.push(day);
            continue;
        }
        if (next === content) continue;
        await tx.write(key, serializeDocument({ ...parsed.data, pisi: { ...parsed.data.pisi, updatedAt: now().toISOString() }, content: next }));
        outcome.written.push(day);
    }
    return outcome;
}
