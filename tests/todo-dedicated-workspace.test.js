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
    assert.match(bootstrap, /pisi-todo-workspace-shield\.mjs/);
    assert.match(styles, /56-todo-workspace\.css/);
});

test('sağ paneldeki başlıksız To-do eylem alanı iki kompakt düğme taşır', () => {
    const html = read('index.html');
    const source = read('renderer/tags/pisi-todo-workspace.mjs');
    const css = read('styles/56-todo-workspace.css');

    assert.match(html, /id="pisi-todo-panel-actions-host"/);
    assert.match(source, /getElementById\('pisi-todo-panel-actions-host'\)/);
    assert.match(css, /\.pisi-todo-panel-actions-host/);
    assert.match(source, /pisi-todo-panel-actions/);
    assert.match(source, /pisi-todo-workspace-open/);
    assert.match(source, /pisi-todo-quick-add/);
    assert.match(source, /openPisiTodoWorkspace/);
    assert.match(source, /pisi:quick-add-requested/);
    assert.match(css, /\.pisi-todo-panel-actions/);
    assert.match(css, /\.pisi-todo-quick-add/);
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

test('To-do çalışma alanı opaktır ve arkadaki merkez yüzeylerini kilitler', () => {
    const css = read('styles/56-todo-workspace.css');
    const shield = read('renderer/tags/pisi-todo-workspace-shield.mjs');

    assert.match(css, /background-color: var\(--pisi-todo-bg\)/);
    assert.match(css, /background-image: none/);
    assert.match(css, /#workspace\.pisi-todo-workspace-active > :not\(\.pisi-todo-workspace\)/);
    assert.match(css, /pointer-events: none;/);
    assert.doesNotMatch(css, /!important/);
    assert.match(shield, /pisi-todo-workspace-active/);
    assert.match(shield, /event\.stopPropagation\(\)/);
    assert.match(shield, /'pointerdown'/);
    assert.match(shield, /'click'/);
    assert.match(shield, /'contextmenu'/);
});

test('To-do çalışma alanı koyu ve açık tema paletlerini kendi kapsamında uygular', () => {
    const css = read('styles/56-todo-workspace.css');

    assert.match(css, /#workspace\.pisi-todo-workspace-active\s*\{[\s\S]*--pisi-todo-bg: #181a1f/);
    assert.match(css, /html\[data-pisi-theme=["\']light["\']\] #workspace\.pisi-todo-workspace-active\s*\{[\s\S]*--pisi-todo-bg: #eceff3/);
    assert.match(css, /--panel-bg: var\(--pisi-todo-card\)/);
    assert.match(css, /--pisi-theme-surface: var\(--pisi-todo-card\)/);
    assert.match(css, /color-scheme: light/);
    assert.doesNotMatch(css, /background(?:-color)?: #1e1e1e/);
    assert.doesNotMatch(css, /background(?:-color)?: #252526/);
});

test('To-do görünümleri iki temada okunabilir yüzey ve odak durumları sunar', () => {
    const css = read('styles/56-todo-workspace.css');

    assert.match(css, /--pisi-todo-text: #f2f4f7/);
    assert.match(css, /--pisi-todo-muted: #b8c0cb/);
    assert.match(css, /--pisi-todo-text: #20252c/);
    assert.match(css, /--pisi-todo-muted: #5f6874/);
    assert.match(css, /\.pisi-todo-workspace :is\(button, select\):focus-visible/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-kanban-column > header/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-kanban-card/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-calendar-day\.today/);
    assert.match(css, /\.pisi-todo-workspace-content \.pisi-third-stat-card strong/);
});
