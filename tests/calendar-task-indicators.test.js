'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Which days carry which mark is a behaviour test: tests/calendar-task-marks.test.mjs (G5).

test('takvim görev ve günlük not çeviri anahtarları catalog içinde yer alır', () => {
    const uiTranslations = JSON.parse(read('locales/ui-translations.json'));

    assert.equal(uiTranslations.tr['Tamamlanmamış görev var'], 'Tamamlanmamış görev var');
    assert.equal(uiTranslations.tr['Tüm görevler tamamlandı'], 'Tüm görevler tamamlandı');
    assert.equal(uiTranslations.tr['Günlük not var'], 'Günlük not var');

    assert.equal(uiTranslations.eng['Tamamlanmamış görev var'], 'Pending tasks exist');
    assert.equal(uiTranslations.eng['Tüm görevler tamamlandı'], 'All tasks completed');
    assert.equal(uiTranslations.eng['Günlük not var'], 'Diary note exists');
});
