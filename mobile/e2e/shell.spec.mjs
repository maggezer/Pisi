import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { back, open, openFromMenu, overflowsSideways, screen, shot, smallTargets } from './helpers.mjs';

const TABS = [
    ['pisi', 'Pisi'],
    ['tasks', 'Görevler'],
    ['notes', 'Notlar'],
    ['calendar', 'Takvim'],
    ['maps', 'Haritalar']
];

test('soğuk açılışta Pisi ekranı bugünün tarihiyle gelir', async ({ page }) => {
    await open(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('h1 time')).toHaveAttribute('datetime', '2026-11-14');
    await expect(page.locator('h1 time')).toHaveText('Cumartesi, 14 Kasım');
    await expect(page.locator('.pisi-day-today')).toHaveText('Bugün');
    await shot(page, '01-pisi');

    // Reloading is a cold start: it returns to the Pisi tab from anywhere.
    await openFromMenu(page, 'notes');
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
});

test('beş sekme ve Ayarlar yer tutucu ekranlarını açar', async ({ page }) => {
    await open(page);
    // The Pisi tab has no bottom navigation; every other tab has it, with Pisi as the way back.
    await openFromMenu(page, 'tasks');
    await expect(page.locator('.pisi-tab')).toHaveText(TABS.map(([, label]) => label));

    for (const [index, [tab, label]] of TABS.entries()) {
        if (index === 0) continue;
        await page.locator(`[data-tab="${tab}"]`).tap();
        await expect(screen(page)).toHaveAttribute('data-screen', tab);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
        await expect(page.locator('[aria-current="page"]')).toHaveText(label);
        await shot(page, `0${index + 1}-${tab}`);
    }
    await page.locator('[data-tab="pisi"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('.pisi-tabs')).toHaveCount(0);
    await openFromMenu(page, 'maps');

    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ayarlar');
    await shot(page, '06-settings');
});

test('geri tuşu: sheet, alt ekran, Pisi sekmesi sırasıyla kapanır', async ({ page }) => {
    await open(page);
    await openFromMenu(page, 'tasks');
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

    await openFromMenu(page, 'settings');
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
    await openFromMenu(page, 'settings');
    await page.locator('[data-setting="language"]').tap();
    await page.getByRole('radio', { name: 'English' }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.reload();
    await expect(page.locator('.pisi-day-today')).toHaveText('Today');
    await page.locator('[data-action="launcher"]').tap();
    await expect(page.locator('[data-menu]')).toHaveText(['Tasks', 'Notes', 'Calendar', 'Maps', 'Settings']);
    await page.locator('[data-menu="tasks"]').tap();
    await expect(page.locator('.pisi-tab')).toHaveText(['Pisi', 'Tasks', 'Notes', 'Calendar', 'Maps']);
    await page.locator('[data-tab="pisi"]').tap();
    await shot(page, '09-pisi-english');
});

test('dokunma hedefleri en az 48 px; yazı %130 büyüyünce yatay taşma olmaz', async ({ page }) => {
    await open(page);
    expect(await smallTargets(page)).toEqual([]);
    await openFromMenu(page, 'settings');
    await page.locator('[data-setting="language"]').tap();
    expect(await smallTargets(page)).toEqual([]);
    await back(page);
    await back(page);

    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '10-pisi-font-130');

    await openFromMenu(page, 'tasks');
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.pisi-tab')].filter((tab) => tab.scrollWidth > tab.clientWidth).map((tab) => tab.textContent)
    );
    expect(clipped).toEqual([]);
});

test('üretim derlemesinde bileşen galerisi yoktur', async ({ page }) => {
    await page.goto('/?gallery');
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await expect(page.locator('[data-gallery]')).toHaveCount(0);
    // Playwright runs from the package root (mobile/), next to the build it serves.
    const bundle = fs
        .readdirSync('dist/assets')
        .map((file) => fs.readFileSync(`dist/assets/${file}`, 'utf8'))
        .join('\n');
    expect(bundle).toContain('pisi-tab');
    expect(bundle).toContain('pisi-wheel');
    expect(bundle).not.toContain('gallery');
});
