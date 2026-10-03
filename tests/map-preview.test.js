'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(path.join(root, 'main/functions/map-store.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/10-shell-map-panels.css'), 'utf8');

test('map node önizlemesi non-breaking space değerlerini normal boşluğa çevirir', () => {
    const functionSource = mapSource.match(/function stripPreviewText\(value = ''\) \{[\s\S]*?\n\}/)?.[0];

    assert.ok(functionSource, 'stripPreviewText fonksiyonu bulunamadı.');
    const stripPreviewText = vm.runInNewContext(`(${functionSource})`);

    assert.equal(stripPreviewText('<div>#etiket&nbsp;deneme</div>'), '#etiket deneme');
    assert.equal(stripPreviewText('A&#160;B&#xA0;C\u00a0D'), 'A B C D');
});

test('map node başlığı normal ve düzenleme görünümünde ortalanır', () => {
    const titleRule = css.match(/\.map-node-title \{[\s\S]*?\n\}/)?.[0] || '';
    const inputRule = css.match(/\.map-node-title-input \{[\s\S]*?\n\}/)?.[0] || '';

    assert.match(titleRule, /text-align:\s*center;/);
    assert.match(inputRule, /text-align:\s*center;/);
});
