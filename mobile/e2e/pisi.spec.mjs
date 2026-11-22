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
    // The day's section (docs/task-plan.md §3.2.2): its own tasks by time and priority, then the undated task living in today's diary.
    await expect(taskTitles(page, 'day')).toHaveText([
        'Sabah yürüyüşü',
        'TÜBİTAK raporunun yöntem bölümünü gözden geçir',
        'Market alışverişi',
        'Okuma listesini düzenle'
    ]);
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
    await expect(taskTitles(page, 'day')).toHaveCount(3);
    await expect(page.locator('[data-action="toggle-completed"]')).toHaveText('Tamamlanan (1)');
    await expect.poll(async () => (await storedTasks(page)).find((task) => task.id === market.id).status).toBe('done');
    await shot(page, '14-pisi-completed-undo');

    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect(taskTitles(page, 'day')).toHaveCount(4);
    await expect.poll(async () => (await storedTasks(page)).find((task) => task.id === market.id).status).toBe('todo');
    const restored = (await storedTasks(page)).find((task) => task.id === market.id);
    expect({ ...restored, updatedAt: null }).toEqual({ ...market, updatedAt: null });

    // A repeating task (§3.2.3): completing it adds no record; it moves on to tomorrow and stays ☑ today. Undo brings it back.
    const walk = (tasks) => tasks.find((task) => task.title === 'Sabah yürüyüşü');
    await page.getByRole('checkbox', { name: 'Tamamla: Sabah yürüyüşü' }).tap();
    await expect.poll(async () => walk(await storedTasks(page)).dueDate).toBe('2026-11-15');
    expect((await storedTasks(page)).length).toBe(6);
    expect(walk(await storedTasks(page)).completions).toMatchObject([{ date: TODAY, dueDate: TODAY }]);
    await expect.poll(async () => (await readProjectJson(page, 'diary/2026-11-15.node'))?.content ?? '').toContain(walk(await storedTasks(page)).id);
    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect.poll(async () => walk(await storedTasks(page)).dueDate).toBe(TODAY);
    expect(walk(await storedTasks(page)).completions).toEqual([]);

    // The row opens the task detail, the same sheet the Tasks tab opens.
    await page.locator('.pisi-task-body', { hasText: 'Sabah yürüyüşü' }).tap();
    const detail = page.getByRole('dialog', { name: 'Görev' });
    await expect(detail.locator('[data-task-input="time"]')).toHaveValue('07:30');
    await expect(detail.locator('[data-task-field="repeat"] .pisi-row-value')).toHaveText('Her gün');
    await shot(page, '15-pisi-task-detail');
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('S20: uygulama açılınca bugünün günlüğü, günün görevleri ve gecikenler ek dokunuş olmadan görünür', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    // A cold start: nothing is tapped after the app comes up.
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(dayTitle(page)).toHaveText('Cumartesi, 14 Kasım');
    await expect(diary(page)).toHaveValue('Örnek proje yüklendi.');
    await expect(taskTitles(page, 'overdue')).toHaveText(['Kira ödemesi']);
    await expect(taskTitles(page, 'day')).toHaveText([
        'Sabah yürüyüşü',
        'TÜBİTAK raporunun yöntem bölümünü gözden geçir',
        'Market alışverişi',
        'Okuma listesini düzenle'
    ]);
    for (const locator of [diary(page), group(page, 'overdue'), group(page, 'day')]) await expect(locator).toBeInViewport();
    // The day's diary file holds the day's section with the ids only (§3.2.2); the screen draws the rest.
    const today = await readProjectJson(page, `diary/${TODAY}.node`);
    const ids = (await storedTasks(page)).filter((task) => task.diaryDate === TODAY || task.dueDate === TODAY).map((task) => task.id);
    for (const id of ids) expect(today.content).toContain(`data-pisi-task-ref="${id}"`);
    expect(today.content).not.toContain('Market alışverişi');
    await shot(page, '13-pisi-open-day');
});

test('görev ekleme: doğal dil çipte görünür; tarih yoksa seçili güne yazılır', async ({ page }) => {
    await open(page);
    const input = page.getByRole('textbox', { name: 'Görev ekle' });
    const chips = page.locator('.pisi-parse-chip');

    await input.fill('yarın 14:00 rapor yaz');
    await expect(chips).toHaveText(['15 Kas', '14:00']);
    await shot(page, '16-pisi-add-task');
    await input.press('Enter');
    await expect(page.getByRole('status')).toContainText('Görev eklendi; günü 15 Kas.');
    // It lives in today's diary (docs/task-plan.md §1.4) and shows there with its own day.
    await expect(taskTitles(page, 'day')).toHaveText(['yarın 14:00 rapor yaz']);
    await expect(group(page, 'day').locator('.pisi-task-meta-date')).toHaveText('15 Kas');
    await expect(input).toHaveValue('');
    await expect(chips).toHaveCount(0);

    await wheelDay(page, '2026-11-16').tap();
    await expect(dayTitle(page)).toHaveText('Pazartesi, 16 Kasım');
    await input.fill('Süt al');
    await expect(chips).toHaveText(['16 Kas']);
    await page.getByRole('button', { name: 'Görevi kaydet' }).tap();
    await expect(taskTitles(page, 'day')).toHaveText(['Süt al']);

    const tasks = await storedTasks(page);
    expect(tasks.map((task) => [task.title, task.dueDate, task.dueTime, task.diaryDate, task.noteId, task.status])).toEqual([
        ['yarın 14:00 rapor yaz', '2026-11-15', '14:00', TODAY, null, 'todo'],
        ['Süt al', '2026-11-16', null, '2026-11-16', null, 'todo']
    ]);
    expect((await readProjectJson(page, '.pisi/tasks.json')).version).toBe(2);
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
