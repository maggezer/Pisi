import { expect, test } from '@playwright/test';
import { TODAY, back, loadSampleProject, open, openFromMenu, overflowsSideways, readProjectJson, screen, shot, smallTargets } from './helpers.mjs';

const chip = (page, view) => page.locator(`[data-view="${view}"]`);
const titles = (page) => page.locator('[data-screen="tasks"] .pisi-task-title');
const input = (page) => page.getByRole('textbox', { name: 'Görev ekle' });
const parseChips = (page) => page.locator('.pisi-task-add-chips > *');
const storedTasks = async (page) => (await readProjectJson(page, '.pisi/tasks.json'))?.tasks ?? [];
const storedTask = async (page, title) => (await storedTasks(page)).find((task) => task.title === title);

async function openTasks(page, { sample = true } = {}) {
    await open(page);
    if (sample) await loadSampleProject(page);
    await openFromMenu(page, 'tasks');
    if (sample) await page.getByRole('status').waitFor({ state: 'detached' });
}

test('Görevler "Bugün" ile açılır; çiplerde sayı vardır ve görünümler listeyi değiştirir (G6)', async ({ page }) => {
    await openTasks(page);
    await expect(page.locator('.pisi-header-title')).toHaveText('Görevler');
    await expect(chip(page, 'today')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pisi-chip')).toHaveText(['Bugün3', 'Yaklaşan1', 'Gecikmiş1', 'Tarihsiz1', 'Tamamlanan0']);
    await expect(titles(page)).toHaveText(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir', 'Market alışverişi']);
    expect(await smallTargets(page)).toEqual([]);
    expect(await overflowsSideways(page)).toBe(false);
    await shot(page, '21-tasks-today');

    await chip(page, 'upcoming').tap();
    await expect(page.locator('[data-group="week"] .pisi-task-group-title')).toContainText('7 gün içinde');
    await expect(titles(page)).toHaveText(['Haftalık plan toplantısı']);
    await expect(page.locator('.pisi-task-meta-item')).toHaveText(['17 Kas', '14:00', 'Düşük', 'Her hafta']);
    await chip(page, 'overdue').tap();
    await expect(titles(page)).toHaveText(['Kira ödemesi']);
    await chip(page, 'undated').tap();
    await expect(titles(page)).toHaveText(['Okuma listesini düzenle']);
    await shot(page, '22-tasks-undated');
    await chip(page, 'done').tap();
    await expect(page.locator('[data-tasks="empty"]')).toHaveText('Tamamlanan görev yok.');
    await shot(page, '23-tasks-empty');

    // Back from another view goes to the Pisi tab, not to the previous view.
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
});

test('çipler ekrana sığmayınca yatay kayar ve taşan kenar solar (G14)', async ({ page }) => {
    await openTasks(page);
    const row = page.locator('.pisi-chip-row');
    const metrics = () =>
        row.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth, left: element.scrollLeft, fade: element.dataset.fade }));
    const mask = () => row.evaluate((element) => getComputedStyle(element).maskImage);

    const start = await metrics();
    expect(start.scroll).toBeGreaterThan(start.client);
    expect(start.fade).toBe('end');
    expect(await mask()).toContain('linear-gradient');
    // Every chip is whole: none is cut by the screen edge without a fade over it.
    const boxes = await page.locator('.pisi-chip').evaluateAll((chips) => chips.map((item) => item.getBoundingClientRect().height));
    expect(Math.min(...boxes)).toBeGreaterThanOrEqual(48);

    await chip(page, 'done').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await metrics()).fade).toBe('start');
    await chip(page, 'done').tap();
    await expect(chip(page, 'done')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '24-tasks-chips-scrolled');

    await row.evaluate((element) => (element.scrollLeft = 40));
    await expect.poll(async () => (await metrics()).fade).toBe('both');

    // At 130 % text nothing spills sideways and the row still scrolls.
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await chip(page, 'today').tap();
    await shot(page, '25-tasks-font-130');
});

test('hızlı ekle: okunan alanlar çip olur, öncelik çipten seçilir; görev tasks.json’a yazılır ve yeniden başlatınca durur', async ({ page }) => {
    await openTasks(page, { sample: false });
    await expect(page.locator('[data-tasks="empty"]')).toHaveText('Bugün için görev yok.');

    await input(page).fill('her pazartesi 14:00 haftalık rapor');
    await expect(parseChips(page)).toHaveText(['16 Kas', '14:00', 'Öncelik 3', 'Her hafta']);
    await page.getByRole('button', { name: 'Öncelik 3, Orta. Değiştir' }).tap();
    await page.getByRole('radio', { name: 'Yüksek', exact: true }).tap();
    await expect(parseChips(page)).toHaveText(['16 Kas', '14:00', 'Öncelik 4', 'Her hafta']);
    await expect(input(page)).toHaveValue('her pazartesi 14:00 haftalık rapor');
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '26-tasks-quick-add');
    await input(page).press('Enter');
    await expect(page.getByRole('status')).toContainText('Görev “Yaklaşan” görünümüne eklendi.');
    await expect(input(page)).toHaveValue('');

    await input(page).fill('yarın 9.30 diş hekimi');
    await expect(parseChips(page)).toHaveText(['Yarın', '09:30', 'Öncelik 3']);
    await page.getByRole('button', { name: 'Görevi kaydet' }).tap();
    await input(page).fill('bugün süt al');
    await expect(parseChips(page)).toHaveText(['Bugün', 'Öncelik 3']);
    await input(page).press('Enter');
    await input(page).fill('Kitap listesi');
    await expect(parseChips(page)).toHaveText(['Tarihsiz', 'Öncelik 3']);
    await input(page).press('Enter');
    await expect(page.locator('.pisi-chip')).toHaveText(['Bugün1', 'Yaklaşan2', 'Gecikmiş0', 'Tarihsiz1', 'Tamamlanan0']);
    await expect(titles(page)).toHaveText(['bugün süt al']);

    // Everything added here lives in today's diary (docs/task-plan.md G8); a line without a day gives an undated task.
    const tasks = await storedTasks(page);
    expect(tasks.map((task) => [task.title, task.dueDate, task.dueTime, task.priority, task.repeat, task.diaryDate])).toEqual([
        ['her pazartesi 14:00 haftalık rapor', '2026-11-16', '14:00', 4, 'weekly', TODAY],
        ['yarın 9.30 diş hekimi', '2026-11-15', '09:30', 3, 'none', TODAY],
        ['bugün süt al', TODAY, null, 3, 'none', TODAY],
        ['Kitap listesi', null, null, 3, 'none', TODAY]
    ]);
    // Today's diary holds the section with the four ids; the days they are due got their diaries too (§3.2.2).
    const diary = await readProjectJson(page, `diary/${TODAY}.node`);
    for (const task of tasks) expect(diary.content).toContain(`data-pisi-task-ref="${task.id}"`);
    expect((await readProjectJson(page, 'diary/2026-11-16.node')).content).toContain(tasks[0].id);

    await page.reload();
    await openFromMenu(page, 'tasks');
    await chip(page, 'upcoming').tap();
    await expect(titles(page)).toHaveText(['yarın 9.30 diş hekimi', 'her pazartesi 14:00 haftalık rapor']);
});

test('görev detayı: alanlar düzenlenir, yalnız değişen yazılır ve yeniden başlatınca durur', async ({ page }) => {
    await openTasks(page);
    const before = await storedTasks(page);
    await page.locator('.pisi-task-body', { hasText: 'Market alışverişi' }).tap();
    const detail = page.getByRole('dialog', { name: 'Görev' });
    const value = (field) => detail.locator(`[data-task-field="${field}"] .pisi-row-value`);
    await expect(detail.getByRole('textbox', { name: 'Başlık' })).toHaveValue('Market alışverişi');
    await expect(value('status')).toHaveText('Yapılacak');
    await expect(value('priority')).toHaveText('Yüksek');
    await expect(value('date')).toHaveText('Cumartesi, 14 Kasım');
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '27-task-detail');

    // Opening and closing a field without choosing anything writes nothing.
    await detail.locator('[data-task-field="priority"]').tap();
    await expect(page.getByRole('radio', { name: 'Yüksek', exact: true })).toHaveAttribute('aria-checked', 'true');
    await shot(page, '28-task-priority');
    await page.getByRole('radio', { name: 'Yüksek', exact: true }).tap();
    await expect(value('priority')).toHaveText('Yüksek');
    expect(await storedTasks(page)).toEqual(before);

    await detail.locator('[data-task-field="status"]').tap();
    await page.getByRole('radio', { name: 'Devam ediyor' }).tap();
    await expect(value('status')).toHaveText('Devam ediyor');
    await detail.locator('[data-task-field="priority"]').tap();
    await page.getByRole('radio', { name: 'Çok yüksek' }).tap();
    await expect(value('priority')).toHaveText('Çok yüksek');
    await detail.locator('[data-task-input="time"]').fill('17:15');
    await detail.locator('[data-task-input="reminderAt"]').fill('2026-11-14T16:30');
    await detail.locator('[data-task-field="reminderMode"]').tap();
    await page.getByRole('radio', { name: 'Bitiş günü' }).tap();
    await detail.locator('[data-task-field="repeat"]').tap();
    await page.getByRole('radio', { name: 'Her ay' }).tap();
    await detail.getByRole('textbox', { name: 'Başlık' }).fill('Market ve manav');
    await detail.getByRole('textbox', { name: 'Başlık' }).press('Enter');
    await expect.poll(async () => (await storedTask(page, 'Market ve manav'))?.repeat).toBe('monthly');
    expect(await storedTask(page, 'Market ve manav')).toMatchObject({
        status: 'doing',
        priority: 5,
        dueDate: TODAY,
        dueTime: '17:15',
        reminderAt: '2026-11-14T16:30',
        reminderMode: 'due-morning',
        repeat: 'monthly'
    });

    // The date: another day moves the task to "Yaklaşan" and keeps its time.
    await detail.locator('[data-task-field="date"]').tap();
    const picker = page.getByRole('dialog', { name: 'Tarih' });
    await expect(picker.locator(`[data-date="${TODAY}"]`)).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '29-task-date');
    await picker.locator('[data-date="2026-11-19"]').tap();
    await expect(value('date')).toHaveText('Perşembe, 19 Kasım');
    await expect.poll(async () => (await storedTask(page, 'Market ve manav')).dueDate).toBe('2026-11-19');
    expect((await storedTask(page, 'Market ve manav')).dueTime).toBe('17:15');
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titles(page)).toHaveText(['Sabah yürüyüşü', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir']);
    await expect(page.locator('.pisi-chip')).toHaveText(['Bugün2', 'Yaklaşan2', 'Gecikmiş1', 'Tarihsiz1', 'Tamamlanan0']);

    // Only that one record changed.
    const after = await storedTasks(page);
    const changed = after.filter((task, index) => JSON.stringify(task) !== JSON.stringify(before[index]));
    expect(changed.map((task) => task.title)).toEqual(['Market ve manav']);
    expect((await readProjectJson(page, '.pisi/tasks.json')).version).toBe(2);

    await page.reload();
    await openFromMenu(page, 'tasks');
    await chip(page, 'upcoming').tap();
    await expect(titles(page)).toHaveText(['Haftalık plan toplantısı', 'Market ve manav']);
    await page.locator('.pisi-task-body', { hasText: 'Market ve manav' }).tap();
    await expect(detail.locator('[data-task-input="time"]')).toHaveValue('17:15');
    await expect(value('repeat')).toHaveText('Her ay');

    // Removing the date makes it undated; the time goes with the day.
    await detail.locator('[data-task-field="date"]').tap();
    await picker.getByRole('button', { name: 'Tarihi kaldır' }).tap();
    await expect(value('date')).toHaveText('Tarihsiz');
    await expect(detail.locator('[data-task-input="time"]')).toBeDisabled();
    await expect.poll(async () => (await storedTask(page, 'Market ve manav')).dueDate).toBe(null);
    expect((await storedTask(page, 'Market ve manav')).dueTime).toBe(null);
});

test('tamamlama ve tekrar: onay kutusu tamamlar; "Tamamlandı" tekrarı yeni kayıt açmadan ertesi güne ilerletir; geri al geri getirir', async ({ page }) => {
    await openTasks(page);
    await page.getByRole('checkbox', { name: 'Tamamla: Market alışverişi' }).tap();
    await expect(page.getByRole('status')).toContainText('Görev tamamlandı.');
    await expect(page.locator('.pisi-chip')).toHaveText(['Bugün2', 'Yaklaşan1', 'Gecikmiş1', 'Tarihsiz1', 'Tamamlanan1']);
    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect(chip(page, 'today')).toHaveText('Bugün3');

    // A repeating task (docs/task-plan.md §3.2.3): the completion is recorded and the same task is due tomorrow.
    await page.locator('.pisi-task-body', { hasText: 'Sabah yürüyüşü' }).tap();
    const detail = page.getByRole('dialog', { name: 'Görev' });
    await detail.locator('[data-task-field="status"]').tap();
    await page.getByRole('radio', { name: 'Tamamlandı' }).tap();
    const walk = async () => storedTask(page, 'Sabah yürüyüşü');
    await expect.poll(async () => (await walk()).dueDate).toBe('2026-11-15');
    expect((await storedTasks(page)).length).toBe(6);
    expect(await walk()).toMatchObject({ status: 'todo', dueTime: '07:30', repeat: 'daily', completions: [{ date: TODAY, dueDate: TODAY }] });
    await expect(detail.locator('[data-task-field="date"] .pisi-row-value')).toHaveText('Pazar, 15 Kasım');
    await expect(detail.locator('[data-task-field="status"] .pisi-row-value')).toHaveText('Yapılacak');
    await back(page);
    await expect(page.locator('.pisi-chip')).toHaveText(['Bugün2', 'Yaklaşan2', 'Gecikmiş1', 'Tarihsiz1', 'Tamamlanan0']);
    await page.getByRole('status').getByRole('button', { name: 'Geri al' }).tap();
    await expect.poll(async () => (await walk()).dueDate).toBe(TODAY);
    expect((await walk()).completions).toEqual([]);

    // A task that does not repeat is listed under "Tamamlanan" and opens again from there.
    await page.getByRole('checkbox', { name: 'Tamamla: Market alışverişi' }).tap();
    await chip(page, 'done').tap();
    await expect(titles(page)).toHaveText(['Market alışverişi']);
    await shot(page, '30-tasks-done');
    await page.getByRole('checkbox', { name: 'Yeniden aç: Market alışverişi' }).tap();
    await expect(page.locator('[data-tasks="empty"]')).toBeVisible();
    await expect.poll(async () => (await storedTask(page, 'Market alışverişi')).status).toBe('todo');
});

test('İngilizcede Görevler ve görev detayı çevrilir', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-setting="language"]').tap();
    await page.getByRole('radio', { name: 'English' }).tap();
    await back(page);
    await openFromMenu(page, 'tasks');
    await expect(page.locator('.pisi-chip-label')).toHaveText(['Today', 'Upcoming', 'Overdue', 'Undated', 'Completed']);
    await page.getByRole('textbox', { name: 'Add task' }).fill('yarın 14:00 report');
    await expect(parseChips(page)).toHaveText(['Tomorrow', '14:00', 'Priority 3']);
    await page.locator('.pisi-task-body', { hasText: 'Market alışverişi' }).tap();
    const detail = page.getByRole('dialog', { name: 'Task' });
    await expect(detail.locator('.pisi-list-item:not([hidden]) .pisi-row-title')).toHaveText([
        'Status',
        'Priority',
        'Date',
        'Time',
        'Repeat',
        'Reminder',
        'Reminder time',
        'Place'
    ]);
    await expect(detail.locator('[data-task-field="place"] .pisi-row-value')).toHaveText('Diary · Saturday, 14 November');
    await shot(page, '31-task-detail-english');
});
