'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const styleSource = fs.readFileSync(
    path.join(root, 'style.css'),
    'utf8'
);
const selectionSource = fs.readFileSync(
    path.join(root, 'styles/102-map-node-selection-rectangle.css'),
    'utf8'
);

test('selected map nodes render an external rectangular selection frame', () => {
    assert.match(selectionSource, /\.map-node-box\.selected::after/);
    assert.match(selectionSource, /inset:\s*-6px/);
    assert.match(selectionSource, /border:\s*1px\s+solid\s+#f39c12/);
    assert.match(selectionSource, /border-radius:\s*2px/);
    assert.match(selectionSource, /pointer-events:\s*none/);
});

test('map node selection rectangle stylesheet is loaded', () => {
    assert.match(
        styleSource,
        /styles\/102-map-node-selection-rectangle\.css/
    );
});
