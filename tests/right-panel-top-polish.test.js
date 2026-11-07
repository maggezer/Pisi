'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Todo top actions keep hover clearance from the right tab strip', () => {
    const css = read('styles/105-feature-polish.css');
    assert.match(css, /#right-tab-missions\.right-tab-page\s*>\s*\.pisi-todo-panel-actions-host\s*\{[^}]*min-height:\s*42px;[^}]*padding-top:\s*4px;/s);
    assert.match(css, /pisi-missions-filter-menu,[\s\S]*pisi-missions-status-filter\s*\{[^}]*top:\s*4px;/s);
});

test('right panel tab strip has no divider against its content', () => {
    const css = read('styles/105-feature-polish.css');

    assert.match(css, /#right-panel\.panel\s*>\s*#right-panel-tabs\s*\{[^}]*border-bottom:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(css, /#right-panel\.panel\s*>\s*#right-panel-content\s*\{[^}]*border-top:\s*0;[^}]*box-shadow:\s*none;/s);
});
