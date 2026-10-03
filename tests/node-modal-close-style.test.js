'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('node modal close button sits flush in the top-right corner without a frame', () => {
    const css = read('styles/92-compatibility.css');

    assert.match(css, /#node-modal > #node-modal-header\s*\{[\s\S]*?position:\s*relative/);
    assert.match(css, /padding:\s*0 48px 0 14px/);
    assert.match(css, /#node-modal #node-modal-close\s*\{[\s\S]*?position:\s*absolute/);
    assert.match(css, /top:\s*0/);
    assert.match(css, /right:\s*0/);
    assert.match(css, /border:\s*0/);
    assert.match(css, /background:\s*transparent/);
    assert.match(css, /box-shadow:\s*none/);
});

test('node modal close polish follows task-count styling inside the compatibility bundle', () => {
    const style = read('style.css');
    assert.match(style, /styles\/92-compatibility\.css/);
    const css = read('styles/92-compatibility.css');
    const badgeIndex = css.indexOf('/* ===== Source: styles/100-map-task-count-badge.css ===== */');
    const closeIndex = css.indexOf('/* ===== Source: styles/101-node-modal-close.css ===== */');
    assert.ok(badgeIndex >= 0, 'task-count CSS section must exist');
    assert.ok(closeIndex > badgeIndex, 'modal-close polish must follow task-count styling');
});
