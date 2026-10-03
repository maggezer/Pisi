'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('üçüncü sürüm modülü ve görünüm stilleri bootstrap zincirine bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const styles = read('style.css');

    assert.match(bootstrap, /pisi-todo-third-release\.mjs/);
    assert.match(bootstrap, /pisi-todo-third-release-guard\.mjs/);
    assert.match(styles, /50-productivity\.css/);
});

test('görev bağımlılıkları kalıcı metadata, çoklu seçim ve döngü koruması sağlar', () => {
    const source = read('renderer/tags/pisi-todo-third-release.mjs');

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
    const source = read('renderer/tags/pisi-todo-third-release.mjs');
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

test('hatırlatmalar görev etiketi sınıfında saklanır ve tek seferlik bildirilir', () => {
    const source = read('renderer/tags/pisi-todo-third-release.mjs');

    assert.match(source, /pisi-todo-reminder-/);
    assert.match(source, /due-morning/);
    assert.match(source, /day-before/);
    assert.match(source, /three-days-before/);
    assert.match(source, /Notification\.requestPermission/);
    assert.match(source, /new Notification/);
    assert.match(source, /localStorage\.setItem\(seenKey, '1'\)/);
    assert.match(source, /pisi-third-reminder-banner/);
});

test('yeniden çizim koruması alternatif görünümde mutation döngüsünü engeller', () => {
    const guard = read('renderer/tags/pisi-todo-third-release-guard.mjs');

    assert.match(guard, /state\.observer\?\.disconnect/);
    assert.match(guard, /list\.dataset\.pisiThirdView === state\.view/);
    assert.match(guard, /pisiThirdEnhanced/);
    assert.match(guard, /applyPisiTodoThirdRelease/);
});

test('üçüncü sürüm alt görev sistemini yeniden getirmez', () => {
    const source = read('renderer/tags/pisi-todo-third-release.mjs');

    assert.doesNotMatch(source, /addPisiSubtask/);
    assert.doesNotMatch(source, /pisi-mission-add-child/);
    assert.doesNotMatch(source, /Yeni alt görev/);
});
