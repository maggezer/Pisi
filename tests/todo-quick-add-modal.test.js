'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Quick Add's behaviour (form, target, date, repeat, reminder) is tested by
// tests/task-panel-core.test.mjs and scripts/electron-tasks-panel-e2e.mjs (G4).

test('Tasks sekmesi çalışma merkezinden kaldırılmıştır; Quick Add modalda kalır', () => {
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const css = [read('styles/58-workspaces-platform.css'), read('styles/90-themes.css')].join('\n');

    assert.match(commandCenter, /activePage: ''/);
    assert.doesNotMatch(commandCenter, /activePage: 'tasks'/);
    assert.match(commandCenter, /pages\[0\]\?\.id \|\| ''/);
    assert.doesNotMatch(css, /pisi-task-hub/);
    assert.doesNotMatch(css, /pisi-task-postpone-select/);
});

test('kısayol sayfası Ctrl ve ⌘ biçimini kayıtlı komut kısayolundan üretir', () => {
    const commands = read('renderer/core/pisi-command-registry.mjs');

    assert.match(commands, /function formatPisiShortcutForDisplay/);
    assert.match(commands, /\? '⌘' : 'Ctrl'/);
    assert.match(commands, /formatPisiShortcutForDisplay\([\s\S]*getPisiCommandShortcut\(command\)/);
});

test('görev ekleme modalı koyu ve açık temalarda ayrı, okunabilir paletler kullanır', () => {
    const css = read('styles/58-workspaces-platform.css');

    assert.match(css, /\.pisi-quick-add-overlay \{[\s\S]*--pisi-quick-modal-bg: #20242b/);
    assert.match(css, /\.pisi-quick-add-overlay\[hidden\]/);
    assert.match(css, /html\[data-pisi-theme=(?:"light"|'light')\] \.pisi-quick-add-overlay \{[\s\S]*--pisi-quick-modal-bg: #ffffff/);
    assert.match(css, /\.pisi-quick-add-dialog \.pisi-quick-field input:focus/);
    assert.match(css, /\.pisi-quick-add-actions/);
});

test('yeni görev ekleme metinleri iki dil kataloğunda eşleşir', () => {
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;
    const keys = [
        'Görev ekle',
        'Görevi ekle',
        'Görev ekleme penceresini aç (Ctrl+M)',
        'Inbox’a veya seçili node’a hızlı görev ekler.',
        'Görev eklemek için önce bir proje klasörü seçin.',
        'Yükleniyor…'
    ];

    for (const key of keys) {
        assert.equal(typeof tr[key], 'string', `Türkçe anahtar eksik: ${key}`);
        assert.equal(typeof eng[key], 'string', `İngilizce anahtar eksik: ${key}`);
    }
    assert.equal(eng['Görev ekle'], 'Add task');
    assert.equal('Global Quick Add (Ctrl+Shift+A)' in tr, false);
    assert.equal('Global Quick Add (Ctrl+Shift+A)' in eng, false);
});
