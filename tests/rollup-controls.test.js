'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Properties sayfası Relation ve Rollup için doğrudan ekleme butonları sunar', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');

    assert.match(structured, /makePisiStructuredButton\(\s*'Relation ekle'/);
    assert.match(structured, /makePisiStructuredButton\(\s*'Rollup ekle'/);
    assert.match(
        structured,
        /addRollup\.addEventListener\('click',[\s\S]*type: 'rollup'[\s\S]*aggregate: 'count'/
    );
    assert.match(
        structured,
        /controls\.append\(add, addRelation, addRollup, save, status\)/
    );
    assert.match(
        structured,
        /section\.append\(subtitle, controls, rows, templateControls\)/
    );
});

test('Rollup ayarları açık etiket ve açıklamalarla gösterilir', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');
    const styles = read('styles/59-platform-system.css');

    for (const label of [
        'Relation özelliği',
        'Hedef özellik',
        'Hesaplama',
        'Relation adı veya kimliği',
        'Hedef özellik adı veya kimliği'
    ]) {
        assert.ok(structured.includes(label), label);
    }
    assert.match(styles, /\.pisi-rollup-field/);
    assert.match(styles, /\.pisi-rollup-help/);
    assert.match(styles, /\.pisi-rollup-add/);
});

test('Rollup kontrollerinin Türkçe ve İngilizce metinleri eşleşir', () => {
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    for (const key of [
        'Relation ekle',
        'Rollup ekle',
        'Relation adı veya kimliği',
        'Hedef özellik adı veya kimliği',
        'Relation özelliği',
        'Hedef özellik',
        'Hesaplama',
        "Rollup, Relation alanındaki node'ların hedef özelliğini hesaplar."
    ]) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
    assert.equal(eng['Rollup ekle'], 'Add rollup');
});
