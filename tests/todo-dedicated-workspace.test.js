'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssSection } = require('./source-bundle');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('To-do çalışma alanı koyu ve açık tema paletlerini kendi kapsamında uygular', () => {
    const css = readCssSection('styles/50-productivity.css', '56-todo-workspace.css');

    assert.match(css, /#workspace\.pisi-todo-workspace-active\s*\{[\s\S]*--pisi-todo-bg: #181a1f/);
    assert.match(css, /html\[data-pisi-theme=["\']light["\']\] #workspace\.pisi-todo-workspace-active\s*\{[\s\S]*--pisi-todo-bg: #eceff3/);
    assert.match(css, /--panel-bg: var\(--pisi-todo-card\)/);
    assert.match(css, /--pisi-theme-surface: var\(--pisi-todo-card\)/);
    assert.match(css, /color-scheme: light/);
    assert.doesNotMatch(css, /background(?:-color)?: #1e1e1e/);
    assert.doesNotMatch(css, /background(?:-color)?: #252526/);
});

test('To-do görünümleri iki temada okunabilir yüzey ve odak durumları sunar', () => {
    const css = readCssSection('styles/50-productivity.css', '56-todo-workspace.css');

    assert.match(css, /--pisi-todo-text: #f2f4f7/);
    assert.match(css, /--pisi-todo-muted: #b8c0cb/);
    assert.match(css, /--pisi-todo-text: #20252c/);
    assert.match(css, /--pisi-todo-muted: #5f6874/);
    assert.match(css, /\.pisi-todo-workspace :is\(button, select\):focus-visible/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-kanban-column > header/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-kanban-card/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-calendar-day\.today/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-stat-card strong/);
});
