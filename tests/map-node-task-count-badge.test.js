'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The badge itself (open task count, its label) is checked in the real app:
// scripts/electron-tasks-surfaces-e2e.mjs (docs/task-plan.md G5).
test('node modal open button is hidden and the open task count badge sits inside the card', () => {
    const css = read('styles/92-compatibility.css');

    assert.match(css, /\.map-node-box > \.map-node-open\s*\{[\s\S]*?display:\s*none/);
    assert.match(css, /\.pisi-map-task-count-badge\s*\{/);
    assert.match(css, /top:\s*5px/);
    assert.match(css, /right:\s*7px/);
    assert.match(css, /box-shadow:\s*none/);
    assert.match(css, /pointer-events:\s*none/);
});

test('double click modal opening remains available after removing the corner button', () => {
    const workspace = read('renderer/map/pisi-map-workspace.mjs');
    const previewDoubleClick = /previewEl\?\.addEventListener\('dblclick',[\s\S]{0,260}?openNodeModalFromBox\(box\)/;

    assert.match(workspace, previewDoubleClick);
});
