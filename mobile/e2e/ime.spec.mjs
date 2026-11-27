// Typing through an Android keyboard (IME). Gboard and other keyboards write
// through composition: a swiped word is a composition that is committed at the
// end, a letter from the long-press menu (ğ, ş, ı, ö, ü, İ) is committed text.
// The app must take both in every place text is typed. On the phone the
// WebView gets the keyboard's full input connection (capacitor.config.json has
// no `captureInput`); here Chrome's IME input (CDP) stands in for the keyboard.

import { expect, test } from '@playwright/test';
import { loadSampleProject, open, openFromMenu, readProjectJson, screen } from './helpers.mjs';

const TURKISH = 'ğüşıöçİĞÜŞÖÇ';

/** A swiped word: the keyboard composes it letter by letter, then commits it whole. */
async function swipeWord(cdp, word) {
    for (let length = 1; length <= word.length; length += 1) {
        const text = word.slice(0, length);
        await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: word });
}

/** Letters picked one by one from the long-press menu: each is committed text, no key event carries it. */
async function pickLetters(cdp, letters) {
    for (const letter of letters) await cdp.send('Input.insertText', { text: letter });
}

async function typeLikeAKeyboard(cdp) {
    await swipeWord(cdp, 'çiçeği');
    await cdp.send('Input.insertText', { text: ' ' });
    await swipeWord(cdp, 'güzelmiş');
    await cdp.send('Input.insertText', { text: ' ' });
    await pickLetters(cdp, TURKISH);
}

const EXPECTED = `çiçeği güzelmiş ${TURKISH}`;

test('klavye: kaydırarak yazılan kelime ve uzun basma menüsündeki Türkçe harfler not, günlük ve görev alanına girer', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    const cdp = await page.context().newCDPSession(page);

    // The day's diary.
    const diary = page.locator('[data-diary="text"]');
    await diary.tap();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await typeLikeAKeyboard(cdp);
    await expect(diary).toHaveValue(new RegExp(`${EXPECTED}$`));
    await expect.poll(async () => (await readProjectJson(page, 'diary/2026-11-14.node'))?.content ?? '').toContain(EXPECTED);

    // The add task line.
    const add = page.getByRole('textbox', { name: 'Görev ekle' });
    await add.tap();
    await typeLikeAKeyboard(cdp);
    await expect(add).toHaveValue(EXPECTED);
    await add.press('Enter');
    await expect.poll(async () => ((await readProjectJson(page, '.pisi/tasks.json'))?.tasks ?? []).map((task) => task.title)).toContain(EXPECTED);

    // A note: a new block after Enter, typed only through the keyboard's composition.
    await openFromMenu(page, 'notes');
    await page.getByRole('status').waitFor({ state: 'detached' });
    await page.locator('[data-note="Pisi Mobil.node"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'note');
    const blocks = page.locator('.pisi-note-editor > .pisi-note-block');
    await blocks.first().tap();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await typeLikeAKeyboard(cdp);
    await expect(blocks.nth(1)).toHaveText(EXPECTED);
    await expect.poll(async () => (await readProjectJson(page, 'Pisi Mobil.node')).content).toContain(`>${EXPECTED}</div>`);
});
