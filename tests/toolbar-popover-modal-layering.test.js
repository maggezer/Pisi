'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const interactionCss = fs.readFileSync(path.join(root, 'styles/92-interaction-fixes.css'), 'utf8');
const popoverSource = fs.readFileSync(path.join(root, 'renderer/editor/pisi-editor-toolbar-popovers.mjs'), 'utf8');

function readZIndex(selectorPattern) {
    const block = interactionCss.match(selectorPattern)?.[0] || '';
    const value = block.match(/z-index:\s*(\d+)/u)?.[1];
    return value ? Number(value) : null;
}

test('toolbar popovers are portalled to body', () => {
    assert.match(popoverSource, /document\.body\.appendChild\(popover\)/u);
});

test('toolbar popovers render above the node modal', () => {
    const modalZ = readZIndex(/html body #node-modal-overlay\s*\{[^}]*\}/u);
    const popoverZ = readZIndex(/html body > \.pisi-office-popover\s*\{[^}]*\}/u);

    assert.equal(modalZ, 30000);
    assert.equal(popoverZ, 32000);
    assert.ok(popoverZ > modalZ);
});
