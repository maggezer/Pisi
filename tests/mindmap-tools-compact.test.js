'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const panel = read('renderer/map/pisi-map-right-panel.mjs');
const css = read('renderer/map/pisi-map-right-panel.css');
const icons = read('assets/map-tools.svg');

test('Mind Map search stays first and filter criteria move behind one filter disclosure', () => {
    assert.match(panel, /filters: 'Filtreler'/);
    assert.match(panel, /pisi-mindmap-filter-button/);
    assert.match(panel, /pisi-mindmap-filter-menu/);
    assert.match(panel, /'pisi-map-operational-scope'/);
    assert.match(panel, /'pisi-map-operational-relation'/);
    assert.match(panel, /'pisi-map-operational-depth'/);
    assert.match(panel, /'pisi-map-scope-controls'/);
    assert.match(panel, /const ordered = \[query, actions, menu, layoutRow, summary\]/);
    assert.match(panel, /aria-expanded/);
});

test('Mind Map text action buttons are decorated as icon-only controls', () => {
    for (const id of [
        'pisi-map-operational-focus',
        'pisi-map-operational-next',
        'pisi-map-operational-linked',
        'pisi-map-operational-deps',
        'pisi-map-operational-labels',
        'pisi-map-operational-work',
        'pisi-map-operational-save-layout',
        'pisi-map-operational-restore',
        'pisi-map-operational-delete-layout',
        'pisi-map-operational-reset'
    ]) {
        assert.match(panel, new RegExp(id));
    }
    assert.match(panel, /classList\.add\('pisi-mindmap-icon-button'\)/);
    assert.match(panel, /dataset\.pisiToolIcon = icon/);
    assert.match(css, /\.pisi-mindmap-icon-button\s*\{/);
    assert.match(css, /font-size:\s*0/);
    assert.match(css, /assets\/map-tools\.svg/);
});

test('Mind Map filter menu is a compact inline dropdown and icon sprite ships with it', () => {
    assert.match(css, /\.pisi-mindmap-filter-menu\s*\{/);
    assert.match(css, /\.pisi-mindmap-filter-menu\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(icons, /viewBox="0 0 300 20"/);
    assert.match(icons, /translate\(280 0\)/);
});
