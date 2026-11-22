import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { getCalendarMarks, monthOf } from '../src/screens/calendar/calendar-model.mjs';
import { describeDay, renderDayDots } from '../src/ui/month-grid.mjs';
import { NOW, TODAY, createMemoryProject, noteFile, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

const task = (id, fields = {}) => ({
    id: `task_00000000-0000-4000-9000-${String(id).padStart(12, '0')}`,
    title: `Görev ${id}`,
    status: 'todo',
    priority: 3,
    dueDate: null,
    scheduledAt: null,
    deadline: null,
    reminderAt: null,
    reminderMode: 'none',
    repeat: 'none',
    manualOrder: id,
    source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' },
    ...fields
});
const TASKS = [
    task(1, { dueDate: TODAY }),
    task(2, { dueDate: '2026-11-12', status: 'done', completedAt: new Date(2026, 10, 12, 18).toISOString() }),
    // A day with one open and one done task counts as open.
    task(3, { dueDate: '2026-11-20', status: 'done' }),
    task(4, { dueDate: '2026-11-20' }),
    task(5, { dueDate: '2026-11-03' }),
    task(6, { dueDate: '2026-12-02', status: 'waiting' }),
    task(7)
];
const FILES = {
    '.pisi/tasks.json': storeJson({ version: 1, updatedAt: null, tasks: TASKS }),
    'diary/2026-11-10.node': noteFile({ id: 'node_d1', title: '10-11-2026' }),
    'diary/2026-11-12.node': noteFile({ id: 'node_d2', title: '12-11-2026' })
};

describe('takvim noktaları (masaüstü takvim kuralı: günlük bölümünün gün kuralı)', () => {
    it('tarihli her görev gününü işaretler; açık görevi olan gün ile hepsi biten gün ayrılır', () => {
        const marks = getCalendarMarks(TASKS, ['2026-11-10', '2026-11-12']);
        expect([...marks.tasks].sort()).toEqual(['2026-11-03', '2026-11-14', '2026-11-20', '2026-12-02']);
        expect([...marks.tasksDone]).toEqual(['2026-11-12']);
        expect([...marks.diary]).toEqual(['2026-11-10', '2026-11-12']);
        // Bilinmeyen ya da büyük harfli durumlar masaüstündeki gibi okunur: yalnız "done" bitmiş sayılır.
        expect([...getCalendarMarks([task(8, { dueDate: TODAY, status: 'DONE' })], []).tasks]).toEqual([TODAY]);
        expect([...getCalendarMarks([task(9, { dueDate: TODAY, status: undefined })], []).tasks]).toEqual([TODAY]);
        // Eski alanlar (scheduledAt, deadline) okunmaz: görevin günü yalnız dueDate'tir (GK1).
        expect([...getCalendarMarks([task(10, { scheduledAt: '2026-11-20T10:00', deadline: '2026-11-21' })], []).tasks]).toEqual([]);
        expect(monthOf('2026-11-14')).toBe('2026-11');
    });

    it('gün, o günün günlük bölümündeki görevlerdir: günlükte yaşayan, o gün biten ve o gün tamamlanan görevler', () => {
        const repeating = task(11, {
            dueDate: '2026-11-22',
            repeat: 'daily',
            completions: [{ date: '2026-11-21', dueDate: '2026-11-21', at: '2026-11-21T06:00:00.000Z' }]
        });
        const lateDone = task(12, { dueDate: '2026-11-10', status: 'done', completedOn: '2026-11-16', completedAt: '2026-11-16T08:00:00.000Z' });
        const living = task(13, { diaryDate: '2026-11-05', dueDate: '2026-11-28' });
        const marks = getCalendarMarks([repeating, lateDone, living], []);
        // 21: tamamlanan tekrar (☑); 22: sonraki tekrar açık; 10 ve 16: geç tamamlanan görev ikisinde de bitmiş.
        expect([...marks.tasksDone].sort()).toEqual(['2026-11-10', '2026-11-16', '2026-11-21']);
        // 5: görevin günlüğü (başka güne tarihli, kendi durumuyla açık); 28: bitiş günü.
        expect([...marks.tasks].sort()).toEqual(['2026-11-05', '2026-11-22', '2026-11-28']);
    });

    it('noktalar ve günün adı: açık görev dolu nokta, biten görevler ayrı tonda nokta, günlük halka', () => {
        const marks = getCalendarMarks(TASKS, ['2026-11-12']);
        const classes = (day) => [...renderDayDots(day, marks).children].map((dot) => dot.className);
        expect(classes('2026-11-20')).toEqual(['pisi-day-dot pisi-day-dot-tasks']);
        expect(classes('2026-11-12')).toEqual(['pisi-day-dot pisi-day-dot-tasks pisi-day-dot-done', 'pisi-day-dot pisi-day-dot-diary']);
        expect(classes('2026-11-11')).toEqual([]);
        const labels = { today: 'Bugün', hasTasks: 'görev var', allTasksDone: 'görevlerin hepsi tamamlandı', hasDiary: 'günlük var' };
        expect(describeDay('2026-11-12', { locale: 'tr-TR', today: TODAY, marks, labels })).toBe('Perşembe, 12 Kasım, görevlerin hepsi tamamlandı, günlük var');
        // Tarih çarkının işaretlerinde "tasksDone" yoktur; orada bir şey değişmez.
        expect(describeDay('2026-11-12', { locale: 'tr-TR', today: TODAY, marks: { tasks: new Set(), diary: new Set() }, labels })).toBe('Perşembe, 12 Kasım');
    });
});

let app;
let root;

async function start({ files = FILES, deviceLanguage = 'tr-TR' } = {}) {
    const platform = createFakePlatform();
    const memory = createMemoryProject(files);
    const errors = [];
    app = createApp({
        root,
        platform,
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage,
        project: memory.project,
        now: () => new Date(NOW),
        onError: (error) => errors.push(error)
    });
    await app.ready;
    app.router.selectTab('calendar');
    await settle();
    return { ...memory, platform, errors };
}

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const tap = (selector) => $(selector).click();
const settle = () => vi.advanceTimersByTimeAsync(0);
const cell = (day) => $(`[data-calendar="grid"] [data-date="${day}"]`);
// What each dot of a day stands for: open tasks, tasks all done, diary.
const dotsOf = (day) =>
    [...cell(day).querySelectorAll('.pisi-day-dot')].map((dot) =>
        dot.classList.contains('pisi-day-dot-done') ? 'done' : dot.classList.contains('pisi-day-dot-diary') ? 'diary' : 'tasks'
    );
const markedDays = () =>
    all('[data-calendar="grid"] [data-date]')
        .filter((button) => button.querySelector('.pisi-day-dot'))
        .map((button) => `${button.dataset.date} ${dotsOf(button.dataset.date).join('+')}`);

function swipe(dx, dy = 0) {
    const target = $('[data-calendar="grid"]');
    const touch = (x, y) => ({ clientX: x, clientY: y });
    const begin = new Event('touchstart', { bubbles: true });
    Object.assign(begin, { touches: [touch(200, 300)], changedTouches: [touch(200, 300)] });
    target.dispatchEvent(begin);
    const end = new Event('touchend', { bubbles: true });
    Object.assign(end, { touches: [], changedTouches: [touch(200 + dx, 300 + dy)] });
    target.dispatchEvent(end);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = document.createElement('div');
    document.body.append(root);
});

afterEach(() => {
    app?.destroy();
    root.remove();
    vi.useRealTimers();
});

describe('Takvim sekmesi', () => {
    it('bugünün ayıyla açılır: hafta pazartesi başlar, gün adları Türkçedir, bugün işaretlidir', async () => {
        await start();
        expect($('[data-screen="calendar"]')).not.toBe(null);
        expect($('.pisi-header-title').textContent).toBe('Takvim');
        expect($('.pisi-calendar-month-title').textContent).toBe('Kasım 2026');
        expect(all('.pisi-date-weekday').map((name) => name.textContent)).toEqual(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
        // 1 Kasım 2026 pazar: önünde altı boş hücre vardır.
        expect(all('[data-calendar="grid"] .pisi-date-cell').findIndex((item) => item.dataset.date === '2026-11-01')).toBe(6);
        expect(all('[aria-current="date"]').map((item) => item.dataset.date)).toEqual([TODAY]);
        expect(cell(TODAY).getAttribute('aria-label')).toBe('Cumartesi, 14 Kasım, Bugün, görev var');
        expect($('[data-action="this-month"]').hidden).toBe(true);
        // Miladi/Hicri/Çin seçicisi yoktur (G12).
        expect($('[data-screen="calendar"] select, [data-screen="calendar"] .pisi-segmented')).toBe(null);
    });

    it('noktalar örnek veriyle birebir eşleşir; açıklama satırı anlamlarını yazar', async () => {
        await start();
        expect(markedDays()).toEqual(['2026-11-03 tasks', '2026-11-10 diary', '2026-11-12 done+diary', '2026-11-14 tasks', '2026-11-20 tasks']);
        expect(all('[data-calendar="legend"] [data-legend]').map((item) => `${item.dataset.legend}: ${item.textContent}`)).toEqual([
            'tasks: Açık görev',
            'done: Görevler tamamlandı',
            'diary: Günlük'
        ]);
        expect($('.pisi-calendar-hint').textContent).toBe('Bir güne dokun; o gün Pisi sekmesinde açılır.');
    });

    it('ay düğmelerle ve yatay kaydırmayla değişir; "Bu aya dön" bugünün ayına getirir', async () => {
        const { platform } = await start();
        tap('[data-action="next-month"]');
        expect($('.pisi-calendar-month-title').textContent).toBe('Aralık 2026');
        expect(markedDays()).toEqual(['2026-12-02 tasks']);
        expect($('[data-action="this-month"]').hidden).toBe(false);
        // 1 Aralık 2026 salı.
        expect(all('[data-calendar="grid"] .pisi-date-cell').findIndex((item) => item.dataset.date === '2026-12-01')).toBe(1);

        swipe(-120);
        expect($('.pisi-calendar-month-title').textContent).toBe('Ocak 2027');
        swipe(120);
        swipe(120);
        expect($('.pisi-calendar-month-title').textContent).toBe('Kasım 2026');
        expect(platform.calls.haptics).toBe(3);
        // Kısa ya da dikey hareket ayı değiştirmez.
        swipe(-40);
        swipe(-100, 90);
        expect($('.pisi-calendar-month-title').textContent).toBe('Kasım 2026');

        tap('[data-action="previous-month"]');
        expect($('.pisi-calendar-month-title').textContent).toBe('Ekim 2026');
        tap('[data-action="this-month"]');
        expect($('.pisi-calendar-month-title').textContent).toBe('Kasım 2026');
        expect($('[data-action="this-month"]').hidden).toBe(true);
    });

    it('bir güne dokununca Pisi sekmesi o günle açılır; geri dönünce takvim kaldığı ayda ve o gün seçili', async () => {
        const { platform } = await start();
        tap('[data-action="next-month"]');
        tap('[data-calendar="grid"] [data-date="2026-12-02"]');
        expect(app.router.getState()).toMatchObject({ tab: 'pisi', stack: [], overlays: [], selectedDate: '2026-12-02' });
        expect($('[data-screen="pisi"]')).not.toBe(null);
        expect($('h1 time').getAttribute('datetime')).toBe('2026-12-02');
        await settle();
        expect([...root.querySelectorAll('[data-group="day"] .pisi-task-title')].map((title) => title.textContent)).toEqual(['Görev 6']);

        // Pisi sekmesinde geri tuşu uygulamayı arka plana alır (sekme geçişi gibi).
        platform.pressBack();
        expect(platform.calls.minimize).toBe(1);

        app.router.selectTab('calendar');
        await settle();
        expect($('.pisi-calendar-month-title').textContent).toBe('Aralık 2026');
        expect(cell('2026-12-02').getAttribute('aria-pressed')).toBe('true');
    });

    it('Pisi sekmesinde yazılan günlük ve tamamlanan görev, takvime dönünce noktaya yansır', async () => {
        await start();
        tap('[data-calendar="grid"] [data-date="2026-11-20"]');
        await settle();
        const diary = $('[data-diary="text"]');
        diary.value = 'Yeni gün';
        diary.dispatchEvent(new Event('input', { bubbles: true }));
        for (const box of root.querySelectorAll('[data-group="day"] [role="checkbox"]')) box.click();
        await vi.advanceTimersByTimeAsync(6000);

        app.router.selectTab('calendar');
        await settle();
        await settle();
        expect(dotsOf('2026-11-20')).toEqual(['done', 'diary']);
        expect(cell('2026-11-20').getAttribute('aria-label')).toBe('Cuma, 20 Kasım, görevlerin hepsi tamamlandı, günlük var');
    });

    it('İngilizcede gün ve ay adları ve açıklama satırı çevrilir; boş projede nokta yoktur', async () => {
        await start({ files: {}, deviceLanguage: 'en-US' });
        expect($('.pisi-header-title').textContent).toBe('Calendar');
        expect($('.pisi-calendar-month-title').textContent).toBe('November 2026');
        expect(all('.pisi-date-weekday').map((name) => name.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(all('[data-calendar="legend"] [data-legend]').map((item) => item.textContent)).toEqual(['Open tasks', 'Tasks done', 'Diary']);
        expect(markedDays()).toEqual([]);
        expect($('[aria-label="Previous month"]')).not.toBe(null);
    });
});
