'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('toolbar sections use separators and alignment controls use a fixed 2x2 grid', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const css = read('styles/65-unified-toolbar.css');
    assert.match(toolbar, /data-pisi-unified-command="justifyFull"/);
    assert.match(toolbar, /pisiToolbarIcon\('align-justify'\)/);
    assert.match(css, /pisi-toolbar-align-grid[\s\S]*repeat\(2, 26px\)/);
    assert.match(css, /pisi-toolbar-section[\s\S]*border-right: 1px solid #3a3b40/);
    assert.match(css, /pisi-toolbar-section[\s\S]*background: transparent/);
});

test('table cells support justify and compact style buttons stay fixed width', () => {
    const sheet = read('renderer/editor/pisi-editor-sheet-structure.mjs');
    const css = read('styles/65-unified-toolbar.css');
    assert.match(sheet, /action === 'alignJustify'/);
    assert.match(sheet, /textAlign = 'justify'/);
    assert.match(css, /pisi-toolbar-style-grid \.pisi-ribbon-btn[\s\S]*width: 26px/);
});

test('canvas dimensions provide four-digit input space', () => {
    const css = read('styles/65-unified-toolbar.css');
    assert.match(css, /pisi-toolbar-dimension-row[\s\S]*repeat\(2, 52px\)/);
    assert.match(css, /pisi-ribbon-number[\s\S]*min-width: 52px/);
});
