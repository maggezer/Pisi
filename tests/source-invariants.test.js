'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(
    path.join(root, filePath),
    'utf8'
);

test('renderer formülleri eval veya Function constructor kullanmaz', () => {
    const source = read('app.js');
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /\bFunction\s*\(/);
});

test('Electron güvenlik sınırları üretim ayarlarında korunur', () => {
    const source = read('main.js');
    assert.match(source, /sandbox:\s*true/);
    assert.match(source, /nodeIntegration:\s*false/);
    assert.match(source, /contextIsolation:\s*true/);
    assert.match(source, /setWindowOpenHandler/);
    assert.match(source, /will-navigate/);
    assert.match(source, /setPermissionRequestHandler/);
});

test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {
    const app = read('app.js');
    const workspace = read('renderer/kedi-map-workspace.js');

    assert.match(app, /removeAttribute\('data-image-loaded'\)/);
    assert.match(workspace, /removeAttribute\('data-image-loaded'\)/);
    assert.doesNotMatch(
        workspace,
        /globallyAllowedAttributes[\s\S]{0,500}data-image-loaded/
    );
});

test('preload API anahtarları ve kritik DOM kontrolleri tekildir', () => {
    const preload = read('preload.js');
    const html = read('index.html');

    assert.equal(
        (preload.match(/deleteNodeFromMap\s*:/g) || []).length,
        1
    );
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
