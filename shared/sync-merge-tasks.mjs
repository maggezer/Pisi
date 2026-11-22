// The task rules of the tasks.json merge (docs/task-plan.md G9, docs/sync-plan.md
// §3.4). shared/sync-merge-authority.mjs merges a task record field by field;
// this module decides the fields where "the later updatedAt wins" would lose
// what a user did on the other device:
//
// - `completions` merge entry by entry, keyed by the due day of the occurrence
//   they complete (`dueDate`). An occurrence completed on both devices keeps the
//   completion that was done first (the smaller `at`); the other one is logged.
//   An entry taken back on one side and changed on the other follows the
//   record's updatedAt rule and is logged.
// - A done task that does not repeat, completed on both devices, keeps the
//   earlier completion (`completedAt` with its `completedOn`).
// - Progress does not go back: when the merged due day of a repeating task is
//   not after every merged completion's due day, the due day (and `reminderAt`,
//   which moves with it) comes from the side that is further on.
// A list in which a due day repeats (an 'after-completion' task completed twice
// on one day) cannot be keyed and merges as a whole field, as before.
//
// Every losing value is returned as a conflict for the device's conflict log.

import { PISI_SYNC_ABSENT, clonePisiSyncJson, isPisiSyncPlainObject, pisiSyncJsonEqual } from './sync-merge-json.mjs';

const read = (object, key) => (isPisiSyncPlainObject(object) && Object.hasOwn(object, key) ? object[key] : PISI_SYNC_ABSENT);
const changed = (side, base) => !pisiSyncJsonEqual(side, base);

/** The key of a completion: the due day of the occurrence it completes (the day it was done when it had none). */
export function getPisiSyncCompletionKey(entry) {
    if (!isPisiSyncPlainObject(entry)) return null;
    if (typeof entry.dueDate === 'string' && entry.dueDate) return `due:${entry.dueDate}`;
    return typeof entry.date === 'string' && entry.date ? `day:${entry.date}` : null;
}

/** Completions keyed by occurrence, or null when a list cannot be keyed (not a list, an entry without a day, a repeated day). */
function keyCompletions(list) {
    if (list === PISI_SYNC_ABSENT || list === null) return new Map();
    if (!Array.isArray(list)) return null;
    const out = new Map();
    for (const entry of list) {
        const key = getPisiSyncCompletionKey(entry);
        if (!key || out.has(key)) return null;
        out.set(key, entry);
    }
    return out;
}

const atOf = (entry) => (typeof entry?.at === 'string' ? entry.at : '');
const compareCompletions = (a, b) =>
    atOf(a).localeCompare(atOf(b)) ||
    String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')) ||
    String(a.date ?? '').localeCompare(String(b.date ?? ''));

/**
 * Three-way merge of the `completions` of one task that both sides changed.
 * Returns the merged list (sorted by `at`), or null when a side's list cannot
 * be keyed (the caller then merges the field as a whole).
 */
export function mergePisiSyncTaskCompletions({ recordId = null, base, local, remote, localWins = false, conflicts = [] }) {
    const [b, l, r] = [keyCompletions(base), keyCompletions(local), keyCompletions(remote)];
    if (!b || !l || !r) return null;
    const out = [];
    for (const key of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
        const [be, le, re] = [b.get(key), l.get(key), r.get(key)];
        let value;
        if (pisiSyncJsonEqual(le, re) || pisiSyncJsonEqual(re, be)) value = le;
        else if (pisiSyncJsonEqual(le, be)) value = re;
        else if (le && re) {
            // The same occurrence completed on both devices: the one done first stays.
            const localFirst = atOf(le) && atOf(le) < atOf(re);
            value = localFirst ? le : re;
            conflicts.push({
                recordId,
                field: 'completions',
                kind: 'completion',
                winner: localFirst ? 'local' : 'remote',
                base: clonePisiSyncJson(be ?? null),
                lost: clonePisiSyncJson(localFirst ? re : le)
            });
        } else {
            // Taken back on one side, changed on the other: the record's updatedAt decides.
            value = localWins ? le : re;
            conflicts.push({
                recordId,
                field: 'completions',
                kind: 'completion',
                winner: localWins ? 'local' : 'remote',
                base: clonePisiSyncJson(be ?? null),
                lost: clonePisiSyncJson((localWins ? re : le) ?? null)
            });
        }
        if (value) out.push(clonePisiSyncJson(value));
    }
    return out.sort(compareCompletions);
}

/**
 * The value the field merge of sync-merge-authority.mjs gives `key`:
 * `{ value, side }` where side is 'local', 'remote' or 'both' (no conflict).
 */
function plainMerge(key, base, local, remote, localWins) {
    const [b, l, r] = [read(base, key), read(local, key), read(remote, key)];
    if (pisiSyncJsonEqual(l, r) || pisiSyncJsonEqual(r, b)) return { value: l, side: pisiSyncJsonEqual(l, r) ? 'both' : 'local' };
    if (pisiSyncJsonEqual(l, b)) return { value: r, side: 'remote' };
    return { value: localWins ? l : r, side: localWins ? 'local' : 'remote', conflict: true };
}

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The fields of a task record (present on both sides) that the task rules
 * decide, as a Map(field → value; PISI_SYNC_ABSENT drops the field). The
 * caller merges the other fields as usual and must not log the decided ones:
 * their conflicts are pushed here.
 */
export function resolvePisiSyncTaskFields({ recordId, base, local, remote, localWins = false, conflicts = [] }) {
    const resolved = new Map();
    const b = base === PISI_SYNC_ABSENT ? {} : base;

    // completions: entry by entry, when both sides changed the list.
    let completions = plainMerge('completions', b, local, remote, localWins).value;
    const [bc, lc, rc] = [read(b, 'completions'), read(local, 'completions'), read(remote, 'completions')];
    if (changed(lc, bc) && changed(rc, bc) && changed(lc, rc)) {
        const merged = mergePisiSyncTaskCompletions({ recordId, base: bc, local: lc, remote: rc, localWins, conflicts });
        if (merged) {
            resolved.set('completions', merged);
            completions = merged;
        }
    }

    // A done task that does not repeat, completed on both devices: the earlier completion stays.
    const status = plainMerge('status', b, local, remote, localWins).value;
    const [bAt, lAt, rAt] = [read(b, 'completedAt'), read(local, 'completedAt'), read(remote, 'completedAt')];
    if (status === 'done' && typeof lAt === 'string' && typeof rAt === 'string' && lAt !== rAt && changed(lAt, bAt) && changed(rAt, bAt)) {
        const winner = lAt < rAt ? local : remote;
        const loser = winner === local ? remote : local;
        for (const key of ['completedAt', 'completedOn']) resolved.set(key, clonePisiSyncJson(read(winner, key)));
        conflicts.push({
            recordId,
            field: 'completedAt',
            kind: 'completion',
            winner: winner === local ? 'local' : 'remote',
            base: clonePisiSyncJson(bAt === PISI_SYNC_ABSENT ? null : bAt),
            lost: { completedAt: read(loser, 'completedAt'), completedOn: read(loser, 'completedOn') === PISI_SYNC_ABSENT ? null : read(loser, 'completedOn') }
        });
    }

    // Progress does not go back.
    const repeat = plainMerge('repeat', b, local, remote, localWins).value;
    const due = plainMerge('dueDate', b, local, remote, localWins);
    const doneDays = (Array.isArray(completions) ? completions : []).map((entry) => entry?.dueDate).filter(isDay);
    const lastDone = doneDays.sort().at(-1);
    // An 'after-completion' task completed early is due again on the day it was due (today + n), so equal is fine there.
    const behind = (value) => (repeat === 'after-completion' ? value < lastDone : value <= lastDone);
    if (typeof repeat === 'string' && repeat !== 'none' && lastDone && isDay(due.value) && behind(due.value)) {
        // Each side alone is past its own completions, so one of them is past the merged ones.
        const ahead = [local, remote].filter((side) => isDay(read(side, 'dueDate')) && !behind(read(side, 'dueDate')));
        const other = ahead.sort((x, y) => read(y, 'dueDate').localeCompare(read(x, 'dueDate')))[0];
        if (other) {
            resolved.set('dueDate', read(other, 'dueDate'));
            resolved.set('reminderAt', clonePisiSyncJson(read(other, 'reminderAt')));
            conflicts.push({
                recordId,
                field: 'dueDate',
                kind: 'progress',
                winner: other === local ? 'local' : 'remote',
                base: clonePisiSyncJson(read(b, 'dueDate') === PISI_SYNC_ABSENT ? null : read(b, 'dueDate')),
                lost: due.value
            });
        }
    }
    return resolved;
}
