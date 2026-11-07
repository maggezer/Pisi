'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const focusMenu = read('renderer/map/pisi-map-focus-menu.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const css = read('styles/105-feature-polish.css');

test('standalone hop control is retired at runtime and Focus neighbors owns the degree menu', () => {
    assert.match(bootstrap, /\.\/map\/pisi-map-focus-menu\.mjs/);
    assert.match(focusMenu, /getElementById\('pisi-map-operational-depth'\)\?\.remove\(\)/);
    assert.match(focusMenu, /data-pisi-focus-degree/);
    assert.match(focusMenu, /\['1', 'first'\]/);
    assert.match(focusMenu, /\['2', 'second'\]/);
    assert.match(focusMenu, /\['3', 'third'\]/);
    assert.match(focusMenu, /\['all', 'all'\]/);
    assert.match(focusMenu, /aria-haspopup/);
    assert.match(focusMenu, /aria-expanded/);
});

test('first through third degree use operational neighbor focus while All uses the full connected component', () => {
    assert.match(focusMenu, /state\.scope\.mode = 'neighbors'/);
    assert.match(focusMenu, /state\.scope\.focusRootNodeId = rootNodeId/);
    assert.match(focusMenu, /Math\.min\(3, Math\.max\(1, Number\(degree\) \|\| 1\)\)/);
    assert.match(focusMenu, /degree === 'all'/);
    assert.match(focusMenu, /state\.scope\.mode = 'manual'/);
    assert.match(focusMenu, /state\.scope\.includedNodeIds = collectConnectedNodeIds\(rootNodeId\)/);
    assert.match(focusMenu, /const visited = new Set\(\[root\]\)/);
    assert.match(focusMenu, /ensure\(sourceId\)\.add\(targetId\)/);
    assert.match(focusMenu, /ensure\(targetId\)\.add\(sourceId\)/);
});

test('Focus degree state is rendered and persisted through the existing operational map authority', () => {
    assert.match(focusMenu, /schedulePisiOperationalRender/);
    assert.match(focusMenu, /window\.pisiProject\.saveMapCamera/);
    assert.match(focusMenu, /operationalPayload:\s*\{/);
    assert.match(focusMenu, /scope:\s*state\.scope/);
    assert.match(focusMenu, /display:\s*state\.display/);
});

test('Focus degree dropdown has dedicated dark and light theme styling', () => {
    assert.match(css, /\.pisi-map-focus-degree-menu\s*\{/);
    assert.match(css, /\.pisi-map-focus-degree-menu\[hidden\]/);
    assert.match(css, /html\[data-pisi-theme=["\']light["\']\] body \.pisi-map-focus-degree-menu/);
});
