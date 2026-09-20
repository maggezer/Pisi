'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('node modal open button is removed and open task count stays inside the card', () => {
    const render = read('renderer/map/pisi-map-operational-render.mjs');
    const css = read('styles/100-map-task-count-badge.css');

    assert.match(render, /box\.querySelector\('\.map-node-open'\)\?\.remove\(\)/);
    assert.match(render, /function makePisiTaskCountBadge\(openCount\)/);
    assert.match(render, /badge\.className = 'pisi-map-task-count-badge'/);
    assert.match(render, /badge\.textContent = String\(openCount\)/);
    assert.match(render, /if \(openCount > 0\)/);
    assert.doesNotMatch(render, /`\$\{openCount\} open`\s*,\s*'ready'/);

    assert.match(css, /\.map-node-box > \.map-node-open\s*\{[\s\S]*?display:\s*none/);
    assert.match(css, /\.pisi-map-task-count-badge\s*\{/);
    assert.match(css, /top:\s*5px/);
    assert.match(css, /right:\s*7px/);
    assert.match(css, /box-shadow:\s*none/);
    assert.match(css, /pointer-events:\s*none/);
});

test('legacy mission task badge no longer appears on map node boxes', () => {
    const css = read('styles/100-map-task-count-badge.css');

    assert.match(
        css,
        /\.map-node-box\[data-node-path\] > \.pisi-mission-node-badge\s*\{[\s\S]*?display:\s*none/
    );
});

test('double click modal opening remains available after removing the corner button', () => {
    const workspace = read('renderer/map/pisi-map-workspace.mjs');
    const previewDoubleClick = /previewEl\?\.addEventListener\('dblclick',[\s\S]{0,260}?openNodeModalFromBox\(box\)/;

    assert.match(workspace, previewDoubleClick);
});

test('task count badge stylesheet is loaded after existing map styles', () => {
    const style = read('style.css');
    assert.match(style, /styles\/100-map-task-count-badge\.css/);
});
