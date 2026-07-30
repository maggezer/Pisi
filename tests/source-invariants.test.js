'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { collect, readMainSource, readRendererSource, readMany } = require('./source-bundle');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const rendererSource = readRendererSource();
const mainSource = [read('main.js'), readMainSource(), read('main/runtime.js')].join('\n');
const treeSource = readMany(collect('renderer/tree', '.mjs'));
const mapSource = readMany(collect('renderer/map', '.mjs'));
const editorSource = readMany(collect('renderer/editor', '.mjs'));

test('renderer formülleri eval veya Function constructor kullanmaz', () => {
    assert.doesNotMatch(rendererSource, /\beval\s*\(/);
    assert.doesNotMatch(rendererSource, /\bFunction\s*\(/);
});

test('Electron güvenlik sınırları üretim ayarlarında korunur', () => {
    const html = read('index.html');
    assert.match(mainSource, /sandbox:\s*true/);
    assert.match(mainSource, /nodeIntegration:\s*false/);
    assert.match(mainSource, /contextIsolation:\s*true/);
    assert.match(mainSource, /setWindowOpenHandler/);
    assert.match(mainSource, /will-navigate/);
    assert.match(mainSource, /setPermissionRequestHandler/);
    assert.match(html, /style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'/);
    assert.doesNotMatch(html, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval')/);
});

test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {
    const paintLoadCleanupCount = (
        rendererSource.match(/removeAttribute\('data-image-loaded'\)/g) || []
    ).length;
    assert.ok(paintLoadCleanupCount >= 2);
    assert.doesNotMatch(mapSource, /globallyAllowedAttributes[\s\S]{0,500}data-image-loaded/);
});

test('Paint PNG zemini ve ağaç yenilemesi görünür regresyon üretmez', () => {
    assert.match(editorSource, /function resetPisiCanvasToWhite\(/);
    assert.match(editorSource, /function ensurePisiCanvasWhiteBackground\(/);
    assert.doesNotMatch(editorSource, /globalCompositeOperation\s*=\s*['"]destination-out['"]/);
    assert.match(treeSource, /document\.createDocumentFragment\(\)/);
    assert.match(treeSource, /treeEl\.replaceChildren\(/);
});

test('renderer yalnızca tek ES module bootstrap üzerinden yüklenir', () => {
    const html = read('index.html');
    assert.match(html, /<script type="module" src="renderer\/bootstrap\.mjs"><\/script>/);
    assert.doesNotMatch(html, /<script src="(?:app|renderer\/[^"]+)\.js"><\/script>/);
});

test('preload API anahtarları ve kritik DOM kontrolleri tekildir', () => {
    const preload = read('preload.js');
    const html = read('index.html');
    assert.equal((preload.match(/deleteNodeFromMap\s*:/g) || []).length, 1);
    assert.match(html, /id="node-modal-close"/);
    assert.match(html, /id="node-modal-title"/);
    assert.match(html, /id="center-node-editor-title"/);
    assert.match(html, /id="center-node-editor-save"/);
});

test('kullanılmayan production paketleri geri eklenmez', () => {
    const packageJson = JSON.parse(read('package.json'));
    assert.deepEqual(packageJson.dependencies || {}, {});
    assert.equal(packageJson.devDependencies.electron, '^43.2.0');
    assert.equal(packageJson.devDependencies['electron-builder'], '^26.15.7');
});
