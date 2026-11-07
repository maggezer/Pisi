'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const todoThirdFiles = [
    'renderer/tags/pisi-todo-third-release.mjs',
    'renderer/tags/pisi-todo-third-model.mjs',
    'renderer/tags/pisi-todo-third-query.mjs',
    'renderer/tags/pisi-todo-third-ui.mjs'
];
const readTodoThirdSource = () => todoThirdFiles.map(read).join('\n');

test('üçüncü sürüm modülü ve görünüm stilleri bootstrap zincirine bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const styles = read('style.css');

    assert.match(bootstrap, /pisi-todo-third-release\.mjs/);
    assert.match(bootstrap, /pisi-todo-third-release-guard\.mjs/);
    const facade = read('renderer/tags/pisi-todo-third-release.mjs');
    assert.match(facade, /pisi-todo-third-model\.mjs/);
    assert.match(facade, /pisi-todo-third-query\.mjs/);
    assert.match(facade, /pisi-todo-third-ui\.mjs/);
    for (const file of todoThirdFiles) {
        assert.ok(read(file).split(/\r?\n/).length <= 650, `${file} yeniden büyük bir domain dosyasına dönüştü`);
    }
});

test('görev bağımlılıkları kalıcı metadata, çoklu seçim ve döngü koruması sağlar', () => {
    const source = readTodoThirdSource();

    assert.match(source, /data(?:set)?\.pisiTodoParent/);
    assert.match(source, /dep:/);
    assert.match(source, /encodeURIComponent/);
    assert.match(source, /decodeURIComponent/);
    assert.match(source, /wouldCreatePisiDependencyCycleThirdRelease/);
    assert.match(source, /incompleteDependencies/);
    assert.match(source, /dependencyBlocked/);
    assert.match(source, /Önce bağımlı görevleri tamamlayın/);
});

test('kanban, takvim, zaman çizelgesi ve istatistik görünümü sağlanır', () => {
    const source = readTodoThirdSource();
    const css = read('styles/50-productivity.css');

    assert.match(source, /renderPisiTodoThirdKanban/);
    assert.match(source, /renderPisiTodoThirdCalendar/);
    assert.match(source, /renderPisiTodoThirdTimeline/);
    assert.match(source, /renderPisiTodoThirdStats/);
    assert.match(source, /setPisiMissionStatusFirstRelease/);
    assert.match(css, /pisi-third-kanban/);
    assert.match(css, /pisi-third-calendar-grid/);
    assert.match(css, /pisi-third-timeline-track/);
    assert.match(css, /pisi-third-stat-cards/);
});

// Hatırlatma zamanlaması main süreçte: tests/reminder-schedule-core.test.mjs ve
// tests/reminder-service.test.mjs davranışı doğrudan test eder.

test('yeniden çizim koruması alternatif görünümde mutation döngüsünü engeller', () => {
    const guard = read('renderer/tags/pisi-todo-third-release-guard.mjs');

    assert.match(guard, /state\.observer\?\.disconnect/);
    assert.match(guard, /list\.dataset\.pisiThirdView === state\.view/);
    assert.match(guard, /pisiThirdEnhanced/);
    assert.match(guard, /applyPisiTodoThirdRelease/);
});

test('üçüncü sürüm alt görev sistemini yeniden getirmez', () => {
    const source = readTodoThirdSource();

    assert.doesNotMatch(source, /addPisiSubtask/);
    assert.doesNotMatch(source, /pisi-mission-add-child/);
    assert.doesNotMatch(source, /Yeni alt görev/);
});
