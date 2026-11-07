'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('right panel exposes enough inner width for seven Mind Map icon actions', () => {
    const css = read('styles/105-feature-polish.css');
    assert.match(css, /#main-layout\s*>\s*#right-panel\s*\{[^}]*padding-left:\s*8px;[^}]*padding-right:\s*8px;/s);
    assert.match(css, /@media\s*\(max-width:\s*1000px\)[\s\S]*grid-template-columns:\s*220px minmax\(260px, 1fr\) 280px;/);

    const rightPanelWidth = 280;
    const horizontalPadding = 16;
    const iconWidth = 32;
    const gap = 6;
    const required = 7 * iconWidth + 6 * gap;
    assert.ok(rightPanelWidth - horizontalPadding >= required);
});
