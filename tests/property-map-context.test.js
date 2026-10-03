'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const structuredViewFiles = [
    'renderer/data/pisi-structured-views.mjs',
    'renderer/data/pisi-structured-view-state.mjs',
    'renderer/data/pisi-structured-view-helpers.mjs',
    'renderer/data/pisi-structured-view-query.mjs',
    'renderer/data/pisi-structured-view-property-ui.mjs',
    'renderer/data/pisi-structured-view-ui.mjs'
];
const readStructuredViews = () => structuredViewFiles.map(read).join('\n');

test('property şeması ve node seçenekleri yalnız aktif node mapinden alınır', () => {
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    const editor = read('renderer/editor/pisi-node-editor.mjs');
    const structured = readStructuredViews();

    assert.match(preload, /getNodePropertyContext:[\s\S]*project:get-node-property-context/);
    assert.match(runtime, /project:get-node-property-context/);
    assert.match(runtime, /findParentMapPathForNode\(safeNodePath, nodeInfo\)/);
    assert.match(runtime, /belongsToPreferredMap/);
    assert.match(editor, /mapPath: propertyMapPath/);
    assert.match(structured, /getPisiNodePropertyMapContext/);
    assert.match(structured, /collectPisiMapPropertyDefinitions\(nodes\)/);
    assert.doesNotMatch(structured, /makePisiNodePropertySelect/);
    assert.match(structured, /makePisiRelationPropertyPicker/);
    assert.match(structured, /context\.propertyDefinitions/);
    assert.match(structured, /getPisiActiveMapPropertyContext/);
    assert.match(structured, /function makePisiMapDatabaseDocuments\(context\)/);
    assert.match(structured, /materializePisiStructuredDocuments\(propertyContext\)/);
    assert.doesNotMatch(structured, /ensurePisiSearchIndex/);
    const facade = read('renderer/data/pisi-structured-views.mjs');
    const state = read('renderer/data/pisi-structured-view-state.mjs');
    const helpers = read('renderer/data/pisi-structured-view-helpers.mjs');
    const query = read('renderer/data/pisi-structured-view-query.mjs');
    const propertyUi = read('renderer/data/pisi-structured-view-property-ui.mjs');
    const baseUi = read('renderer/data/pisi-structured-view-ui.mjs');
    assert.match(facade, /pisi-structured-view-state\.mjs/);
    assert.match(facade, /pisi-structured-view-property-ui\.mjs/);
    assert.match(facade, /pisi-structured-view-ui\.mjs/);
    assert.doesNotMatch(state, /pisi-structured-view-(?:helpers|query|property-ui|ui)\.mjs|pisi-structured-views\.mjs/);
    assert.doesNotMatch(helpers, /pisi-structured-view-(?:query|property-ui|ui)\.mjs|pisi-structured-views\.mjs/);
    assert.doesNotMatch(query, /pisi-structured-view-(?:property-ui|ui)\.mjs|pisi-structured-views\.mjs/);
    assert.doesNotMatch(propertyUi, /pisi-structured-view-ui\.mjs|pisi-structured-views\.mjs/);
    assert.doesNotMatch(baseUi, /pisi-structured-view-property-ui\.mjs|pisi-structured-views\.mjs/);
});

test('property adı önerisi türü devralır, değeri temizler ve ikon aksiyonları kullanır', () => {
    const structured = readStructuredViews();
    const css = read('styles/58-workspaces-platform.css');

    assert.match(structured, /className = 'pisi-property-suggestions'/);
    assert.match(structured, /normalized\.type = definition\.type/);
    assert.match(structured, /replaceValue\(makePisiBlankPropertyValue\(definition\.type\)\)/);
    assert.match(structured, /makePisiPropertyIconButton\('Özellik ekle', 'add'\)/);
    assert.match(structured, /makePisiPropertyIconButton\('Özellikleri kaydet', 'save'\)/);
    assert.doesNotMatch(structured, /textContent = pisiStructuredTranslate\('Node özellikleri'\)/);
    assert.doesNotMatch(structured, /className = 'pisi-property-node-title'/);
    assert.match(css, /assets\/properties\/chevron-down\.svg/);
    assert.match(css, /\.pisi-property-icon-button/);
});
