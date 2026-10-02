'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Verdana is the application and rich-editor default while Vincendo remains available', () => {
    const css = read('styles/107-verdana-default.css');
    const customization = read('renderer/shell/pisi-customizations.mjs');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');

    assert.match(css, /html,\s*\nbody,[\s\S]*font-family:\s*Verdana, Geneva, Tahoma, sans-serif/);
    assert.match(
        css,
        /#center-node-editor-content,[\s\S]*#node-modal-content,[\s\S]*\.pisi-rich-editor[\s\S]*font-family:\s*Verdana, Geneva, Tahoma, sans-serif/
    );

    assert.match(customization, /\['"Vincendo", "Segoe UI", Tahoma, sans-serif', 'Vincendo'\]/);
    assert.match(customization, /\['Verdana, Geneva, sans-serif', 'Verdana'\]/);
    assert.match(toolbar, /<option value="Vincendo"(?: selected)?>Vincendo<\/option>/);
});
