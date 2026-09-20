'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(
    path.join(__dirname, '..', 'styles', '10-tree-and-map.css'),
    'utf8'
);

test('manual title view constrains saved inline node height to enlarged title height', () => {
    const selector = '#map-canvas[data-node-view="title"] .map-node-box';
    const start = css.indexOf(selector);
    const end = css.indexOf('}', start);
    const rule = css.slice(start, end);

    assert.ok(start >= 0);
    assert.match(rule, /min-height:\s*42px/);
    assert.match(rule, /height:\s*42px/);
    assert.match(rule, /max-height:\s*42px/);
});

test('node title and preview fonts scale existing preferences by one and a half', () => {
    assert.match(css, /font-size:\s*calc\(var\(--pisi-map-node-title-size\) \* 1\.5\)/);
    assert.match(css, /font-size:\s*calc\(var\(--pisi-map-node-text-size\) \* 1\.5\)/);
});

test('manual title view removes preview and node controls', () => {
    assert.match(
        css,
        /data-node-view="title"[^}]*\.map-node-preview[\s\S]*?display:\s*none/
    );
});
