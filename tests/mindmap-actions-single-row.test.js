'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mind Map primary actions fit on one row and Reset sits at layout row right edge', () => {
    const style = read('style.css');
    const css = read('styles/105-feature-polish.css');
    const panel = read('renderer/map/pisi-map-right-panel.mjs');

    assert.match(style, /105-feature-polish\.css/);
    assert.match(css, /pisi-mindmap-icon-actions\.pisi-mindmap-icon-actions\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*2px;/s);
    assert.match(css, /pisi-mindmap-icon-actions\s*>\s*\.pisi-mindmap-icon-button\s*\{[^}]*flex:\s*0 0 30px;[^}]*width:\s*30px;/s);
    assert.match(css, /pisi-mindmap-layout-row\.pisi-mindmap-layout-row\s*\{[^}]*repeat\(4, 32px\)/s);

    const primaryStart = panel.indexOf('const mindMapPrimaryActionIds');
    const primaryEnd = panel.indexOf('const mindMapFilterControlIds', primaryStart);
    const primaryBlock = panel.slice(primaryStart, primaryEnd);
    assert.doesNotMatch(primaryBlock, /'pisi-map-operational-reset'/);

    const layoutStart = panel.indexOf('function ensureMindMapLayoutRow');
    const layoutEnd = panel.indexOf('function enhanceMindMapToolbar', layoutStart);
    const layoutBlock = panel.slice(layoutStart, layoutEnd);
    assert.match(layoutBlock, /'pisi-map-operational-reset'/);
    assert.ok(layoutBlock.indexOf("'pisi-map-operational-reset'") > layoutBlock.indexOf("'pisi-map-operational-delete-layout'"));

    const availableWidth = 280 - 16 - 8;
    const requiredWidth = 7 * 30 + 6 * 2;
    assert.ok(requiredWidth <= availableWidth);
});
