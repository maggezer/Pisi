'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('global görünüm ayarları sağ panelden Preferences sayfasına taşınır', () => {
    const html = read('index.html');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const customizations = read('renderer/shell/pisi-customizations.mjs');

    assert.doesNotMatch(html, /data-pisi-custom-(?:color|size|font)/);
    assert.match(html, /id="pisi-map-customize-panel"/);
    assert.match(commandCenter, /renderPisiCustomizationPreferences\(page\)/);
    assert.match(customizations, /id = 'pisi-customize-preferences'/);
    assert.match(customizations, /id = 'pisi-language-select'/);
    assert.match(customizations, /dataset\.pisiCustomColor = key/);
    assert.match(customizations, /dataset\.pisiCustomSize = key/);
    assert.match(customizations, /dataset\.pisiCustomFont = 'mapNodeFontFamily'/);
    assert.match(customizations, /appendPisiFontPreference\(map\)/);
});

test('Customize yalnız görünür bir map varken etkinleşir ve en sağdadır', () => {
    const html = read('index.html');
    const customizations = read('renderer/shell/pisi-customizations.mjs');
    const windowSource = read('renderer/shell/pisi-window.mjs');
    const tabs = read('renderer/shell/pisi-tabs.mjs');
    const css = read('styles/20-map-interactions.css');

    assert.match(
        html,
        /data-right-tab="customizations"[\s\S]*aria-disabled="true"[\s\S]*disabled/
    );
    assert.match(customizations, /window\.activeMapPath/);
    assert.match(customizations, /!canvas\.hidden/);
    assert.match(customizations, /button\.disabled = !enabled/);
    assert.match(customizations, /appendChild\(button\)/);
    assert.match(customizations, /pisi:map-customization-context-changed/);
    assert.match(tabs, /pisi:map-customization-context-changed/);
    assert.match(windowSource, /button\.disabled/);
    assert.match(
        css,
        /data-right-tab="customizations"\] \{ order: 70; \}/
    );
});

test('node kartı renkleri map kaydında tutulur ve global varsayılanı ezer', () => {
    const filesystem = read('main/functions/filesystem-core.js');
    const mapStore = read('main/functions/map-store.js');
    const references = read('main/functions/structured-nodes.js');
    const workspace = read('renderer/map/pisi-map-workspace.mjs');
    const customizations = read('renderer/shell/pisi-customizations.mjs');
    const mapCss = read('styles/10-tree-and-map.css');

    assert.match(filesystem, /normalizePisiMapNodeCustomization/);
    assert.match(mapStore, /layout\.customization/);
    assert.match(mapStore, /customization: normalizedCustomization/);
    assert.match(mapStore, /stored\.customization = customization/);
    assert.match(references, /customization: normalizedCustomization/);
    assert.match(workspace, /applyPisiMapNodeCustomization\(box, node\)/);
    assert.match(workspace, /customization: \{ \.\.\.\(node\?\.customization \|\| \{\}\) \}/);
    assert.match(customizations, /--pisi-map-node-box-color/);
    assert.match(customizations, /--pisi-map-node-title-color/);
    assert.match(customizations, /node\.customization =/);
    assert.match(mapCss, /background: var\(--pisi-map-node-box-color\)/);
    assert.match(mapCss, /color: var\(--pisi-map-node-title-color\)/);
});

test('seçili bağlantının rengi yalnız o edge üzerinde saklanır ve çizilir', () => {
    const filesystem = read('main/functions/filesystem-core.js');
    const state = read('renderer/core/state.mjs');
    const edges = read('renderer/map/pisi-map-edges.mjs');
    const customizations = read('renderer/shell/pisi-customizations.mjs');

    assert.match(filesystem, /normalizePisiMapEdgeCustomization/);
    assert.match(filesystem, /normalizedEdge\.customization = customization/);
    assert.match(state, /selectedMapEdgeId/);
    assert.match(edges, /function selectPisiMapEdge/);
    assert.match(edges, /bindPisiMapEdgeSelection/);
    assert.match(edges, /pathEl\.style\.stroke = color/);
    assert.match(edges, /ensurePisiMapEdgeMarker/);
    assert.match(customizations, /upsertMapConnection/);
    assert.match(customizations, /edge\.customization =/);
});

test('kişiselleştirme yüzeyleri açık ve koyu tema stillerini taşır', () => {
    const dark = read('styles/60-customization.css');
    const themes = read('styles/90-themes.css');

    assert.match(dark, /#pisi-map-customize-panel/);
    assert.match(dark, /\.pisi-selection-customize-row/);
    assert.match(themes, /\.pisi-preferences-customization/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.pisi-selection-customize-row/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.pisi-selection-customize-reset/);
});
