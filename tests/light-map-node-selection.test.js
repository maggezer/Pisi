'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssSection } = require('./source-bundle');

const root = path.resolve(__dirname, '..');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const selectionSource = readCssSection('styles/92-compatibility.css', '102-light-map-node-selection.css');

test('light theme selected map node keeps the orange selection border', () => {
    assert.match(selectionSource, /html\[data-pisi-theme=["\']light["\']\]\s+body\s+\.map-node-box\.selected/);
    assert.match(selectionSource, /border-color:\s*var\(--pisi-theme-accent,\s*#f39c12\)/);
    assert.match(selectionSource, /0\s+0\s+0\s+2px\s+rgb\(243\s+156\s+18\s*\/\s*25%\)/);
});

test('external rectangular node selection frame is no longer loaded', () => {
    assert.doesNotMatch(styleSource, /102-map-node-selection-rectangle\.css/);
    assert.doesNotMatch(selectionSource, /::after/);
    assert.doesNotMatch(selectionSource, /inset:\s*-6px/);
});
