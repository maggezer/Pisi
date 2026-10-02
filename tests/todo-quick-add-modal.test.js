'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('sağ To-do başlığı eşit kare, sağa yaslı ve yalnız ikonlu eylemleri taşır', () => {
    const workspace = read('renderer/tags/pisi-todo-workspace.mjs');
    const css = read('styles/56-todo-workspace.css');

    assert.match(workspace, /pisi-todo-panel-actions/);
    assert.match(workspace, /id = 'pisi-todo-quick-add'/);
    assert.match(workspace, /'pisi:quick-add-requested'/);
    assert.match(workspace, /aria-keyshortcuts', 'Control\+M'/);
    assert.doesNotMatch(workspace, /pisi-todo-panel-action-label/);
    assert.match(workspace, /workspaceButton\.appendChild\(icon\)/);
    assert.match(workspace, /quickAddButton\.appendChild\(icon\)/);
    assert.match(css, /\.pisi-todo-panel-actions \{[\s\S]*justify-content: flex-end/);
    assert.match(css, /\.pisi-todo-panel-action \{[\s\S]*width: 38px;[\s\S]*height: 38px/);
    assert.doesNotMatch(css, /\.pisi-todo-panel-action-label/);
    assert.match(css, /assets\/todo\/workspace\.svg/);
    assert.match(css, /assets\/todo\/add-task\.svg/);
    assert.ok(read('assets/todo/workspace.svg').includes('<svg'));
    assert.ok(read('assets/todo/add-task.svg').includes('<svg'));
});

test('Tasks sekmesi çalışma merkezinden tamamen kaldırılır ve Quick Add modalda kalır', () => {
    const capture = read('renderer/productivity/pisi-quick-capture.mjs');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const css = [
        read('styles/58-roadmap-workspace.css'),
        read('styles/90-themes.css'),
        read('styles/91-light-theme-tuning.css')
    ].join('\n');

    assert.match(capture, /function ensurePisiQuickAddModal/);
    assert.match(capture, /async function openPisiQuickAddModal/);
    assert.match(capture, /function closePisiQuickAddModal/);
    assert.match(capture, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(capture, /event\.key === 'Escape'/);
    assert.match(capture, /getPisiQuickAddFocusableElements/);
    assert.doesNotMatch(capture, /id: 'tasks'/);
    assert.doesNotMatch(capture, /renderPisiTasksPage/);
    assert.doesNotMatch(capture, /openPisiCommandCenter\('tasks'\)/);
    assert.doesNotMatch(capture, /renderPisiCommandCenterPage/);
    assert.match(commandCenter, /activePage: ''/);
    assert.doesNotMatch(commandCenter, /activePage: 'tasks'/);
    assert.match(commandCenter, /pages\[0\]\?\.id \|\| ''/);
    assert.doesNotMatch(css, /pisi-task-hub/);
    assert.doesNotMatch(css, /pisi-task-postpone-select/);
});

test('quick add modülü kayıt sisteminin salt-okunur global bağlarını ezmez', () => {
    const capture = read('renderer/productivity/pisi-quick-capture.mjs');

    assert.match(capture, /registerModule\('productivity\.quickCapture', moduleApi\)/);
    assert.doesNotMatch(capture, /window\.openPisiQuickAddModal\s*=/);
    assert.doesNotMatch(capture, /window\.closePisiQuickAddModal\s*=/);
});

test('Ctrl+M görev ekleme modalını açar ve kısayol sayfasında okunur görünür', () => {
    const capture = read('renderer/productivity/pisi-quick-capture.mjs');
    const commands = read('renderer/core/pisi-command-registry.mjs');

    assert.match(capture, /id: 'pisi\.quick-add'/);
    assert.match(capture, /defaultShortcut: 'Mod\+M'/);
    assert.match(capture, /handler: openPisiQuickAddModal/);
    assert.doesNotMatch(capture, /installPisiQuickAddButton/);
    assert.doesNotMatch(capture, /pisi-quick-add-button/);
    assert.doesNotMatch(capture, /Mod\+Shift\+A/);
    assert.match(commands, /function formatPisiShortcutForDisplay/);
    assert.match(commands, /\? '⌘' : 'Ctrl'/);
    assert.match(commands, /formatPisiShortcutForDisplay\([\s\S]*getPisiCommandShortcut\(command\)/);
});

test('görev ekleme modalı koyu ve açık temalarda ayrı, okunabilir paletler kullanır', () => {
    const css = read('styles/58-roadmap-workspace.css');

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
