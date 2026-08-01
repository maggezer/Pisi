'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

test('Turkish and English catalogs have matching complete keys', () => {
    const tr = readJson('locales/lang-tr.json');
    const eng = readJson('locales/lang-eng.json');
    const trKeys = Object.keys(tr.strings).sort();
    const engKeys = Object.keys(eng.strings).sort();

    assert.equal(tr.language, 'tr');
    assert.equal(eng.language, 'eng');
    assert.deepEqual(engKeys, trKeys);
    assert.ok(trKeys.length >= 350);
    assert.equal(eng.strings['Dil'], 'Language');
    assert.equal(eng.strings['PISI proje klasörü seç'], 'Choose a Pisi project folder');
    assert.equal(eng.strings['İki yana yasla'], 'Justify');
    assert.equal(eng.strings['Yeni Node'], 'New Note');
});

test('language selection is persisted and the live DOM translator watches changes', () => {
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    const html = read('index.html');

    assert.match(html, /id="pisi-language-select"/);
    assert.match(preload, /contextBridge\.exposeInMainWorld\('pisiI18n'/);
    assert.match(preload, /ipcRenderer\.invoke\('app:get-language'\)/);
    assert.match(preload, /ipcRenderer\.invoke\('app:set-language'/);
    assert.match(preload, /characterData: true/);
    assert.match(preload, /attributes: true/);
    assert.match(runtime, /ipcMain\.handle\('app:get-language'/);
    assert.match(runtime, /ipcMain\.handle\('app:set-language'/);
});

test('renderer and native Electron dialogs use the localization layer', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const rendererI18n = read('renderer/core/i18n.mjs');
    const runtime = read('main/runtime.js');
    const electronIpc = read('main/functions/electron-ipc.js');
    const mainBootstrap = read('main.js');

    assert.ok(bootstrap.startsWith('import "./core/i18n.mjs";'));
    assert.match(rendererI18n, /window\.alert =/);
    assert.match(rendererI18n, /window\.confirm =/);
    assert.match(rendererI18n, /window\.prompt =/);
    assert.match(mainBootstrap, /main\/functions\/i18n/);
    assert.match(runtime, /translatePisiMain\('PISI proje klasörü seç'\)/);
    assert.match(electronIpc, /translatePisiMain\('PISI kapatılamadı'\)/);
});
