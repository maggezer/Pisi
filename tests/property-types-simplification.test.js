'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('property menüsü yalnız Metin, Sayı, Tags ve Relation türlerini sunar', () => {
    const core = read('renderer/data/pisi-properties-core.mjs');
    const menuTypes = core.slice(
        core.indexOf('const PISI_NODE_PROPERTY_TYPES'),
        core.indexOf('const PISI_LEGACY_PROPERTY_TYPE_ALIASES')
    );
    const aggregates = core.slice(
        core.indexOf('const PISI_ROLLUP_AGGREGATES'),
        core.indexOf('function normalizePisiNodePropertyType')
    );

    for (const type of ['text', 'number', 'multiselect', 'relation']) {
        assert.match(menuTypes, new RegExp(`value: '${type}'`));
    }
    for (const removed of ['date', 'select', 'node', 'checkbox', 'rollup']) {
        assert.doesNotMatch(menuTypes, new RegExp(`value: '${removed}'`));
    }
    assert.match(menuTypes, /value: 'multiselect', label: 'Tags'/);
    assert.doesNotMatch(aggregates, /checked-percent|İşaretli yüzdesi/);
});

test('eski property türleri veri kaybetmeden yeni türlere dönüştürülür', () => {
    const rendererCore = read('renderer/data/pisi-properties-core.mjs');
    const main = read('main/functions/structured-nodes.js');

    for (const mapping of [
        "date: 'text'",
        "select: 'multiselect'",
        "node: 'relation'",
        "checkbox: 'multiselect'"
    ]) {
        assert.ok(rendererCore.includes(mapping), mapping);
        assert.ok(main.includes(mapping), mapping);
    }
    assert.match(main, /'text', 'number', 'multiselect', 'relation', 'rollup'/);
});

test('Rollup yalnız ana toolbardan node bloğu olarak eklenir ve property menüsü değildir', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');
    const propertiesUi = read('renderer/data/pisi-node-properties-ui.mjs');
    const rollupBlocks = read('renderer/data/pisi-rollup-blocks.mjs');
    const styles = read('styles/58-roadmap-workspace.css');

    assert.doesNotMatch(propertiesUi, /pisi:property-rollup-request|addPisiToolbarRollup/);
    assert.match(rollupBlocks, /pisi:rollup-block-request/);
    assert.match(rollupBlocks, /function insertPisiRollupBlock/);
    assert.match(structured, /document\.createElement\(isRollup \? 'span' : 'select'\)/);
    assert.match(structured, /className = isRollup \? 'pisi-property-type-readonly'/);
    assert.match(structured, /row\.dataset\.propertyType = normalized\.type/);
    assert.match(styles, /\.pisi-property-type-readonly/);
});

test('Node ID ile otomatik oluşturulma ve değiştirilme tarihleri sistem bilgisidir', () => {
    const filesystem = read('main/functions/filesystem-core.js');
    const documentStore = read('main/functions/document-store.js');
    const propertiesUi = read('renderer/data/pisi-node-properties-ui.mjs');
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    assert.match(filesystem, /createdAt: now,[\s\S]*updatedAt: now/);
    assert.match(documentStore, /if \(!data\.pisi\.createdAt\)/);
    assert.match(documentStore, /data\.pisi\.updatedAt = data\.pisi\.createdAt/);
    assert.match(propertiesUi, /function getPisiNodeSystemProperties/);
    assert.match(propertiesUi, /metadata\.id/);
    assert.match(propertiesUi, /metadata\.createdAt/);
    assert.match(propertiesUi, /metadata\.updatedAt/);
    assert.match(propertiesUi, /systemProperties: getPisiNodeSystemProperties/);
    for (const key of ['Sistem', 'Node ID', 'Oluşturulma tarihi', 'Değiştirilme tarihi']) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
});
