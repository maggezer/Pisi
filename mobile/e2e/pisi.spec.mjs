import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import {
    TODAY,
    back,
    loadSampleProject,
    open,
    openFromMenu,
    overflowsSideways,
    projectFiles,
    readProjectJson,
    screen,
    shot,
    smallTargets,
    swipe
} from './helpers.mjs';

const dayTitle = (page) => page.locator('h1 time');
const wheelDay = (page, date) => page.locator(`[data-wheel="track"] [data-date="${date}"]`);
const group = (page, id) => page.locator(`[data-group="${id}"]`);
const taskTitles = (page, id) => group(page, id).locator('.pisi-task-title');
const diary = (page) => page.locator('[data-diary="text"]');
const storedTasks = async (page) => (await readProjectJson(page, '.pisi/tasks.json')).tasks;

test('soğuk açılış: Pisi ekranı bugünle gelir; alt menü yok, menü düğmesi ve tarih çarkı var', async ({ page }) => {
    await open(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(dayTitle(page)).toHaveText('Cumartesi, 14 Kasım');
    await expect(dayTitle(page)).toHaveAttribute('datetime', TODAY);
    await expect(page.locator('.pisi-day-today')).toBeVisible();
    await expect(page.locator('[data-action="go-today"]')).toBeHidden();
    await expect(page.locator('.pisi-tabs')).toHaveCount(0);
    await expect(page.locator('.pisi-home-heading')).toHaveText(['Günlük', 'Görevler']);

    // Empty day: a hint in a diary field at least three lines high, a plain "no tasks" text and the add line.
    await expect(diary(page)).toHaveAttribute('placeholder', 'Bugün neler oldu?');
    const lines = await diary(page).evaluate((element) => {
        const style = getComputedStyle(element);
        return (element.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)) / Number.parseFloat(style.lineHeight);
    });
    expect(lines).toBeGreaterThanOrEqual(3);
    await expect(page.locator('[data-tasks="empty"]')).toHaveText('Bugün için görev yok.');
    await expect(page.getByRole('textbox', { name: 'Görev ekle' })).toBeVisible();

    await expect(wheelDay(page, TODAY)).toHaveAttribute('aria-pressed', 'true');
    await expect(wheelDay(page, TODAY)).toHaveAttribute('aria-current', 'date');
    await expect(page.locator('.pisi-wheel-month')).toHaveText('Kas');
    await expect(page.getByRole('button', { name: 'Menüyü aç' })).toBeVisible();
    await shot(page, '11-pisi-empty');
});

test('menü her ekranı iki dokunuşla açar', async ({ page }) => {
    await open(page);
    await page.locator('[data-action="launcher"]').tap();
    const menu = page.getByRole('dialog', { name: 'Menü' });
    await expect(menu.locator('[data-menu]')).toHaveText(['Görevler', 'Notlar', 'Takvim', 'Haritalar', 'Ayarlar']);
    await expect(menu.locator('[data-menu] svg')).toHaveCount(5);
    await shot(page, '12-pisi-menu');
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-action="launcher"]')).toBeFocused();

    for (const target of ['tasks', 'notes', 'calendar', 'maps', 'settings']) {
        await openFromMenu(page, target);
        await back(page);
        await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    }
});

test('görevler: gruplar, iki satıra saran başlık, saat ve öncelik; tamamlama tasks.json’a yazılır ve geri alınır', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);

    await expect(group(page, 'overdue').locator('.pisi-task-group-title')).toContainText('Gecikmiş');
    await expect(taskTitles(page, 'overdue')).toHaveText(['Kira ödemesi']);
    await expect(taskTitles(page, 'day')).toHaveText(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir', 'Market alışverişi']);
    await expect(page.locator('[data-action="toggle-completed"]')).toHaveCount(0);
    await expect(diary(page)).toHaveValue('Örnek proje yüklendi.');

    // G4: the long title uses the full width and wraps instead of being cut.
    const long = group(page, 'day').locator('.pisi-task').nth(1);
    const title = long.locator('.pisi-task-title');
    expect(
        await title.evaluate((element) => Math.round(element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight)))
    ).toBe(2);
    expect(await title.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    const rowBox = await long.boundingBox();
    expect(rowBox.width).toBeGreaterThan(page.viewportSize().width - 40);
    // G5: the planned time and the priority are on the meta line.
    await expect(long.locator('.pisi-task-meta-item')).toHaveText(['10:00', 'Çok düşük']);
    await expect(group(page, 'overdue').locator('.pisi-task-meta-item')).toHaveText(['12 Kas', 'Düşük']);
    await expect(wheelDay(page, TODAY).locator('.pisi-day-dot')).toHaveCount(2);
    await expect(wheelDay(page, '2026-11-12').locator('.pisi-day-dot-tasks')).toHaveCount(1);
    await page.getByRole('status').waitFor({ state: 'detached' });
    await shot(page, '13-pisi-day');

    const market = (await storedTasks(page)).find((task) => task.title === 'Market alışverişi');
    await page.getByRole('checkbox', { name: 'Tamamla: Market alışverişi' }).tap();
    await expect(page.getByRole('status')).toContainText('Görev tamamlandı.');
    await expect(taskTitles(page, 'day')).toHaveCount(2);
    await expect(page.locator('[data-action="toggle-completed"]')).toHaveText('Tamamlanan (1)');
    await expect.poll(async () => (await storedTasks(page)).find((task) => task.id === market.id).status).toBe('done');
    await shot(page, '14-pisi-completed-undo');

    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect(taskTitles(page, 'day')).toHaveCount(3);
    await expect.poll(async () => (await storedTasks(page)).find((task) => task.id === market.id).status).toBe('todo');
    const restored = (await storedTasks(page)).find((task) => task.id === market.id);
    expect({ ...restored, updatedAt: null }).toEqual({ ...market, updatedAt: null });

    // A repeating task: completing it adds the next occurrence, undo takes that back too.
    await page.getByRole('checkbox', { name: 'Tamamla: Sabah yürüyüşü' }).tap();
    await expect.poll(async () => (await storedTasks(page)).length).toBe(7);
    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect.poll(async () => (await storedTasks(page)).length).toBe(6);

    // The row opens the read-only detail.
    await page.locator('.pisi-task-body', { hasText: 'Sabah yürüyüşü' }).tap();
    const detail = page.getByRole('dialog', { name: 'Görev' });
    await expect(detail.locator('[data-task-field="time"] .pisi-row-value')).toHaveText('07:30');
    await expect(detail.locator('[data-task-field="repeat"] .pisi-row-value')).toHaveText('Her gün');
    await shot(page, '15-pisi-task-detail');
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('görev ekleme: doğal dil çipte görünür; tarih yoksa seçili güne yazılır', async ({ page }) => {
    await open(page);
    const input = page.getByRole('textbox', { name: 'Görev ekle' });
    const chips = page.locator('.pisi-parse-chip');

    await input.fill('yarın 14:00 rapor yaz');
    await expect(chips).toHaveText(['15 Kas', '14:00']);
    await shot(page, '16-pisi-add-task');
    await input.press('Enter');
    await expect(page.getByRole('status')).toContainText('Görev 15 Kas gününe eklendi.');
    await expect(input).toHaveValue('');
    await expect(chips).toHaveCount(0);

    await wheelDay(page, '2026-11-16').tap();
    await expect(dayTitle(page)).toHaveText('Pazartesi, 16 Kasım');
    await input.fill('Süt al');
    await expect(chips).toHaveText(['16 Kas']);
    await page.getByRole('button', { name: 'Görevi kaydet' }).tap();
    await expect(taskTitles(page, 'day')).toHaveText(['Süt al']);

    const tasks = await storedTasks(page);
    expect(tasks.map((task) => [task.title, task.scheduledAt, task.dueDate, task.todoTag, task.status])).toEqual([
        ['yarın 14:00 rapor yaz', '2026-11-15T14:00', '2026-11-15', 'todo.3.15-11-2026', 'todo'],
        ['Süt al', '2026-11-16', '2026-11-16', 'todo.3.16-11-2026', 'todo']
    ]);
    expect(tasks.every((task) => /^task_[0-9a-f-]{36}$/.test(task.id))).toBe(true);

    // Cold start: both are read back from storage on their own days.
    await page.reload();
    await wheelDay(page, '2026-11-15').tap();
    await expect(taskTitles(page, 'day')).toHaveText(['yarın 14:00 rapor yaz']);
    await expect(group(page, 'day').locator('.pisi-task-meta-time')).toHaveText('14:00');
});

test('günlük: ilk karakterle dosya oluşur, kendiliğinden kaydedilir ve yeniden başlatınca durur', async ({ page }) => {
    await open(page);
    const paths = async () => (await projectFiles(page)).map((file) => file.path).sort();
    await expect(page.locator('[data-tasks="empty"]')).toBeVisible();
    expect(await paths()).toEqual(['.pisi/properties.json', 'diary/.pisi-diary']);

    await diary(page).tap();
    await page.waitForTimeout(900);
    expect(await paths()).toEqual(['.pisi/properties.json', 'diary/.pisi-diary']);

    await diary(page).pressSequentially('Sabah erken kalktım.');
    await expect.poll(paths).toContain('diary/2026-11-14.node');
    const saved = await readProjectJson(page, 'diary/2026-11-14.node');
    expect(saved.pisi).toMatchObject({ type: 'node', title: '14-11-2026' });
    expect(saved.content).toMatch(
        /^<div class="pisi-editor-block" data-pisi-block-id="[^"]+" data-pisi-block-type="paragraph"[^>]*>Sabah erken kalktım\.<\/div>$/
    );
    await expect(wheelDay(page, TODAY).locator('.pisi-day-dot-diary')).toHaveCount(1);
    expect((await paths()).filter((path) => path.endsWith('.tmp'))).toEqual([]);

    // Text typed right before the app is hidden is written without waiting for the timer.
    await diary(page).pressSequentially(' Yürüdüm.');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await readProjectJson(page, 'diary/2026-11-14.node')).content).toContain('Sabah erken kalktım. Yürüdüm.');

    await page.reload();
    await expect(diary(page)).toHaveValue('Sabah erken kalktım. Yürüdüm.');
    // Another day starts empty and creates nothing until something is written.
    await wheelDay(page, '2026-11-13').tap();
    await expect(diary(page)).toHaveValue('');
    await wheelDay(page, TODAY).tap();
    await expect(diary(page)).toHaveValue('Sabah erken kalktım. Yürüdüm.');
    expect((await paths()).filter((path) => path.startsWith('diary/'))).toEqual(['diary/.pisi-diary', 'diary/2026-11-14.node']);
});

test('gün üç yolla değişir: çark, içerikte kaydırma ve tarih seçici', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);

    // 1. The wheel: a tap, then a scroll that brings another day to rest in the middle.
    await wheelDay(page, '2026-11-13').tap();
    await expect(dayTitle(page)).toHaveText('Cuma, 13 Kasım');
    await expect(page.locator('.pisi-day-today')).toBeHidden();
    await expect(page.locator('[data-action="go-today"]')).toBeVisible();
    await expect(group(page, 'overdue')).toHaveCount(0);
    await expect(wheelDay(page, '2026-11-13')).toHaveAttribute('aria-pressed', 'true');
    await expect(wheelDay(page, TODAY)).toHaveAttribute('aria-pressed', 'false');
    await expect(wheelDay(page, TODAY)).toHaveAttribute('aria-current', 'date');
    await shot(page, '17-pisi-other-day');

    await page.locator('[data-wheel="track"]').evaluate((track) => {
        const item = track.querySelector('[data-date="2026-11-17"]');
        track.scrollLeft = item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2;
    });
    await expect(dayTitle(page)).toHaveText('Salı, 17 Kasım');
    await expect(taskTitles(page, 'day')).toHaveText(['Haftalık plan toplantısı']);

    await page.locator('[data-action="go-today"]').tap();
    await expect(dayTitle(page)).toHaveText('Cumartesi, 14 Kasım');
    await expect(page.locator('.pisi-day-today')).toBeVisible();

    // 2. A sideways swipe on the content; a vertical one only scrolls.
    const box = await page.locator('[data-home="scroll"]').boundingBox();
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
    await swipe(page, { x: middle.x + 120, y: middle.y }, { x: middle.x - 120, y: middle.y });
    await expect(dayTitle(page)).toHaveText('Pazar, 15 Kasım');
    await swipe(page, { x: middle.x - 120, y: middle.y }, { x: middle.x + 120, y: middle.y });
    await swipe(page, { x: middle.x - 120, y: middle.y }, { x: middle.x + 120, y: middle.y });
    await expect(dayTitle(page)).toHaveText('Cuma, 13 Kasım');
    await swipe(page, { x: middle.x, y: middle.y + 150 }, { x: middle.x + 20, y: middle.y - 150 });
    await expect(dayTitle(page)).toHaveText('Cuma, 13 Kasım');

    // 3. The date picker behind the title.
    await dayTitle(page).tap();
    const picker = page.getByRole('dialog', { name: 'Tarih seç' });
    await expect(picker.locator('.pisi-date-month-title')).toHaveText('Kasım 2026');
    await expect(picker.locator('.pisi-date-weekday')).toHaveText(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
    await expect(picker.locator('[data-date="2026-11-13"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.locator(`[data-date="${TODAY}"]`)).toHaveAttribute('aria-current', 'date');
    await expect(picker.locator(`[data-date="${TODAY}"] .pisi-day-dot`)).toHaveCount(2);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '18-pisi-date-picker');
    await picker.getByRole('button', { name: 'Sonraki ay' }).tap();
    await picker.locator('[data-date="2026-12-03"]').tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(dayTitle(page)).toHaveText('Perşembe, 3 Aralık');
    await expect(page.locator('.pisi-wheel-month')).toHaveText('Ara');
    await expect(wheelDay(page, '2026-12-03')).toHaveAttribute('aria-pressed', 'true');
});

test('çark: her gün 48 px dokunma alanı; seçili gün ortada, bugün ve seçili gün ayrı görünür', async ({ page }) => {
    await open(page);
    const size = await wheelDay(page, TODAY).evaluate((item) => [item.offsetWidth, item.offsetHeight]);
    expect(Math.min(...size)).toBeGreaterThanOrEqual(48);
    const centred = () =>
        page.locator('[data-wheel="track"]').evaluate((track) => {
            const item = track.querySelector('[aria-pressed="true"]');
            return Math.abs(item.offsetLeft + item.offsetWidth / 2 - (track.scrollLeft + track.clientWidth / 2));
        });
    expect(await centred()).toBeLessThanOrEqual(1);

    await wheelDay(page, '2026-11-16').tap();
    expect(await centred()).toBeLessThanOrEqual(1);
    const face = (date) =>
        wheelDay(page, date)
            .locator('.pisi-wheel-face')
            .evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).borderTopColor]);
    const [selected, today, plain] = [await face('2026-11-16'), await face(TODAY), await face('2026-11-15')];
    expect(selected[0]).not.toBe(plain[0]);
    expect(today[0]).toBe(plain[0]);
    expect(today[1]).not.toBe(plain[1]);
});

test('%130 yazıda taşma yok, dokunma hedefleri 48 px; İngilizcede metinler çevrilir (G2)', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole('status').waitFor({ state: 'detached' });
    await shot(page, '19-pisi-font-130');

    await openFromMenu(page, 'settings');
    await page.locator('[data-setting="language"]').tap();
    await page.getByRole('radio', { name: 'English' }).tap();
    await back(page);
    await expect(page.locator('.pisi-home-heading')).toHaveText(['Diary', 'Tasks']);
    await expect(dayTitle(page)).toHaveText('Saturday, 14 November');
    await expect(page.locator('.pisi-day-today')).toHaveText('Today');
    await expect(page.locator('.pisi-wheel-month')).toHaveText('Nov');
    await expect(group(page, 'overdue').locator('.pisi-task-group-title')).toContainText('Overdue');
    await expect(group(page, 'overdue').locator('.pisi-task-meta-item')).toHaveText(['12 Nov', 'Low']);
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
    await shot(page, '19-pisi-english');
});

test.describe('hareket azaltma açıkken', () => {
    test.use({ reducedMotion: 'reduce' });

    test('gün değişimi animasyonsuzdur', async ({ page }) => {
        await open(page);
        await wheelDay(page, '2026-11-15').tap();
        await expect(dayTitle(page)).toHaveText('Pazar, 15 Kasım');
        const animations = await page
            .locator('[data-home="scroll"] > *')
            .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
        expect(new Set(animations)).toEqual(new Set(['none']));
    });
});

test('büyük projede Pisi ekranı indeks beklenmeden açılır (2.000 not, 5.000 görev)', async ({ page }) => {
    test.slow();
    await open(page);
    await expect(page.locator('[data-tasks="empty"]')).toBeVisible();

    // Test data only: written straight into the Filesystem plugin's web store, in the shape the app itself writes.
    await page.evaluate(
        ({ today }) =>
            new Promise((resolve, reject) => {
                const root = '/DATA/projects/default';
                const stamp = Date.now();
                const iso = '2026-11-01T08:00:00.000Z';
                const entry = (path, content) => ({
                    path: `${root}/${path}`,
                    folder: `${root}/${path}`.replace(/\/[^/]+$/, ''),
                    type: 'file',
                    size: content.length,
                    ctime: stamp,
                    mtime: stamp,
                    content
                });
                const id = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
                const day = (offset) => {
                    const date = new Date(2026, 10, 14 + offset);
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                };
                const tasks = Array.from({ length: 5000 }, (_, index) => {
                    // Twelve tasks today, the rest spread over the two years around it.
                    const due = index < 12 ? today : day((index % 700) - 350 || 1);
                    const [year, month, date] = due.split('-');
                    return {
                        id: `task_${id(index)}`,
                        title: `Görev ${index + 1}`,
                        status: index % 5 === 4 && index >= 12 ? 'done' : 'todo',
                        priority: (index % 5) + 1,
                        dueDate: due,
                        scheduledAt: index % 3 === 0 ? `${due}T${String(8 + (index % 10)).padStart(2, '0')}:00` : due,
                        deadline: null,
                        reminderAt: null,
                        reminderMode: 'none',
                        durationMinutes: 0,
                        actualMinutes: 0,
                        repeat: 'none',
                        completionOffsetDays: null,
                        dependencies: [],
                        manualOrder: index,
                        todoTag: `todo.${(index % 5) + 1}.${date}-${month}-${year}`,
                        source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' },
                        createdAt: iso,
                        updatedAt: iso,
                        completedAt: index % 5 === 4 && index >= 12 ? iso : null
                    };
                });
                const note = (index) => {
                    const nodeId = `node_${id(index)}`;
                    const title = `Not ${index + 1}`;
                    const block = (blockId, text) =>
                        `<div class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="paragraph" data-pisi-section-level="0">${text}</div>`;
                    const pisi = {
                        version: 1,
                        type: 'node',
                        id: nodeId,
                        title,
                        sidecar: `inv_${title}__${nodeId}`,
                        createdAt: iso,
                        updatedAt: iso,
                        parentMap: 'none'
                    };
                    const content = Array.from({ length: 6 }, (_, line) =>
                        block(`blk-${index}-${line}`, `${title} için ${line + 1}. paragraf; arama ve önizleme metni.`)
                    ).join('');
                    return entry(`${title}.node`, JSON.stringify({ pisi, content }, null, 2));
                };
                const files = [
                    entry('.pisi/tasks.json', `${JSON.stringify({ version: 1, updatedAt: iso, tasks }, null, 2)}\n`),
                    ...Array.from({ length: 2000 }, (_, index) => note(index))
                ];
                const open = indexedDB.open('Disc');
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const transaction = open.result.transaction('FileStorage', 'readwrite');
                    for (const file of files) transaction.objectStore('FileStorage').put(file);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                };
            }),
        { today: TODAY }
    );

    // When the first task row and the project counts appear, measured inside the page from navigation start.
    await page.addInitScript(() => {
        window.pisiStartup = {};
        const mark = () => {
            if (!window.pisiStartup.screen && document.querySelector('[data-screen="pisi"]')) window.pisiStartup.screen = performance.now();
            if (!window.pisiStartup.tasks && document.querySelector('.pisi-task')) window.pisiStartup.tasks = performance.now();
        };
        new MutationObserver(mark).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    await expect(taskTitles(page, 'day')).toHaveCount(12);
    const startup = await page.evaluate(() => window.pisiStartup);

    // The whole project has been walked when Settings shows the counts.
    await openFromMenu(page, 'settings');
    await expect(page.locator('[data-project="notes"] .pisi-row-value')).toHaveText('2000', { timeout: 60_000 });
    await expect(page.locator('[data-project="tasks"] .pisi-row-value')).toHaveText('5000');
    const indexed = await page.evaluate(() => performance.now());

    const report = { screenMs: Math.round(startup.screen), firstTaskMs: Math.round(startup.tasks), projectCountedByMs: Math.round(indexed) };
    test.info().annotations.push({ type: 'pisi-startup', description: JSON.stringify(report) });
    const folder = `e2e/screenshots/${test.info().project.name}`;
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(`${folder}/startup-timing.json`, `${JSON.stringify({ notes: 2000, tasks: 5000, ...report }, null, 2)}\n`);
    console.log(`[pisi-startup ${test.info().project.name}] ${JSON.stringify(report)}`);
    expect(startup.tasks).toBeLessThan(3000);
});
