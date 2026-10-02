'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const toolbar = fs.readFileSync(path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs'), 'utf8');

const iconNames = [
    'bold',
    'italic',
    'strike',
    'underline',
    'align-left',
    'align-center',
    'align-right',
    'align-justify',
    'font-color',
    'highlight',
    'symbol',
    'subscript',
    'superscript',
    'bullet-list',
    'number-list',
    'formula-logical',
    'formula-text',
    'formula-math',
    'formula-personal',
    'table',
    'canvas',
    'pen',
    'brush',
    'eraser',
    'shape',
    'lasso',
    'chevron-down'
];

test('toolbar uses complete dark and light Pisi SVG icon sets', () => {
    assert.match(toolbar, /PISI_TOOLBAR_ICON_ROOT = 'assets\/toolbar'/);
    assert.match(toolbar, /PISI_TOOLBAR_LIGHT_ICON_ROOT/);
    assert.match(toolbar, /class="pisi-toolbar-icon"/);

    for (const name of iconNames) {
        const darkIconPath = path.join(root, 'assets', 'toolbar', name + '.svg');
        const lightIconPath = path.join(root, 'assets', 'toolbar', 'light', name + '.svg');

        assert.equal(fs.existsSync(darkIconPath), true, name + ' dark icon is missing');
        assert.equal(fs.existsSync(lightIconPath), true, name + ' light icon is missing');

        const darkSvg = fs.readFileSync(darkIconPath, 'utf8');
        const lightSvg = fs.readFileSync(lightIconPath, 'utf8');

        assert.match(darkSvg, /<svg[\s\S]*viewBox="0 0 24 24"/);
        assert.match(lightSvg, /<svg[\s\S]*viewBox="0 0 24 24"/);
        assert.match(lightSvg, /#2d3136/i, name + ' light icon needs dark ink');
        assert.doesNotMatch(lightSvg, /#d8d8da/i);
    }
});

test('toolbar icon sources follow live theme changes', () => {
    assert.match(toolbar, /data-pisi-toolbar-icon="\$\{name\}"/);
    assert.match(toolbar, /normalizePisiToolbarIconTheme/);
    assert.match(toolbar, /document\.addEventListener\('pisi:theme-changed'/);
    assert.match(toolbar, /syncPisiToolbarIconTheme\(document, event\.detail\?\.theme\)/);
    assert.match(toolbar, /syncPisiToolbarIconTheme\(toolbar\)/);
});

test('retired formula controls and direct Sheet action buttons stay removed', () => {
    assert.doesNotMatch(toolbar, /data-pisi-formula-trigger="financial"/);
    assert.doesNotMatch(toolbar, /class="pisi-sheet-inline-tools"/);
    assert.doesNotMatch(toolbar, /pisi-sheet-context-tools/);
    assert.doesNotMatch(toolbar, /data-pisi-excel-action=/);
});
