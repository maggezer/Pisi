'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('takvim göstergesinin nötr, kırmızı ve yeşil renk sınıflarının CSS kuralları vardır', () => {
    const prodCss = read('styles/50-productivity.css');
    const polishCss = read('styles/105-feature-polish.css');

    // 1. CSS kuralları
    assert.match(prodCss, /\.pisi-calendar-day\.has-diary-node\.has-uncompleted-tasks::after \{[\s\S]*?background:\s*#e74c3c;/);
    assert.match(prodCss, /\.pisi-calendar-day\.has-diary-node\.has-completed-tasks::after \{[\s\S]*?background:\s*#2ecc71;/);
    assert.match(prodCss, /\.pisi-calendar-day\.has-diary-node\.has-diary-note-only::after \{[\s\S]*?background:\s*#8e9297;/);

    // Light tema stilleri
    assert.match(polishCss, /\.pisi-calendar-day\.has-diary-node\.has-uncompleted-tasks::after \{[\s\S]*?background:\s*#d63031;/);
    assert.match(polishCss, /\.pisi-calendar-day\.has-diary-node\.has-completed-tasks::after \{[\s\S]*?background:\s*#2ecc71|#27ae60;/);

    // Günlerin sınıfları ve görev olayı: tests/calendar-task-marks.test.mjs (davranış testi).
});

test('takvim görev ve günlük not çeviri anahtarları catalog içinde yer alır', () => {
    const uiTranslations = JSON.parse(read('locales/ui-translations.json'));

    assert.equal(uiTranslations.tr['Tamamlanmamış görev var'], 'Tamamlanmamış görev var');
    assert.equal(uiTranslations.tr['Tüm görevler tamamlandı'], 'Tüm görevler tamamlandı');
    assert.equal(uiTranslations.tr['Günlük not var'], 'Günlük not var');

    assert.equal(uiTranslations.eng['Tamamlanmamış görev var'], 'Pending tasks exist');
    assert.equal(uiTranslations.eng['Tüm görevler tamamlandı'], 'All tasks completed');
    assert.equal(uiTranslations.eng['Günlük not var'], 'Diary note exists');
});
