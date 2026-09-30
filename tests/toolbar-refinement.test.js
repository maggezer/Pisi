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

    const order = [
        'justifyLeft',
        'justifyRight',
        'justifyCenter',
        'justifyFull'
    ].map((command) => toolbar.indexOf(`data-pisi-unified-command="${command}"`));
    assert.ok(order.every((position) => position >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);

    const actionStack = toolbar.indexOf('pisi-toolbar-text-action-stack');
    const alignGrid = toolbar.indexOf('pisi-toolbar-align-grid');
    assert.ok(actionStack >= 0 && alignGrid > actionStack);
    assert.doesNotMatch(toolbar, /pisi-toolbar-section-reserved/);
    assert.doesNotMatch(css, /pisi-toolbar-section-reserved/);
    assert.match(
        css,
        /pisi-toolbar-section:not\(\.pisi-toolbar-section-drawing\):last-child[\s\S]*border-right: 0/
    );
    assert.match(
        css,
        /pisi-unified-toolbar > \.pisi-toolbar-section-drawing[\s\S]*border-right: 1px solid #3a3b40/
    );
    assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 56px/);
    assert.match(css, /grid-template-columns: 250px 118px 226px 104px 236px 44px/);
    assert.match(toolbar, /data-pisi-excel-formula/);
    assert.match(css, /pisi-toolbar-formula-layout/);
    assert.match(css, /pisi-sheet-formula-input/);
    assert.match(toolbar, /class="pisi-sheet-main-stack"/);
    assert.match(css, /pisi-sheet-main-stack[\s\S]*repeat\(2, 38px\)/);
    assert.doesNotMatch(toolbar, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(css, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(toolbar, /openPisiToolbarTablePopover/);
    assert.match(css, /pisi-editor-toolbar[\s\S]*min-height: 102px/);
    assert.match(css, /pisi-unified-toolbar[\s\S]*min-height: 98px/);
    assert.match(css, /pisi-unified-toolbar[\s\S]*padding: 4px 8px 1px/);
    assert.match(css, /pisi-toolbar-section[\s\S]*padding: 4px 10px 1px 6px/);
});

test('Table ve Rollup butonları formül butonlarıyla aynı ölçüdedir', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const css = read('styles/65-unified-toolbar.css');

    assert.match(toolbar, /data-pisi-table-trigger/);
    assert.match(toolbar, /data-pisi-rollup-trigger/);
    assert.match(css, /\.pisi-formula-btn \{[\s\S]*width: 42px;[\s\S]*height: 38px;/);
    assert.match(css, /\.pisi-toolbar-data-btn \{[\s\S]*width: 42px;[\s\S]*height: 38px;/);
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

test('font selector stays left aligned and paint split buttons use fixed widths', () => {
    const css = read('styles/70-components.css');
    assert.match(
        css,
        /pisi-toolbar-section-text \.pisi-toolbar-section-row-top[\s\S]*justify-content: flex-start/
    );
    assert.match(
        css,
        /pisi-toolbar-section-drawing \.pisi-toolbar-draw-grid[\s\S]*grid-template-columns: repeat\(2, 44px\)/
    );
    assert.match(
        css,
        /pisi-toolbar-section-drawing \.pisi-ribbon-split[\s\S]*grid-template-columns: 26px 18px/
    );
    assert.match(
        css,
        /pisi-toolbar-section-drawing \.pisi-ribbon-split \.pisi-ribbon-btn[\s\S]*width: 26px/
    );
});
