'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('badge picker preferences overflowundan body portalına çıkarılır', () => {
    const source = read('renderer/map/pisi-map-property-badge-portal.mjs');

    assert.match(source, /document\.body\.appendChild\(picker\)/);
    assert.match(source, /getBoundingClientRect\(\)/);
    assert.match(source, /window\.innerWidth/);
    assert.match(source, /window\.innerHeight/);
    assert.match(source, /positionPisiBadgePickerPortal/);
    assert.match(source, /document\.addEventListener\('scroll'/);
    assert.match(source, /window\.addEventListener\('resize'/);
});

test('badge picker portalı üst katmanda fixed konumlanır', () => {
    const css = read('renderer/map/pisi-map-property-badge-portal.css');

    assert.match(css, /\.pisi-badge-picker-portal\s*\{/);
    assert.match(css, /position:\s*fixed/);
    assert.match(css, /z-index:\s*12050/);
    assert.match(css, /max-width:\s*calc\(100vw - 16px\)/);
    assert.match(css, /max-height:\s*min\(320px, calc\(100vh - 16px\)\)/);
});

test('portal badge sisteminden sonra bootstrap edilir', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const badgeIndex = bootstrap.indexOf('./map/pisi-map-property-badges.mjs');
    const portalIndex = bootstrap.indexOf('./map/pisi-map-property-badge-portal.mjs');

    assert.ok(badgeIndex >= 0);
    assert.ok(portalIndex > badgeIndex);
});
