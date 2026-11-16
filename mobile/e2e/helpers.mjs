// Shared steps for the phone-view tests.

import { expect, test } from '@playwright/test';

// Saturday 14 November 2026, 09:30 in Istanbul.
export const NOW = new Date('2026-11-14T09:30:00+03:00');
export const TODAY = '2026-11-14';

export const screen = (page) => page.locator('[data-screen]');
// In a browser Escape stands in for the Android back button.
export const back = (page) => page.keyboard.press('Escape');
export const shot = (page, name, options = {}) =>
    page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png`, animations: 'disabled', ...options });

export async function open(page) {
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await expect(screen(page)).toBeVisible();
}

/** Opens a screen from the Pisi tab's menu: two taps. `target` is a tab id or `settings`. */
export async function openFromMenu(page, target) {
    await page.locator('[data-action="launcher"]').tap();
    await page.locator(`[data-menu="${target}"]`).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', target);
}

export async function loadSampleProject(page) {
    await openFromMenu(page, 'settings');
    await page.locator('[data-developer="load-sample"]').tap();
    await expect(page.getByRole('status')).toContainText('Örnek proje yüklendi');
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
}

/** The project files as the storage driver sees them: the Filesystem plugin's web store (IndexedDB). */
export const projectFiles = (page) =>
    page.evaluate(
        () =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open('Disc');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const all = request.result.transaction('FileStorage').objectStore('FileStorage').getAll();
                    all.onerror = () => reject(all.error);
                    all.onsuccess = () =>
                        resolve(
                            all.result
                                .filter((entry) => entry.type === 'file')
                                .map((entry) => ({ path: entry.path.replace(/^\/DATA\/projects\/default\//, ''), content: entry.content }))
                        );
                };
            })
    );

/**
 * Test data only: writes `[key, content]` files straight into the Filesystem plugin's web store, in the shape
 * the plugin itself writes, with an entry for every folder on the way so that listing a folder finds them.
 * Content is text, or base64 for a file the app reads as bytes. Reload the page afterwards to open the project again.
 */
export const seedProjectFiles = (page, files) =>
    page.evaluate(
        (entries) =>
            new Promise((resolve, reject) => {
                const root = '/DATA/projects/default';
                const stamp = Date.now();
                const parent = (path) => path.replace(/\/[^/]+$/, '');
                const records = new Map();
                for (const [key, content] of entries) {
                    const path = `${root}/${key}`;
                    records.set(path, { path, folder: parent(path), type: 'file', size: content.length, ctime: stamp, mtime: stamp, content });
                    for (let folder = parent(path); folder.length > root.length && !records.has(folder); folder = parent(folder)) {
                        records.set(folder, { path: folder, folder: parent(folder), type: 'directory', size: 0, ctime: stamp, mtime: stamp });
                    }
                }
                const request = indexedDB.open('Disc');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const transaction = request.result.transaction('FileStorage', 'readwrite');
                    for (const record of records.values()) transaction.objectStore('FileStorage').put(record);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                };
            }),
        files
    );

export async function readProjectJson(page, path) {
    const file = (await projectFiles(page)).find((entry) => entry.path === path);
    return file ? JSON.parse(file.content) : null;
}

/** Visible controls smaller than 48 px on either side. */
export const smallTargets = (page) =>
    page.evaluate(() =>
        [...document.querySelectorAll('button, input, textarea')]
            .filter((control) => control.checkVisibility({ visibilityProperty: true }))
            .map((control) => ({
                name: (control.getAttribute('aria-label') || control.textContent || control.id).trim(),
                box: control.getBoundingClientRect()
            }))
            .filter(({ box }) => box.width < 48 || box.height < 48)
            .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`)
    );

export const overflowsSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** A real one-finger swipe through the browser's input pipeline. */
export async function swipe(page, from, to) {
    const session = await page.context().newCDPSession(page);
    const point = (x, y) => [{ x: Math.round(x), y: Math.round(y) }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
    for (let step = 1; step <= 5; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: point(from.x + ((to.x - from.x) * step) / 5, from.y + ((to.y - from.y) * step) / 5)
        });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
}
