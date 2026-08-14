'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('açık harita sağ üst menüden PNG veya PDF olarak dışa aktarılır', () => {
    const exporter = read('renderer/map/pisi-map-export.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));

    assert.match(bootstrap, /\.\/map\/pisi-map-export\.mjs/);
    assert.ok(manifest.some((entry) => (
        entry.module === 'map.export' &&
        entry.path === 'renderer/map/pisi-map-export.mjs'
    )));
    assert.match(exporter, /id = 'pisi-map-export-control'/);
    assert.match(exporter, /data-map-export-format="png"/);
    assert.match(exporter, /data-map-export-format="pdf"/);
    assert.match(exporter, /window\.pisiProject\?\.exportMap\?/);
    assert.match(exporter, /pisi:map-customization-context-changed/);
});

test('çıktı ekran görüntüsü yerine bütün görünür map geometrisinden üretilir', () => {
    const exporter = read('renderer/map/pisi-map-export.mjs');

    assert.match(exporter, /#map-board \.map-node-box\[data-node-id\]/);
    assert.match(exporter, /box\.style\.left/);
    assert.match(exporter, /box\.style\.top/);
    assert.match(exporter, /PISI_MAP_EXPORT_PADDING = 220/);
    assert.match(exporter, /makePisiMapExportConnectionPath/);
    assert.match(exporter, /activeMapEdges/);
    assert.match(exporter, /getComputedStyle\(livePath\)\.stroke/);
    assert.match(exporter, /getComputedStyle\(box\)/);
    assert.doesNotMatch(exporter, /capturePage|html2canvas|getDisplayMedia/);
});

test('PNG yüksek çözünürlükte rasterize edilir, PDF SVG vektörünü korur', () => {
    const exporter = read('renderer/map/pisi-map-export.mjs');
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    const portability = read('main/functions/portability.js');
    const mainManifest = JSON.parse(read('main/module-manifest.json'));

    assert.match(exporter, /PISI_MAP_EXPORT_MAX_DIMENSION = 8192/);
    assert.match(exporter, /canvas\.toBlob/);
    assert.match(exporter, /'image\/png'/);
    assert.match(preload, /exportMap: \(mapPath, payload\).*project:export-map/);
    assert.match(runtime, /ipcMain\.handle\('project:export-map'/);
    assert.match(runtime, /extensions: \['\.map'\]/);
    assert.match(portability, /function validatePisiMapExportSvg/);
    assert.match(portability, /function decodePisiMapExportPng/);
    assert.match(portability, /printToPDF\(\{/);
    assert.match(portability, /preferCSSPageSize: true/);
    assert.ok(mainManifest.find((entry) => entry.module === 'main.portability')
        .bindings.includes('exportPisiMapGraphic'));
});

test('export düğmesi, menüsü, ikonu ve metinleri iki temada tanımlıdır', () => {
    const mapCss = read('styles/20-map-interactions.css');
    const lightCss = read('styles/91-light-theme-tuning.css');
    const icon = read('assets/icons/export-map.svg');
    const icons = JSON.parse(read('assets/icons/icons.json'));
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    assert.match(mapCss, /#pisi-map-export-control[\s\S]*right: 64px/);
    assert.match(mapCss, /assets\/icons\/export-map\.svg/);
    assert.match(mapCss, /\.pisi-map-export-menu/);
    assert.match(lightCss, /data-pisi-theme="light"[^\n]*\.pisi-map-export-trigger/);
    assert.match(lightCss, /data-pisi-theme="light"[^\n]*\.pisi-map-export-menu/);
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(icon, /<script\b|on\w+=/i);
    assert.equal(icons.actions.exportMap, 'assets/icons/export-map.svg');

    for (const key of [
        'Haritayı dışa aktar',
        'PNG olarak dışa aktar',
        'PDF olarak dışa aktar',
        'Harita dışa aktarılamadı.'
    ]) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
});
