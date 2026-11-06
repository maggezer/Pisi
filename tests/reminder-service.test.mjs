import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createPisiReminderService, PISI_REMINDER_MISSED_GRACE_MS } from '../main/functions/reminder-service-core.js';
import { PISI_REMINDER_MAX_WAIT_MS } from '../main/functions/reminder-schedule-core.js';

const require = createRequire(import.meta.url);

// Electron stubs: a Notification class that records what is shown, a
// powerMonitor event emitter and a fake clock with one-shot timers.
function makeHarness({ tasks = [], platform = 'linux', start = new Date(2026, 10, 6, 12, 0).getTime(), stateFile = undefined } = {}) {
    const shown = [];
    class FakeNotification extends EventEmitter {
        static isSupported() {
            return true;
        }
        constructor(options) {
            super();
            this.options = options;
        }
        show() {
            shown.push(this);
        }
    }
    const clock = { now: start, timers: [] };
    const files = { state: stateFile, writes: 0 };
    const sent = [];
    const windowCalls = [];
    const powerMonitor = new EventEmitter();
    const deps = {
        Notification: FakeNotification,
        powerMonitor,
        platform,
        now: () => clock.now,
        setTimeout: (fn, ms) => {
            const timer = { fn, at: clock.now + ms, ms };
            clock.timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            clock.timers = clock.timers.filter((item) => item !== timer);
        },
        getProjectFolder: () => '/project',
        readTasks: () => tasks,
        readState: () => {
            if (files.state === undefined) return { ok: false, missing: true };
            if (files.state === 'corrupt') return { ok: false, error: 'Unexpected token' };
            return { ok: true, data: JSON.parse(files.state) };
        },
        writeState: (_project, state) => {
            files.writes += 1;
            files.state = JSON.stringify(state);
            return { ok: true };
        },
        getSettings: () => ({ defaultTime: '09:00' }),
        showWindow: () => windowCalls.push('show'),
        sendToRenderer: (payload) => sent.push(payload),
        translate: (text) => text,
        log: () => {}
    };
    const service = createPisiReminderService(deps);
    const advance = (ms) => {
        clock.now += ms;
        for (const timer of [...clock.timers].sort((a, b) => a.at - b.at)) {
            if (timer.at <= clock.now && clock.timers.includes(timer)) {
                clock.timers = clock.timers.filter((item) => item !== timer);
                timer.fn();
            }
        }
    };
    return { service, shown, clock, files, sent, windowCalls, powerMonitor, advance, tasks };
}

const at = (h, m, d = 6) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const task = (id, reminderAt, extra = {}) => ({
    id,
    title: `Görev ${id}`,
    status: 'todo',
    reminderAt,
    source: { nodePath: `/project/${id}.node`, blockId: `blk_${id}` },
    ...extra
});

test('a native notification is shown exactly at the reminder time and only once', () => {
    const h = makeHarness({ tasks: [task('task_one01', at(12, 30))] });
    h.service.start();
    assert.equal(h.clock.timers.length, 1, 'one timer only');
    assert.equal(h.clock.timers[0].ms, PISI_REMINDER_MAX_WAIT_MS, 'long waits are capped');
    h.advance(29 * 60 * 1000);
    assert.equal(h.shown.length, 0);
    h.advance(60 * 1000);
    assert.equal(h.shown.length, 1);
    assert.equal(h.shown[0].options.title, 'Pisi görev hatırlatması');
    assert.equal(h.shown[0].options.body, 'Görev task_one01');
    assert.deepEqual(h.shown[0].options.actions, [], 'no notification actions outside macOS');
    assert.equal(h.sent.at(-1).type, 'pending');
    assert.equal(h.sent.at(-1).entries[0].taskId, 'task_one01');
    h.service.reschedule();
    h.advance(60 * 60 * 1000);
    assert.equal(h.shown.length, 1, 'state file prevents a repeat');
    assert.equal(JSON.parse(h.files.state).pending[`task_one01@${new Date(2026, 10, 6, 12, 30).toISOString()}`].taskId, 'task_one01');
});

test('clicking the notification brings the window forward and opens the task source', () => {
    const h = makeHarness({ tasks: [task('task_two02', at(11, 59))] });
    h.service.start();
    assert.equal(h.shown.length, 1);
    h.shown[0].emit('click');
    assert.deepEqual(h.windowCalls, ['show']);
    assert.deepEqual(
        { ...h.sent.at(-1), key: undefined },
        { type: 'open', key: undefined, taskId: 'task_two02', nodePath: '/project/task_two02.node', blockId: 'blk_task_two02' }
    );
});

test('task changes re-plan the single timer', () => {
    const h = makeHarness({ tasks: [task('task_thr03', at(15, 0))] });
    h.service.start();
    assert.equal(h.service.getNextAt(), new Date(2026, 10, 6, 15, 0).getTime());
    h.tasks.push(task('task_fou04', at(12, 5)));
    h.service.reschedule('tasks');
    assert.equal(h.clock.timers.length, 1);
    assert.equal(h.clock.timers[0].ms, 5 * 60 * 1000);
    h.tasks[1].status = 'done';
    h.service.reschedule('tasks');
    h.advance(5 * 60 * 1000);
    assert.equal(h.shown.length, 0, 'a completed task does not fire');
});

test('resume and unlock re-plan, so reminders due during sleep fire on wake', () => {
    const h = makeHarness({ tasks: [task('task_fiv05', at(12, 20))] });
    h.service.start();
    // The machine sleeps: the clock jumps without the timer firing.
    h.clock.now += 40 * 60 * 1000;
    h.powerMonitor.emit('resume');
    assert.equal(h.shown.length, 1);
    h.service.stop();
    assert.equal(h.powerMonitor.listenerCount('resume'), 0);
    assert.equal(h.service.hasTimer(), false);
});

test('reminders missed while Pisi was closed produce one summary notification and a pending list', () => {
    const tasks = [task('task_old01', '2026-10-01T09:00'), task('task_old02', at(8, 0)), task('task_old03', at(11, 0))];
    const h = makeHarness({ tasks });
    h.service.start();
    assert.equal(h.shown.length, 1);
    assert.equal(h.shown[0].options.body, '{count} hatırlatma kaçırıldı'.replace('{count}', '3'));
    h.shown[0].emit('click');
    assert.equal(h.sent.at(-1).type, 'show-pending');
    const pending = h.service.listPending().entries;
    assert.deepEqual(
        pending.map((entry) => [entry.taskId, entry.missed]),
        [
            ['task_old01', true],
            ['task_old02', true],
            ['task_old03', true]
        ]
    );
    // A reminder within the grace window after opening is shown on its own.
    const fresh = makeHarness({ tasks: [task('task_new01', at(12, 0))], start: new Date(2026, 10, 6, 12, 0).getTime() + PISI_REMINDER_MISSED_GRACE_MS / 2 });
    fresh.service.start();
    assert.equal(fresh.shown[0].options.body, 'Görev task_new01');
});

test('snooze from a macOS notification action fires again ten minutes later; complete goes to the renderer', () => {
    const h = makeHarness({
        platform: 'darwin',
        start: new Date(2026, 10, 6, 11, 50).getTime(),
        tasks: [task('task_six06', at(12, 0)), task('task_sev07', at(11, 58))]
    });
    h.service.start();
    h.advance(10 * 60 * 1000);
    assert.equal(h.shown.length, 2);
    assert.deepEqual(
        h.shown[0].options.actions.map((action) => action.text),
        ['10 dk ertele', 'Tamamlandı']
    );
    const six = h.shown.find((item) => item.options.body === 'Görev task_six06');
    six.emit('action', {}, 0);
    assert.equal(
        h.service.listPending().entries.some((entry) => entry.taskId === 'task_six06'),
        false
    );
    h.advance(9 * 60 * 1000);
    assert.equal(h.shown.length, 2);
    h.advance(60 * 1000);
    assert.equal(h.shown.length, 3);
    assert.equal(h.shown[2].options.body, 'Görev task_six06');

    const seven = h.shown.find((item) => item.options.body === 'Görev task_sev07');
    seven.emit('action', {}, 1);
    assert.ok(h.sent.some((payload) => payload.type === 'complete' && payload.taskId === 'task_sev07'));
    assert.equal(
        h.service.listPending().entries.some((entry) => entry.taskId === 'task_sev07'),
        false
    );
});

test('a corrupt state file is never overwritten; reminders still show from memory', () => {
    const h = makeHarness({ tasks: [task('task_cor01', at(11, 0))], stateFile: 'corrupt' });
    h.service.start();
    assert.equal(h.shown.length, 1);
    assert.equal(h.files.state, 'corrupt');
    assert.equal(h.files.writes, 0);
    h.service.reschedule();
    assert.equal(h.shown.length, 1, 'memory state prevents a repeat in this session');
});

test('the app identity used for Windows notifications is stable and packaged-aware', async () => {
    const { getWindowsAppIdentity } = await import('../main/functions/windows-app-identity.js');
    const packaged = getWindowsAppIdentity({ isPackaged: true, getAppPath: () => 'C:\\Program Files\\Pisi\\resources\\app.asar' }, 'C:\\Pisi.exe');
    assert.equal(packaged.appId, 'com.mumin.pisi');
    assert.equal(packaged.appId, require('../package.json').build.appId);
    const dev = getWindowsAppIdentity({ isPackaged: false, getAppPath: () => '/repo' }, '/electron');
    assert.match(dev.appId, /^com\.mumin\.pisi\.dev\.[a-f0-9]{12}$/);
});
