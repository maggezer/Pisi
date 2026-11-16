import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { generatePisiProjectFixture } from '../../scripts/generate-project-fixture.mjs';
import { back, open, openFromMenu, overflowsSideways, screen, seedProjectFiles, shot } from './helpers.mjs';

const fixture = path.resolve(import.meta.dirname, '../../tests/fixtures/desktop-project');
const viewport = (page) => page.locator('[data-map="viewport"]');
const rows = (page) => page.locator('[data-maps="list"] [data-map]');

/** Every `.node`/`.map`/JSON file of a project folder (no binary assets) as `[key, text]`. */
function readProjectFolder(folder) {
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

/**
 * What a map's files call for, worked out here from the files themselves: its notes are the `.node`
 * files in its sidecar folder, and it draws the relationships between two of them that it has a view of.
 */
function expectedCounts(files, mapKey) {
    const byKey = new Map(files);
    const map = JSON.parse(byKey.get(mapKey));
    const notes = files.filter(([key]) => key.startsWith(`${map.pisi.sidecar}/`) && key.split('/').length === 2 && key.endsWith('.node'));
    const ids = new Set(notes.map(([, text]) => JSON.parse(text).pisi.id));
    const views = new Set(map.map.relationshipViews.map((view) => view.relationshipId));
    const { relationships } = JSON.parse(byKey.get('.pisi/relationships.json'));
    const edges = relationships.filter((item) => views.has(item.id) && ids.has(item.sourceId) && ids.has(item.targetId));
    return { nodes: String(ids.size), edges: String(edges.length) };
}

async function openProjectWith(page, files) {
    await open(page);
    await seedProjectFiles(page, files);
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'pisi');
    await openFromMenu(page, 'maps');
}

test('haritalar: masaüstünün haritası listede not sayısıyla görünür; görüntüleyici dosyaların gerektirdiği notları ve bağlantıları çizer', async ({ page }) => {
    const files = readProjectFolder(fixture);
    await openProjectWith(page, files);
    await expect(page.locator('.pisi-header-title')).toHaveText('Haritalar');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.pisi-row-title')).toHaveText('Yol Haritası');
    await expect(rows(page).locator('.pisi-row-meta')).toHaveText('2 not');
    expect(await overflowsSideways(page)).toBe(false);
    await shot(page, '50-maps-list');

    await rows(page).tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'map');
    await expect(page.locator('.pisi-header-title')).toHaveText('Yol Haritası');
    const expected = expectedCounts(files, 'Yol Haritası.map');
    await expect(viewport(page)).toHaveAttribute('data-nodes', expected.nodes);
    await expect(viewport(page)).toHaveAttribute('data-edges', expected.edges);
    expect(expected).toEqual({ nodes: '2', edges: '1' });
    await expect(page.locator('.pisi-map-edge')).toHaveCount(1);
    // The zoom and fit buttons are 48 px; map notes scale with the zoom and are left out.
    for (const box of await page
        .locator('.pisi-map-controls button')
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))) {
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
    }
    await shot(page, '51-map-desktop-fixture');

    // A tap on a note opens it; back returns to the map, then to the list.
    // The desktop placed both notes of this map at the same spot; the one drawn last is on top.
    const top = page.locator('.pisi-map-node').last();
    const title = await top.getAttribute('aria-label');
    await top.tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'note');
    await expect(page.locator('.pisi-header-title')).toHaveText(title);
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'map');
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'maps');
});

test('geliştirici menüsündeki örnek harita: üç bağlantı türü, iki parmakla yakınlaştırma, kaydırma ve ekrana sığdırma', async ({ page }) => {
    await open(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-developer="load-sample-map"]').tap();
    await expect(page.getByRole('status')).toContainText('Örnek harita eklendi.');
    await back(page);
    await openFromMenu(page, 'maps');
    await rows(page).tap();
    await expect(viewport(page)).toHaveAttribute('data-nodes', '6');
    await expect(viewport(page)).toHaveAttribute('data-edges', '6');
    await expect(page.locator('.pisi-map-edge-hub')).toHaveCount(4);
    await expect(page.locator('.pisi-map-edge-stream')).toHaveCount(1);
    await expect(page.locator('.pisi-map-edge-peer')).toHaveCount(1);
    await shot(page, '52-map-sample');

    const fitted = Number(await viewport(page).getAttribute('data-zoom'));
    const box = await viewport(page).boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await pinch(page, centre, 40, 120);
    const zoomed = Number(await viewport(page).getAttribute('data-zoom'));
    expect(zoomed).toBeGreaterThan(fitted * 2);
    await shot(page, '53-map-sample-zoomed');

    const before = await page.locator('.pisi-map-world').evaluate((world) => world.style.transform);
    await drag(page, centre, { x: centre.x - 120, y: centre.y - 80 });
    expect(await page.locator('.pisi-map-world').evaluate((world) => world.style.transform)).not.toBe(before);
    // A drag that starts on a note moves the map and does not open the note.
    await expect(screen(page)).toHaveAttribute('data-screen', 'map');

    // Chrome makes no click from a tap that comes right after a quick drag (the tap only stops the gesture);
    // pointerdown and pointerup arrive, click does not. The gesture is left to settle first, as a hand would.
    await page.waitForTimeout(800);
    await page.locator('[data-action="fit"]').tap();
    await expect(viewport(page)).toHaveAttribute('data-zoom', fitted.toFixed(3));
});

test('performans: 500 notluk harita açılır, kaydırma ve yakınlaştırma sırasında kareler ölçülür', async ({ page }, info) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-map-500-'));
    try {
        // The desktop's own project generator: one map of 500 notes in a hierarchy, every relationship with a view.
        await generatePisiProjectFixture(folder, { notes: 500, perMap: 500, relationships: true });
        const files = readProjectFolder(folder);
        await openProjectWith(page, files);
        await expect(rows(page).locator('.pisi-row-meta')).toHaveText('500 not', { timeout: 30_000 });

        const opened = Date.now();
        await rows(page).tap();
        await expect(viewport(page)).toHaveAttribute('data-nodes', '500', { timeout: 30_000 });
        const openMs = Date.now() - opened;
        const expected = expectedCounts(files, 'Harita 001.map');
        expect(expected).toEqual({ nodes: '500', edges: '499' });
        await expect(viewport(page)).toHaveAttribute('data-edges', expected.edges);
        await shot(page, '54-map-500');

        const box = await viewport(page).boundingBox();
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await pinch(page, centre, 30, 150);
        const frames = await measureFrames(page, async () => {
            for (let round = 0; round < 3; round += 1) {
                await drag(page, centre, { x: centre.x - 150, y: centre.y - 150 }, 30);
                await drag(page, centre, { x: centre.x + 150, y: centre.y + 150 }, 30);
            }
            await pinch(page, centre, 150, 40, 30);
        });
        const report = `500 not / 499 bağlantı: açılış ${openMs} ms; ${frames.count} kare, ortanca ${frames.median.toFixed(1)} ms, p95 ${frames.p95.toFixed(1)} ms, en uzun ${frames.max.toFixed(1)} ms`;
        info.annotations.push({ type: 'performans', description: report });
        console.log(`[${info.project.name}] ${report}`);
        // A generous bound for a shared CI machine: a smooth map stays near one frame per 16.7 ms.
        expect(frames.median).toBeLessThan(34);
        await shot(page, '55-map-500-moved');
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});

// ----- touch input through the browser's own pipeline (CDP) -----

async function touch(page, steps) {
    const session = await page.context().newCDPSession(page);
    const points = (list) => list.map((point, id) => ({ x: Math.round(point.x), y: Math.round(point.y), id }));
    const [first, ...rest] = steps;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(first) });
    for (const step of rest) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
}

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

function drag(page, from, to, count = 10) {
    return touch(
        page,
        Array.from({ length: count + 1 }, (_value, step) => [lerp(from, to, step / count)])
    );
}

/** Two fingers on a horizontal line through `centre`, from `fromGap` to `toGap` pixels from it. */
function pinch(page, centre, fromGap, toGap, count = 10) {
    return touch(
        page,
        Array.from({ length: count + 1 }, (_value, step) => {
            const gap = fromGap + ((toGap - fromGap) * step) / count;
            return [
                { x: centre.x - gap, y: centre.y },
                { x: centre.x + gap, y: centre.y }
            ];
        })
    );
}

/** Frame intervals (requestAnimationFrame) while `action` runs. */
async function measureFrames(page, action) {
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
