'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (fileName) => fs.readFileSync(path.join(root, fileName), 'utf8');

test('Electron renderer is isolated behind the preload bridge', () => {
    const main = read('main.js');
    const preload = read('preload.js');
    const renderers = [
        'app.js', 'calendar.js', 'canvas-core.js', 'connection-engine.js',
        'file-system.js', 'modal-manager.js', 'node-engine.js', 'paint-engine.js'
    ].map(read).join('\n');

    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /sandbox:\s*true/);
    assert.match(preload, /contextBridge\.exposeInMainWorld\('kedi'/);
    assert.doesNotMatch(renderers, /\brequire\s*\(/);
    assert.doesNotMatch(renderers, /\bnew Function\s*\(|\beval\s*\(/);
});

test('filesystem writes are atomic and restricted to the selected workspace', () => {
    const main = read('main.js');
    assert.match(main, /function assertWorkspacePath/);
    assert.match(main, /Sembolik bağlantı çalışma alanının dışına çıkıyor/);
    assert.match(main, /function atomicWrite/);
    assert.match(main, /fs\.renameSync\(tempPath,\s*safePath\)/);
});

test('canvas documents use a versioned non-empty schema and guarded loading', () => {
    const fileSystem = read('file-system.js');
    const app = read('app.js');
    assert.match(fileSystem, /schemaVersion:\s*2/);
    assert.match(fileSystem, /content\.trim\(\)\s*===\s*''/);
    assert.match(fileSystem, /dosyaya dokunulmadı/);
    assert.match(app, /pendingCanvasSave\s*=\s*\{\s*targetPath,\s*timerId\s*\}/);
    assert.match(app, /targetPath\s*===\s*window\.currentCanvasFile/);
});

test('connections have one state owner and stable identifiers', () => {
    const connections = read('connection-engine.js');
    assert.doesNotMatch(connections, /\blet connections\s*=/);
    assert.match(connections, /window\.connections/);
    assert.match(connections, /createConnectionId/);
    assert.match(connections, /data-connection-id/);
});

test('node modal and paint persistence hooks are present', () => {
    const index = read('index.html');
    const modal = read('modal-manager.js');
    const paint = read('paint-engine.js');
    assert.match(index, /id="super-node-modal-overlay"/);
    assert.match(index, /id="super-node-modal-body"/);
    assert.match(modal, /originalContentParent/);
    assert.match(modal, /getOpenNodeSnapshot/);
    assert.match(paint, /markCanvasModified/);
    assert.match(paint, /rotateButton/);
    assert.match(paint, /clearButton/);
    assert.doesNotMatch(paint, /dataset\.loaded|data-loaded/);
});

test('CSP and HTML event-handler restrictions remain enabled', () => {
    const index = read('index.html');
    const app = read('app.js');
    assert.match(index, /Content-Security-Policy/);
    assert.doesNotMatch(index, /\son[a-z]+\s*=/i);
    assert.match(app, /function sanitizeHtml/);
    assert.match(app, /name\.startsWith\('on'\)/);
});
