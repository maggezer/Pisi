'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Mind Map toolbar uses an unlayered seven-slot row after the panel stylesheet', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const css = read('renderer/map/pisi-map-toolbar-layout-fix.css');

    const panelImport = bootstrap.indexOf('./map/pisi-map-right-panel.mjs');
    const fixImport = bootstrap.indexOf('./map/pisi-map-toolbar-layout-fix.mjs');
    assert.ok(panelImport >= 0);
    assert.ok(fixImport > panelImport);

    assert.match(css, /grid-template-columns:\s*repeat\(7, 30px\)/);
    assert.match(css, /justify-content:\s*space-between/);
    assert.match(css, /> \.pisi-mindmap-icon-button\s*\{[^}]*width:\s*30px;/s);
});

test('Reset occupies its own second-row far-right slot', () => {
    const css = read('renderer/map/pisi-map-toolbar-layout-fix.css');

    assert.match(css, /pisi-mindmap-layout-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) repeat\(3, 32px\);[^}]*grid-template-rows:\s*32px 32px;/s);
    assert.match(css, /#pisi-map-operational-reset\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*2;[^}]*justify-self:\s*end;/s);
});
