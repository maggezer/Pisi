'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mind Map task-status scope control is retired from the UI', () => {
    const retirement = read('renderer/map/pisi-map-task-scope-retirement.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');
    const css = read('styles/112-mindmap-task-scope-retired.css');

    assert.match(retirement, /pisi-map-operational-scope/);
    assert.match(retirement, /control\.remove\(\)/);
    assert.match(retirement, /'active'/);
    assert.match(retirement, /'blocked'/);
    assert.match(retirement, /'overdue'/);
    assert.match(retirement, /'missing-next-action'/);
    assert.match(retirement, /current\.scope\.mode = 'all'/);
    assert.match(retirement, /pisi-map-operational-restore/);
    assert.match(retirement, /pisi-map-apply-scope/);
    assert.match(bootstrap, /pisi-map-task-scope-retirement\.mjs/);
    assert.match(css, /#pisi-map-operational-scope\s*\{[^}]*display:\s*none/s);
});
