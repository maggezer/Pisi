import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    PISI_REMINDER_MAX_WAIT_MS,
    dismissPisiReminders,
    getPisiReminderDelay,
    getPisiReminderKey,
    getPisiTaskReminderTime,
    listPisiPendingReminders,
    markPisiRemindersShown,
    normalizePisiReminderState,
    normalizePisiReminderTimeOfDay,
    planPisiReminders,
    prunePisiReminderState,
    snoozePisiReminder
} from '../main/functions/reminder-schedule-core.js';

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const task = (patch = {}) => ({ id: 'task_abcd1', title: 'Rapor', status: 'todo', source: { nodePath: '/p/Not.node', blockId: 'blk_1' }, ...patch });

test('explicit reminderAt wins over the relative mode', () => {
    const value = task({ reminderAt: '2026-11-07T14:00', reminderMode: 'day-before', dueDate: '2026-11-20' });
    assert.equal(getPisiTaskReminderTime(value), local(2026, 11, 7, 14, 0));
});

test('relative modes derive from the due date at the default time', () => {
    const base = { dueDate: '2026-11-20' };
    assert.equal(getPisiTaskReminderTime(task({ ...base, reminderMode: 'due-morning' })), local(2026, 11, 20, 9, 0));
    assert.equal(getPisiTaskReminderTime(task({ ...base, reminderMode: 'day-before' }), { defaultTime: '18:30' }), local(2026, 11, 19, 18, 30));
    assert.equal(getPisiTaskReminderTime(task({ ...base, reminderMode: 'three-days-before' }), { defaultTime: '07:05' }), local(2026, 11, 17, 7, 5));
    // Month boundary.
    assert.equal(getPisiTaskReminderTime(task({ dueDate: '2026-12-01', reminderMode: 'three-days-before' })), local(2026, 11, 28, 9, 0));
    // A deadline with a time still uses its date.
    assert.equal(getPisiTaskReminderTime(task({ deadline: '2026-11-20T17:00', reminderMode: 'day-before' })), local(2026, 11, 19, 9, 0));
});

test('no reminder without a usable time, for finished tasks or for unknown modes', () => {
    assert.equal(getPisiTaskReminderTime(task({ reminderMode: 'day-before' })), null);
    assert.equal(getPisiTaskReminderTime(task({ reminderMode: 'none', dueDate: '2026-11-20' })), null);
    assert.equal(getPisiTaskReminderTime(task({ reminderMode: 'week-before', dueDate: '2026-11-20' })), null);
    assert.equal(getPisiTaskReminderTime(task({ reminderAt: '2026-02-30T10:00' })), null);
    assert.equal(getPisiTaskReminderTime(task({ reminderAt: '2026-11-07T14:00', status: 'done' })), null);
    assert.equal(getPisiTaskReminderTime(null), null);
    assert.equal(normalizePisiReminderTimeOfDay('24:00'), '09:00');
    assert.equal(normalizePisiReminderTimeOfDay('8:00'), '09:00');
    assert.equal(normalizePisiReminderTimeOfDay('08:15'), '08:15');
});

test('wall-clock reminder times hold in other time zones and across DST', () => {
    const script = fileURLToPath(new URL('../main/functions/reminder-schedule-core.js', import.meta.url));
    const probe = `import(${JSON.stringify(script)}).then((core) => {
        const at = (task) => new Date(core.getPisiTaskReminderTime({ id: 'task_abcd1', status: 'todo', ...task }, { defaultTime: '09:00' }));
        const a = at({ reminderAt: '2026-03-29T14:00' });
        const b = at({ dueDate: '2026-03-30', reminderMode: 'day-before' });
        const c = at({ dueDate: '2026-11-02', reminderMode: 'day-before' });
        console.log(JSON.stringify([a.toISOString(), [b.getHours(), b.getDate()], [c.getHours(), c.getDate()]]));
    });`;
    const run = (tz) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
    const istanbul = run('Europe/Istanbul');
    assert.equal(istanbul[0], '2026-03-29T11:00:00.000Z');
    assert.deepEqual(istanbul[1], [9, 29]);
    const newYork = run('America/New_York');
    assert.equal(newYork[0], '2026-03-29T18:00:00.000Z');
    // 2026-11-01 is the US DST end: the reminder still fires at 09:00 local.
    assert.deepEqual(newYork[2], [9, 1]);
    const berlin = run('Europe/Berlin');
    // 2026-03-29 is the EU DST start.
    assert.deepEqual(berlin[1], [9, 29]);
});

test('plan returns past unseen reminders as due, flags missed ones and finds the next instant', () => {
    const now = local(2026, 11, 6, 12, 0);
    const tasks = [
        task({ id: 'task_past1', reminderAt: '2026-11-06T11:59' }),
        task({ id: 'task_old01', reminderAt: '2026-10-01T08:00' }),
        task({ id: 'task_next1', reminderAt: '2026-11-06T13:00' }),
        task({ id: 'task_late1', reminderAt: '2026-11-08T13:00' }),
        task({ id: 'task_done1', reminderAt: '2026-11-06T10:00', status: 'done' })
    ];
    const plan = planPisiReminders(tasks, {}, { now, missedBefore: local(2026, 11, 6, 11, 0) });
    assert.deepEqual(
        plan.due.map((entry) => [entry.taskId, entry.missed]),
        [
            ['task_old01', true],
            ['task_past1', false]
        ]
    );
    assert.equal(plan.due[1].nodePath, '/p/Not.node');
    assert.equal(plan.due[1].blockId, 'blk_1');
    assert.equal(plan.nextAt, local(2026, 11, 6, 13, 0));

    // No reminder is skipped for being old.
    const veryOld = planPisiReminders([task({ reminderAt: '2020-01-01T08:00' })], {}, { now, missedBefore: now });
    assert.equal(veryOld.due.length, 1);
});

test('shown reminders do not repeat, but a changed time re-arms them', () => {
    const now = local(2026, 11, 6, 12, 0);
    const original = task({ reminderAt: '2026-11-06T11:00' });
    const first = planPisiReminders([original], {}, { now });
    const state = markPisiRemindersShown({}, first.due, now);
    assert.equal(planPisiReminders([original], state, { now }).due.length, 0);
    assert.deepEqual(
        listPisiPendingReminders(state).map((entry) => entry.key),
        [getPisiReminderKey(original.id, local(2026, 11, 6, 11, 0))]
    );

    const moved = { ...original, reminderAt: '2026-11-06T11:30' };
    assert.equal(planPisiReminders([moved], state, { now }).due.length, 1);
    // A relative reminder follows a new default time the same way.
    const relative = task({ dueDate: '2026-11-07', reminderMode: 'day-before' });
    const relState = markPisiRemindersShown({}, planPisiReminders([relative], {}, { now, defaultTime: '09:00' }).due, now);
    assert.equal(planPisiReminders([relative], relState, { now, defaultTime: '10:00' }).due.length, 1);
});

test('snooze postpones by ten minutes and clears the pending entry', () => {
    const now = local(2026, 11, 6, 12, 0);
    const value = task({ reminderAt: '2026-11-06T11:00' });
    const shown = markPisiRemindersShown({}, planPisiReminders([value], {}, { now }).due, now);
    const key = Object.keys(shown.pending)[0];
    const snoozed = snoozePisiReminder(shown, key, now);
    assert.deepEqual(listPisiPendingReminders(snoozed), []);
    const later = planPisiReminders([value], snoozed, { now: now + 5 * 60 * 1000 });
    assert.equal(later.due.length, 0);
    assert.equal(later.nextAt, now + 10 * 60 * 1000);
    const fired = planPisiReminders([value], snoozed, { now: now + 10 * 60 * 1000, missedBefore: now + 10 * 60 * 1000 });
    assert.equal(fired.due.length, 1);
    assert.equal(fired.due[0].missed, false, 'a snoozed reminder is not reported as missed');
    const reshown = markPisiRemindersShown(snoozed, fired.due, now + 10 * 60 * 1000);
    assert.deepEqual(reshown.snoozed, {});
});

test('dismiss and prune keep the state file small and consistent', () => {
    const now = local(2026, 11, 6, 12, 0);
    const kept = task({ id: 'task_keep1', reminderAt: '2026-11-06T11:00' });
    const finished = task({ id: 'task_fin01', reminderAt: '2026-11-06T10:00' });
    const removed = task({ id: 'task_gone1', reminderAt: '2026-11-06T09:00' });
    let state = markPisiRemindersShown({}, planPisiReminders([kept, finished, removed], {}, { now }).due, now);
    assert.equal(Object.keys(state.pending).length, 3);
    state = dismissPisiReminders(state, [getPisiReminderKey(kept.id, local(2026, 11, 6, 11, 0))]);
    assert.equal(Object.keys(state.pending).length, 2);
    state = prunePisiReminderState(state, [kept, { ...finished, status: 'done' }]);
    assert.deepEqual(Object.keys(state.shown), [getPisiReminderKey(kept.id, local(2026, 11, 6, 11, 0))]);
    assert.deepEqual(state.pending, {});
});

test('state normalization drops malformed records', () => {
    const state = normalizePisiReminderState({
        shown: { 'task_a@2026': 'x', nokey: 'y' },
        pending: { 'task_a@1': { key: 'task_a@1', taskId: 'task_a', time: 1 }, bad: { key: 'other', taskId: 'x', time: 1 }, worse: null },
        snoozed: { task_a: { key: 'task_a@1', until: 'soon' }, task_b: { key: 'task_b@1', until: 5 } }
    });
    assert.deepEqual(Object.keys(state.shown), ['task_a@2026']);
    assert.deepEqual(Object.keys(state.pending), ['task_a@1']);
    assert.deepEqual(state.snoozed, { task_b: { key: 'task_b@1', until: 5 } });
    assert.deepEqual(normalizePisiReminderState('corrupt'), { version: 1, shown: {}, pending: {}, snoozed: {} });
});

test('the timer waits at most fifteen minutes', () => {
    assert.equal(getPisiReminderDelay(null, 0), PISI_REMINDER_MAX_WAIT_MS);
    assert.equal(getPisiReminderDelay(1000, 0), 1000);
    assert.equal(getPisiReminderDelay(-5, 0), 0);
    assert.equal(getPisiReminderDelay(40 * 24 * 60 * 60 * 1000, 0), PISI_REMINDER_MAX_WAIT_MS);
});
