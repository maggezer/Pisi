import test from 'node:test';
import assert from 'node:assert/strict';

import * as shared from '../shared/reminder-schedule.mjs';
import * as desktop from '../main/functions/reminder-schedule-core.js';

const { listPisiUpcomingReminders, getPisiReminderKey } = shared;
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const task = (id, patch = {}) => ({ id, title: `Görev ${id}`, status: 'todo', noteId: 'node_abc', ...patch });

test('masaüstü hatırlatma anını shared kuralıyla hesaplar (telefonla aynı dakika)', () => {
    for (const name of [
        'PISI_REMINDER_DEFAULT_TIME',
        'PISI_REMINDER_RELATIVE_DAYS',
        'normalizePisiReminderTimeOfDay',
        'parsePisiLocalDateTime',
        'getPisiTaskReminderTime',
        'getPisiReminderKey'
    ]) {
        assert.equal(desktop[name], shared[name], `${name} is not the shared implementation`);
    }
});

test('yaklaşan hatırlatmalar: yalnız açık görevler ve gelecekteki anlar, en yakını önce, sınırla', () => {
    const now = local(2026, 11, 14, 9, 30);
    const tasks = [
        task('task_a', { reminderAt: '2026-11-20T08:00' }),
        task('task_b', { dueDate: '2026-11-16', reminderMode: 'day-before' }),
        task('task_c', { reminderAt: '2026-11-14T09:30' }),
        task('task_d', { reminderAt: '2026-11-13T10:00' }),
        task('task_e', { reminderAt: '2026-11-15T10:00', status: 'done' }),
        task('task_f', { dueDate: '2026-11-14', reminderMode: 'due-morning' }),
        task('task_g', { dueDate: '2026-11-18' }),
        { title: 'kimliksiz', reminderAt: '2026-11-15T10:00' },
        null
    ];
    const upcoming = listPisiUpcomingReminders(tasks, { now, defaultTime: '18:00' });
    assert.deepEqual(
        upcoming.map((entry) => [entry.taskId, new Date(entry.time).getDate(), new Date(entry.time).getHours()]),
        [
            ['task_f', 14, 18],
            ['task_b', 15, 18],
            ['task_a', 20, 8]
        ]
    );
    assert.deepEqual(upcoming[0], {
        key: getPisiReminderKey('task_f', local(2026, 11, 14, 18)),
        taskId: 'task_f',
        time: local(2026, 11, 14, 18),
        title: 'Görev task_f'
    });
    assert.deepEqual(
        listPisiUpcomingReminders(tasks, { now, defaultTime: '18:00', limit: 2 }).map((entry) => entry.taskId),
        ['task_f', 'task_b']
    );
    // The default time moves relative reminders; at 09:00 the due-morning reminder of today has passed.
    assert.deepEqual(
        listPisiUpcomingReminders(tasks, { now }).map((entry) => entry.taskId),
        ['task_b', 'task_a']
    );
    assert.deepEqual(listPisiUpcomingReminders(undefined, { now }), []);
});
