import { expect, test } from '@playwright/test';
import { readPisiTask } from '../../shared/task-model.mjs';
import { getPisiTaskCalendarSummary } from '../../shared/task-diary.mjs';
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

const monthTitle = (page) => page.locator('.pisi-calendar-month-title');
const cell = (page, date) => page.locator(`[data-calendar="grid"] [data-date="${date}"]`);
const diary = (page) => page.locator('[data-diary="text"]');

/** What the grid shows: `YYYY-MM-DD kind+kind` for every day with a dot (tasks, done, diary). */
const shownMarks = (page) =>
    page.locator('[data-calendar="grid"] [data-date]').evaluateAll((cells) =>
        cells
            .map((item) => {
                const kinds = [...item.querySelectorAll('.pisi-day-dot')].map((dot) =>
                    dot.classList.contains('pisi-day-dot-done') ? 'done' : dot.classList.contains('pisi-day-dot-diary') ? 'diary' : 'tasks'
                );
                return kinds.length ? `${item.dataset.date} ${kinds.join('+')}` : null;
            })
            .filter(Boolean)
    );

/**
 * The marks the project files call for in `month`, worked out here from the stored files with the
 * desktop calendar's rule, the day rule of the diary task section (docs/task-plan.md §3.2.2, shared/task-diary.mjs):
 * a day counts the tasks its section lists, each with its state on that day; a day is "done" when none of
 * them is open there; a diary day has a `diary/YYYY-MM-DD.node` file.
 */
async function expectedMarks(page, month) {
    const { tasks } = await readProjectJson(page, '.pisi/tasks.json');
    const summary = getPisiTaskCalendarSummary(tasks.map(readPisiTask).filter(Boolean));
    const diaryDays = new Set((await projectFiles(page)).map((file) => /^diary\/(\d{4}-\d{2}-\d{2})\.node$/.exec(file.path)?.[1]).filter(Boolean));
    return [...new Set([...summary.keys(), ...diaryDays])]
        .filter((day) => day.startsWith(month))
        .sort()
        .map((day) => {
            const entry = summary.get(day);
            const tasksMark = entry ? (entry.open > 0 ? 'tasks' : 'done') : null;
            return `${day} ${[tasksMark, diaryDays.has(day) ? 'diary' : null].filter(Boolean).join('+')}`;
        });
}

test('takvim: pazartesiyle başlayan ay, bugün işaretli, noktalar proje dosyalarıyla birebir; açıklama satırı var', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'calendar');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Takvim');
    await expect(monthTitle(page)).toHaveText('Kasım 2026');
    await expect(page.locator('.pisi-date-weekday')).toHaveText(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
    await expect(page.locator('[aria-current="date"]')).toHaveAttribute('data-date', TODAY);
    await expect(page.locator('[data-calendar="legend"] [data-legend]')).toHaveText(['Açık görev', 'Görevler tamamlandı', 'Günlük']);
    // G12: no Gregorian/Hijri/Chinese switch.
    await expect(page.locator('[data-screen="calendar"] select, [data-screen="calendar"] [role="radiogroup"]')).toHaveCount(0);

    // Sample project: overdue rent on the 12th, today's tasks and diary, the weekly meeting on the 17th. Each task lives in
    // its day's diary, so those days have a diary too (docs/task-plan.md §3.2.2).
    await expect.poll(() => shownMarks(page)).toEqual(['2026-11-12 tasks+diary', '2026-11-14 tasks+diary', '2026-11-17 tasks+diary']);
    expect(await shownMarks(page)).toEqual(await expectedMarks(page, '2026-11'));
    await expect(cell(page, TODAY)).toHaveAttribute('aria-label', 'Cumartesi, 14 Kasım, Bugün, görev var, günlük var');

    // Every day is a 48 dp target; nothing spills sideways, also at 130 % text.
    expect(await smallTargets(page)).toEqual([]);
    expect(await overflowsSideways(page)).toBe(false);
    await page.getByRole('status').waitFor({ state: 'detached' });
    await shot(page, '40-calendar');
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '41-calendar-font-130', { fullPage: true });
});

test('takvimden güne dokununca Pisi sekmesi o günle açılır; orada yapılan değişiklik takvime yansır', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'calendar');

    // The 12th: the overdue rent is that day's task on the Pisi tab.
    await cell(page, '2026-11-12').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('h1 time')).toHaveText('Perşembe, 12 Kasım');
    await expect(page.locator('[data-group="day"] .pisi-task-title')).toHaveText(['Kira ödemesi']);
    await page.getByRole('checkbox', { name: 'Tamamla: Kira ödemesi' }).tap();
    await expect.poll(async () => (await readProjectJson(page, '.pisi/tasks.json')).tasks.find((task) => task.title === 'Kira ödemesi').status).toBe('done');
    await diary(page).fill('Kira ödendi.');
    await expect.poll(async () => (await projectFiles(page)).some((file) => file.path === 'diary/2026-11-12.node')).toBe(true);

    // Back on the calendar the 12th has the "all done" dot and the diary ring.
    await openFromMenu(page, 'calendar');
    await expect.poll(() => shownMarks(page)).toEqual(['2026-11-12 done+diary', '2026-11-14 tasks+diary', '2026-11-17 tasks+diary']);
    expect(await shownMarks(page)).toEqual(await expectedMarks(page, '2026-11'));
    await expect(cell(page, '2026-11-12')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(page, '2026-11-12')).toHaveAttribute('aria-label', 'Perşembe, 12 Kasım, görevlerin hepsi tamamlandı, günlük var');
    await page.getByRole('status').waitFor({ state: 'detached' });
    await shot(page, '42-calendar-marks');

    // Android back on the Calendar returns to the Pisi tab, which still shows the day picked.
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('h1 time')).toHaveAttribute('datetime', '2026-11-12');
});

test('ay düğmelerle ve yatay kaydırmayla değişir; "Bu aya dön" bugünün ayına getirir; ay sekmeler arasında korunur', async ({ page }) => {
    await open(page);
    await openFromMenu(page, 'calendar');
    const thisMonth = page.getByRole('button', { name: 'Bu aya dön' });
    await expect(thisMonth).toBeHidden();

    await page.getByRole('button', { name: 'Sonraki ay' }).tap();
    await expect(monthTitle(page)).toHaveText('Aralık 2026');
    await expect(thisMonth).toBeVisible();

    const grid = await page.locator('[data-calendar="grid"]').boundingBox();
    const y = grid.y + grid.height / 2;
    await swipe(page, { x: grid.x + grid.width * 0.85, y }, { x: grid.x + grid.width * 0.15, y });
    await expect(monthTitle(page)).toHaveText('Ocak 2027');
    await swipe(page, { x: grid.x + grid.width * 0.15, y }, { x: grid.x + grid.width * 0.85, y });
    await expect(monthTitle(page)).toHaveText('Aralık 2026');

    // The month stays where it was left while the user visits another tab.
    await page.locator('[data-tab="tasks"]').tap();
    await page.locator('[data-tab="calendar"]').tap();
    await expect(monthTitle(page)).toHaveText('Aralık 2026');

    await thisMonth.tap();
    await expect(monthTitle(page)).toHaveText('Kasım 2026');
    await expect(thisMonth).toBeHidden();
});
