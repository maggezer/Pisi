'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mind Map filters expose filters, saved filters and one freeze/live toggle', () => {
    const moduleSource = read('renderer/map/pisi-map-filter-simplification.mjs');
    const css = read('renderer/map/pisi-map-filter-simplification.css');
    const bootstrap = read('renderer/bootstrap.mjs');

    assert.match(bootstrap, /pisi-map-filter-simplification\.mjs/);
    assert.match(moduleSource, /pisi-map-scope-strategy'\)\?\.remove\(\)/);
    assert.match(moduleSource, /activeFilters:\s*'Active Filters'/);
    assert.match(moduleSource, /savedFilters:\s*'Saved Filters'/);
    assert.match(moduleSource, /freeze:\s*'Freeze Results'/);
    assert.match(moduleSource, /returnLive:\s*'Return to Live'/);
    assert.match(moduleSource, /strategy:\s*'live'/);
    assert.match(moduleSource, /capturePisiScopeSnapshot/);

    assert.match(css, /#pisi-map-scope-property[\s\S]*grid-row:\s*1/);
    assert.match(css, /#pisi-map-scope-filter-chips[\s\S]*grid-row:\s*4/);
    assert.match(css, /#pisi-map-saved-scope[\s\S]*grid-row:\s*6/);
    assert.match(css, /#pisi-map-freeze-scope[\s\S]*grid-row:\s*8/);
});

test('saved filter presets are normalized back to live strategy', () => {
    const moduleSource = read('renderer/map/pisi-map-filter-simplification.mjs');

    const saveStart = moduleSource.indexOf('async function savePisiFilterPreset');
    const applyStart = moduleSource.indexOf('async function applyPisiFilterPreset');
    const saveBlock = moduleSource.slice(saveStart, applyStart);
    assert.match(saveBlock, /strategy:\s*'live'/);

    const applyEnd = moduleSource.indexOf('function replaceActionButton', applyStart);
    const applyBlock = moduleSource.slice(applyStart, applyEnd);
    assert.match(applyBlock, /strategy:\s*'live'/);
});
