import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { createMemoryNotifier } from '../src/app/memory-notifier.mjs';
import { createPreferences } from '../src/app/preferences.mjs';
import { PISI_REMINDER_CHANNEL, createReminderScheduler, getReminderNotificationId, planReminderNotifications } from '../src/app/reminders.mjs';
import { createI18n } from '../src/i18n/index.mjs';
import { NOW, TODAY, createMemoryProject, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

const t = createI18n('tr').t;
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const task = (id, title, fields = {}) => ({ id, title, status: 'todo', dueDate: null, reminderMode: 'none', reminderAt: null, diaryDate: TODAY, ...fields });

/** The parts of the task controller the scheduler uses. */
function fakeTasks(list) {
    const listeners = new Set();
    return {
        get list() {
            return list;
        },
        getTasks: () => list,
        isLoaded: () => true,
        find: (id) => list.find((item) => item.id === id) ?? null,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        set(next) {
            list = next;
            for (const listener of listeners) listener();
        }
    };
}

function setup({ tasks: list, notifier = createMemoryNotifier(), storage = createFakeStorage(), clock = NOW } = {}) {
    const tasks = fakeTasks(list);
    const preferences = createPreferences(storage, ['tr', 'eng']);
    const errors = [];
    const time = { now: new Date(clock) };
    const scheduler = createReminderScheduler({
        notifier,
        tasks,
        preferences,
        getT: () => t,
        now: () => time.now,
        setTimer: (callback, delay) => setTimeout(callback, delay),
        clearTimer: (timer) => clearTimeout(timer),
        onError: (error) => errors.push(error)
    });
    return { scheduler, tasks, notifier, preferences, errors, time };
}

const scheduled = (notifier) => notifier.scheduled().map((item) => [item.extra.taskId, new Date(item.at).getDate(), new Date(item.at).getHours(), item.body]);

describe('hatırlatma bildirimleri: planlama', () => {
    let current = null;
    afterEach(() => current?.scheduler.destroy());

    it('gelecekteki hatırlatmalar bildirim olur; izin ilk seferde bir kez sorulur; kanal Türkçe adlıdır', async () => {
        current = setup({
            tasks: [
                task('task_a', 'Rapor yaz', { reminderAt: '2026-11-14T15:00' }),
                task('task_b', 'Kira', { dueDate: '2026-11-16', reminderMode: 'day-before' }),
                task('task_c', 'Geçmiş', { reminderAt: '2026-11-14T08:00' }),
                task('task_d', 'Biten', { reminderAt: '2026-11-15T10:00', status: 'done' }),
                task('task_e', '  ', { reminderAt: '2026-11-20T07:30' })
            ]
        });
        const { scheduler, tasks, notifier, preferences } = current;
        tasks.set(tasks.list);
        await scheduler.settled();

        expect(notifier.requests()).toBe(1);
        expect(preferences.wasReminderPermissionAsked()).toBe(true);
        expect(scheduled(notifier)).toEqual([
            ['task_a', 14, 15, 'Rapor yaz'],
            ['task_b', 15, 9, 'Kira'],
            ['task_e', 20, 7, 'Adsız görev']
        ]);
        const [first] = notifier.scheduled();
        expect(first).toMatchObject({
            id: getReminderNotificationId('task_a'),
            title: 'Pisi görev hatırlatması',
            channelId: PISI_REMINDER_CHANNEL,
            exact: true,
            extra: { pisi: 'reminder', taskId: 'task_a' }
        });
        expect(notifier.channel(PISI_REMINDER_CHANNEL)).toMatchObject({ name: 'Görev hatırlatmaları' });
        expect(scheduler.getStatus()).toMatchObject({ permission: 'granted', exact: 'granted', count: 3, next: at(14, 15) });

        // Planning again with nothing changed asks nothing and schedules nothing new.
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(notifier.requests()).toBe(1);
    });

    it('görev değişince aynı kimlikle yeniden kurulur; biten ya da hatırlatması kalkan görevinki iptal olur; gösterilmiş olan kalır', async () => {
        current = setup({
            tasks: [task('task_a', 'Rapor', { reminderAt: '2026-11-14T15:00' }), task('task_b', 'Kira', { reminderAt: '2026-11-15T10:00' })]
        });
        const { scheduler, tasks, notifier, time } = current;
        tasks.set(tasks.list);
        await scheduler.settled();
        const idA = getReminderNotificationId('task_a');

        tasks.set([
            task('task_a', 'Rapor (son)', { reminderAt: '2026-11-14T16:30' }),
            task('task_b', 'Kira', { reminderAt: '2026-11-15T10:00', status: 'done' })
        ]);
        await scheduler.settled();
        expect(scheduled(notifier)).toEqual([['task_a', 14, 16, 'Rapor (son)']]);
        expect(notifier.scheduled()[0].id).toBe(idA);

        // The reminder has come and is in the shade; planning after it leaves it there.
        time.now = new Date(at(14, 17));
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(notifier.scheduled().map((item) => item.id)).toEqual([idA]);
    });

    it('bitiş gününe göre hatırlatma ayarlardaki saatte gelir; saat değişince bildirim kayar', async () => {
        current = setup({ tasks: [task('task_b', 'Kira', { dueDate: '2026-11-16', reminderMode: 'due-morning' })] });
        const { scheduler, tasks, notifier } = current;
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(scheduled(notifier)).toEqual([['task_b', 16, 9, 'Kira']]);
        await scheduler.setDefaultTime('18:00');
        expect(scheduled(notifier)).toEqual([['task_b', 16, 18, 'Kira']]);
        expect(scheduler.getStatus().defaultTime).toBe('18:00');
    });

    it('kapatılınca gelecek bildirimler iptal olur; açılınca geri gelir', async () => {
        current = setup({ tasks: [task('task_a', 'Rapor', { reminderAt: '2026-11-14T15:00' })] });
        const { scheduler, tasks, notifier, preferences } = current;
        tasks.set(tasks.list);
        await scheduler.settled();
        await scheduler.setEnabled(false);
        expect(notifier.scheduled()).toEqual([]);
        expect(preferences.getRemindersEnabled()).toBe(false);
        expect(scheduler.getStatus()).toMatchObject({ enabled: false, count: 0 });
        await scheduler.setEnabled(true);
        expect(scheduled(notifier)).toEqual([['task_a', 14, 15, 'Rapor']]);
    });

    it('izin verilmezse bir şey kurulmaz ve kendiliğinden bir daha sorulmaz; Ayarlar’dan istenebilir', async () => {
        const notifier = createMemoryNotifier({ grantOnRequest: false });
        current = setup({ tasks: [task('task_a', 'Rapor', { reminderAt: '2026-11-14T15:00' })], notifier });
        const { scheduler, tasks } = current;
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(notifier.requests()).toBe(1);
        expect(notifier.scheduled()).toEqual([]);
        expect(scheduler.getStatus()).toMatchObject({ permission: 'denied', count: 0 });

        tasks.set(tasks.list);
        await scheduler.settled();
        expect(notifier.requests()).toBe(1);

        // The user allowed it in Android's settings and taps the row.
        notifier.setPermission('granted');
        await scheduler.requestPermission();
        expect(notifier.scheduled()).toHaveLength(1);
        expect(scheduler.getStatus().permission).toBe('granted');
    });

    it('tam zamanlı alarm izni yoksa bildirim yaklaşık kurulur (Android ayar ekranı açılmaz); izin gelince tam kurulur', async () => {
        const notifier = createMemoryNotifier({ permission: 'granted', exact: 'denied' });
        current = setup({ tasks: [task('task_a', 'Rapor', { reminderAt: '2026-11-14T15:00' })], notifier });
        const { scheduler, tasks } = current;
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(notifier.scheduled().map((item) => item.exact)).toEqual([false]);
        expect(scheduler.getStatus().exact).toBe('denied');
        await scheduler.openExactAlarmSettings();
        expect(notifier.scheduled().map((item) => item.exact)).toEqual([true]);
    });

    it('durum yalnız gerçekten değişince bildirilir: hatırlatmayı değiştirmeyen görev değişikliği Ayarlar’ı yeniden çizdirmez', async () => {
        current = setup({ tasks: [task('task_a', 'Rapor', { reminderAt: '2026-11-14T15:00' })] });
        const { scheduler, tasks } = current;
        const told = [];
        scheduler.subscribe((status) => told.push(status.count));
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(told.length).toBeGreaterThan(0);
        const before = told.length;

        // A sync turn brings tasks.json again, or a task without a reminder changes: nothing to tell.
        tasks.set([...tasks.list, task('task_b', 'Hatırlatmasız')]);
        await scheduler.settled();
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(told.length).toBe(before);

        tasks.set([...tasks.list, task('task_c', 'Yeni', { reminderAt: '2026-11-15T10:00' })]);
        await scheduler.settled();
        expect(told.at(-1)).toBe(2);
    });

    it('Android’in izni açılışta, planlamadan önce okunur; hatırlatmasız bir plan sonra durumu değiştirmez', async () => {
        current = setup({ tasks: [task('task_b', 'Hatırlatmasız')] });
        const { scheduler, tasks, notifier } = current;
        await scheduler.ready();
        expect(scheduler.getStatus()).toMatchObject({ permission: 'prompt', exact: null, count: 0 });
        const told = [];
        scheduler.subscribe((status) => told.push(status));
        tasks.set(tasks.list);
        await scheduler.settled();
        expect(told).toEqual([]);
        // Nothing to remind of: Android is not asked.
        expect(notifier.requests()).toBe(0);
    });

    it('bildirime dokununca görevin kimliği gelir; başka uygulamanın bildirimi sayılmaz', () => {
        current = setup({ tasks: [] });
        const opened = [];
        const stop = current.scheduler.onOpen((taskId) => opened.push(taskId));
        const [item] = planReminderNotifications([{ key: 'task_a@x', taskId: 'task_a', time: at(14, 15), title: 'Rapor' }], { t, exact: true });
        void current.notifier.schedule([item, { id: 7, at: at(14, 16), extra: { other: true } }]);
        current.notifier.tap(item.id);
        current.notifier.tap(7);
        stop();
        current.notifier.tap(item.id);
        expect(opened).toEqual(['task_a']);
    });

    it('bildirim kimlikleri planda benzersizdir ve görev kimliğinden gelir', () => {
        expect(getReminderNotificationId('task_a')).toBe(getReminderNotificationId('task_a'));
        expect(getReminderNotificationId('task_a')).not.toBe(getReminderNotificationId('task_b'));
        expect(getReminderNotificationId('task_a')).toBeGreaterThan(0);
        const twice = planReminderNotifications(
            [
                { key: 'a@1', taskId: 'task_a', time: 1, title: 'A' },
                { key: 'a@2', taskId: 'task_a', time: 2, title: 'A' }
            ],
            { t, exact: true }
        );
        expect(new Set(twice.map((item) => item.id)).size).toBe(2);
    });
});

describe('hatırlatma bildirimleri: uygulamada', () => {
    let app;
    let root;
    beforeEach(() => {
        root = document.createElement('div');
        document.body.append(root);
    });
    afterEach(() => {
        app?.destroy();
        root.remove();
    });

    const record = (id, title, fields = {}) => ({
        id,
        title,
        tags: [],
        status: 'todo',
        priority: 3,
        dueDate: null,
        dueTime: null,
        repeat: 'none',
        completionOffsetDays: null,
        reminderMode: 'none',
        reminderAt: null,
        dependencies: [],
        manualOrder: 1,
        noteId: null,
        diaryDate: TODAY,
        durationMinutes: 0,
        actualMinutes: 0,
        completions: [],
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
        completedAt: null,
        completedOn: null,
        ...fields
    });
    const TASK_ID = 'task_00000000-0000-4000-9000-000000000001';

    async function start() {
        const notifier = createMemoryNotifier();
        const memory = createMemoryProject({
            '.pisi/tasks.json': storeJson({ version: 2, updatedAt: null, tasks: [record(TASK_ID, 'Faturayı öde', { reminderAt: '2026-11-14T18:00' })] })
        });
        app = createApp({
            root,
            platform: createFakePlatform(),
            storage: createFakeStorage(),
            systemTheme: createFakeSystemTheme(),
            deviceLanguage: 'tr-TR',
            project: memory.project,
            notifier,
            now: () => new Date(NOW),
            onError: (error) => {
                throw error;
            }
        });
        await app.ready;
        await app.remindersSettled();
        return { notifier, ...memory };
    }
    const $ = (selector) => root.querySelector(selector);
    const value = (selector) => $(`${selector} .pisi-row-value`).textContent;

    it('proje açılınca hatırlatma kurulur; bildirime dokununca görev ayrıntısı açılır', async () => {
        const { notifier } = await start();
        expect(notifier.scheduled().map((item) => [item.body, item.at])).toEqual([['Faturayı öde', at(14, 18)]]);
        notifier.tap(notifier.scheduled()[0].id);
        await Promise.resolve();
        await app.ready;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(app.router.getState().overlays.at(-1)).toBe(`task:${TASK_ID}`);
        expect([...root.querySelectorAll('[data-sheet] input, [data-sheet] textarea')].map((field) => field.value)).toContain('Faturayı öde');
    });

    it('Ayarlar: hatırlatmalar bölümü durumu gösterir; kapatma ve saat seçimi sheet’ten yapılır', async () => {
        const { notifier } = await start();
        $('[data-action="launcher"]').click();
        $('[data-menu="settings"]').click();
        expect(value('[data-setting="reminders-enabled"]')).toBe('Açık');
        expect(value('[data-setting="reminders-time"]')).toBe('09:00');
        expect(value('[data-reminders="permission"]')).toBe('Verildi');
        expect(value('[data-reminders="scheduled"]')).toBe('1');
        expect($('[data-reminders="scheduled"] .pisi-row-meta').textContent).toMatch(/^Sıradaki: 14 Kas/);
        expect($('[data-reminders="exact"]')).toBeNull();

        $('[data-setting="reminders-enabled"]').click();
        [...root.querySelectorAll('[data-sheet="reminders-enabled"] .pisi-sheet-option')].find((option) => option.textContent.includes('Kapalı')).click();
        await app.remindersSettled();
        expect(notifier.scheduled()).toEqual([]);
        expect(value('[data-setting="reminders-enabled"]')).toBe('Kapalı');
        expect($('[data-reminders="permission"]')).toBeNull();

        $('[data-setting="reminders-time"]').click();
        [...root.querySelectorAll('[data-sheet="reminders-time"] .pisi-sheet-option')].find((option) => option.textContent.includes('18:00')).click();
        await app.remindersSettled();
        expect(value('[data-setting="reminders-time"]')).toBe('18:00');
    });
});
