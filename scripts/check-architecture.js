'use strict';

// Keeps module ownership, file-size limits and CSS cascade rules enforceable in CI.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(directory, extension) {
    const result = [];
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...walk(relative, extension));
        else if (entry.name.endsWith(extension)) result.push(relative);
    }
    return result;
}

function scanRootSelectors(css) {
    const selectors = [];
    let cursor = 0;
    let index = 0;
    const skipString = (start, quote) => {
        let i = start + 1;
        while (i < css.length) {
            if (css[i] === '\\') { i += 2; continue; }
            if (css[i] === quote) return i + 1;
            i += 1;
        }
        return i;
    };
    const skipComment = (start) => {
        const end = css.indexOf('*/', start + 2);
        return end === -1 ? css.length : end + 2;
    };
    while (index < css.length) {
        if (css.startsWith('/*', index)) { index = skipComment(index); continue; }
        if (css[index] === '"' || css[index] === "'") { index = skipString(index, css[index]); continue; }
        if (css[index] !== '{') { index += 1; continue; }
        const open = index;
        let depth = 1;
        index += 1;
        while (index < css.length && depth > 0) {
            if (css.startsWith('/*', index)) { index = skipComment(index); continue; }
            if (css[index] === '"' || css[index] === "'") { index = skipString(index, css[index]); continue; }
            if (css[index] === '{') depth += 1;
            if (css[index] === '}') depth -= 1;
            index += 1;
        }
        const prelude = css.slice(cursor, open).replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
        if (prelude && !prelude.startsWith('@')) selectors.push(prelude);
        cursor = index;
    }
    return selectors;
}

const errors = [];
const html = read('index.html');
const moduleScripts = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((match) => match[1]);
if (moduleScripts.length !== 1 || moduleScripts[0] !== 'renderer/bootstrap.mjs') {
    errors.push('Expected one renderer module bootstrap, found: ' + moduleScripts.join(', '));
}
if (/<script[^>]+src="(?:app|renderer\/[^\"]+)\.js"/.test(html)) {
    errors.push('Classic renderer scripts remain in index.html.');
}

for (const oldFile of [
    'app.js', 'renderer/pisi-tree.js', 'renderer/pisi-map-workspace.js',
    'renderer/pisi-tags.js', 'renderer/pisi-calendar.js',
    'renderer/pisi-node-modal.js', 'renderer/pisi-map-connections.js'
]) {
    if (fs.existsSync(path.join(root, oldFile))) errors.push('Legacy renderer file remains: ' + oldFile);
}

const manifests = [
    JSON.parse(read('renderer/module-manifest.json')),
    JSON.parse(read('main/module-manifest.json'))
];
for (const manifest of manifests) {
    const owners = new Map();
    for (const module of manifest) {
        for (const binding of module.bindings) {
            if (owners.has(binding)) {
                errors.push('Duplicate module binding ' + binding + ': ' + owners.get(binding) + ' / ' + module.module);
            }
            owners.set(binding, module.module);
        }
    }
}

for (const file of walk('renderer', '.mjs')) {
    const lines = read(file).split(/\r?\n/).length;
    const limit = file === 'renderer/tags/pisi-todo-third-release.mjs'
        ? 1050
        : 1000;
    if (file !== 'renderer/runtime.mjs' && lines > limit) {
        errors.push('Renderer module too large (' + lines + '): ' + file);
    }
}
for (const file of walk('main/functions', '.js')) {
    const lines = read(file).split(/\r?\n/).length;
    if (lines > 1100) errors.push('Main domain module too large (' + lines + '): ' + file);
}
if (read('main.js').split(/\r?\n/).length > 40) errors.push('main.js is not a thin bootstrap.');

const selectorOwners = new Map();
for (const file of walk('styles', '.css')) {
    const css = read(file);
    if (/!important\b/.test(css)) errors.push('!important remains in ' + file);
    for (const selector of scanRootSelectors(css)) {
        if (selectorOwners.has(selector)) {
            errors.push('Duplicate CSS selector ' + selector + ': ' + selectorOwners.get(selector) + ' / ' + file);
        }
        selectorOwners.set(selector, file);
    }
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('Architecture boundaries, CSS cascade and module sizes are valid.');
