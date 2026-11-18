// The general sweep of M10 (docs/mobile-plan.md): every screen, with the
// sample project and the sample map loaded, is checked for what the device
// acceptance list asks of all of them: the back button, the keyboard, the
// phone turned sideways, 130 % text, a screen reader and reduced motion.

import { devices, expect, test } from '@playwright/test';
import { back, loadSampleProject, movingElements, open, openFromMenu, overflowsSideways, screen, shot, smallTargets, unnamedControls } from './helpers.mjs';

const PORTRAIT = devices['Pixel 7'].viewport;
const LANDSCAPE = devices['Pixel 7 landscape'].viewport;
const blocks = (page) => page.locator('.pisi-note-editor > .pisi-note-block');
const status = (page) => page.getByRole('status');

async function openSampleProject(page) {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-developer="load-sample-map"]').tap();
    await expect(status(page)).toContainText('Örnek harita eklendi');
    await back(page);
    await status(page).waitFor({ state: 'detached' });
}

/**
 * Visits every screen in turn, from the Pisi tab and back to it, and runs `check(name)` on each once it has drawn.
 * The note is "Pisi Mobil" and the map is the developer menu's sample map.
 */
async function eachScreen(page, check) {
    await expect(page.locator('.pisi-task').first()).toBeVisible();
    await check('pisi');
    for (const tab of ['tasks', 'calendar', 'settings']) {
        await openFromMenu(page, tab);
        await check(tab);
        if (tab === 'settings') {
            // Pairing with the desktop (S5): a phone with a project is asked first what happens to it (S6), then the form.
            await page.locator('[data-sync="pair"]').tap();
            await expect(page.locator('[data-pair="initial"]')).toBeVisible();
            await check('sync-pair-initial');
            await page.locator('[data-action="initial-merge"]').tap();
            await page.locator('[data-action="use-code"]').tap();
            await expect(page.locator('#pair-server')).toBeVisible();
            await check('sync-pair');
            await back(page);
            await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
        }
        await back(page);
    }
    await openFromMenu(page, 'notes');
    await expect(page.locator('.pisi-note-card').first()).toBeVisible();
    await check('notes');
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    await expect(blocks(page).first()).toBeVisible();
    await check('note');
    await back(page);
    await back(page);
    await openFromMenu(page, 'maps');
    await expect(page.locator('[data-maps="list"] [data-map]')).toHaveCount(1);
    await check('maps');
    await page.locator('[data-maps="list"] [data-map]').tap();
    await expect(page.locator('[data-map="viewport"]')).toHaveAttribute('data-nodes', '6');
    await check('map');
    await back(page);
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
}

test('geri tuşu: sheet, alt ekran ve sekme sırasıyla kapanır; Pisi sekmesinde uygulama arka plana alınır', async ({ page }) => {
    await openSampleProject(page);
    const where = () => screen(page).getAttribute('data-screen');

    // A sheet over a sheet: the task detail and one of its fields.
    await page.locator('.pisi-task-body').first().tap();
    await expect(page.getByRole('dialog', { name: 'Görev' })).toBeVisible();
    await page.locator('[data-sheet] [data-task-field="priority"]').tap();
    await expect(page.getByRole('dialog', { name: 'Öncelik' })).toBeVisible();
    await back(page);
    await expect(page.getByRole('dialog', { name: 'Görev' })).toBeVisible();
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await where()).toBe('pisi');

    // Notes → note → Notes → Pisi.
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    expect(await where()).toBe('note');
    await back(page);
    expect(await where()).toBe('notes');
    await back(page);
    expect(await where()).toBe('pisi');

    // Maps → map → a note on it → the map → Maps → Pisi.
    await openFromMenu(page, 'maps');
    await page.locator('[data-maps="list"] [data-map]').tap();
    await expect(page.locator('[data-map="viewport"]')).toHaveAttribute('data-nodes', '6');
    await page.locator('.pisi-map-node').first().tap();
    expect(await where()).toBe('note');
    await back(page);
    expect(await where()).toBe('map');
    await back(page);
    expect(await where()).toBe('maps');
    await back(page);
    expect(await where()).toBe('pisi');

    // Settings → its theme sheet → Settings → the tab it was opened from.
    await openFromMenu(page, 'calendar');
    await page.locator('[data-action="settings"]').tap();
    await page.locator('[data-setting="theme"]').tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await where()).toBe('settings');
    await back(page);
    expect(await where()).toBe('calendar');
    await back(page);
    expect(await where()).toBe('pisi');

    // On the Pisi tab back sends the app to the background: in a browser nothing changes.
    await back(page);
    expect(await where()).toBe('pisi');
});

test('klavye: yazılan alan klavyenin altında kalmaz; köşe düğmeleri ve alt menü klavye açıkken çekilir', async ({ page }) => {
    await openSampleProject(page);
    // The keyboard is stood in for by a shorter window, as Android makes it with Keyboard.resize: native.
    const keyboard = { width: PORTRAIT.width, height: 470 };
    const keyboardOpen = () => page.evaluate(() => document.documentElement.dataset.keyboard ?? null);
    const bottomOf = (locator) => locator.evaluate((element) => element.getBoundingClientRect().bottom);

    // The task add row is the last thing on the Pisi tab.
    const add = page.locator('#pisi-task-add');
    await add.tap();
    expect(await keyboardOpen()).toBeNull();
    await page.setViewportSize(keyboard);
    await expect.poll(keyboardOpen).toBe('open');
    await expect.poll(() => bottomOf(add)).toBeLessThanOrEqual(keyboard.height);
    await expect(page.locator('[data-action="launcher"]')).toBeHidden();
    await expect(page.locator('.pisi-wheel')).toBeHidden();
    await page.keyboard.type('klavyenin üstünde');
    await expect(add).toHaveValue('klavyenin üstünde');
    await shot(page, '90-keyboard-pisi');
    await page.setViewportSize(PORTRAIT);
    await expect.poll(keyboardOpen).toBeNull();
    await expect(page.locator('[data-action="launcher"]')).toBeVisible();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');

    // A long note: the caret at its end stays above the formatting bar, which sits on the keyboard.
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    await blocks(page).last().tap();
    await page.keyboard.press('Control+End');
    for (let line = 1; line <= 18; line += 1) {
        await page.keyboard.press('Enter');
        await page.keyboard.type(`Satır ${line}`);
    }
    await page.setViewportSize(keyboard);
    await expect.poll(keyboardOpen).toBe('open');
    const toolbar = page.locator('.pisi-note-toolbar');
    await expect(toolbar).toBeVisible();
    const barTop = await toolbar.evaluate((element) => element.getBoundingClientRect().top);
    expect(barTop).toBeLessThanOrEqual(keyboard.height);
    // The caret is where the typing goes on: its line is above the bar.
    const caretBottom = () => page.evaluate(() => document.getSelection().getRangeAt(0).getBoundingClientRect().bottom);
    await expect.poll(caretBottom).toBeLessThanOrEqual(barTop);
    await expect(blocks(page).last()).toHaveText('Satır 18');
    await shot(page, '91-keyboard-note');
    await page.setViewportSize(PORTRAIT);
    await back(page);

    // Another tab: the tab bar makes room while the search field is typed in.
    await page.getByRole('searchbox', { name: 'Notlarda ara' }).tap();
    await page.setViewportSize(keyboard);
    await expect.poll(keyboardOpen).toBe('open');
    await expect(page.locator('.pisi-tabs')).toBeHidden();
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pisi-tabs')).toBeVisible();
});

test('yatay ekran: hiçbir ekranda yatay taşma yok, içerik görünür kalır', async ({ page }) => {
    await openSampleProject(page);
    await page.setViewportSize(LANDSCAPE);
    await eachScreen(page, async (name) => {
        expect(await overflowsSideways(page), name).toBe(false);
        // The screen's own content is on screen and has room, under the header and above the tab bar.
        const room = await page.evaluate(() => {
            const main = document.querySelector('.pisi-main');
            const box = main.getBoundingClientRect();
            return { top: box.top, height: Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0) };
        });
        expect(room.height, name).toBeGreaterThanOrEqual(150);
        await shot(page, `92-landscape-${name}`);
    });
});

test('%130 yazı: hiçbir ekranda yatay taşma yok, dokunma hedefleri 48 px', async ({ page }) => {
    await openSampleProject(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    await eachScreen(page, async (name) => {
        expect(await overflowsSideways(page), name).toBe(false);
        // On a map the notes are drawn at the map's scale; they grow with pinching, like the desktop's map.
        expect(await smallTargets(page, name === 'map' ? '.pisi-map-world *' : null), name).toEqual([]);
        if (name === 'settings' || name === 'note') await shot(page, `93-font-130-${name}`, { fullPage: true });
    });
});

test('ekran okuyucu: her ekranda her kontrolün adı var; her ekranın bir ana başlığı ve ana bölgesi var', async ({ page }) => {
    await openSampleProject(page);
    await eachScreen(page, async (name) => {
        expect(await unnamedControls(page), name).toEqual([]);
        if (name === 'pisi') {
            // The check sees what a screen reader sees: a button without a name is caught.
            await page.evaluate(() => document.querySelector('.pisi-main').append(Object.assign(document.createElement('button'), { id: 'unnamed' })));
            expect(await unnamedControls(page)).toEqual(['button <button class="">']);
            await page.evaluate(() => document.getElementById('unnamed').remove());
        }
        await expect(page.getByRole('main'), name).toHaveCount(1);
        expect(await page.getByRole('heading', { level: 1 }).count(), name).toBeGreaterThanOrEqual(1);
    });
    // The sheets too: the task detail and a choice sheet.
    await page.locator('.pisi-task-body').first().tap();
    expect(await unnamedControls(page)).toEqual([]);
    await back(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-setting="language"]').tap();
    expect(await unnamedControls(page)).toEqual([]);
});

test.describe('hareket azaltma açıkken', () => {
    test.use({ reducedMotion: 'reduce' });

    test('hiçbir ekranda ve sheet’te animasyon ya da geçiş kalmaz', async ({ page }) => {
        await openSampleProject(page);
        await eachScreen(page, async (name) => {
            expect(await movingElements(page), name).toEqual([]);
        });
        await page.locator('.pisi-task-body').first().tap();
        await expect(page.locator('[data-sheet]')).toBeVisible();
        expect(await movingElements(page)).toEqual([]);
        await back(page);
        await page.locator('[data-action="launcher"]').tap();
        expect(await movingElements(page)).toEqual([]);
    });
});
