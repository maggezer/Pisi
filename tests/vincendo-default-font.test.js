'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Vincendo is the application, editor, toolbar and map-node default font', () => {
    const css = read('styles/105-bundled-vincendo.css');
    const customization = read('renderer/shell/pisi-customizations.mjs');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');

    assert.match(css, /--pisi-app-font-family:\s*"Vincendo"/);
    assert.match(css, /html,\s*\nbody\s*\{[\s\S]*font-family:\s*var\(--pisi-app-font-family\)/);
    assert.match(css, /#center-node-editor-content,[\s\S]*#node-modal-content,[\s\S]*\.pisi-rich-editor[\s\S]*font-family:\s*var\(--pisi-app-font-family\)/);
    assert.match(customization, /PISI_MAP_NODE_FONT_OPTIONS = \[\s*\n\s*\['"Vincendo", "Segoe UI", Tahoma, sans-serif', 'Vincendo'\]/);
    assert.match(customization, /mapNodeFontFamily:\s*PISI_MAP_NODE_FONT_OPTIONS\[0\]\[0\]/);
    assert.match(customization, /parsed\.mapNodeFontFamily === PISI_LEGACY_MAP_NODE_DEFAULT_FONT/);
    assert.match(toolbar, /<option value="Vincendo" selected>Vincendo<\/option>/);
});
