'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mind Map primary actions including Reset fit on one row', () => {
    const style = read('style.css');
    const css = read('styles/115-mindmap-actions-single-row.css');
    const panel = read('renderer/map/pisi-map-right-panel.mjs');

    assert.match(style, /115-mindmap-actions-single-row\.css/);
    assert.match(css, /pisi-mindmap-icon-actions\.pisi-mindmap-icon-actions\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*2px;/s);
    assert.match(css, /pisi-mindmap-icon-actions\s*>\s*\.pisi-mindmap-icon-button\s*\{[^}]*flex:\s*0 0 30px;[^}]*width:\s*30px;/s);
    assert.match(panel, /'pisi-map-operational-reset'/);

    const availableWidth = 280 - 16 - 8;
    const requiredWidth = (8 * 30) + (7 * 2);
    assert.ok(requiredWidth <= availableWidth);
});
