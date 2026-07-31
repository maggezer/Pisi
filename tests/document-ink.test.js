'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const inkSource = read('renderer/editor/pisi-editor-document-ink.mjs');
const bootstrapSource = read('renderer/bootstrap.mjs');
const styleSource = read('style.css');
const inkCss = read('styles/66-document-ink.css');
const nodeEditorSource = read('renderer/editor/pisi-node-editor.mjs');
const mapWorkspaceSource = read('renderer/map/pisi-map-workspace.mjs');

test('canvas yoksa Paint araçları belge mürekkep katmanına yönelir', () => {
    assert.match(
        inkSource,
        /function hasPisiEmbeddedPaintCanvas\(editor\)/
    );
    assert.match(
        inkSource,
        /querySelector\('canvas\[data-pisi-canvas\]'\)/
    );
    assert.match(
        inkSource,
        /hasPisiEmbeddedPaintCanvas\(editor\)[\s\S]*?return false/
    );
    assert.match(
        inkSource,
        /editor\.classList\.add\('pisi-document-ink-active'\)/
    );
});

test('belge mürekkebi şeffaf PNG olarak kaydedilip geri yüklenir', () => {
    assert.match(
        inkSource,
        /canvas\.toDataURL\('image\/png'\)/
    );
    assert.match(
        inkSource,
        /canvas\.dataset\.image = imageData/
    );
    assert.match(
        inkSource,
        /querySelectorAll\('canvas\[data-pisi-document-ink\]'\)/
    );
    assert.match(
        nodeEditorSource,
        /data-pisi-document-ink/
    );
    assert.match(
        mapWorkspaceSource,
        /savePisiDocumentInkForEditor\(editor\)/
    );
});

test('silgi yalnızca mürekkep katmanını temizler', () => {
    assert.match(
        inkSource,
        /function erasePisiDocumentInkSegment\(/
    );
    assert.match(inkSource, /context\.clearRect\(/);
    assert.doesNotMatch(
        inkSource,
        /removeChild|textContent\s*=|innerHTML\s*=/
    );
});

test('yazı aracına geçmek veya Escape belge çizimini kapatır', () => {
    assert.match(
        inkSource,
        /deactivatePisiDocumentInk\([\s\S]*?clearToolHighlight: true/
    );
    assert.match(
        inkSource,
        /event\.key !== 'Escape'/
    );
    assert.match(
        inkCss,
        /pisi-rich-editor\.pisi-document-ink-active/
    );
});

test('belge mürekkep modülü bootstrap ve stil zincirine bağlıdır', () => {
    assert.match(
        bootstrapSource,
        /import "\.\/editor\/pisi-editor-document-ink\.mjs";/
    );
    assert.match(
        styleSource,
        /styles\/66-document-ink\.css/
    );
});
