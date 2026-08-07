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

test('takvim günlükleri normal klasör taramasından ayrı olarak görev indeksine katılır', () => {
    const index = read('renderer/tags/pisi-tag-index.mjs');
    const start = index.indexOf('async function buildPisiMissionBlockIndex()');
    const end = index.indexOf('async function buildPisiTagBlockIndex()', start);
    const missionBuilder = index.slice(start, end);

    assert.match(missionBuilder, /const seenPaths = new Set\(\)/);
    assert.match(
        missionBuilder,
        /collectPisiMissionNodeItemsFromFolder\([\s\S]*?seenPaths,[\s\S]*?scanState/
    );
    assert.match(missionBuilder, /await collectPisiDiaryTagNodeItems\(scanState\)/);
    assert.match(missionBuilder, /seenPaths\.has\(normalizedDiaryPath\)/);
    assert.match(missionBuilder, /nodeItems\.push\(diaryNode\)/);
});

test('node açıldığında To-do katmanı kapanır ve yalnız Kanban görsel iyileştirmesi kalır', () => {
    const panel = read('renderer/tags/pisi-todo-first-release.mjs');
    const panelCss = read('styles/50-tags-and-missions.css');
    const workspace = read('renderer/tags/pisi-todo-workspace.mjs');
    const workspaceCss = read('styles/56-todo-workspace.css');

    assert.match(workspace, /'pisi:active-node-changed'/);
    assert.match(workspace, /event\.detail\?\.reason !== 'center-open'/);
    assert.match(workspace, /closePisiTodoWorkspace\(\{ restore: false \}\)/);
    assert.doesNotMatch(workspace, /pisi-todo-workspace-open-icon/);
    assert.doesNotMatch(panel, /createPisiMissionsOverviewFirstRelease/);
    assert.doesNotMatch(panelCss, /pisi-missions-overview/);
    assert.doesNotMatch(workspaceCss, /\.pisi-third-stat-card,/);
    assert.match(workspaceCss, /pisi-third-kanban-column/);
    assert.match(workspaceCss, /pisi-third-kanban-card:hover/);
});

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
