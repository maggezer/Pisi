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

test('Rollup ana toolbar üzerinden property paneli açmadan node bloğu ekler', () => {
    const structured = readStructuredViews();
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const propertiesUi = read('renderer/data/pisi-node-properties-ui.mjs');
    const rollupBlocks = read('renderer/data/pisi-rollup-blocks.mjs');

    assert.doesNotMatch(structured, /makePisiStructuredButton\(\s*'Relation ekle'/);
    assert.doesNotMatch(structured, /makePisiStructuredButton\(\s*'Rollup ekle'/);
    assert.match(toolbar, /data-pisi-table-trigger[\s\S]*data-pisi-rollup-trigger/);
    assert.match(toolbar, /pisi:rollup-block-request/);
    assert.doesNotMatch(toolbar, /pisi:property-rollup-request/);
    assert.doesNotMatch(propertiesUi, /addPisiToolbarRollup|pisi:property-rollup-request/);
    assert.match(rollupBlocks, /function insertPisiRollupBlock/);
    assert.match(rollupBlocks, /data-pisi-block-type="rollup"/);
    assert.match(rollupBlocks, /pisi:rollup-block-request/);
    assert.match(structured, /controls\.append\(status, templatePicker, add, save\)/);
    assert.match(structured, /section\.append\(rows, controls\)/);
});

test('Rollup blok içinde hesaplanır ve çift tıklamayla yeniden düzenlenir', () => {
    const rollupBlocks = read('renderer/data/pisi-rollup-blocks.mjs');
    const styles = read('styles/58-workspaces-platform.css');

    for (const label of ['Relation özelliği', 'Hedef property', 'Hesaplama', 'Rollup bloğunu düzenle', 'Rollup bloğunu kaydet']) {
        assert.ok(rollupBlocks.includes(label), label);
    }
    assert.match(rollupBlocks, /computePisiRollupValue\(/);
    assert.match(rollupBlocks, /addEventListener\('dblclick'/);
    assert.match(rollupBlocks, /editor\?\.dispatchEvent\(new Event\('input'/);
    assert.match(styles, /\.pisi-block-system > \.pisi-rollup-block/);
    assert.match(styles, /\.pisi-rollup-block-dialog/);
    assert.match(styles, /\.pisi-rollup-block-value/);
});

test('Rollup kontrollerinin Türkçe ve İngilizce metinleri eşleşir', () => {
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    for (const key of [
        'Rollup ekle',
        'Rollup bloğu',
        'Rollup bloğunu düzenle',
        'Rollup bloğunu kaydet',
        'Rollup hesaplanıyor…',
        'Rollup hesaplanamadı.',
        'Düzenlemek için çift tıklayın',
        'Relation seçin',
        'Relation özelliği',
        'Hedef property',
        'Hesaplama',
        'Kayıt sayısı için hedef gerekmez'
    ]) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
    assert.equal(eng['Rollup ekle'], 'Add rollup');
});

test('Rollup yapılandırması node içeriğinde ve Markdown geçişinde korunur', () => {
    const blocks = read('renderer/editor/pisi-block-editor.mjs');
    const editor = read('renderer/editor/pisi-node-editor.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));

    assert.match(blocks, /id: 'rollup', label: 'Rollup bloğu'/);
    assert.match(blocks, /PISI_BLOCK_TYPES\.filter\(\(record\) => record\.id !== 'rollup'/);
    assert.match(blocks, /\{\{pisi-rollup:/);
    assert.match(blocks, /block\.dataset\.pisiRollupRelation/);
    assert.match(blocks, /block\.dataset\.pisiRollupTarget/);
    for (const attribute of ['data-pisi-rollup-relation', 'data-pisi-rollup-target', 'data-pisi-rollup-aggregate']) {
        assert.ok(editor.includes(`'${attribute}'`), attribute);
    }
    assert.match(bootstrap, /data\/pisi-rollup-blocks\.mjs/);
    assert.ok(manifest.some((record) => record.module === 'data.rollupBlocks'));
});

test('Rollup açık ve koyu temada ayrı yüzey renkleri kullanır', () => {
    const dark = read('styles/58-workspaces-platform.css');
    const light = read('styles/90-themes.css');

    assert.match(dark, /\.pisi-rollup-block-overlay/);
    assert.match(dark, /\.pisi-rollup-block-editor-field > select/);
    assert.match(light, /data-pisi-theme=["\']light["\'][\s\S]*\.pisi-rollup-block/);
    assert.match(light, /data-pisi-theme=["\']light["\'][\s\S]*\.pisi-rollup-block-dialog/);
});
