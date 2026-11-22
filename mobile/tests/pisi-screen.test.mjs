import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { NOW, TODAY, createMemoryProject, noteFile, paragraph, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

// Version 2 records (docs/task-plan.md §3.1): each lives in a day's diary or a note.
const EV_ID = 'node_00000000-0000-4000-8000-0000000000e1';
const record = (id, title, fields = {}) => ({
    id: `task_00000000-0000-4000-9000-${String(id).padStart(12, '0')}`,
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
    manualOrder: id,
    noteId: null,
    diaryDate: TODAY,
    durationMinutes: 0,
    actualMinutes: 0,
    completions: [],
    createdAt: `2026-11-01T08:00:0${id}.000Z`,
    updatedAt: '2026-11-01T08:00:00.000Z',
    completedAt: null,
    completedOn: null,
    ...fields
});
const TASKS = [
    record(1, 'Sabah yürüyüşü', { dueDate: TODAY, dueTime: '07:30', repeat: 'daily' }),
    record(2, 'TÜBİTAK raporunun yöntem bölümünü gözden geçir', { dueDate: TODAY, dueTime: '10:00', priority: 5, deneme: 'korunur' }),
    record(3, 'Kira ödemesi', { dueDate: '2026-11-12', priority: 4, noteId: EV_ID, diaryDate: null }),
    record(4, 'Dün biten', { dueDate: TODAY, status: 'done', completedAt: new Date(2026, 10, 14, 8).toISOString(), completedOn: TODAY }),
    record(5, 'Yarınki iş', { dueDate: '2026-11-15', diaryDate: '2026-11-15' })
];
const tasksFile = (tasks = TASKS) => storeJson({ version: 2, updatedAt: null, tasks });
const NOTES = { 'Ev.node': noteFile({ id: EV_ID, title: 'Ev' }) };

async function start({ files = {}, deviceLanguage = 'tr-TR' } = {}) {
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
    return { ...memory, platform, errors };
}

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const tap = (selector) => $(selector).click();
const titles = (group) => all(`[data-group="${group}"] .pisi-task-title`).map((title) => title.textContent);
const snackbar = () => $('.pisi-snackbar-message')?.textContent ?? null;
const storedTasks = (driver) => JSON.parse(driver.snapshot()['.pisi/tasks.json']).tasks;
const selectedDate = () => app.router.getState().selectedDate;
const settle = () => vi.advanceTimersByTimeAsync(0);

function type(selector, text) {
    const field = $(selector);
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

function swipe(dx, dy = 0, target = $('[data-home="scroll"]')) {
    const touch = (x, y) => ({ clientX: x, clientY: y });
    const start = new Event('touchstart', { bubbles: true });
    Object.assign(start, { touches: [touch(200, 300)], changedTouches: [touch(200, 300)] });
    target.dispatchEvent(start);
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

describe('Pisi sekmesi: başlık ve gün değiştirme', () => {
    it('seçili günü yazar; bugün değilse "Bugün" etiketi gider, "Bugüne dön" gelir (G3)', async () => {
        await start();
        expect($('h1 time').textContent).toBe('Cumartesi, 14 Kasım');
        expect([$('.pisi-day-today').hidden, $('[data-action="go-today"]').hidden]).toEqual([false, true]);

        tap('[data-wheel="track"] [data-date="2026-11-12"]');
        expect(selectedDate()).toBe('2026-11-12');
        expect($('h1 time').textContent).toBe('Perşembe, 12 Kasım');
        expect($('h1 time').getAttribute('datetime')).toBe('2026-11-12');
        expect([$('.pisi-day-today').hidden, $('[data-action="go-today"]').hidden]).toEqual([true, false]);

        tap('[data-action="go-today"]');
        expect(selectedDate()).toBe(TODAY);
        expect($('.pisi-day-today').hidden).toBe(false);
    });

    it('çark: bugün ve seçili gün ayrı işaretlenir, görevli ve günlüklü günlerde nokta vardır (G15)', async () => {
        const { platform } = await start({
            files: { '.pisi/tasks.json': tasksFile(), 'diary/2026-11-10.node': noteFile({ id: 'node_d', title: '10-11-2026' }) }
        });
        const day = (date) => $(`[data-wheel="track"] [data-date="${date}"]`);
        expect(all('[data-wheel="track"] [aria-pressed="true"]').map((item) => item.dataset.date)).toEqual([TODAY]);
        expect(day(TODAY).getAttribute('aria-current')).toBe('date');
        expect(day(TODAY).getAttribute('aria-label')).toBe('Cumartesi, 14 Kasım, Bugün, görev var');
        expect(day('2026-11-10').getAttribute('aria-label')).toBe('Salı, 10 Kasım, günlük var');
        expect(day('2026-11-12').querySelector('.pisi-day-dot-tasks')).not.toBe(null);
        expect(day('2026-11-10').querySelector('.pisi-day-dot-diary')).not.toBe(null);
        expect(day('2026-11-11').querySelectorAll('.pisi-day-dot').length).toBe(0);
        expect($('.pisi-wheel-month').textContent).toBe('Kas');

        tap('[data-wheel="track"] [data-date="2026-11-15"]');
        expect(day('2026-11-15').getAttribute('aria-pressed')).toBe('true');
        expect(day(TODAY).getAttribute('aria-pressed')).toBe('false');
        expect(day(TODAY).getAttribute('aria-current')).toBe('date');

        // Scrolling the wheel: the day that comes to rest in the middle is selected, with a light vibration on the way.
        const track = $('[data-wheel="track"]');
        const target = day('2026-11-17');
        Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
        for (const [index, item] of [...track.children].entries()) {
            Object.defineProperty(item, 'offsetLeft', { value: index * 48, configurable: true });
            Object.defineProperty(item, 'offsetWidth', { value: 48, configurable: true });
        }
        track.scrollLeft = target.offsetLeft - 126;
        track.dispatchEvent(new Event('scroll'));
        expect(platform.calls.haptics).toBe(1);
        expect(selectedDate()).toBe('2026-11-15');
        await vi.advanceTimersByTimeAsync(100);
        expect(selectedDate()).toBe('2026-11-17');
    });

    it('çark uzak bir güne gidince o günün çevresinde yeniden kurulur', async () => {
        await start();
        app.router.setSelectedDate('2027-03-01');
        expect($('[data-wheel="track"] [aria-pressed="true"]').dataset.date).toBe('2027-03-01');
        expect($('.pisi-wheel-month').textContent).toBe('Mar');
        expect($('h1 time').textContent).toBe('Pazartesi, 1 Mart 2027');
    });

    it('içerikte yatay kaydırma günü değiştirir; dikey kaydırma ve yazılan alandaki hareket değiştirmez', async () => {
        const { platform } = await start();
        swipe(-120);
        expect(selectedDate()).toBe('2026-11-15');
        swipe(120);
        swipe(120);
        expect(selectedDate()).toBe('2026-11-13');
        expect(platform.calls.haptics).toBe(3);

        swipe(-40);
        swipe(-100, 90);
        expect(selectedDate()).toBe('2026-11-13');
        await settle();
        $('[data-diary="text"]').focus();
        swipe(-150, 0, $('[data-diary="text"]'));
        expect(selectedDate()).toBe('2026-11-13');
    });

    it('tarih seçici: ay değiştirilir, gün seçilince kapanır ve odak başlığa döner', async () => {
        const { platform } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap('[data-action="pick-date"]');
        const dialog = $('[role="dialog"]');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Tarih seç');
        expect($('.pisi-date-month-title').textContent).toBe('Kasım 2026');
        expect(all('.pisi-date-weekday').map((name) => name.textContent)).toEqual(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
        expect($('.pisi-date-cell[aria-pressed="true"]').dataset.date).toBe(TODAY);
        expect(document.activeElement.dataset.date).toBe(TODAY);
        expect($('.pisi-date-cell[data-date="2026-11-15"] .pisi-day-dot-tasks')).not.toBe(null);

        tap('[data-action="next-month"]');
        expect($('.pisi-date-month-title').textContent).toBe('Aralık 2026');
        tap('.pisi-date-cell[data-date="2026-12-03"]');
        expect($('[role="dialog"]')).toBe(null);
        expect(selectedDate()).toBe('2026-12-03');
        expect($('h1 time').textContent).toBe('Perşembe, 3 Aralık');
        expect(document.activeElement.dataset.action).toBe('pick-date');

        // Back closes the sheet without changing the day; "today" in the sheet returns to today.
        tap('[data-action="pick-date"]');
        expect($('.pisi-date-month-title').textContent).toBe('Aralık 2026');
        platform.pressBack();
        expect([$('[role="dialog"]'), selectedDate()]).toEqual([null, '2026-12-03']);
        tap('[data-action="pick-date"]');
        tap('[data-action="pick-today"]');
        expect(selectedDate()).toBe(TODAY);
    });
});

describe('Pisi sekmesi: görevler', () => {
    it('grupları, tam genişlikte satırı ve meta satırını gösterir (G4, G5)', async () => {
        await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        expect(all('.pisi-home-heading').map((heading) => heading.textContent)).toEqual(['Günlük', 'Görevler']);
        expect(all('.pisi-task-group-title').map((title) => title.textContent)).toEqual(['Gecikmiş1', 'Bu gün2']);
        expect(titles('overdue')).toEqual(['Kira ödemesi']);
        expect(titles('day')).toEqual(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir']);

        const meta = (id) => all(`[data-task="${TASKS[id].id}"] .pisi-task-meta-item`).map((item) => item.textContent);
        expect(meta(0)).toEqual(['07:30', 'Orta', 'Her gün']);
        expect(meta(1)).toEqual(['10:00', 'Çok yüksek']);
        expect(meta(2)).toEqual(['12 Kas', 'Yüksek', 'Ev']);
        expect($(`[data-task="${TASKS[1].id}"] [data-priority]`).dataset.priority).toBe('5');
        expect($(`[data-task-toggle="${TASKS[0].id}"]`).getAttribute('aria-label')).toBe('Tamamla: Sabah yürüyüşü');

        // Completed tasks are collapsed until asked for.
        const toggle = $('[data-action="toggle-completed"]');
        expect([toggle.textContent, toggle.getAttribute('aria-expanded'), titles('done')]).toEqual(['Tamamlanan (1)', 'false', []]);
        toggle.click();
        expect([$('[data-action="toggle-completed"]').getAttribute('aria-expanded'), titles('done')]).toEqual(['true', ['Dün biten']]);
    });

    it('başka bir günde "Gecikmiş" görünmez; görevsiz günde boş durum ve ekleme satırı vardır', async () => {
        await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap('[data-wheel="track"] [data-date="2026-11-15"]');
        expect([$('[data-group="overdue"]'), titles('day')]).toEqual([null, ['Yarınki iş']]);
        tap('[data-wheel="track"] [data-date="2026-11-16"]');
        expect($('[data-tasks="empty"]').textContent).toBe('Bu gün için görev yok.');
        expect($('[data-action="add-task-input"]').placeholder).toBe('Görev ekle');
    });

    it('onay kutusu görevi tamamlar, titreşir ve 5 saniyelik "Geri al" sunar', async () => {
        const { driver, platform } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap(`[data-task-toggle="${TASKS[1].id}"]`);
        // The row moves before the file is written.
        expect(titles('day')).toEqual(['Sabah yürüyüşü']);
        expect(platform.calls.haptics).toBe(1);
        await settle();

        const stored = storedTasks(driver);
        expect(stored[1]).toMatchObject({ status: 'done', deneme: 'korunur' });
        expect(stored[1].completedAt).toBe(NOW.toISOString());
        expect(stored.filter((task, index) => index !== 1)).toEqual(TASKS.filter((task, index) => index !== 1));
        expect(snackbar()).toBe('Görev tamamlandı.');
        expect($('[data-action="toggle-completed"]').textContent).toBe('Tamamlanan (2)');

        tap('.pisi-snackbar [data-action="undo"]');
        await settle();
        expect(storedTasks(driver)[1]).toMatchObject({ status: 'todo', completedAt: null, completedOn: null });
        expect(titles('day')).toEqual(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir']);
        expect(snackbar()).toBe(null);
    });

    it('"Geri al" 5 saniye sonra kaybolur; tamamlanan görev yeniden açılabilir', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap(`[data-task-toggle="${TASKS[2].id}"]`);
        await settle();
        expect(snackbar()).toBe('Görev tamamlandı.');
        await vi.advanceTimersByTimeAsync(5000);
        expect(snackbar()).toBe(null);
        expect($('[data-group="overdue"]')).toBe(null);

        tap('[data-action="toggle-completed"]');
        expect(titles('done')).toEqual(['Kira ödemesi', 'Dün biten']);
        expect($(`[data-task-toggle="${TASKS[2].id}"]`).getAttribute('aria-label')).toBe('Yeniden aç: Kira ödemesi');
        tap(`[data-task-toggle="${TASKS[2].id}"]`);
        await settle();
        expect(storedTasks(driver)[2].status).toBe('todo');
        expect(titles('overdue')).toEqual(['Kira ödemesi']);
    });

    it('tekrar eden görev: tamamlanınca yeni kayıt açılmaz, ertesi güne ilerler ve bugün ☑ kalır; "Geri al" geri getirir (§3.2.3)', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap(`[data-task-toggle="${TASKS[0].id}"]`);
        await settle();
        const after = storedTasks(driver);
        expect(after).toHaveLength(5);
        expect(after[0]).toMatchObject({ status: 'todo', dueDate: '2026-11-15', completions: [{ date: TODAY, dueDate: TODAY, at: NOW.toISOString() }] });
        expect(titles('day')).toEqual(['TÜBİTAK raporunun yöntem bölümünü gözden geçir']);
        tap('[data-action="toggle-completed"]');
        expect(titles('done')).toEqual(['Sabah yürüyüşü', 'Dün biten']);
        // The next day's diary gets the row (it is created for it).
        expect(driver.snapshot()['diary/2026-11-15.node']).toContain(TASKS[0].id);

        tap('.pisi-snackbar [data-action="undo"]');
        await settle();
        const undone = storedTasks(driver);
        expect(undone.map((task) => task.id)).toEqual(TASKS.map((task) => task.id));
        expect(undone[0]).toMatchObject({ status: 'todo', dueDate: TODAY, completions: [] });
        expect(titles('day')).toEqual(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir']);
    });

    it('geçmiş günde tekrarın eski tamamlaması kilitlidir; en son tamamlama o günden geri alınır (§3.2.3, S18)', async () => {
        const daily = record(9, 'Spor', {
            repeat: 'daily',
            dueDate: '2026-11-15',
            diaryDate: '2026-11-12',
            completions: [
                { date: '2026-11-13', dueDate: '2026-11-13', at: new Date(2026, 10, 13, 7).toISOString() },
                { date: TODAY, dueDate: TODAY, at: new Date(2026, 10, 14, 7).toISOString() }
            ]
        });
        const { driver } = await start({ files: { '.pisi/tasks.json': tasksFile([daily]) } });
        tap('[data-wheel="track"] [data-date="2026-11-13"]');
        tap('[data-action="toggle-completed"]');
        const locked = $(`[data-task-toggle="${daily.id}"]`);
        expect([locked.disabled, locked.getAttribute('aria-checked'), locked.getAttribute('aria-label')]).toEqual([
            true,
            'true',
            'Kilitli: Spor daha sonra yeniden tamamlandı'
        ]);

        tap('[data-wheel="track"] [data-date="2026-11-14"]');
        tap('[data-action="toggle-completed"]');
        expect($(`[data-task-toggle="${daily.id}"]`).disabled).toBe(false);
        tap(`[data-task-toggle="${daily.id}"]`);
        await settle();
        expect(storedTasks(driver)[0]).toMatchObject({ dueDate: TODAY, completions: [{ date: '2026-11-13' }] });
        expect(titles('day')).toEqual(['Spor']);
    });

    it('görev ekleme: ayrıştırılan tarih çipte görünür; tarih yoksa seçili güne yazılır', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': tasksFile([]) } });
        const chips = () => all('.pisi-parse-chip').map((chip) => chip.textContent);
        expect([$('.pisi-task-add-chips').hidden, $('[data-action="add-task"]').disabled]).toEqual([true, true]);

        tap('[data-wheel="track"] [data-date="2026-11-16"]');
        type('[data-action="add-task-input"]', 'Süt al');
        expect([chips(), $('[data-action="add-task"]').disabled]).toEqual([['16 Kas'], false]);
        type('[data-action="add-task-input"]', '10:30 doktor her gün');
        expect(chips()).toEqual(['16 Kas', '10:30', 'Her gün']);
        type('[data-action="add-task-input"]', 'yarın 14:00 rapor yaz');
        expect(chips()).toEqual(['15 Kas', '14:00']);

        type('[data-action="add-task-input"]', 'Süt al');
        $('.pisi-task-add').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await settle();
        expect($('[data-action="add-task-input"]').value).toBe('');
        expect(titles('day')).toEqual(['Süt al']);
        expect(storedTasks(driver)[0]).toMatchObject({ title: 'Süt al', status: 'todo', dueDate: '2026-11-16', dueTime: null, diaryDate: '2026-11-16' });
        expect(snackbar()).toBe(null);
        // The day's diary is created with the task in its section (docs/task-plan.md §3.2.2).
        expect(driver.snapshot()['diary/2026-11-16.node']).toContain(storedTasks(driver)[0].id);

        // A task due another day still lives in the selected day's diary; it shows there with its own day.
        type('[data-action="add-task-input"]', 'yarın 14:00 rapor yaz');
        $('.pisi-task-add').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await settle();
        expect(titles('day')).toEqual(['Süt al', 'yarın 14:00 rapor yaz']);
        expect(all(`[data-task="${storedTasks(driver)[1].id}"] .pisi-task-meta-item`).map((item) => item.textContent)).toEqual(['15 Kas', '14:00', 'Orta']);
        expect(snackbar()).toBe('Görev eklendi; günü 15 Kas.');
        expect(storedTasks(driver)[1]).toMatchObject({ title: 'yarın 14:00 rapor yaz', dueDate: '2026-11-15', dueTime: '14:00', diaryDate: '2026-11-16' });
    });

    it('satıra dokununca görev detayı açılır; geri tuşu kapatır ve odak satıra döner', async () => {
        const { platform } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap(`[data-task-open="${TASKS[0].id}"]`);
        expect($('[role="dialog"] .pisi-task-detail-title').value).toBe('Sabah yürüyüşü');
        const field = (id) => $(`[data-task-field="${id}"] .pisi-row-value`)?.textContent ?? null;
        expect(['status', 'priority', 'date', 'repeat'].map(field)).toEqual(['Yapılacak', 'Orta', 'Cumartesi, 14 Kasım', 'Her gün']);
        expect($('[data-task-input="time"]').value).toBe('07:30');
        expect(document.activeElement.dataset.taskField).toBe('status');

        platform.pressBack();
        expect($('[role="dialog"]')).toBe(null);
        expect(document.activeElement.dataset.taskOpen).toBe(TASKS[0].id);
    });

    it('detayda yapılan değişiklik Pisi sekmesindeki satıra yansır', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': tasksFile(), ...NOTES } });
        tap(`[data-task-open="${TASKS[1].id}"]`);
        tap('[data-task-field="priority"]');
        tap('.pisi-sheet-option[data-value="2"]');
        await settle();
        expect($('[data-task-field="priority"] .pisi-row-value').textContent).toBe('Düşük');
        expect(document.activeElement.dataset.taskField).toBe('priority');
        expect($(`[data-task="${TASKS[1].id}"] .pisi-task-meta-priority`).textContent).toBe('Düşük');
        expect(storedTasks(driver)[1]).toMatchObject({ priority: 2, deneme: 'korunur' });
    });

    it('bozuk tasks.json ezilmez: görevler kilitlenir ve kullanıcıya söylenir (V7)', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': '{bozuk' } });
        expect($('[data-tasks="read-only"]').textContent).toBe('Görev dosyası okunamadı; görevler değiştirilmeyecek.');
        expect($('[data-action="add-task-input"]').readOnly).toBe(true);
        type('[data-action="add-task-input"]', 'Yazılmaz');
        $('.pisi-task-add').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await settle();
        expect(driver.snapshot()['.pisi/tasks.json']).toBe('{bozuk');
    });
});

describe('Pisi sekmesi: günlük', () => {
    it('boşken ipucu gösterir; ilk karakterle dosya oluşur, boş günlük dosya oluşturmaz', async () => {
        const { driver } = await start();
        const text = $('[data-diary="text"]');
        expect([text.placeholder, Number(text.getAttribute('rows')), text.readOnly, text.value]).toEqual(['Bugün neler oldu?', 3, false, '']);

        type('[data-diary="text"]', '   ');
        await vi.advanceTimersByTimeAsync(700);
        expect(Object.keys(driver.snapshot())).toEqual(['.pisi/properties.json', 'diary/.pisi-diary']);

        type('[data-diary="text"]', 'S');
        expect(driver.snapshot()['diary/2026-11-14.node']).toBeUndefined();
        await vi.advanceTimersByTimeAsync(700);
        const saved = JSON.parse(driver.snapshot()['diary/2026-11-14.node']);
        expect(saved.pisi.title).toBe('14-11-2026');
        expect(saved.content).toContain('>S</div>');
        // The day now has a diary dot on the wheel.
        expect($(`[data-wheel="track"] [data-date="${TODAY}"] .pisi-day-dot-diary`)).not.toBe(null);
    });

    it('yazarken gecikmeli kaydeder; değişmeyen metin yeniden yazılmaz (V4)', async () => {
        const { driver } = await start();
        type('[data-diary="text"]', 'Sabah');
        await vi.advanceTimersByTimeAsync(300);
        type('[data-diary="text"]', 'Sabah yürüdüm.');
        await vi.advanceTimersByTimeAsync(300);
        expect(driver.snapshot()['diary/2026-11-14.node']).toBeUndefined();
        await vi.advanceTimersByTimeAsync(400);
        const first = driver.snapshot()['diary/2026-11-14.node'];
        expect(first).toContain('Sabah yürüdüm.');

        const writes = driver.count('writeText');
        type('[data-diary="text"]', 'Sabah yürüdüm.');
        await vi.advanceTimersByTimeAsync(700);
        expect(driver.count('writeText')).toBe(writes);
        expect(driver.snapshot()['diary/2026-11-14.node']).toBe(first);
    });

    it('duraklatmada, gün değişiminde ve menüden çıkarken bekleyen metin hemen yazılır', async () => {
        const { driver, platform } = await start();
        const diary = (date) => driver.snapshot()[`diary/${date}.node`] ?? '';

        type('[data-diary="text"]', 'Duraklamadan önce');
        platform.pause();
        await settle();
        expect(diary(TODAY)).toContain('Duraklamadan önce');

        type('[data-diary="text"]', 'Gün değişmeden önce');
        tap('[data-wheel="track"] [data-date="2026-11-13"]');
        await settle();
        expect(diary(TODAY)).toContain('Gün değişmeden önce');
        expect($('[data-diary="text"]').value).toBe('');

        type('[data-diary="text"]', 'Dünün notu');
        tap('[data-action="launcher"]');
        tap('[data-menu="notes"]');
        await settle();
        expect(diary('2026-11-13')).toContain('Dünün notu');

        // Coming back shows what was saved for each day.
        platform.pressBack();
        await settle();
        expect($('[data-diary="text"]').value).toBe('Dünün notu');
        tap('[data-wheel="track"] [data-date="2026-11-14"]');
        await settle();
        expect($('[data-diary="text"]').value).toBe('Gün değişmeden önce');
    });

    it('masaüstünün bloklarına dokunmaz ve kaç blok olduğunu söyler (V8)', async () => {
        const image = '<div class="pisi-editor-block" data-pisi-block-id="blk-img" data-pisi-block-type="image"><img src="a.png"></div>';
        const content = `${paragraph('blk-1', 'İlk satır')}${image}`;
        const { driver } = await start({ files: { 'diary/2026-11-14.node': noteFile({ id: 'node_d', title: '14-11-2026', content }) } });
        expect($('[data-diary="text"]').value).toBe('İlk satır');
        expect($('.pisi-diary-note').textContent).toBe('Bu günlükte masaüstünde düzenlenen 1 blok daha var.');

        type('[data-diary="text"]', 'İlk satır değişti');
        await vi.advanceTimersByTimeAsync(700);
        const saved = JSON.parse(driver.snapshot()['diary/2026-11-14.node']);
        expect(saved.content).toBe(`${paragraph('blk-1', 'İlk satır değişti')}${image}`);
    });

    it('bozuk günlük dosyası ezilmez: alan kilitlenir ve nedeni yazılır (V7)', async () => {
        const { driver } = await start({ files: { 'diary/2026-11-14.node': '{bozuk' } });
        expect($('[data-diary="text"]').readOnly).toBe(true);
        expect($('.pisi-diary-note').textContent).toBe('Bu günün günlük dosyası okunamadı; değiştirilmeyecek.');
        expect(driver.snapshot()['diary/2026-11-14.node']).toBe('{bozuk');
    });

    it('dil değişince yazılmakta olan metin kaybolmaz', async () => {
        await start();
        type('[data-diary="text"]', 'Yarım cümle');
        tap('[data-action="launcher"]');
        tap('[data-menu="settings"]');
        tap('[data-setting="language"]');
        tap('[role="radio"][data-value="eng"]');
        tap('[data-action="back"]');
        await settle();
        expect($('#pisi-diary-title').textContent).toBe('Diary');
        expect($('[data-diary="text"]').placeholder).toBe('What happened today?');
        expect($('[data-diary="text"]').value).toBe('Yarım cümle');
    });
});

describe('Pisi sekmesi: açılış', () => {
    it('görevler ve günlük, proje indeksi kurulmadan önce görünür (M5.6)', async () => {
        const platform = createFakePlatform();
        const files = {
            '.pisi/tasks.json': tasksFile(),
            'diary/2026-11-14.node': noteFile({ id: 'node_d', title: '14-11-2026', content: paragraph('b', 'Sabah') })
        };
        const { project } = createMemoryProject(files);
        let releaseIndex;
        const build = project.index.build.bind(project.index);
        project.index.build = () => new Promise((resolve) => (releaseIndex = () => resolve(build())));
        app = createApp({
            root,
            platform,
            storage: createFakeStorage(),
            systemTheme: createFakeSystemTheme(),
            deviceLanguage: 'tr-TR',
            project,
            now: () => new Date(NOW)
        });
        await vi.waitFor(() => expect(releaseIndex).toBeTypeOf('function'));
        expect(titles('day')).toHaveLength(2);
        expect($('[data-diary="text"]').value).toBe('Sabah');
        releaseIndex();
        await app.ready;
    });

    it('arka plandan dönünce gece yarısı geçtiyse "bugün" ilerler, seçili gün yerinde kalır', async () => {
        const platform = createFakePlatform();
        let clock = new Date(NOW);
        app = createApp({
            root,
            platform,
            storage: createFakeStorage(),
            systemTheme: createFakeSystemTheme(),
            deviceLanguage: 'tr-TR',
            now: () => new Date(clock)
        });
        clock = new Date(2026, 10, 15, 0, 5);
        platform.resume();
        expect(selectedDate()).toBe(TODAY);
        expect([$('.pisi-day-today').hidden, $('[data-action="go-today"]').hidden]).toEqual([true, false]);
        expect($(`[data-wheel="track"] [data-date="2026-11-15"]`).getAttribute('aria-current')).toBe('date');
        tap('[data-action="go-today"]');
        expect(selectedDate()).toBe('2026-11-15');
    });
});
