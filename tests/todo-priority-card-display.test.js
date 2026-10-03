const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'renderer/tags/pisi-todo-priority-card-display.mjs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/105-feature-polish.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'renderer/bootstrap.mjs'), 'utf8');
const styleIndex = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.match(bootstrap, /pisi-todo-priority-card-display\.mjs/, 'Todo priority display cleanup should load from bootstrap');
assert.match(styleIndex, /105-feature-polish\.css/, 'Todo priority display stylesheet should be loaded');
assert.match(css, /\.pisi-mission-meta\s*>\s*\.pisi-mission-priority/, 'legacy Priority: N · Label badge should remain hidden');
assert.match(css, /\.pisi-mission-node/, 'Map and node location should be hidden from Todo task cards immediately');
assert.match(css, /span:first-child:not\(\.pisi-mission-priority\)/, 'the leading date metadata should be hidden before runtime cleanup');
assert.match(moduleSource, /querySelectorAll\('\.pisi-mission-node'\)/, 'Map and node location should also be removed from rendered cards');
assert.match(moduleSource, /const firstMeta = meta\?\.querySelector\(':scope > span:first-child'\)/, 'card cleanup should identify the leading date metadata');
assert.match(moduleSource, /firstMeta\.remove\(\)/, 'card date metadata should be removed from the DOM');
assert.match(moduleSource, /querySelectorAll\('\.pisi-mission-priority'\)/, 'legacy priority badge should also be removed from rendered cards');
assert.match(moduleSource, /\^\(\?:Order\|Sıra\|Priority\|Öncelik\)/, 'display cleanup should recognize both old Order labels and current Priority labels');
assert.match(moduleSource, /badge\.textContent = parsed\.displayValue/, 'only the numeric workorder value should remain visible');
assert.match(moduleSource, /function arrangePisiTodoCardLayout/, 'Todo cards should have a dedicated compact layout pass');
assert.match(moduleSource, /const desired = \[badge, main, check, content\]/, 'top-row DOM order should be priority, task, completion, then controls');
assert.match(moduleSource, /status\.classList\.add\('pisi-mission-status-icon'\)/, 'Todo status select should be converted to icon presentation');
assert.match(moduleSource, /summary\.classList\.add\('pisi-mission-planning-icon'\)/, 'Planning summary should be converted to icon presentation');
assert.match(
    css,
    /grid-template-areas:\s*["\']priority task check["\']\s*["\']controls controls controls["\']/s,
    'Todo card should use priority-task-check on row one and controls on row two'
);
assert.match(
    css,
    /\.pisi-mission-status-icon[\s\S]*background-image:\s*url\(["\']\.\.\/assets\/todo\/status-filter\.svg["\']\)/,
    'Todo dropdown should use the Todo status icon'
);
assert.match(css, /\.pisi-mission-planning-icon::before[\s\S]*workspace\.svg/, 'Planning dropdown should use a planning/calendar icon mask');
assert.match(
    css,
    /\.pisi-mission-compact-card > \.pisi-mission-check-wrap[\s\S]*grid-area:\s*check/,
    'completion checkbox should occupy the far-right top grid area'
);
assert.match(
    css,
    /\.pisi-mission-compact-card > \.pisi-mission-content[\s\S]*justify-content:\s*flex-end/,
    'Todo and Planning controls should be right-aligned on the lower row'
);
assert.match(moduleSource, /\(value - min\) \/ \(max - min\)/, 'priority color should be normalized from the lowest to highest visible value');
assert.match(moduleSource, /Math\.round\(ratio \* 4\)/, 'priority color scale should use five red-to-green levels');
for (let tone = 0; tone <= 4; tone += 1) {
    assert.match(css, new RegExp(`\\.pisi-mission-compact-card > \\.pisi-priority-tone-${tone}`), `priority tone ${tone} should have a visible style`);
}
assert.match(css, /pisi-priority-tone-0[\s\S]*#d94a4a/);
assert.match(css, /pisi-priority-tone-4[\s\S]*#2f9d58/);

console.log('Todo priority card display regression checks passed');
