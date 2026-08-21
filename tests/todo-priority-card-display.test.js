const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(
    path.join(root, 'renderer/tags/pisi-todo-priority-card-display.mjs'),
    'utf8'
);
const css = fs.readFileSync(
    path.join(root, 'styles/119-todo-priority-card-display.css'),
    'utf8'
);
const bootstrap = fs.readFileSync(
    path.join(root, 'renderer/bootstrap.mjs'),
    'utf8'
);
const styleIndex = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.match(
    bootstrap,
    /pisi-todo-priority-card-display\.mjs/,
    'Todo priority display cleanup should load from bootstrap'
);
assert.match(
    styleIndex,
    /119-todo-priority-card-display\.css/,
    'Todo priority display stylesheet should be loaded'
);
assert.match(
    css,
    /\.pisi-mission-meta\s*>\s*\.pisi-mission-priority/,
    'legacy Priority: N · Label badge should remain hidden'
);
assert.match(
    css,
    /\.pisi-mission-node/,
    'Map and node location should be hidden from Todo task cards immediately'
);
assert.match(
    css,
    /span:first-child:not\(\.pisi-mission-priority\)/,
    'the leading date metadata should be hidden before runtime cleanup'
);
assert.match(
    moduleSource,
    /querySelectorAll\('\.pisi-mission-node'\)/,
    'Map and node location should also be removed from rendered cards'
);
assert.match(
    moduleSource,
    /const firstMeta = meta\?\.querySelector\(':scope > span:first-child'\)/,
    'card cleanup should identify the leading date metadata'
);
assert.match(
    moduleSource,
    /firstMeta\.remove\(\)/,
    'card date metadata should be removed from the DOM'
);
assert.match(
    moduleSource,
    /querySelectorAll\('\.pisi-mission-priority'\)/,
    'legacy priority badge should also be removed from rendered cards'
);
assert.match(
    moduleSource,
    /\^\(\?:Order\|Sıra\|Priority\|Öncelik\)/,
    'display cleanup should recognize both old Order labels and current Priority labels'
);
assert.match(
    moduleSource,
    /badge\.textContent = parsed\.displayValue/,
    'only the numeric workorder value should remain visible'
);
assert.match(
    moduleSource,
    /status\.after\(badge\)/,
    'priority value should be moved directly to the right of the Todo status select'
);
assert.match(
    moduleSource,
    /\(value - min\) \/ \(max - min\)/,
    'priority color should be normalized from the lowest to highest visible value'
);
assert.match(
    moduleSource,
    /Math\.round\(ratio \* 4\)/,
    'priority color scale should use five red-to-green levels'
);
for (let tone = 0; tone <= 4; tone += 1) {
    assert.match(
        css,
        new RegExp(`\\.pisi-mission-top > \\.pisi-priority-tone-${tone}`),
        `priority tone ${tone} should have a visible style`
    );
}
assert.match(css, /pisi-priority-tone-0[\s\S]*#d94a4a/);
assert.match(css, /pisi-priority-tone-4[\s\S]*#2f9d58/);

console.log('Todo priority card display regression checks passed');
