'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const parseLocale = (file) => JSON.parse(read(file));

const turkish = parseLocale('locales/lang-tr.json');
const english = parseLocale('locales/lang-eng.json');
const trStrings = turkish.strings || {};
const enStrings = english.strings || {};
const errors = [];

if (turkish.language !== 'tr') errors.push('Turkish locale language must be tr.');
if (english.language !== 'eng') errors.push('English locale language must be eng.');

const trKeys = Object.keys(trStrings).sort();
const enKeys = Object.keys(enStrings).sort();
if (JSON.stringify(trKeys) !== JSON.stringify(enKeys)) {
    const missingTr = enKeys.filter((key) => !Object.hasOwn(trStrings, key));
    const missingEn = trKeys.filter((key) => !Object.hasOwn(enStrings, key));
    errors.push('Locale key mismatch. Missing TR: ' + missingTr.join(' | ') + '; missing ENG: ' + missingEn.join(' | '));
}
if (trKeys.length < 350) errors.push('Locale catalog is unexpectedly small: ' + trKeys.length);

for (const key of trKeys) {
    if (typeof trStrings[key] !== 'string' || !trStrings[key].trim()) {
        errors.push('Empty Turkish translation: ' + key);
    }
    if (typeof enStrings[key] !== 'string' || !enStrings[key].trim()) {
        errors.push('Empty English translation: ' + key);
    }
    if (/[ÇĞİÖŞÜçğıöşü]/.test(key) && enStrings[key] === key) {
        errors.push('Untranslated English value: ' + key);
    }
}

function requireKey(value, location) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (/^(?:PISI|Pisi|html|×|＋|−|[🗺️📄📁⚠️]+)$/.test(clean)) return;
    if (/^[0-9.,:%x×+\- ]+$/.test(clean)) return;
    if (/^#[A-Z]+!$/.test(clean)) return;
    if (/^\\u[0-9a-f]+$/i.test(clean)) return;
    if (/^\$\{[^}]+\}$/.test(clean)) return;
    if (!Object.hasOwn(trStrings, clean)) {
        errors.push('Missing locale key at ' + location + ': ' + clean);
    }
}

const html = read('index.html')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, '');
for (const match of html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) {
    requireKey(match[1], 'index.html attribute');
}
for (const match of html.matchAll(/>([^<>]+)</g)) {
    requireKey(match[1], 'index.html text');
}

const rendererUiFiles = [
    'renderer/editor/pisi-editor-unified-toolbar.mjs',
    'renderer/editor/pisi-editor-paint.mjs',
    'renderer/editor/pisi-editor-toolbar-popovers.mjs',
    'renderer/editor/pisi-editor-toolbar-menus.mjs',
    'renderer/tags/pisi-tag-editor.mjs',
    'renderer/tags/pisi-tag-panels.mjs',
    'renderer/tree/pisi-tree-view.mjs',
    'renderer/map/pisi-map-workspace.mjs'
];
const uiPatterns = [
    /\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g,
    /(?:\.title|\.placeholder|textContent)\s*=\s*'([^']+)'/g,
    /(?:\.title|\.placeholder|textContent)\s*=\s*"([^"]+)"/g,
    /(?:window\.)?(?:alert|confirm|prompt)\(\s*'([^']+)'/g,
    /setPisiSheetToolbarStatus\([^,]+,\s*'([^']+)'/g
];
for (const file of rendererUiFiles) {
    const source = read(file);
    for (const pattern of uiPatterns) {
        for (const match of source.matchAll(pattern)) requireKey(match[1], file);
    }
}

for (const file of [
    'main/runtime.js',
    'main/functions/electron-ipc.js',
    'main/functions/document-store.js',
    'main/functions/map-store.js'
]) {
    const source = read(file);
    for (const match of source.matchAll(/translatePisiMain\(\s*'([^']+)'/g)) {
        requireKey(match[1], file + ' translatePisiMain');
    }
}

const requiredKeys = [
    'Dil',
    'Türkçe',
    'English',
    'Dil değişikliği anında uygulanır.',
    'İngilizceye geç',
    'Türkçeye geç',
    'Temel yazı araçları',
    'İki yana yasla',
    'PISI proje klasörü seç',
    'PISI kapatılamadı',
    'Yeni Map',
    'Yeni Node',
    'Yeni Klasör',
    'Dosya oluşturulamadı.'
];
for (const key of requiredKeys) requireKey(key, 'required key');

const preload = read('preload.js');
for (const marker of [
    "ipcRenderer.invoke('app:get-language')",
    "ipcRenderer.invoke('app:set-language'",
    "contextBridge.exposeInMainWorld('pisiI18n'",
    "characterData: true",
    "attributes: true",
    "pisi-language-select"
]) {
    if (!preload.includes(marker)) errors.push('Missing preload i18n marker: ' + marker);
}

const runtime = read('main/runtime.js');
for (const marker of ["ipcMain.handle('app:get-language'", "ipcMain.handle('app:set-language'"]) {
    if (!runtime.includes(marker)) errors.push('Missing main language IPC: ' + marker);
}
if (!read('main.js').includes('require("./main/functions/i18n")')) {
    errors.push('Main i18n module is not bootstrapped.');
}
if (!read('renderer/bootstrap.mjs').startsWith('import "./core/i18n.mjs";')) {
    errors.push('Renderer i18n module must load before other renderer modules.');
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('Pisi i18n catalogs, UI coverage and language plumbing are valid (' + trKeys.length + ' keys).');
