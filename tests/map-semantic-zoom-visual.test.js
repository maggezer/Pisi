'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(
    path.join(__dirname, '..', 'styles', '10-tree-and-map.css'),
    'utf8'
);

test('far semantic zoom constrains saved inline node height to title height', () => {
    const selector = '#map-canvas[data-semantic-zoom="far"] .map-node-box';
    const start = css.indexOf(selector);
    const end = css.indexOf('}', start);
    const rule = css.slice(start, end);

    assert.ok(start >= 0);
    assert.match(rule, /min-height:\s*34px/);
    assert.match(rule, /height:\s*34px/);
    assert.match(rule, /max-height:\s*34px/);
});

test('far semantic zoom removes preview and node controls', () => {
    assert.match(
        css,
        /data-semantic-zoom="far"[^}]*\.map-node-preview[\s\S]*?display:\s*none/
    );
});
