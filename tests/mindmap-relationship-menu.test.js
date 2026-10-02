'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const moduleSource = read('renderer/map/pisi-map-relationship-menu.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const style = read('style.css');
const css = read('styles/113-mindmap-relationship-menu.css');

test('All relationships select is retired from visible Mind Map filters', () => {
    assert.match(css, /#pisi-map-operational-relation\s*\{[^}]*display:\s*none\s*;/s);
    assert.doesNotMatch(css, /!important/);
    assert.match(moduleSource, /select\.hidden\s*=\s*true/);
});

test('relationship filter is exposed as an icon menu beside Focus neighbors', () => {
    assert.match(moduleSource, /pisi-map-operational-relationship-button/);
    assert.match(moduleSource, /dataset\.pisiToolIcon\s*=\s*'relationship'/);
    assert.match(moduleSource, /focus\.insertAdjacentElement\('afterend', button\)/);
    assert.match(css, /data-pisi-tool-icon=["\']relationship["\']/);
    assert.match(css, /21\.428571%/);
});

test('relationship menu preserves all existing relationship filter choices', () => {
    for (const value of ['all', 'down-hub', 'stream', 'co-level']) {
        assert.match(moduleSource, new RegExp(`\\['${value}'`));
    }
    assert.match(moduleSource, /select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});

test('relationship menu module and stylesheet are loaded', () => {
    assert.match(bootstrap, /\.\/map\/pisi-map-relationship-menu\.mjs/);
    assert.match(style, /113-mindmap-relationship-menu\.css/);
});
