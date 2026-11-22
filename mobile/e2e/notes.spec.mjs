import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { back, loadSampleProject, open, openFromMenu, overflowsSideways, readProjectJson, screen, shot, smallTargets } from './helpers.mjs';

const fixture = path.resolve(import.meta.dirname, '../../tests/fixtures/desktop-project');
const cards = (page) => page.locator('.pisi-note-card-title');
const blocks = (page) => page.locator('.pisi-note-editor > .pisi-note-block');
const search = (page) => page.getByRole('searchbox', { name: 'Notlarda ara' });

async function openNotes(page) {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'notes');
    await page.getByRole('status').waitFor({ state: 'detached' });
}

/**
 * Copies the desktop's "Toplantı Notları" (Sheet, Paint, image, file, a task block) with its image and drawing, and the
 * desktop's tasks.json, into the browser's project store.
 */
async function seedDesktopNote(page) {
    const name = 'Toplantı Notları.node';
    const note = fs.readFileSync(path.join(fixture, name), 'utf8');
    const sidecar = JSON.parse(note).pisi.sidecar;
    // The image and the Paint drawing, as base64: the plugin's own form for a file written without an encoding.
    const assets = ['image', 'paint'].flatMap((folder) =>
        fs
            .readdirSync(path.join(fixture, sidecar, folder))
            .map((file) => [`${sidecar}/${folder}/${file}`, fs.readFileSync(path.join(fixture, sidecar, folder, file)).toString('base64')])
    );
    // Test data only: written straight into the Filesystem plugin's web store, in the shape the plugin itself writes.
    await page.evaluate(
        (files) =>
            new Promise((resolve, reject) => {
                const root = '/DATA/projects/default';
                const stamp = Date.now();
                const entry = ([key, content]) => ({
                    path: `${root}/${key}`,
                    folder: `${root}/${key}`.replace(/\/[^/]+$/, ''),
                    type: 'file',
                    size: content.length,
                    ctime: stamp,
                    mtime: stamp,
                    content
                });
                const request = indexedDB.open('Disc');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const transaction = request.result.transaction('FileStorage', 'readwrite');
                    for (const file of files) transaction.objectStore('FileStorage').put(entry(file));
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                };
            }),
        [[name, note], ['.pisi/tasks.json', fs.readFileSync(path.join(fixture, '.pisi/tasks.json'), 'utf8')], ...assets]
    );
    return note;
}

test('Notlar: liste, Türkçe arama ve filtre; kart sade ve bloklar arası boşluklu (G7, G8)', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('.pisi-header-title')).toHaveText('Notlar');
    // The diaries of the days the sample tasks live in are listed too (docs/task-plan.md §3.2.2).
    await expect(cards(page)).toHaveText(['Işık ve ısı', 'Pisi Mobil', 'Toplantı Notları', '12-11-2026', '14-11-2026', '17-11-2026']);
    await expect(page.locator('[data-note="Toplantı Notları.node"] .pisi-note-card-preview')).toHaveText(
        'Gündem Mobil veri katmanı, masaüstü uyumluluğu ve örnek proje. Kararlar Her yazma tek kuyruktan geçer.'
    );
    expect(await smallTargets(page)).toEqual([]);
    expect(await overflowsSideways(page)).toBe(false);
    await shot(page, '30-notes-list');

    await search(page).fill('ISIK');
    await expect(cards(page)).toHaveText(['Işık ve ısı']);
    await search(page).fill('istanbul');
    await expect(cards(page)).toHaveText(['Işık ve ısı']);
    await search(page).fill('kuyruk');
    await expect(cards(page)).toHaveText(['Toplantı Notları']);
    await shot(page, '31-notes-search');
    await page.locator('[data-action="clear-search"]').tap();
    await page.locator('.pisi-notes-filter [data-value="diary"]').tap();
    await expect(cards(page)).toHaveText(['12-11-2026', '14-11-2026', '17-11-2026']);
    await page.locator('.pisi-notes-filter [data-value="notes"]').tap();
    await expect(cards(page)).toHaveCount(3);

    // At 130 % text nothing spills sideways and every control is still large enough.
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflowsSideways(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '32-notes-font-130');
});

test('not aç, düzenle, yeniden başlat: içerik kalıcıdır ve dosyada yalnız ilgili blok değişir', async ({ page }) => {
    await openNotes(page);
    const before = await readProjectJson(page, 'Pisi Mobil.node');
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'note');
    await expect(page.locator('.pisi-header-title')).toHaveText('Pisi Mobil');
    await expect(blocks(page)).toHaveText(['Pisi Mobil örnek projesi.', /^Bu notlar yalnız deneme içindir/]);
    // The editor uses the interface's font family (G9).
    const fonts = await page.evaluate(() => [
        getComputedStyle(document.body).fontFamily,
        getComputedStyle(document.querySelector('.pisi-note-block')).fontFamily
    ]);
    expect(fonts[1]).toBe(fonts[0]);

    // Type at the end of the first block, then Enter starts a new block and the toolbar makes it a heading.
    await blocks(page).first().tap();
    await page.keyboard.press('End');
    await expect(page.locator('.pisi-note-toolbar')).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.keyboard.type(' Mobilden eklendi.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Yeni başlık');
    await page.locator('[data-tool="heading"]').tap();
    await page.locator('[data-tool="heading"]').tap();
    await expect(blocks(page).nth(1)).toHaveAttribute('data-type', 'heading2');
    await expect(page.locator('[data-tool="heading"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '33-note-editing');

    // Back saves at once.
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'notes');
    await expect.poll(async () => (await readProjectJson(page, 'Pisi Mobil.node')).content).toContain('Yeni başlık');
    const after = await readProjectJson(page, 'Pisi Mobil.node');
    const [first, second, third] = before.content.match(/<div[^>]*>.*?<\/div>/g);
    expect(third).toBeUndefined();
    expect(after.content).toMatch(
        new RegExp(
            `^${first.replace('Pisi Mobil örnek projesi.', 'Pisi Mobil örnek projesi. Mobilden eklendi.').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
                '<h2 class="pisi-editor-block" data-pisi-block-id="blk_[0-9a-f-]{36}" data-pisi-block-type="heading2">Yeni başlık</h2>' +
                `${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
        )
    );
    expect({ ...after, content: '', pisi: { ...after.pisi, updatedAt: '' } }).toEqual({ ...before, content: '', pisi: { ...before.pisi, updatedAt: '' } });

    // A cold start reads it back from storage.
    await page.reload();
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    await expect(blocks(page)).toHaveText(['Pisi Mobil örnek projesi. Mobilden eklendi.', 'Yeni başlık', /^Bu notlar yalnız deneme içindir/]);
    await expect(blocks(page).nth(1)).toHaveAttribute('data-type', 'heading2');
});

test('yeni not: başlık sorulur, liste düğmeleriyle yazılır ve yeniden başlatınca durur', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-action="new-note"]').tap();
    await expect(page.getByRole('dialog', { name: 'Yeni not' })).toBeVisible();
    await expect(page.locator('[data-action="create-note"]')).toBeDisabled();
    await page.getByRole('textbox', { name: 'Başlık' }).fill('Alışveriş');
    await shot(page, '34-note-new');
    await page.locator('[data-action="create-note"]').tap();
    await expect(page.locator('.pisi-header-title')).toHaveText('Alışveriş');
    await expect(blocks(page).first()).toHaveAttribute('data-placeholder', 'Yazmaya başla…');
    await shot(page, '35-note-empty');

    await blocks(page).first().tap();
    await page.locator('[data-tool="bullet"]').tap();
    await page.keyboard.type('Süt');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ekmek');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bitti.');
    await expect(blocks(page)).toHaveText(['Süt', 'Ekmek', 'Bitti.']);
    await expect(blocks(page).evaluateAll((items) => items.map((item) => item.dataset.type))).resolves.toEqual(['bullet', 'bullet', 'paragraph']);

    // The note is saved a moment after typing stops; then a cold start reads it back.
    await expect.poll(async () => (await readProjectJson(page, 'Alışveriş.node')).content).toContain('Bitti.');
    await page.reload();
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Alışveriş.node"]').tap();
    await expect(blocks(page)).toHaveText(['Süt', 'Ekmek', 'Bitti.']);
    const stored = await readProjectJson(page, 'Alışveriş.node');
    expect(stored.content).not.toMatch(/pisi-note-|data-type|contenteditable|role=/);
    expect(stored.content.match(/data-pisi-block-type="(\w+)"/g)).toEqual([
        'data-pisi-block-type="bullet"',
        'data-pisi-block-type="bullet"',
        'data-pisi-block-type="paragraph"'
    ]);
});

test('masaüstü blokları salt okunur kart; görsel sidecar’dan gösterilir; paragraf düzenlenince diğer bloklar bayt bayt kalır', async ({ page }) => {
    await open(page);
    const original = await seedDesktopNote(page);
    await page.reload();
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Toplantı Notları.node"]').tap();
    await expect(blocks(page)).toHaveText(['Gündem: mobil veri katmanı', 'Kararlar bu paragrafta toplanır.', '']);
    await expect(page.locator('.pisi-note-protected-caption')).toHaveText([
        'Tablo · Masaüstünde düzenlenir',
        'Çizim · Masaüstünde düzenlenir',
        'Görsel · Masaüstünde düzenlenir',
        'Dosya · Masaüstünde düzenlenir'
    ]);
    // The version 2 task block holds only the task id (docs/task-plan.md §3.2.1): the phone draws its row from tasks.json (G8).
    await expect(page.locator('.pisi-note-task .pisi-task-title')).toHaveText(['Sunucu faturasını öde']);
    await expect(page.locator('.pisi-note-task .pisi-task-meta-item')).toHaveText(['20 Kas', 'Yüksek']);
    const image = page.locator('[data-protected="image"] img');
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
    expect(await image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('[data-protected="canvas"] img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    // The file block shows its name and size; without sync the phone cannot open a file it does not hold (S6).
    await expect(page.locator('[data-protected="file"] .pisi-note-file-name')).toHaveText('Rapor Özet.pdf');
    await shot(page, '36-note-protected', { fullPage: true });

    await blocks(page).nth(1).tap();
    await page.keyboard.press('End');
    await page.keyboard.type(' Mobil onayladı.');
    await back(page);
    await expect.poll(async () => (await readProjectJson(page, 'Toplantı Notları.node')).content).toContain('Mobil onayladı.');
    const before = JSON.parse(original);
    const after = await readProjectJson(page, 'Toplantı Notları.node');
    expect(after.content).toBe(before.content.replace('Kararlar bu paragrafta toplanır.', 'Kararlar bu paragrafta toplanır. Mobil onayladı.'));
    expect(after.content).not.toContain('blob:');
});
