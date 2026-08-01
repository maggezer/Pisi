'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const includeExt = new Set(['.html', '.js', '.mjs']);
const includeRoots = ['index.html', 'main.js', 'preload.js', 'main', 'renderer'];
const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'coverage']);

function walk(target, files = []) {
    const absolute = path.join(root, target);
    if (!fs.existsSync(absolute)) return files;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
        if (includeExt.has(path.extname(absolute))) files.push(absolute);
        return files;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
        walk(path.join(target, entry.name), files);
    }
    return files;
}

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

function looksUserFacing(value) {
    const text = String(value || '').replace(/\\n/g, ' ').trim();
    if (!text || text.length < 2 || text.length > 240) return false;
    if (/^(?:[.#\[\]{}()<>:=+*\\/|!?&;%$@^`~-]+|[a-zA-Z0-9_.\-/]+)$/.test(text)) return false;
    if (/^(?:data-|aria-|pisi-|node-|map-|custom-|right-|center-|assets\/|renderer\/|styles\/)/i.test(text)) return false;
    if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(text)) return false;
    if (/^#[0-9a-f]{3,8}$/i.test(text)) return false;
    if (/^[0-9.,:%x×+\- ]+$/.test(text)) return false;
    return /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text) && (/[ÇĞİÖŞÜçğıöşü]/.test(text) || /\s/.test(text) || /^[A-Z][a-z]/.test(text));
}

const candidates = [];
for (const file of includeRoots.flatMap((entry) => walk(entry))) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const source = fs.readFileSync(file, 'utf8');
    const seen = new Set();
    const add = (value, index, kind) => {
        const clean = String(value || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!looksUserFacing(clean)) return;
        const key = `${lineOf(source, index)}\0${clean}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ file: relative, line: lineOf(source, index), kind, value: clean });
    };

    if (relative.endsWith('.html')) {
        const attrRe = /\b(title|aria-label|placeholder|alt)="([^"]+)"/g;
        for (const match of source.matchAll(attrRe)) add(match[2], match.index, `html:${match[1]}`);
        const textRe = />([^<>]+)</g;
        for (const match of source.matchAll(textRe)) {
            const value = match[1].replace(/<!--.*?-->/gs, '').trim();
            add(value, match.index, 'html:text');
        }
    }

    const stringRe = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    for (const match of source.matchAll(stringRe)) {
        if (match[1] === '`' && /\$\{/.test(match[2])) {
            add(match[2].replace(/\$\{[^}]+\}/g, '{value}'), match.index, 'js:template');
        } else {
            add(match[2], match.index, 'js:string');
        }
    }
}

candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.value.localeCompare(b.value));
fs.writeFileSync(path.join(root, 'i18n-audit.json'), JSON.stringify({ count: candidates.length, candidates }, null, 2) + '\n');
console.log(`i18n audit: ${candidates.length} candidates`);
