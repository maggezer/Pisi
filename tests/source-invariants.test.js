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
const tagIndexSource = read('renderer/tags/pisi-tag-index.mjs');
const mapWorkspaceSource = read('renderer/map/pisi-map-workspace.mjs');
const nodeEditorSource = read('renderer/editor/pisi-node-editor.mjs');

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

test('Electron giriş dosyaları uygulama kökünden yüklenir', () => {
    const electronIpc = read('main/functions/electron-ipc.js');
    assert.match(
        electronIpc,
        /const PISI_APP_ROOT = path\.resolve\(__dirname, '\.\.', '\.\.'\);/
    );
    assert.match(
        electronIpc,
        /preload: path\.join\(PISI_APP_ROOT, 'preload\.js'\)/
    );
    assert.match(
        electronIpc,
        /loadFile\(path\.join\(PISI_APP_ROOT, 'index\.html'\)\)/
    );
    assert.doesNotMatch(
        electronIpc,
        /path\.join\(__dirname, '(?:preload\.js|index\.html)'\)/
    );
});

test('editör normalizasyonu caret konumunu korur', () => {
    assert.match(tagIndexSource, /function capturePisiEditorSelection\(/);
    assert.match(tagIndexSource, /function restorePisiEditorSelection\(/);
    assert.match(
        tagIndexSource,
        /const selectionSnapshot = preserveSelection[\s\S]*?restorePisiEditorSelection\(editor, selectionSnapshot\)/
    );

    const contentFunction = mapWorkspaceSource.match(
        /function getPisiEditorContent\(editor\) \{[\s\S]*?\n\}/
    )?.[0] || '';

    assert.match(contentFunction, /const normalizedEditor = editor\.cloneNode\(true\)/);
    assert.match(
        contentFunction,
        /ensurePisiEditorBlocks\(normalizedEditor, \{[\s\S]*?preserveSelection: false/
    );
    assert.doesNotMatch(contentFunction, /ensurePisiEditorBlocks\(editor\)/);
});

test('Enter ile boş satır korunur ve belge sonunda açılır', () => {
    assert.match(tagIndexSource, /function getPisiEditorNodePath\(/);
    assert.match(tagIndexSource, /function resolvePisiEditorNodePath\(/);
    assert.match(tagIndexSource, /nodePath: getPisiEditorNodePath\(editor, container\)/);
    assert.match(tagIndexSource, /function resolvePisiEditorSelectionPoint\(/);
    assert.match(nodeEditorSource, /function focusPisiEditorAtEnd\(/);
    assert.match(nodeEditorSource, /range\.collapse\(false\)/);
    assert.match(nodeEditorSource, /focusPisiEditorAtEnd\(contentInput\)/);
    assert.match(nodeEditorSource, /focusPisiEditorAtEnd\(contentEditor\)/);
});

test('merkez node editöründe başlık ve kaydet şeridi bulunmaz', () => {
    const html = read('index.html');
    const editorCss = read('styles/40-editor.css');

    assert.doesNotMatch(
        html,
        /center-node-editor-(?:header|title|save)/
    );
    assert.doesNotMatch(
        editorCss,
        /#center-node-editor-(?:header|title|save)/
    );
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
    assert.doesNotMatch(html, /<script src="(?:app|renderer\/[^\"]+)\.js"><\/script>/);
});

test('renderer bootstrap yalnızca mevcut modülleri import eder', () => {
    const bootstrapPath = path.join(root, 'renderer', 'bootstrap.mjs');
    const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
    const imports = [...bootstrapSource.matchAll(/^import\s+["'](.+?)["'];/gm)]
        .map((match) => match[1]);

    assert.ok(imports.length > 0, 'Renderer bootstrap import listesi boş olamaz.');

    for (const modulePath of imports) {
        const resolvedPath = path.resolve(path.dirname(bootstrapPath), modulePath);
        assert.ok(
            fs.existsSync(resolvedPath),
            `Renderer bootstrap eksik modül import ediyor: ${modulePath}`
        );
    }
});

test('preload API anahtarları ve kritik DOM kontrolleri tekildir', () => {
    const preload = read('preload.js');
    const html = read('index.html');
    assert.equal((preload.match(/deleteNodeFromMap\s*:/g) || []).length, 1);
    assert.match(html, /id="node-modal-close"/);
    assert.match(html, /id="node-modal-title"/);
});

test('kullanılmayan production paketleri geri eklenmez', () => {
    const packageJson = JSON.parse(read('package.json'));
    assert.deepEqual(packageJson.dependencies || {}, {});
    assert.equal(packageJson.devDependencies.electron, '^43.2.0');
    assert.equal(packageJson.devDependencies['electron-builder'], '^26.15.7');
});



test('editör iki görünümde güncel beş bölümlü toolbarı kullanır', () => {
    const html = read('index.html');
    const css = read('styles/65-unified-toolbar.css');
    const toolbarSource = read('renderer/editor/pisi-editor-unified-toolbar.mjs');

    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab=/);
    assert.ok(css.includes('grid-template-columns: 250px 118px 104px 76px minmax(282px, 1fr)'));
    assert.doesNotMatch(toolbarSource, /pisi-toolbar-section-reserved/);

    for (const section of [
        'pisi-toolbar-section-text',
        'pisi-toolbar-section-styles',
        'pisi-toolbar-section-table',
        'pisi-toolbar-section-excel',
        'pisi-toolbar-section-drawing'
    ]) {
        assert.match(toolbarSource, new RegExp(section));
    }
});
