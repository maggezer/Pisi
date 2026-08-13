'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('property şeması ve node seçenekleri yalnız aktif node mapinden alınır', () => {
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    const editor = read('renderer/editor/pisi-node-editor.mjs');
    const structured = read('renderer/data/pisi-structured-views.mjs');

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
    assert.match(structured, /makePisiMapDatabaseDocuments\(propertyContext\)/);
    assert.doesNotMatch(structured, /ensurePisiSearchIndex/);
});

test('property adı önerisi türü devralır, değeri temizler ve ikon aksiyonları kullanır', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');
    const css = read('styles/58-roadmap-workspace.css');

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
