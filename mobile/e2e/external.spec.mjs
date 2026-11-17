// S4 (docs/sync-plan.md): a change that comes from outside (the sync engine,
// S5) is taken in place by the open note. "Outside" is the debug build's
// developer bridge, `window.pisiDeveloper.external` (data/external-source.mjs),
// the same helper the unit tests use.

import { expect, test } from '@playwright/test';
import { open, openFromMenu, screen, seedProjectFiles, shot } from './helpers.mjs';

const paragraph = (id, text) =>
    `<div class="pisi-editor-block" data-pisi-block-id="${id}" data-pisi-block-type="paragraph" data-pisi-section-level="0">${text}</div>`;
const note = (id, title, texts) =>
    JSON.stringify(
        {
            pisi: {
                version: 1,
                type: 'node',
                id,
                title,
                sidecar: `inv_${title}__${id}`,
                createdAt: '2026-11-01T08:00:00.000Z',
                updatedAt: '2026-11-01T08:00:00.000Z',
                parentMap: 'none'
            },
            content: texts.map((text, index) => paragraph(`blk_${index + 1}`, text)).join('')
        },
        null,
        2
    );
const BLOCKS = ['Gündem', 'Mobil veri katmanı', 'Üçüncü blok', 'Dördüncü blok', 'Beşinci blok', 'Altıncı blok'];

const blocks = (page) => page.locator('.pisi-note-editor > .pisi-note-block');
const external = (page, method, ...args) => page.evaluate(([name, list]) => window.pisiDeveloper.external[name](...list), [method, args]);

/** Marks every block element of the open note, so that a later look can tell whether it is the same element. */
const markBlocks = (page) =>
    page.evaluate(() =>
        document.querySelectorAll('.pisi-note-editor > *').forEach((element, index) => {
            element.pisiMark = index + 1;
        })
    );
const marks = (page) => page.evaluate(() => [...document.querySelectorAll('.pisi-note-editor > *')].map((element) => element.pisiMark ?? null));

/** The caret: which block it is in (1-based) and where in its text. */
const caret = (page) =>
    page.evaluate(() => {
        const selection = document.getSelection();
        const block = selection.anchorNode?.parentElement?.closest('.pisi-note-block');
        const list = [...document.querySelectorAll('.pisi-note-editor > .pisi-note-block')];
        const range = document.createRange();
        range.selectNodeContents(block);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return { block: list.indexOf(block) + 1, offset: range.toString().length };
    });

async function openNoteA(page) {
    await open(page);
    await seedProjectFiles(page, [
        ['A.node', note('node_a', 'A', BLOCKS)],
        ['B.node', note('node_b', 'B', ['Başka not'])]
    ]);
    await page.reload();
    await expect(screen(page)).toBeVisible();
    await page.waitForFunction(() => Boolean(window.pisiDeveloper?.external));
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="A.node"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'note');
    await expect(blocks(page)).toHaveText(BLOCKS);
}

/** Puts the caret at the end of block `index` (0-based) and types `text` with the keyboard. */
async function typeAtEnd(page, index, text) {
    await blocks(page).nth(index).tap();
    await page.keyboard.press('End');
    await page.keyboard.type(text);
}

test('S4: not A açıkken ve 3. blok yazılırken 5. blok dışarıdan değişir: yalnız 5. blok güncellenir, imleç ve yazılan metin yerinde kalır', async ({
    page
}) => {
    await openNoteA(page);
    await typeAtEnd(page, 2, ' ve yazılan');
    expect(await caret(page)).toEqual({ block: 3, offset: 'Üçüncü blok ve yazılan'.length });
    await markBlocks(page);

    const result = await external(page, 'setBlockText', 'A.node', 'blk_5', 'Beşinci blok (masaüstü)');
    expect(result).toMatchObject({ written: true });
    await expect(blocks(page).nth(4)).toHaveText('Beşinci blok (masaüstü)');
    await expect(blocks(page).nth(2)).toHaveText('Üçüncü blok ve yazılan');
    expect(await marks(page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await caret(page)).toEqual({ block: 3, offset: 'Üçüncü blok ve yazılan'.length });

    // Typing goes on where it was.
    await page.keyboard.type('!');
    await expect(blocks(page).nth(2)).toHaveText('Üçüncü blok ve yazılan!');
    await shot(page, '60-external-block-updated');
});

test('S4: kirli 3. bloğa gelen dış değişiklik uygulanmaz ve ertelendiği görünür', async ({ page }) => {
    await openNoteA(page);
    await typeAtEnd(page, 2, ' burada');
    const result = await external(page, 'setBlockText', 'A.node', 'blk_3', 'Uzaktan gelen', { flush: false });
    expect(result).toMatchObject({ written: false, reason: 'dirty' });
    await expect(page.locator('[data-note="external-deferred"]')).toBeVisible();
    await expect(page.locator('[data-note="external-deferred"]')).toHaveText('Başka cihazdan gelen bir değişiklik, yazdıklarının kaydedilmesini bekliyor.');
    await expect(blocks(page).nth(2)).toHaveText('Üçüncü blok burada');
    await shot(page, '61-external-deferred');
});

test('S4: not B dışarıdan değişince açık not A’nın DOM’u yeniden kurulmaz', async ({ page }) => {
    await openNoteA(page);
    await markBlocks(page);
    const result = await external(page, 'setBlockText', 'B.node', 'blk_1', 'B değişti');
    expect(result).toMatchObject({ written: true });
    // The change has reached the index: the notes list shows it once the note is closed.
    await page.waitForFunction(() => document.querySelector('.pisi-note-editor'));
    expect(await marks(page)).toEqual([1, 2, 3, 4, 5, 6]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-note="B.node"] .pisi-note-card-preview')).toHaveText('B değişti');
});

test('S4: açık not dışarıdan silinince kullanıcıya söylenir ve listeye dönülür; uygulama çökmez', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    await openNoteA(page);
    const result = await external(page, 'remove', 'A.node');
    expect(result).toMatchObject({ written: true, removed: true });
    await expect(page.getByRole('status')).toContainText('Bu not masaüstünde silindi.');
    await expect(screen(page)).toHaveAttribute('data-screen', 'notes');
    await expect(page.locator('[data-note="A.node"]')).toHaveCount(0);
    await shot(page, '62-external-note-deleted');
    expect(errors).toEqual([]);
});
