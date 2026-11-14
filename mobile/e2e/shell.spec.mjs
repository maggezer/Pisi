import { expect, test } from '@playwright/test';

// Saturday 14 November 2026, 09:30 in Istanbul.
const NOW = new Date('2026-11-14T09:30:00+03:00');
const TABS = [
    ['pisi', 'Pisi'],
    ['tasks', 'Görevler'],
    ['notes', 'Notlar'],
    ['calendar', 'Takvim'],
    ['maps', 'Haritalar']
];

async function open(page) {
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await expect(page.locator('[data-screen]')).toBeVisible();
}

async function shot(page, name) {
    await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png` });
}

const screen = (page) => page.locator('[data-screen]');
// In a browser Escape stands in for the Android back button.
const back = (page) => page.keyboard.press('Escape');

test('soğuk açılışta Pisi ekranı bugünün tarihiyle gelir', async ({ page }) => {
    await open(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-14');
    await expect(page.locator('time')).toContainText('14 Kasım 2026');
    await expect(page.locator('.pisi-day-today')).toHaveText('Bugün');
    await shot(page, '01-pisi');

    // Reloading is a cold start: it returns to the Pisi tab from anywhere.
    await page.locator('[data-tab="notes"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'notes');
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
});

test('beş sekme ve Ayarlar yer tutucu ekranlarını açar', async ({ page }) => {
    await open(page);
    await expect(page.locator('.pisi-tab')).toHaveText(TABS.map(([, label]) => label));

    for (const [index, [tab, label]] of TABS.entries()) {
        await page.locator(`[data-tab="${tab}"]`).tap();
        await expect(screen(page)).toHaveAttribute('data-screen', tab);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
        await expect(page.locator('[aria-current="page"]')).toHaveText(label);
        if (index > 0) await shot(page, `0${index + 1}-${tab}`);
    }

    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ayarlar');
    await shot(page, '06-settings');
});

test('geri tuşu: sheet, alt ekran, Pisi sekmesi sırasıyla kapanır', async ({ page }) => {
    await open(page);
    await page.locator('[data-tab="tasks"]').tap();
    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await page.locator('[data-setting="theme"]').tap();
    await expect(page.getByRole('dialog', { name: 'Tema' })).toBeVisible();
    await shot(page, '07-theme-sheet');

    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await expect(page.locator('[data-setting="theme"]')).toBeFocused();

    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'tasks');
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    // On the Pisi tab Android sends the app to the background; in a browser nothing changes.
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
});

test('tema sistemi izler; seçilen tema saklanır ve çubuk rengi arka planla aynıdır', async ({ page }) => {
    await open(page);
    const system = test.info().project.name;
    const other = system === 'dark' ? 'light' : 'dark';
    const theme = () => page.locator('html').getAttribute('data-theme');
    const barMatchesBackground = () =>
        page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.color = document.querySelector('meta[name="theme-color"]').content;
            document.body.append(probe);
            const same = getComputedStyle(probe).color === getComputedStyle(document.body).backgroundColor;
            probe.remove();
            return same;
        });

    expect(await theme()).toBe(system);
    expect(await barMatchesBackground()).toBe(true);

    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await page.locator('[data-setting="theme"]').tap();
    await expect(page.getByRole('radio', { name: 'Sistem' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: other === 'dark' ? 'Koyu' : 'Açık' }).tap();
    expect(await theme()).toBe(other);
    expect(await barMatchesBackground()).toBe(true);

    await page.reload();
    expect(await theme()).toBe(other);
    await shot(page, `08-pisi-forced-${other}`);
});

test('dil İngilizce yapılınca metinler değişir ve seçim saklanır', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await page.locator('[data-setting="language"]').tap();
    await page.getByRole('radio', { name: 'English' }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.reload();
    await expect(page.locator('.pisi-tab')).toHaveText(['Pisi', 'Tasks', 'Notes', 'Calendar', 'Maps']);
    await expect(page.locator('.pisi-day-today')).toHaveText('Today');
    await shot(page, '09-pisi-english');
});

test('dokunma hedefleri en az 48 px; yazı %130 büyüyünce yatay taşma olmaz', async ({ page }) => {
    await open(page);
    const smallTargets = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('button')]
                .map((button) => ({ name: button.textContent.trim(), box: button.getBoundingClientRect() }))
                .filter(({ box }) => box.width < 48 || box.height < 48)
                .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`)
        );
    const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

    expect(await smallTargets()).toEqual([]);
    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await page.locator('[data-setting="language"]').tap();
    expect(await smallTargets()).toEqual([]);
    await back(page);
    await back(page);

    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflows()).toBe(false);
    expect(await smallTargets()).toEqual([]);
    const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.pisi-tab')].filter((tab) => tab.scrollWidth > tab.clientWidth).map((tab) => tab.textContent)
    );
    expect(clipped).toEqual([]);
    await shot(page, '10-pisi-font-130');
});
