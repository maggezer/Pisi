// Shared steps for the phone-view tests.

import fs from 'node:fs';
import path from 'node:path';
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

/** Visible controls smaller than 48 px on either side; controls matching `ignore` are left out. */
export const smallTargets = (page, ignore = null) =>
    page.evaluate(
        (ignore) =>
            [...document.querySelectorAll('button, input, textarea')]
                .filter((control) => control.checkVisibility({ visibilityProperty: true }) && !(ignore && control.matches(ignore)))
                .map((control) => ({
                    name: (control.getAttribute('aria-label') || control.textContent || control.id).trim(),
                    box: control.getBoundingClientRect()
                }))
                .filter(({ box }) => box.width < 48 || box.height < 48)
                .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`),
        ignore
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

/**
 * Controls that a screen reader would announce without a name. Read from Chrome's own accessibility tree,
 * which is what Android's TalkBack is given from the WebView; hidden elements are not in it.
 */
export async function unnamedControls(page) {
    const roles = new Set([
        'button',
        'checkbox',
        'textbox',
        'searchbox',
        'combobox',
        'link',
        'menuitem',
        'radio',
        'switch',
        'tab',
        'slider',
        'listbox',
        'option'
    ]);
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('Accessibility.enable');
        const { nodes } = await session.send('Accessibility.getFullAXTree');
        const unnamed = nodes.filter((node) => !node.ignored && roles.has(node.role?.value) && !String(node.name?.value ?? '').trim());
        const described = [];
        for (const node of unnamed) {
            const { node: dom } = await session.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId });
            const attributes = Object.fromEntries(
                (dom.attributes ?? []).reduce((pairs, value, index, list) => (index % 2 ? pairs : [...pairs, [value, list[index + 1]]]), [])
            );
            described.push(`${node.role.value} <${dom.localName} class="${attributes.class ?? ''}">`);
        }
        return described;
    } finally {
        await session.detach();
    }
}

/** Elements that still move: a running animation or a transition longer than a frame. */
export const movingElements = (page) =>
    page.evaluate(() => {
        const seconds = (list) => Math.max(...list.split(',').map((value) => parseFloat(value) * (value.trim().endsWith('ms') ? 0.001 : 1)));
        const moving = [];
        for (const element of document.querySelectorAll('*')) {
            for (const pseudo of [null, '::before', '::after']) {
                const style = getComputedStyle(element, pseudo);
                const animated = style.animationName !== 'none' && seconds(style.animationDuration) > 0.017;
                const transitioned = style.transitionProperty !== 'none' && seconds(style.transitionDuration) > 0.017;
                if (animated || transitioned) moving.push(`${element.localName}.${String(element.className?.baseVal ?? element.className)}${pseudo ?? ''}`);
            }
        }
        return [...new Set(moving)];
    });

/** Every `.node`/`.map`/JSON file of a project folder (no binary assets) as `[key, text]`. */
export function readProjectFolder(folder) {
    const files = [];
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(node|map|json)$/.test(entry.name)) files.push([path.relative(folder, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]);
        }
    };
    walk(folder);
    return files;
}

/** Touch input through the browser's own pipeline (CDP): `steps` are lists of points, one per finger. */
export async function touch(page, steps) {
    const session = await page.context().newCDPSession(page);
    const points = (list) => list.map((point, id) => ({ x: Math.round(point.x), y: Math.round(point.y), id }));
    const [first, ...rest] = steps;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(first) });
    for (const step of rest) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
}

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/** A one-finger drag in `count` steps. */
export function drag(page, from, to, count = 10) {
    return touch(
        page,
        Array.from({ length: count + 1 }, (_value, step) => [lerp(from, to, step / count)])
    );
}

/** Two fingers on a horizontal line through `centre`, from `fromGap` to `toGap` pixels from it. */

/** Frame intervals (ms) while `action` runs, measured with requestAnimationFrame inside the page. */
export async function measureFrames(page, action) {
    await page.evaluate(() => {
        const state = { stamps: [], running: true };
        window.__pisiFrames = state;
        const tick = (time) => {
            state.stamps.push(time);
            if (state.running) window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
    });
    await action();
    const stamps = await page.evaluate(() => {
        window.__pisiFrames.running = false;
        return window.__pisiFrames.stamps;
    });
    const intervals = stamps
        .slice(1)
        .map((stamp, index) => stamp - stamps[index])
        .sort((a, b) => a - b);
    const at = (fraction) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))] ?? 0;
    return { count: intervals.length, median: at(0.5), p95: at(0.95), max: intervals.at(-1) ?? 0 };
}
