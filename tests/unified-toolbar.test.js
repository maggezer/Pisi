'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('editor preserves the current six-section toolbar selection', () => {
    const html = read('index.html');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab/);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    for (const section of [
        'pisi-toolbar-section-text',
        'pisi-toolbar-section-styles',
        'pisi-toolbar-section-table',
        'pisi-toolbar-section-excel',
        'pisi-toolbar-section-drawing',
        'pisi-toolbar-section-portability'
    ]) {
        assert.match(toolbar, new RegExp(section));
    }
    assert.doesNotMatch(toolbar, /pisi-toolbar-section-reserved/);
    for (const formula of ['logical', 'text', 'math', 'personal']) {
        assert.match(toolbar, new RegExp('data-pisi-formula-trigger="' + formula + '"'));
    }
    assert.doesNotMatch(toolbar, /data-pisi-formula-trigger="financial"/);
    assert.doesNotMatch(toolbar, /data-pisi-sheet-tools/);
    assert.doesNotMatch(toolbar, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(toolbar, /pisi-sheet-context-tools/);
    assert.doesNotMatch(toolbar, /data-pisi-excel-action=/);
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
