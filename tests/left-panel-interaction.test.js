'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('map yanındaki yeni node aksiyonu hover sırasında koyu çerçeve üretmez', () => {
    const treeCss = read('styles/10-tree-and-map.css');

    assert.match(
        treeCss,
        /\.tree-inline-action-btn:hover\s*\{[\s\S]*?background: transparent;[\s\S]*?border-color: transparent;[\s\S]*?\}/
    );
    assert.match(
        treeCss,
        /\.tree-inline-action-btn\s*\{[\s\S]*?border: 1px solid transparent;[\s\S]*?background-color: transparent;[\s\S]*?box-shadow: none;[\s\S]*?\}/
    );
    assert.match(treeCss, /\.tree-inline-action-btn:focus-visible/);
});

test('sol panel normal ok imlecini korur, yalnız metin alanları text imlecidir', () => {
    const style = read('style.css');
    const iconsCss = read('styles/93-node-action-icons.css');

    assert.ok(
        style.indexOf('styles/93-node-action-icons.css') >
        style.indexOf('styles/60-customization.css')
    );
    assert.match(
        iconsCss,
        /#left-panel,\s*#left-panel \*\s*\{\s*cursor: default;/
    );
    assert.match(
        iconsCss,
        /#left-panel input,[\s\S]*?\[contenteditable="true"\][\s\S]*?cursor: text;/
    );
});
