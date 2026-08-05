'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('özel To-do çalışma alanı bootstrap ve stil zincirine bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const styles = read('style.css');

    assert.match(bootstrap, /pisi-todo-workspace\.mjs/);
    assert.match(styles, /56-todo-workspace\.css/);
});

test('sağ paneldeki To-do başlığı çalışma alanını açan düğmeye dönüşür', () => {
    const source = read('renderer/tags/pisi-todo-workspace.mjs');

    assert.match(source, /#right-tab-missions > \.right-panel-section-title/);
    assert.match(source, /pisi-todo-workspace-open/);
    assert.match(source, /openPisiTodoWorkspace/);
});

test('genel görünümler merkezdeki özel çalışma alanına aktarılır', () => {
    const source = read('renderer/tags/pisi-todo-workspace.mjs');

    assert.match(source, /value: 'kanban'/);
    assert.match(source, /value: 'calendar'/);
    assert.match(source, /value: 'timeline'/);
    assert.match(source, /value: 'stats'/);
    assert.match(source, /renderPisiTodoThirdKanban/);
    assert.match(source, /renderPisiTodoThirdCalendar/);
    assert.match(source, /renderPisiTodoThirdTimeline/);
    assert.match(source, /renderPisiTodoThirdStats/);
    assert.match(source, /pisi-todo-workspace-content/);
});

test('sağ alandaki To-do toolbarı ve görev listesi korunur', () => {
    const source = read('renderer/tags/pisi-todo-workspace.mjs');
    const css = read('styles/56-todo-workspace.css');

    assert.match(source, /state\.view = 'list'/);
    assert.match(source, /renderPisiMissionsPanelFirstRelease/);
    assert.match(css, /#pisi-missions-panel \.pisi-third-view-switcher/);
    assert.doesNotMatch(source, /getElementById\(['"]pisi-missions-panel['"]\)\?*\.remove/);
    assert.doesNotMatch(source, /getElementById\(['"]pisi-missions-list['"]\).*replaceChildren/s);
});

test('özel To-do dosyası merkez sekmelerinde açılıp kapatılabilir', () => {
    const source = read('renderer/tags/pisi-todo-workspace.mjs');

    assert.match(source, /pisi-todo-center-tab/);
    assert.match(source, /captureAndHidePisiCenterSurfaces/);
    assert.match(source, /restorePisiCenterSurfaces/);
    assert.match(source, /closePisiTodoWorkspace/);
    assert.match(source, /center-tabs-empty/);
});
