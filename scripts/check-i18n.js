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
const seenErrors = new Set();

function addError(message) {
    if (seenErrors.has(message)) return;
    seenErrors.add(message);
    errors.push(message);
}

if (turkish.language !== 'tr') addError('Turkish locale language must be tr.');
if (english.language !== 'eng') addError('English locale language must be eng.');

const trKeys = Object.keys(trStrings).sort();
const enKeys = Object.keys(enStrings).sort();
if (JSON.stringify(trKeys) !== JSON.stringify(enKeys)) {
    const missingTr = enKeys.filter((key) => !Object.hasOwn(trStrings, key));
    const missingEn = trKeys.filter((key) => !Object.hasOwn(enStrings, key));
    addError('Locale key mismatch. Missing TR: ' + missingTr.join(' | ') + '; missing ENG: ' + missingEn.join(' | '));
}
if (trKeys.length < 350) addError('Locale catalog is unexpectedly small: ' + trKeys.length);

for (const key of trKeys) {
    if (typeof trStrings[key] !== 'string' || !trStrings[key].trim()) {
        addError('Empty Turkish translation: ' + key);
    }
    if (typeof enStrings[key] !== 'string' || !enStrings[key].trim()) {
        addError('Empty English translation: ' + key);
    }
    if (/[ÇĞİÖŞÜçğıöşü]/.test(key) && enStrings[key] === key) {
        addError('Untranslated English value: ' + key);
    }
}

const turkishLeakPattern = /\b(?:görev|kaydedilemedi|bulunamadı|oluştur(?:ulamadı)?|seç(?:ildi)?|sil(?:insin|inemedi)?|kapat(?:ılamadı)?|değil|dosya|proje|klasör|bağlantı|özellik|ayar(?:ları)?|görünüm|tarih|renk|başlık|metin|işlem|hata|için|üzerine|yeniden|taşınsın|açılamadı|okunamadı|değiştirilemedi)\b/iu;
for (const key of enKeys) {
    const value = enStrings[key];
    if (typeof value !== 'string') continue;
    if (/[ÇĞİÖŞÜçğıöşü]/u.test(value) || turkishLeakPattern.test(value)) {
        addError(`Turkish text leaked into English locale: ${key} => ${value}`);
    }
}

function requireKey(value, location) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (/^(?:PISI|Pisi|html|×|＋|−|[🗺️📄📁⚠️✓✕]+)$/.test(clean)) return;
    if (/^[0-9.,:%x×+\- ]+$/.test(clean)) return;
    if (/^#[A-Z]+!$/.test(clean)) return;
    if (/^\\u[0-9a-f]+$/i.test(clean)) return;
    if (/^\$\{[^}]+\}$/.test(clean)) return;
    if (/^(?:https?:|data:|assets\/|renderer\/|styles\/)/i.test(clean)) return;
    if (/^[A-Za-z0-9_.-]+\.(?:m?js|css|json|md|html|svg|png|ico)$/i.test(clean)) return;
    if (!Object.hasOwn(trStrings, clean)) {
        addError('Missing locale key at ' + location + ': ' + clean);
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

function walkSourceFiles(relativeDir) {
    const dir = path.join(root, relativeDir);
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        const relative = path.join(relativeDir, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) files.push(...walkSourceFiles(relative));
        else if (/\.(?:m?js)$/i.test(entry.name)) files.push(relative);
    }
    return files;
}

const rendererUiFiles = walkSourceFiles('renderer');
const uiPatterns = [
    { re: /(?:\.title|\.placeholder|\.ariaLabel|textContent)\s*=\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, name: 'property text' },
    { re: /(?:\.title|\.placeholder|\.ariaLabel|textContent)\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, name: 'property text' },
    { re: /setAttribute\(\s*'(?:title|aria-label|placeholder|alt)'\s*,\s*'([^']+)'/g, name: 'attribute text' },
    { re: /setAttribute\(\s*"(?:title|aria-label|placeholder|alt)"\s*,\s*"([^"]+)"/g, name: 'attribute text' },
    { re: /(?:window\.)?(?:alert|confirm|prompt)\(\s*'([^']+)'/g, name: 'dialog text' },
    { re: /(?:window\.)?(?:alert|confirm|prompt)\(\s*"([^"]+)"/g, name: 'dialog text' },
    { re: /\blabel\s*:\s*'([^']+)'/g, name: 'label' },
    { re: /\blabel\s*:\s*"([^"]+)"/g, name: 'label' },
    { re: /\b(?:pisi[A-Za-z0-9_]*Translate|translatePisiUiText)\(\s*'([^']+)'/g, name: 'translation call' },
    { re: /\b(?:pisi[A-Za-z0-9_]*Translate|translatePisiUiText)\(\s*"([^"]+)"/g, name: 'translation call' },
    { re: /window\.pisiT\?\.\(\s*'([^']+)'/g, name: 'pisiT call' },
    { re: /window\.pisiT\?\.\(\s*"([^"]+)"/g, name: 'pisiT call' },
    { re: /\b(?:makePisi[A-Za-z0-9_]*Button|makePisi[A-Za-z0-9_]*Select)\(\s*'([^']+)'/g, name: 'UI factory' },
    { re: /\b(?:makePisi[A-Za-z0-9_]*Button|makePisi[A-Za-z0-9_]*Select)\(\s*"([^"]+)"/g, name: 'UI factory' }
];

for (const file of rendererUiFiles) {
    const source = read(file);
    for (const { re, name } of uiPatterns) {
        for (const match of source.matchAll(re)) {
            const value = match[1]
                .replace(/\\n/g, ' ')
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"');
            requireKey(value, `${file} ${name}`);
        }
    }
}

for (const file of walkSourceFiles('main')) {
    const source = read(file);
    for (const pattern of [
        /translatePisiMain\(\s*'([^']+)'/g,
        /translatePisiMain\(\s*"([^"]+)"/g
    ]) {
        for (const match of source.matchAll(pattern)) {
            requireKey(match[1], file + ' translatePisiMain');
        }
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
    if (!preload.includes(marker)) addError('Missing preload i18n marker: ' + marker);
}

const runtime = read('main/runtime.js');
for (const marker of ["ipcMain.handle('app:get-language'", "ipcMain.handle('app:set-language'"]) {
    if (!runtime.includes(marker)) addError('Missing main language IPC: ' + marker);
}
if (!read('main.js').includes('require("./main/functions/i18n")')) {
    addError('Main i18n module is not bootstrapped.');
}
if (!read('renderer/bootstrap.mjs').startsWith('import "./core/i18n.mjs";')) {
    addError('Renderer i18n module must load before other renderer modules.');
}

if (errors.length) {
    console.error(`Pisi full i18n audit found ${errors.length} issue(s):`);
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('Pisi i18n catalogs, full renderer UI coverage and language plumbing are valid (' + trKeys.length + ' keys across ' + rendererUiFiles.length + ' renderer modules).');
