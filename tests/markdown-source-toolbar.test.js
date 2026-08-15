'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Markdown kaynak görünümü toolbar butonu üretmez', () => {
    const blocks = read('renderer/editor/pisi-block-editor.mjs');

    assert.doesNotMatch(blocks, /id: 'core\.markdown-source'/);
});

test('Markdown kaynak komutu ve düzenleyicisi kullanılabilir kalır', () => {
    const blocks = read('renderer/editor/pisi-block-editor.mjs');

    assert.match(blocks, /id: 'pisi\.block\.markdown-source'/);
    assert.match(blocks, /defaultShortcut: 'Mod\+Shift\+M'/);
    assert.match(blocks, /function openPisiMarkdownSource/);
    assert.match(blocks, /function closePisiMarkdownSource/);
});
