// The large-project test of M10 (docs/mobile-plan.md): a project of 2,000
// notes, 5,000 tasks and two months of diary, made by the desktop's own
// project generator (scripts/generate-project-fixture.mjs). Three timings are
// measured and reported, in the test's annotations and in
// e2e/screenshots/<theme>/large-project-timing.json (the pisi-mobile-screens
// artifact): the Pisi tab's first appearance, the frames while the note list
// is scrolled, and how long a search takes to show its results.
// The bounds are generous, for a shared CI machine; the numbers are the report.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { generatePisiProjectFixture } from '../../scripts/generate-project-fixture.mjs';
import { back, drag, measureFrames, open, openFromMenu, readProjectFolder, seedProjectFiles, shot, TODAY } from './helpers.mjs';

const SIZE = { notes: 2000, perMap: 250, tasks: 5000, diaryDays: 60 };
const QUERIES = ['Not 01234', 'toplantı', 'etiket7', 'ISIK', 'çalışma takvim'];

test('büyük proje (2.000 not, 5.000 görev): Pisi ekranı, not listesi kaydırma ve arama süreleri ölçülür', async ({ page }, info) => {
    test.slow();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-large-'));
    let files;
    try {
        await generatePisiProjectFixture(folder, { ...SIZE, today: TODAY });
        files = readProjectFolder(folder);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
    await open(page);
    await seedProjectFiles(page, files);

    // When the screen and its first task row appear, measured inside the page from navigation start.
    await page.addInitScript(() => {
        window.pisiStartup = {};
        const mark = () => {
            if (!window.pisiStartup.screen && document.querySelector('[data-screen="pisi"]')) window.pisiStartup.screen = performance.now();
            if (!window.pisiStartup.tasks && document.querySelector('.pisi-task')) window.pisiStartup.tasks = performance.now();
        };
        new MutationObserver(mark).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    // Twelve tasks fall on the day; the Pisi tab reads tasks.json and the day's diary before the project is walked (M5).
    await expect(page.locator('[data-group="day"] .pisi-task-title')).toHaveCount(12);
    await expect(page.locator('[data-diary="text"]')).toHaveValue(/^2026-11-14 günlüğü/);
    const startup = await page.evaluate(() => window.pisiStartup);
    await shot(page, '94-large-pisi');

    // The whole project has been walked when Settings shows the counts.
    await openFromMenu(page, 'settings');
    const count = (id) => page.locator(`[data-project="${id}"] .pisi-row-value`);
    await expect(count('notes')).toHaveText('2000', { timeout: 60_000 });
    await expect(count('tasks')).toHaveText('5000');
    await expect(count('diary')).toHaveText('60');
    await expect(count('maps')).toHaveText('8');
    await expect(count('integrity')).toHaveText('Sorun yok');
    const indexedMs = await page.evaluate(() => performance.now());
    await back(page);

    // The note list: only the rows on screen are drawn, and scrolling it is measured frame by frame.
    await openFromMenu(page, 'notes');
    const cards = page.locator('.pisi-note-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThan(60);
    const list = await page.locator('.pisi-main').boundingBox();
    const from = { x: list.x + list.width / 2, y: list.y + list.height * 0.8 };
    const to = { x: from.x, y: list.y + list.height * 0.2 };
    const scroll = await measureFrames(page, async () => {
        for (let round = 0; round < 12; round += 1) await drag(page, from, to, 8);
        for (let round = 0; round < 4; round += 1) await drag(page, to, from, 8);
    });
    expect(await page.locator('.pisi-main').evaluate((main) => main.scrollTop)).toBeGreaterThan(1000);
    await shot(page, '95-large-notes-scrolled');

    // Search: from the input event to the next frame, with the results drawn.
    await page.locator('.pisi-main').evaluate((main) => main.scrollTo({ top: 0 }));
    const searches = [];
    for (const query of QUERIES) {
        searches.push({
            query,
            ...(await page.evaluate(async (text) => {
                const input = document.getElementById('pisi-notes-search');
                const start = performance.now();
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise((resolve) => window.requestAnimationFrame(() => setTimeout(resolve)));
                const list = document.querySelector('.pisi-virtual');
                return {
                    ms: Math.round(performance.now() - start),
                    results: list && !list.hidden ? Number(getComputedStyle(list).getPropertyValue('--pisi-virtual-count')) : 0,
                    first: document.querySelector('.pisi-note-card-title')?.textContent ?? null
                };
            }, query))
        });
    }
    // Every note and diary day has "toplantı", every note "çalışma … takvim"; nothing has "ışık"; a title picks one note.
    expect(searches.map(({ query, results }) => [query, results])).toEqual([
        ['Not 01234', 1],
        ['toplantı', 2060],
        ['etiket7', 100],
        ['ISIK', 0],
        ['çalışma takvim', 2000]
    ]);
    expect(searches[0].first).toBe('Not 01234');
    await shot(page, '96-large-search');

    const searchMs = searches.map((search) => search.ms).sort((a, b) => a - b);
    const report = {
        notes: SIZE.notes,
        tasks: SIZE.tasks,
        diaryDays: SIZE.diaryDays,
        pisiScreenMs: Math.round(startup.screen),
        pisiFirstTaskMs: Math.round(startup.tasks),
        projectCountedByMs: Math.round(indexedMs),
        noteListScroll: {
            frames: scroll.count,
            medianMs: Number(scroll.median.toFixed(1)),
            p95Ms: Number(scroll.p95.toFixed(1)),
            maxMs: Number(scroll.max.toFixed(1))
        },
        search: { medianMs: searchMs[Math.floor(searchMs.length / 2)], maxMs: searchMs.at(-1), queries: searches }
    };
    info.annotations.push({ type: 'büyük proje', description: JSON.stringify(report) });
    const out = `e2e/screenshots/${info.project.name}`;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(`${out}/large-project-timing.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[large-project ${info.project.name}] ${JSON.stringify({ ...report, search: { ...report.search, queries: undefined } })}`);

    expect(startup.tasks).toBeLessThan(3000);
    expect(scroll.median).toBeLessThan(34);
    expect(report.search.maxMs).toBeLessThan(1000);
});
