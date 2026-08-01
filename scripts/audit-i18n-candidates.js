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

function cleanValue(value) {
    return String(value || '')
        .replace(/\\n/g, ' ')
        .replace(/\$\{[^}]+\}/g, '{value}')
        .replace(/\s+/g, ' ')
        .trim();
}

function looksUserFacing(value) {
    const text = cleanValue(value);
    if (!text || text.length < 2 || text.length > 300) return false;
    if (/^(?:[.#\[\]{}()<>:=+*\\/|!?&;%$@^`~-]+|[a-zA-Z0-9_.\-/]+)$/.test(text)) return false;
    if (/^#[0-9a-f]{3,8}$/i.test(text)) return false;
    if (/^[0-9.,:%x×+\- ]+$/.test(text)) return false;
    if (/^(?:use strict|utf-8|anonymous|success|error|warning|info)$/i.test(text)) return false;
    if (/(?:\\s|\\d|\\w|\.replace\(|\.match\(|function\s|=>|class=|data-[a-z]|<\/?[a-z]|\{\s*[a-z]+:)/i.test(text)) return false;
    return /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text);
}

function isUiContext(context) {
    return /(?:textContent|innerHTML|insertAdjacentHTML|setAttribute\s*\(\s*['"](?:title|aria-label|placeholder|alt)|\.title\s*=|\.placeholder\s*=|alert\s*\(|confirm\s*\(|prompt\s*\(|showMessageBox|showOpenDialog|showSaveDialog|Notification|toast|status|message\s*:|detail\s*:|title\s*:|label\s*:|button|throw\s+new\s+Error|return\s*\{[^}]*error)/i.test(context);
}

const allCandidates = [];
const uiCandidates = [];
const files = [...new Set(includeRoots.flatMap((entry) => walk(entry)))];

function record(target, relative, source, value, index, kind) {
    const clean = cleanValue(value);
    if (!looksUserFacing(clean)) return;
    target.push({ file: relative, line: lineOf(source, index), kind, value: clean });
}

for (const file of files) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const source = fs.readFileSync(file, 'utf8');

    if (relative.endsWith('.html')) {
        const attrRe = /\b(title|aria-label|placeholder|alt)="([^"]+)"/g;
        for (const match of source.matchAll(attrRe)) {
            record(allCandidates, relative, source, match[2], match.index, `html:${match[1]}`);
            record(uiCandidates, relative, source, match[2], match.index, `html:${match[1]}`);
        }
        const textRe = />([^<>]+)</g;
        for (const match of source.matchAll(textRe)) {
            const value = match[1].replace(/<!--.*?-->/gs, '').trim();
            record(allCandidates, relative, source, value, match.index, 'html:text');
            record(uiCandidates, relative, source, value, match.index, 'html:text');
        }
    }

    const stringRe = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    for (const match of source.matchAll(stringRe)) {
        const value = match[2];
        const kind = match[1] === '`' ? 'js:template' : 'js:string';
        record(allCandidates, relative, source, value, match.index, kind);
        const context = source.slice(Math.max(0, match.index - 160), Math.min(source.length, match.index + match[0].length + 160));
        if (/[ÇĞİÖŞÜçğıöşü]/.test(value) || isUiContext(context)) {
            record(uiCandidates, relative, source, value, match.index, kind);
        }
    }
}

function dedupe(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = `${item.file}\0${item.line}\0${item.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.value.localeCompare(b.value));
}

function groupUnique(items) {
    const values = new Map();
    for (const item of items) {
        if (!values.has(item.value)) values.set(item.value, []);
        values.get(item.value).push({ file: item.file, line: item.line, kind: item.kind });
    }
    return [...values.entries()]
        .map(([value, locations]) => ({ value, locations }))
        .sort((a, b) => a.value.localeCompare(b.value, 'tr'));
}

const all = dedupe(allCandidates);
const ui = dedupe(uiCandidates);
const unique = groupUnique(ui);
fs.writeFileSync(path.join(root, 'i18n-audit.json'), JSON.stringify({ count: all.length, candidates: all }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'i18n-audit-summary.json'), JSON.stringify({ count: ui.length, uniqueCount: unique.length, candidates: ui, unique }, null, 2) + '\n');
console.log(`i18n audit: ${all.length} candidates, ${ui.length} UI occurrences, ${unique.length} unique values`);
