'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const toolbar = fs.readFileSync(
    path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs'),
    'utf8'
);

const iconNames = [
    "bold",
    "italic",
    "strike",
    "underline",
    "align-left",
    "align-center",
    "align-right",
    "align-justify",
    "font-color",
    "highlight",
    "symbol",
    "subscript",
    "superscript",
    "bullet-list",
    "number-list",
    "formula-logical",
    "formula-text",
    "formula-math",
    "formula-personal",
    "table",
    "canvas",
    "pen",
    "brush",
    "eraser",
    "shape",
    "lasso",
    "chevron-down"
];

test('toolbar uses the Pisi SVG icon set', () => {
    assert.match(toolbar, /PISI_TOOLBAR_ICON_ROOT = 'assets\/toolbar'/);
    assert.match(toolbar, /class="pisi-toolbar-icon"/);
    for (const name of iconNames) {
        const iconPath = path.join(root, 'assets', 'toolbar', name + '.svg');
        assert.equal(fs.existsSync(iconPath), true, name + ' icon is missing');
        const svg = fs.readFileSync(iconPath, 'utf8');
        assert.match(svg, /<svg[\s\S]*viewBox="0 0 24 24"/);
    }
});

test('removed toolbar controls stay removed', () => {
    assert.doesNotMatch(toolbar, /data-pisi-formula-trigger="financial"/);
    assert.doesNotMatch(toolbar, /data-pisi-excel-action="(?:addRow|addCol|deleteRow|deleteCol)"/);
});
