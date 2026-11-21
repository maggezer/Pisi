'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('geri alınan görsel metinler sözlüklerden çıkarılır, işlevsel hata metinleri korunur', () => {
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;
    const removedKeys = [
        'GÖREV MERKEZİ',
        'Görevleri şimdi eşitle',
        'Görevler eşitleniyor…',
        'Bazı görevler eşitlenemedi',
        'Son eşitleme',
        'Tamamlanan',
        'Yeniden dene'
    ];

    for (const key of removedKeys) {
        assert.equal(key in tr, false, `Türkçe görsel anahtar kalmış: ${key}`);
        assert.equal(key in eng, false, `İngilizce görsel anahtar kalmış: ${key}`);
    }
    assert.equal(typeof tr['Görevler eşitlenemedi.'], 'string');
    assert.equal(typeof eng['Görevler eşitlenemedi.'], 'string');
});
