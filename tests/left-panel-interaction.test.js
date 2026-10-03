'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('map yanındaki yeni node aksiyonu delete map ile aynı buton yapısını kullanır', () => {
    const treeCss = read('styles/10-shell-map-panels.css');
    const iconCss = read('styles/92-compatibility.css');

    assert.match(iconCss, /\.add-node-under-map-btn,\s*\.delete-tree-item-btn\s*\{[\s\S]*?width: 22px;[\s\S]*?height: 22px;[\s\S]*?\}/);
    assert.match(
        treeCss,
        /\.tree-inline-action-btn\s*\{[\s\S]*?border: 1px solid transparent;[\s\S]*?background-color: transparent;[\s\S]*?box-shadow: none;[\s\S]*?\}/
    );
    assert.match(treeCss, /\.tree-inline-action-btn:hover\s*\{[\s\S]*?background-color: transparent;/);
    assert.match(
        iconCss,
        /\.add-node-under-map-btn:hover,\s*\.add-node-under-map-btn:focus-visible\s*\{[\s\S]*?background-image:\s*url\(["\']\.\.\/assets\/icons\/create-node\.svg["\']\);[\s\S]*?background-color: rgba\(243, 156, 18, 0\.16\);[\s\S]*?border-color: #f39c12;[\s\S]*?\}/
    );
});

test('sol panel normal ok imlecini korur, yalnız metin alanları text imlecidir', () => {
    const style = read('style.css');
    const iconsCss = read('styles/92-compatibility.css');

    assert.ok(style.indexOf('styles/92-compatibility.css') > style.indexOf('styles/58-workspaces-platform.css'));
    assert.match(iconsCss, /#left-panel,\s*#left-panel \*\s*\{\s*cursor: default;/);
    assert.match(iconsCss, /#left-panel input,[\s\S]*?\[contenteditable=["\']true["\']\][\s\S]*?cursor: text;/);
});
