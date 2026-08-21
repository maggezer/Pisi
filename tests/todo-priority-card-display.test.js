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
    /\.pisi-mission-meta\s*>\s*\.pisi-mission-priority\s*\{[^}]*display:\s*none/s,
    'legacy Priority: N · Label badge should be hidden immediately'
);
assert.match(
    moduleSource,
    /querySelectorAll\('\.pisi-mission-priority'\)/,
    'legacy priority badge should also be removed from rendered cards'
);
assert.match(
    moduleSource,
    /\^\(Order\|Sıra\)/,
    'workorder label conversion should recognize English and Turkish labels'
);
assert.match(
    moduleSource,
    /\? 'Öncelik'\s*:\s*'Priority'/,
    'workorder value should be presented as Priority without changing the value'
);
assert.match(
    moduleSource,
    /match\[2\]/,
    'the existing workorder numeric value should be preserved'
);

console.log('Todo priority card display regression checks passed');
