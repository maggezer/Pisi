'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('sağ panel görevleri bağımsız ve yarış korumalı indeks akışından yeniler', () => {
    const index = read('renderer/tags/pisi-tag-index.mjs');

    assert.match(index, /async function refreshPisiMissionIndex/);
    assert.match(index, /pisiMissionIndexRefreshSequence/);
    assert.ok(
        index.indexOf('if (pisiMissionIndexRefreshPromise') <
        index.indexOf('const requestId = ++pisiMissionIndexRefreshSequence'),
        'devam eden eşitlemeye katılmak aktif isteği eski hale getirmemeli'
    );
    assert.match(index, /projectFolder !== window\.currentProjectFolder/);
    assert.match(index, /missionLoading/);
    assert.match(index, /missionLastSyncedAt/);
    assert.match(index, /pisi:mission-index-updated/);
    assert.match(index, /onFileSystemChanged/);
});

test('To-do sekmesi ve merkez çalışma alanı güncel görev indeksini bekler', () => {
    const windowShell = read('renderer/shell/pisi-window.mjs');
    const workspace = read('renderer/tags/pisi-todo-workspace.mjs');

    assert.match(windowShell, /target === 'missions'/);
    assert.match(windowShell, /await window\.refreshPisiMissionIndex/);
    assert.match(windowShell, /reason: 'right-panel-open'/);
    assert.match(workspace, /async function openPisiTodoWorkspace/);
    assert.match(workspace, /await window\.refreshPisiMissionIndex/);
    assert.match(workspace, /pisi:mission-index-updated/);
});

test('Quick Add ve hızlı erteleme sağ panel indeksini doğrudan eşitler', () => {
    const capture = read('renderer/productivity/pisi-quick-capture.mjs');

    assert.match(capture, /reason: 'quick-add'/);
    assert.match(capture, /reason: 'postpone'/);
    assert.match(capture, /await window\.refreshPisiMissionIndex/);
});

test('To-do paneli eşitleme durumu, özet sayaçları ve görsel ilerleme sunar', () => {
    const panel = read('renderer/tags/pisi-todo-first-release.mjs');
    const panelCss = read('styles/50-tags-and-missions.css');
    const workspaceCss = read('styles/56-todo-workspace.css');

    assert.match(panel, /createPisiMissionsOverviewFirstRelease/);
    assert.match(panel, /pisi-missions-sync-button/);
    assert.match(panel, /pisi-missions-overview-progress-track/);
    assert.match(panel, /pisi-missions-sync-error/);
    assert.match(panelCss, /pisi-missions-overview-stats/);
    assert.match(panelCss, /pisiMissionSyncSpin/);
    assert.match(workspaceCss, /pisi-todo-workspace-open-icon/);
    assert.match(workspaceCss, /pisi-third-kanban-card:hover/);
});

test('yeni To-do durum metinleri Türkçe ve İngilizce sözlüklerde bulunur', () => {
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;
    const keys = [
        'GÖREV MERKEZİ',
        'Görevleri şimdi eşitle',
        'Görevler eşitleniyor…',
        'Bazı görevler eşitlenemedi',
        'Son eşitleme',
        'Tamamlanan',
        'Yeniden dene'
    ];

    for (const key of keys) {
        assert.equal(typeof tr[key], 'string', `Türkçe anahtar eksik: ${key}`);
        assert.equal(typeof eng[key], 'string', `İngilizce anahtar eksik: ${key}`);
    }
    assert.equal(eng.Tamamlanan, 'Completed');
});
