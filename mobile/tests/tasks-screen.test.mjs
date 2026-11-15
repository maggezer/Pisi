import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { NOW, TODAY, createMemoryProject, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

const record = (id, title, fields = {}) => ({
    id: `task_00000000-0000-4000-9000-${String(id).padStart(12, '0')}`,
    title,
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
    record(1, 'Sabah yürüyüşü', { dueDate: TODAY, scheduledAt: `${TODAY}T07:30`, repeat: 'daily', todoTag: 'todo.3.14-11-2026' }),
    record(2, 'Rapor', { dueDate: TODAY, priority: 5, todoTag: 'todo.5.14-11-2026', deneme: 'korunur' }),
    record(3, 'Kira ödemesi', {
        dueDate: '2026-11-12',
        priority: 4,
        todoTag: 'todo.4.12-11-2026',
        source: { nodePath: 'Ev.node', nodeTitle: 'Ev', blockId: null, mapPath: null, mapTitle: '' }
    }),
    record(4, 'Biten iş', { dueDate: TODAY, status: 'done', completedAt: new Date(2026, 10, 14, 8).toISOString(), todoTag: 'todo.3.14-11-2026' }),
    record(5, 'Yarınki iş', { dueDate: '2026-11-15', todoTag: 'todo.3.15-11-2026' }),
    record(6, 'Uzak iş', { dueDate: '2026-11-30', todoTag: 'todo.3.30-11-2026' }),
    record(7, 'Tarihsiz iş', { todoTag: 'todo.3.none' }),
    record(8, 'Nottan gelen', {
        dueDate: TODAY,
        priority: 2,
        todoTag: 'todo.2.14-11-2026',
        source: { nodePath: 'Inbox.node', nodeTitle: 'Inbox', blockId: 'blk_1', mapPath: null, mapTitle: '' }
    })
];
const tasksFile = (tasks = TASKS) => storeJson({ version: 1, updatedAt: null, tasks });

async function start({ files = { '.pisi/tasks.json': tasksFile() }, deviceLanguage = 'tr-TR' } = {}) {
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
    app.router.selectTab('tasks');
    return { ...memory, platform, errors };
}

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const tap = (selector) => $(selector).click();
const titles = (scope = '[data-screen="tasks"]') => all(`${scope} .pisi-task-title`).map((title) => title.textContent);
const chipTexts = () =>
    all('.pisi-chip').map((chip) => `${chip.querySelector('.pisi-chip-label').textContent} ${chip.querySelector('.pisi-chip-count').textContent}`);
const parseChips = () => all('.pisi-task-add-chips > *').map((chip) => chip.textContent);
const snackbar = () => $('.pisi-snackbar-message')?.textContent ?? null;
const storedTasks = (driver) => JSON.parse(driver.snapshot()['.pisi/tasks.json']).tasks;
const stored = (driver, index) => storedTasks(driver).find((task) => task.id === TASKS[index].id);
const writes = (driver) => driver.calls.filter(([name, key]) => name === 'rename' && String(key).includes('tasks.json')).length;
const settle = () => vi.advanceTimersByTimeAsync(0);
const rowValue = (field) => $(`[role="dialog"] [data-task-field="${field}"] .pisi-row-value`)?.textContent ?? null;
const openTask = (index) => tap(`[data-task-open="${TASKS[index].id}"]`);
const choose = (value) => tap(`.pisi-sheet-option[data-value="${value}"]`);

function type(selector, text, event = 'input') {
    const field = $(selector);
    field.value = text;
    field.dispatchEvent(new Event(event, { bubbles: true }));
}
const submitQuickAdd = () => $('.pisi-task-add').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

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

describe('Görevler sekmesi: görünümler', () => {
    it('"Bugün" ile açılır; çiplerde görünüm adı ve sayı vardır (G6)', async () => {
        await start();
        expect($('[data-screen="tasks"]')).not.toBe(null);
        expect($('.pisi-header-title').textContent).toBe('Görevler');
        expect(chipTexts()).toEqual(['Bugün 3', 'Yaklaşan 2', 'Gecikmiş 1', 'Gelen kutusu 1', 'Tamamlanan 1']);
        expect(all('.pisi-chip').map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
        expect($('.pisi-chip-row').getAttribute('aria-label')).toBe('Görev görünümleri');
        // Önce saatli görev, sonra öncelik sırası.
        expect(titles()).toEqual(['Sabah yürüyüşü', 'Rapor', 'Nottan gelen']);
        expect(all(`[data-task="${TASKS[0].id}"] .pisi-task-meta-item`).map((item) => item.textContent)).toEqual(['07:30', 'Orta', 'Her gün']);
    });

    it('görünüm değişince liste değişir; "Yaklaşan" iki grup gösterir, öteki günlerde tarih yazar', async () => {
        await start();
        tap('[data-view="upcoming"]');
        expect($('[data-view="upcoming"]').getAttribute('aria-pressed')).toBe('true');
        expect(all('[data-group]').map((group) => [group.dataset.group, group.querySelector('.pisi-task-group-title')?.textContent])).toEqual([
            ['week', '7 gün içinde1'],
            ['later', 'Daha sonra1']
        ]);
        expect(titles('[data-group="week"]')).toEqual(['Yarınki iş']);
        expect(titles('[data-group="later"]')).toEqual(['Uzak iş']);
        expect($(`[data-task="${TASKS[4].id}"] .pisi-task-meta-date`).textContent).toBe('15 Kas');

        tap('[data-view="overdue"]');
        expect(titles()).toEqual(['Kira ödemesi']);
        expect($('.pisi-task').classList.contains('pisi-task-late')).toBe(true);
        expect(all('.pisi-task-meta-item').map((item) => item.textContent)).toEqual(['12 Kas', 'Yüksek', 'Ev']);
        tap('[data-view="inbox"]');
        expect(titles()).toEqual(['Tarihsiz iş']);
        tap('[data-view="done"]');
        expect(titles()).toEqual(['Biten iş']);
        expect($('.pisi-task [role="checkbox"]').getAttribute('aria-checked')).toBe('true');
    });

    it('boş görünüm sade bir metin gösterir; İngilizcede çipler çevrilir', async () => {
        await start({ files: {}, deviceLanguage: 'en-US' });
        expect(chipTexts()).toEqual(['Today 0', 'Upcoming 0', 'Overdue 0', 'Inbox 0', 'Completed 0']);
        expect($('[data-tasks="empty"]').textContent).toBe('No tasks for today.');
        tap('[data-view="inbox"]');
        expect($('[data-tasks="empty"]').textContent).toBe('The inbox is empty.');
    });

    it('uzun liste parça parça çizilir; "Daha fazla göster" kalanını getirir', async () => {
        const many = Array.from({ length: 230 }, (_, index) => record(100 + index, `Görev ${index + 1}`, { todoTag: 'todo.3.none' }));
        await start({ files: { '.pisi/tasks.json': tasksFile(many) } });
        tap('[data-view="inbox"]');
        expect($('[data-view="inbox"] .pisi-chip-count').textContent).toBe('230');
        expect(titles().length).toBe(100);
        expect($('[data-action="show-more"]').textContent).toBe('Daha fazla göster (130)');
        tap('[data-action="show-more"]');
        tap('[data-action="show-more"]');
        expect(titles().length).toBe(230);
        expect($('[data-action="show-more"]')).toBe(null);
    });

    it('onay kutusu görevi tamamlar, sayılar güncellenir; "Geri al" eski haline döndürür', async () => {
        const { driver, platform } = await start();
        tap(`[data-task-toggle="${TASKS[1].id}"]`);
        await settle();
        expect(titles()).toEqual(['Sabah yürüyüşü', 'Nottan gelen']);
        expect(chipTexts().slice(0, 1).concat(chipTexts().slice(4))).toEqual(['Bugün 2', 'Tamamlanan 2']);
        expect(platform.calls.haptics).toBe(1);
        expect(stored(driver, 1)).toMatchObject({ status: 'done', deneme: 'korunur' });
        expect(snackbar()).toBe('Görev tamamlandı.');

        tap('.pisi-snackbar [data-action="undo"], .pisi-snackbar button');
        await settle();
        expect(titles()).toEqual(['Sabah yürüyüşü', 'Rapor', 'Nottan gelen']);
        expect(stored(driver, 1)).toMatchObject({ status: 'todo', completedAt: null });
    });

    it('Pisi sekmesinde tamamlanan görev Görevler sekmesine dönünce güncel görünür', async () => {
        await start();
        app.router.selectTab('pisi');
        tap(`[data-task-toggle="${TASKS[1].id}"]`);
        await settle();
        app.router.selectTab('tasks');
        expect(titles()).toEqual(['Sabah yürüyüşü', 'Nottan gelen']);
        expect($('[data-view="done"] .pisi-chip-count').textContent).toBe('2');
    });

    it('bozuk tasks.json ezilmez: liste kilitlenir ve kullanıcıya söylenir (V7)', async () => {
        const { driver } = await start({ files: { '.pisi/tasks.json': '{bozuk' } });
        expect($('[data-screen="tasks"] [data-tasks="read-only"]').textContent).toBe('Görev dosyası okunamadı; görevler değiştirilmeyecek.');
        expect($('[data-action="add-task-input"]').readOnly).toBe(true);
        type('[data-action="add-task-input"]', 'Yazılmaz');
        submitQuickAdd();
        await settle();
        expect(driver.snapshot()['.pisi/tasks.json']).toBe('{bozuk');
    });
});

describe('Görevler sekmesi: hızlı ekle', () => {
    it('yazılan satır çip olarak okunur; öncelik çipten seçilir ve yazılan metin yerinde kalır', async () => {
        const { driver } = await start({ files: {} });
        expect($('.pisi-task-add-chips').hidden).toBe(true);
        type('[data-action="add-task-input"]', 'Yarın 14:00 rapor');
        expect(parseChips()).toEqual(['Yarın', '14:00', 'Öncelik 3']);
        type('[data-action="add-task-input"]', 'her pazartesi 14:00 rapor');
        expect(parseChips()).toEqual(['16 Kas', '14:00', 'Öncelik 3', 'Her hafta']);
        const input = $('[data-action="add-task-input"]');

        tap('[data-chip="priority"]');
        expect($('[role="dialog"] .pisi-sheet-title').textContent).toBe('Öncelik');
        expect(all('.pisi-sheet-option').map((option) => option.textContent)).toEqual(['Çok yüksek', 'Yüksek', 'Orta', 'Düşük', 'Çok düşük']);
        choose(4);
        expect($('[role="dialog"]')).toBe(null);
        expect(parseChips()).toEqual(['16 Kas', '14:00', 'Öncelik 4', 'Her hafta']);
        expect($('[data-chip="priority"]').getAttribute('aria-label')).toBe('Öncelik 4, Yüksek. Değiştir');
        expect(document.activeElement.dataset.chip).toBe('priority');
        // Aynı alan: sheet açılıp kapanırken ekran baştan kurulmadı.
        expect($('[data-action="add-task-input"]')).toBe(input);
        expect(input.value).toBe('her pazartesi 14:00 rapor');

        submitQuickAdd();
        await settle();
        expect(input.value).toBe('');
        expect(storedTasks(driver)).toHaveLength(1);
        expect(storedTasks(driver)[0]).toMatchObject({
            title: 'her pazartesi 14:00 rapor',
            priority: 4,
            scheduledAt: '2026-11-16T14:00',
            dueDate: '2026-11-16',
            repeat: 'weekly',
            todoTag: 'todo.4.16-11-2026',
            status: 'todo'
        });
        expect(snackbar()).toBe('Görev “Yaklaşan” görünümüne eklendi.');
        expect($('[data-view="upcoming"] .pisi-chip-count').textContent).toBe('1');
    });

    it('tarih yazılmazsa görev Gelen kutusu’na düşer; yalnız saat yazılırsa bugüne', async () => {
        const { driver } = await start({ files: {} });
        type('[data-action="add-task-input"]', 'Okuma listesini düzenle');
        expect(parseChips()).toEqual(['Gelen kutusu', 'Öncelik 3']);
        submitQuickAdd();
        await settle();
        expect(storedTasks(driver)[0]).toMatchObject({ dueDate: null, scheduledAt: null, todoTag: 'todo.3.none', priority: 3 });
        expect(snackbar()).toBe('Görev “Gelen kutusu” görünümüne eklendi.');

        type('[data-action="add-task-input"]', 'saat 18 spor');
        expect(parseChips()).toEqual(['Bugün', '18:00', 'Öncelik 3']);
        submitQuickAdd();
        await settle();
        expect(storedTasks(driver)[1]).toMatchObject({ scheduledAt: `${TODAY}T18:00`, dueDate: TODAY });
        expect(titles()).toEqual(['saat 18 spor']);
    });

    it('seçilen öncelik yalnız o görev içindir; sonraki görev yine Orta ile başlar', async () => {
        const { driver } = await start({ files: {} });
        type('[data-action="add-task-input"]', 'bugün acil iş');
        tap('[data-chip="priority"]');
        choose(5);
        submitQuickAdd();
        await settle();
        type('[data-action="add-task-input"]', 'bugün sıradan iş');
        expect(parseChips()).toEqual(['Bugün', 'Öncelik 3']);
        submitQuickAdd();
        await settle();
        expect(storedTasks(driver).map((task) => task.priority)).toEqual([5, 3]);
    });

    it('yazılmakta olan satır, başka bir görev değişip liste yeniden çizilince kaybolmaz', async () => {
        await start();
        type('[data-action="add-task-input"]', 'yarım kalan');
        tap(`[data-task-toggle="${TASKS[1].id}"]`);
        await settle();
        await vi.advanceTimersByTimeAsync(6000);
        expect(snackbar()).toBe(null);
        expect($('[data-action="add-task-input"]').value).toBe('yarım kalan');
        expect(parseChips()).toEqual(['Gelen kutusu', 'Öncelik 3']);
    });
});

describe('Görev detayı', () => {
    it('alanları gösterir; seçim alanları kendi sheet’ini açar ve geri tuşu önce onu kapatır', async () => {
        const { platform } = await start();
        openTask(0);
        expect($('[role="dialog"] .pisi-sheet-title').textContent).toBe('Görev');
        expect($('[data-task-field="title"]').value).toBe('Sabah yürüyüşü');
        expect(['status', 'priority', 'date', 'repeat', 'reminderMode'].map(rowValue)).toEqual([
            'Yapılacak',
            'Orta',
            'Cumartesi, 14 Kasım',
            'Her gün',
            'Hatırlatma yok'
        ]);
        expect([$('[data-task-input="time"]').value, $('[data-task-input="reminderAt"]').value]).toEqual(['07:30', '']);
        expect($('[data-task-note]').textContent).toBe('Hatırlatma değerleri saklanır; mobilde bildirim henüz yok.');
        expect($('[data-task-field="source"]').closest('li').hidden).toBe(true);

        tap('[data-task-field="status"]');
        expect(all('.pisi-sheet-option').map((option) => option.textContent)).toEqual(['Yapılacak', 'Devam ediyor', 'Beklemede', 'Engellendi', 'Tamamlandı']);
        expect($('.pisi-sheet-option[aria-checked="true"]').textContent).toBe('Yapılacak');
        platform.pressBack();
        expect($('[role="dialog"] .pisi-sheet-title').textContent).toBe('Görev');
        expect(document.activeElement.dataset.taskField).toBe('status');
        platform.pressBack();
        expect($('[role="dialog"]')).toBe(null);
        expect(document.activeElement.dataset.taskOpen).toBe(TASKS[0].id);
        expect(app.router.getState().tab).toBe('tasks');
    });

    it('durum, öncelik ve tekrar yalnız ilgili kaydı değiştirir; bilinmeyen alan korunur (V3, V5)', async () => {
        const { driver } = await start();
        const before = storedTasks(driver);
        openTask(1);
        tap('[data-task-field="status"]');
        choose('doing');
        await settle();
        tap('[data-task-field="priority"]');
        choose(1);
        await settle();
        tap('[data-task-field="repeat"]');
        choose('weekly');
        await settle();

        expect(['status', 'priority', 'repeat'].map(rowValue)).toEqual(['Devam ediyor', 'Çok düşük', 'Her hafta']);
        expect(stored(driver, 1)).toMatchObject({
            status: 'doing',
            priority: 1,
            repeat: 'weekly',
            todoTag: 'todo.1.14-11-2026',
            deneme: 'korunur',
            title: 'Rapor'
        });
        const after = storedTasks(driver);
        expect(after.filter((task) => task.id !== TASKS[1].id)).toEqual(before.filter((task) => task.id !== TASKS[1].id));
        // Listedeki satır da güncel.
        expect($(`[data-task="${TASKS[1].id}"] .pisi-task-meta-priority`).textContent).toBe('Çok düşük');
    });

    it('aynı değer yeniden seçilince ya da başlık değişmeden bırakılınca dosya yazılmaz (V4)', async () => {
        const { driver } = await start();
        openTask(1);
        const count = writes(driver);
        const text = driver.snapshot()['.pisi/tasks.json'];
        tap('[data-task-field="priority"]');
        choose(5);
        await settle();
        tap('[data-task-field="status"]');
        choose('todo');
        await settle();
        type('[data-task-field="title"]', 'Rapor ', 'change');
        type('[data-task-field="title"]', '   ', 'change');
        await settle();
        expect($('[data-task-field="title"]').value).toBe('Rapor');
        expect(writes(driver)).toBe(count);
        expect(driver.snapshot()['.pisi/tasks.json']).toBe(text);
    });

    it('başlık değişince kaydedilir', async () => {
        const { driver } = await start();
        openTask(1);
        type('[data-task-field="title"]', 'Raporun  son hali', 'change');
        await settle();
        expect(stored(driver, 1).title).toBe('Raporun son hali');
        expect($(`[data-task="${TASKS[1].id}"] .pisi-task-title`).textContent).toBe('Raporun son hali');
        expect($('[data-task-field="title"]').value).toBe('Raporun son hali');
    });

    it('tarih seçiciden değişir, saat korunur; görev öteki görünüme geçer; tarih kaldırılabilir', async () => {
        const { driver } = await start();
        openTask(0);
        tap('[data-task-field="date"]');
        expect($('[role="dialog"] .pisi-sheet-title').textContent).toBe('Tarih');
        expect($('.pisi-date-cell[aria-pressed="true"]').dataset.date).toBe(TODAY);
        tap('[data-date="2026-11-20"]');
        await settle();
        expect(rowValue('date')).toBe('Cuma, 20 Kasım');
        expect(stored(driver, 0)).toMatchObject({ dueDate: '2026-11-20', scheduledAt: '2026-11-20T07:30', todoTag: 'todo.3.20-11-2026' });
        expect(titles('[data-screen="tasks"]')).toEqual(['Rapor', 'Nottan gelen']);
        expect($('[data-view="upcoming"] .pisi-chip-count').textContent).toBe('3');

        tap('[data-task-field="date"]');
        tap('[data-action="remove-date"]');
        await settle();
        expect(rowValue('date')).toBe('Tarihsiz');
        expect(stored(driver, 0)).toMatchObject({ dueDate: null, scheduledAt: null, deadline: null, todoTag: 'todo.3.none' });
        // Tarihsiz görevin saati ve bitiş gününe bağlı hatırlatması olmaz.
        expect([$('[data-task-input="time"]').disabled, $('[data-task-field="reminderMode"]').disabled]).toEqual([true, true]);
        tap('[data-task-field="date"]');
        expect($('[data-action="remove-date"]')).toBe(null);
    });

    it('saat ve hatırlatma alanları değer olarak saklanır', async () => {
        const { driver } = await start();
        openTask(1);
        type('[data-task-input="time"]', '16:45', 'change');
        await settle();
        expect(stored(driver, 1)).toMatchObject({ scheduledAt: `${TODAY}T16:45`, dueDate: TODAY });
        type('[data-task-input="reminderAt"]', '2026-11-14T16:00', 'change');
        await settle();
        tap('[data-task-field="reminderMode"]');
        expect(all('.pisi-sheet-option').map((option) => option.textContent)).toEqual(['Hatırlatma yok', 'Bitiş günü', '1 gün önce', '3 gün önce']);
        choose('day-before');
        await settle();
        expect(stored(driver, 1)).toMatchObject({ reminderAt: '2026-11-14T16:00', reminderMode: 'day-before' });
        expect(rowValue('reminderMode')).toBe('1 gün önce');

        type('[data-task-input="time"]', '', 'change');
        type('[data-task-input="reminderAt"]', '', 'change');
        await settle();
        expect(stored(driver, 1)).toMatchObject({ scheduledAt: TODAY, reminderAt: null });
    });

    it('durum "Tamamlandı" seçilince tekrar eden görevin sonraki tekrarı oluşur; "Geri al" onu da alır', async () => {
        const { driver } = await start();
        openTask(0);
        tap('[data-task-field="status"]');
        choose('done');
        await settle();
        const tasks = storedTasks(driver);
        expect(tasks).toHaveLength(TASKS.length + 1);
        expect(stored(driver, 0).status).toBe('done');
        expect(tasks.at(-1)).toMatchObject({ title: 'Sabah yürüyüşü', status: 'todo', dueDate: '2026-11-15', repeat: 'daily', todoTag: 'todo.3.15-11-2026' });
        expect(rowValue('status')).toBe('Tamamlandı');

        tap('.pisi-snackbar button');
        await settle();
        expect(storedTasks(driver)).toHaveLength(TASKS.length);
        expect(stored(driver, 0).status).toBe('todo');
    });

    it('kaynağı not bloğu olan görevde yalnız durum değişir; öteki alanlar salt okunurdur', async () => {
        const { driver } = await start();
        openTask(7);
        const dialog = $('[role="dialog"]');
        expect(dialog.querySelector('[data-task-field="title"]').tagName).toBe('P');
        expect(dialog.querySelector('[data-task-field="title"]').textContent).toBe('Nottan gelen');
        expect(dialog.querySelectorAll('input, textarea').length).toBe(0);
        expect([...dialog.querySelectorAll('button[data-task-field]')].map((button) => button.dataset.taskField)).toEqual(['status', 'source']);
        expect(['priority', 'date', 'source'].map(rowValue)).toEqual(['Düşük', 'Cumartesi, 14 Kasım', 'Inbox']);
        expect([...dialog.querySelectorAll('li')].filter((item) => !item.hidden).map((item) => item.firstChild.dataset.taskField)).toEqual([
            'status',
            'priority',
            'date',
            'source'
        ]);
        expect($('[data-task-note="note-task"]').textContent).toContain('masaüstünde nottan düzenlenir');

        tap('[data-task-field="status"]');
        choose('waiting');
        await settle();
        expect(stored(driver, 7)).toMatchObject({ status: 'waiting', priority: 2, todoTag: 'todo.2.14-11-2026', title: 'Nottan gelen' });
    });

    it('kaynak nota dokununca not ekranı açılır; geri tuşu Görevler’e döner', async () => {
        const { platform } = await start();
        tap('[data-view="overdue"]');
        openTask(2);
        expect(rowValue('source')).toBe('Ev');
        tap('[data-task-field="source"]');
        expect($('[role="dialog"]')).toBe(null);
        expect(app.router.getState()).toMatchObject({ tab: 'tasks', stack: ['note'], note: { path: 'Ev.node', title: 'Ev' } });
        expect($('[data-screen="note"] .pisi-empty-title').textContent).toBe('Ev');
        expect($('.pisi-header-title').textContent).toBe('Not');
        platform.pressBack();
        expect($('[data-screen="tasks"]')).not.toBe(null);
        expect($('[data-view="overdue"]').getAttribute('aria-pressed')).toBe('true');
    });

    it('başlık yazılırken başka bir görev değişse de alan ve yazılan metin yerinde kalır', async () => {
        await start();
        openTask(1);
        const title = $('[data-task-field="title"]');
        title.focus();
        title.value = 'Yazılıyor';
        // Sheet'in arkasındaki listede bir görev tamamlanır; ardından snackbar kendiliğinden kapanır.
        $(`[data-task-toggle="${TASKS[0].id}"]`).click();
        await settle();
        expect(snackbar()).toBe('Görev tamamlandı.');
        await vi.advanceTimersByTimeAsync(6000);
        expect(snackbar()).toBe(null);
        expect($('[data-task-field="title"]')).toBe(title);
        expect(title.value).toBe('Yazılıyor');
        expect(document.activeElement).toBe(title);
    });
});
