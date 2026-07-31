'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('editor uses one five-section unified toolbar without mode tabs', () => {
    const html = read('index.html');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab/);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    assert.match(toolbar, /pisi-toolbar-section-text/);
    assert.match(toolbar, /pisi-toolbar-section-styles/);
    assert.match(toolbar, /pisi-toolbar-section-table/);
    assert.match(toolbar, /pisi-toolbar-section-drawing/);
    assert.match(toolbar, /pisi-toolbar-section-reserved/);
    for (const button of ['logical', 'text', 'math', 'financial', 'personal']) {
        assert.match(toolbar, new RegExp('data-pisi-formula-trigger="' + button + '"'));
    }
});

test('unified text controls also target selected table cells', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const structure = read('renderer/editor/pisi-editor-sheet-structure.mjs');
    for (const action of [
        'toggleBold', 'toggleItalic', 'toggleUnderline',
        'toggleStrikeThrough', 'fontFamily', 'fontSize',
        'textColor', 'fillColor'
    ]) {
        assert.match(toolbar + structure, new RegExp(action));
    }
});

test('drawing toolbar supports brush and size popovers', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const paint = read('renderer/editor/pisi-editor-paint.mjs');
    assert.match(toolbar, /data-pisi-paint-tool="brush"/);
    assert.match(toolbar, /data-pisi-size-trigger="Brush"/);
    assert.match(paint, /'pencil', 'brush', 'eraser'/);
});
