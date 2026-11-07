import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_ZOOM_MAX,
    PISI_ZOOM_MIN,
    buildPisiContextMenuTemplate,
    clampPisiZoomFactor,
    getPisiSpellCheckerLanguages,
    listPisiZoomLevels,
    normalizePisiShellSettings,
    stepPisiZoomFactor
} from '../main/functions/window-shell-core.js';

const ids = (items) => items.map((item) => item.id || item.type);
const allFlags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

test('editable field: cut, copy, paste, plain paste and select all with edit flags', () => {
    const items = buildPisiContextMenuTemplate({ isEditable: true, editFlags: { ...allFlags, canCut: false, canCopy: false } });
    assert.deepEqual(ids(items), ['cut', 'copy', 'paste', 'paste-plain', 'separator', 'select-all']);
    assert.equal(items.find((item) => item.id === 'cut').enabled, false);
    assert.equal(items.find((item) => item.id === 'paste').enabled, true);
    assert.equal(items.find((item) => item.id === 'paste-plain').role, 'pasteAndMatchStyle');
});

test('read-only text offers copy only for a selection; empty space shows no menu', () => {
    assert.deepEqual(ids(buildPisiContextMenuTemplate({ isEditable: false, selectionText: 'metin', editFlags: allFlags })), ['copy']);
    assert.deepEqual(buildPisiContextMenuTemplate({ isEditable: false, selectionText: '  ' }), []);
    assert.deepEqual(buildPisiContextMenuTemplate({}), []);
});

test('a link adds open and copy; a link refused by the URL policy adds nothing', () => {
    const allowed = (url) => /^https?:/.test(url);
    const items = buildPisiContextMenuTemplate({ linkURL: 'https://example.com/a', isEditable: true, editFlags: allFlags }, { isLinkAllowed: allowed });
    assert.deepEqual(ids(items).slice(0, 3), ['open-link', 'copy-link', 'separator']);
    assert.equal(items[0].action, 'open-link');
    assert.equal(items[1].value, 'https://example.com/a');
    assert.deepEqual(ids(buildPisiContextMenuTemplate({ linkURL: 'https://example.com' }, { isLinkAllowed: allowed })), ['open-link', 'copy-link']);
    assert.deepEqual(buildPisiContextMenuTemplate({ linkURL: 'javascript:alert(1)' }, { isLinkAllowed: allowed }), []);
});

test('a misspelled word shows at most five suggestions and "add to dictionary" first', () => {
    const translate = (text) => `«${text}»`;
    const items = buildPisiContextMenuTemplate(
        { isEditable: true, misspelledWord: 'mrhaba', dictionarySuggestions: ['merhaba', 'marhaba', 'a', 'b', 'c', 'd'], editFlags: allFlags },
        { translate }
    );
    assert.deepEqual(ids(items).slice(0, 8), [
        'spelling-suggestion',
        'spelling-suggestion',
        'spelling-suggestion',
        'spelling-suggestion',
        'spelling-suggestion',
        'separator',
        'add-to-dictionary',
        'separator'
    ]);
    assert.equal(items[0].label, 'merhaba', 'suggestions are not translated');
    assert.equal(items[0].action, 'replace-misspelling');
    assert.equal(items[6].value, 'mrhaba');
    assert.equal(items[6].label, '«Sözlüğe ekle»');
    assert.equal(ids(items).at(-1), 'select-all');
    const none = buildPisiContextMenuTemplate({ isEditable: true, misspelledWord: 'xqz', dictionarySuggestions: [] });
    assert.equal(none[0].id, 'spelling-none');
    assert.equal(none[0].enabled, false);
    assert.equal(buildPisiContextMenuTemplate({ isEditable: true, misspelledWord: 'xqz' }, { spellcheck: false })[0].id, 'cut', 'spell checking off');
});

test('zoom stays within 80–200 % on a 10 % grid and resets to 100 %', () => {
    assert.equal(PISI_ZOOM_MIN, 0.8);
    assert.equal(PISI_ZOOM_MAX, 2);
    assert.equal(clampPisiZoomFactor(0.5), 0.8);
    assert.equal(clampPisiZoomFactor(3), 2);
    assert.equal(clampPisiZoomFactor(1.234), 1.2);
    assert.equal(clampPisiZoomFactor('abc'), 1);
    assert.equal(clampPisiZoomFactor(-1), 1);
    assert.equal(stepPisiZoomFactor(1, 1), 1.1);
    assert.equal(stepPisiZoomFactor(1.1, 1), 1.2, 'no floating point drift');
    assert.equal(stepPisiZoomFactor(2, 1), 2);
    assert.equal(stepPisiZoomFactor(0.8, -1), 0.8);
    assert.equal(stepPisiZoomFactor(1.7, 0), 1);
    let factor = 1;
    for (let index = 0; index < 20; index += 1) factor = stepPisiZoomFactor(factor, -1);
    assert.equal(factor, 0.8);
    assert.deepEqual(listPisiZoomLevels(), [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2]);
});

test('stored shell settings default to 100 % and spell checking on, and repair bad values', () => {
    assert.deepEqual(normalizePisiShellSettings(undefined), { zoomFactor: 1, spellcheck: true });
    assert.deepEqual(normalizePisiShellSettings({ zoomFactor: 9, spellcheck: false }), { zoomFactor: 2, spellcheck: false });
    assert.deepEqual(normalizePisiShellSettings(JSON.parse(JSON.stringify(normalizePisiShellSettings({ zoomFactor: 1.3 })))), {
        zoomFactor: 1.3,
        spellcheck: true
    });
});

test('spell checker languages: interface language first, unavailable dictionaries dropped', () => {
    assert.deepEqual(getPisiSpellCheckerLanguages('tr'), ['tr', 'en-US']);
    assert.deepEqual(getPisiSpellCheckerLanguages('eng'), ['en-US', 'tr']);
    assert.deepEqual(getPisiSpellCheckerLanguages('tr', ['en-US', 'de']), ['en-US']);
    assert.deepEqual(getPisiSpellCheckerLanguages('tr', ['tr-TR', 'en-US']), ['tr-TR', 'en-US']);
});
