'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('1.2–platform modülleri bootstrap ve preload köprüsünde kayıtlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    for (const marker of [
        'productivity/pisi-quick-capture.mjs',
        'data/pisi-structured-views.mjs',
        'portability/pisi-portability-panel.mjs',
        'research/pisi-research-panel.mjs',
        'editor/pisi-block-editor.mjs',
        'search/pisi-block-graph.mjs',
        'team/pisi-team-api.mjs'
    ]) assert.ok(bootstrap.includes(marker), marker);
    for (const marker of [
        'quickAddTask', 'saveNodeProperties', 'getNodePropertyContext', 'createPropertyMap',
        'exportProjectMarkdown', 'listNodeHistory', 'auditIntegrity',
        'restoreBackup', 'captureWebSource', 'listDatabaseTemplates',
        'applyDatabaseTemplate', 'pisiTeamTransport'
    ]) assert.ok(preload.includes(marker), marker);
    for (const channel of [
        'project:quick-add-task', 'project:save-node-properties',
        'project:get-node-property-context',
        'project:create-property-map', 'project:export-node',
        'project:import-markdown', 'project:list-node-history',
        'project:audit-integrity', 'project:restore-backup',
        'project:capture-web-source', 'project:list-database-templates',
        'project:apply-database-template', 'team:get-config',
        'team:append-event'
    ]) assert.ok(runtime.includes(channel), channel);
});

test('görev süreleri, alıntılar ve blok referansları sanitizer tarafından korunur', () => {
    const editor = read('renderer/editor/pisi-node-editor.mjs');
    for (const attribute of [
        'data-pisi-todo-scheduled-at',
        'data-pisi-todo-deadline',
        'data-pisi-todo-duration-minutes',
        'data-pisi-todo-actual-minutes',
        'data-pisi-citation-source',
        'data-pisi-block-ref',
        'data-pisi-block-type'
    ]) assert.ok(editor.includes(attribute), attribute);
});

test('alt görev hiyerarşisi kaldırılmış, görev bağımlılıkları korunmuştur', () => {
    const secondRelease = read('renderer/tags/pisi-todo-second-release.mjs');
    const utils = read('renderer/tags/pisi-todo-utils.mjs');
    const thirdRelease = read('renderer/tags/pisi-todo-third-release.mjs');

    assert.doesNotMatch(secondRelease, /subtask:/);
    assert.doesNotMatch(secondRelease, /pisi-mission-add-child/);
    assert.doesNotMatch(secondRelease, /completedChildren|mission\.depth|block\.todoParents/);
    assert.match(secondRelease, /Alt görev sistemi kaldırıldı/);
    assert.match(utils, /todoParents/);
    assert.match(thirdRelease, /startsWith\('dep:'\)/);
    assert.match(thirdRelease, /pisiTodoParent/);
});

test('blok, eklenti, team ve kısayol API yüzeyleri sürümlüdür', () => {
    const extensions = read('renderer/core/pisi-extension-api.mjs');
    const commands = read('renderer/core/pisi-command-registry.mjs');
    const blocks = read('renderer/editor/pisi-block-editor.mjs');
    const team = read('renderer/team/pisi-team-api.mjs');
    for (const point of [
        'nodeType', 'exporter', 'taskView', 'toolbarTool', 'mapLayout', 'rightPanel'
    ]) assert.match(extensions, new RegExp(`'${point}'`));
    assert.match(extensions, /registerPisiPlugin/);
    assert.match(commands, /findPisiShortcutConflict/);
    assert.match(commands, /Mod\+K/);
    assert.match(blocks, /pisiBlockMarkdownToHtml/);
    assert.match(blocks, /data-pisi-block-type/);
    assert.match(team, /registerPisiTeamProvider/);
    assert.match(team, /optimisticRevision/);
});

test('editör imleci otomatik kayıtta korunur ve Enter yeni satıra bırakılır', () => {
    const nodeEditor = read('renderer/editor/pisi-node-editor.mjs');
    const blocks = read('renderer/editor/pisi-block-editor.mjs');
    const tabs = read('renderer/shell/pisi-tabs.mjs');
    const platformStyles = read('styles/59-platform-system.css');

    assert.match(nodeEditor, /clearPisiEditorCaret/);
    assert.doesNotMatch(nodeEditor, /focusPisiEditorAtEnd/);
    assert.equal(
        (
            nodeEditor.match(
                /suppressNextFileSystemRefresh\(3000\);\s*const saveResult = await window\.pisiProject\?\.saveNodeContent/g
            ) || []
        ).length,
        2
    );
    assert.match(tabs, /shouldSuppressFileSystemRefresh\(\)/);
    assert.match(blocks, /function isPisiSlashMenuOpen\(\)/);
    assert.match(blocks, /if \(isPisiSlashMenuOpen\(\)\)/);
    assert.doesNotMatch(blocks, /pisi-block-toolbar/);
    assert.doesNotMatch(platformStyles, /\.pisi-block-toolbar/);
});

test('Pisi geçmişi gizlenir ve yeniden adlandırma alanları klavyeyi korur', () => {
    const operations = read('main/functions/project-operations.js');
    const startup = read('renderer/shell/pisi-startup.mjs');
    const tree = read('renderer/tree/pisi-tree-view.mjs');
    const map = read('renderer/map/pisi-map-workspace.mjs');
    const commands = read('renderer/core/pisi-command-registry.mjs');
    const styles = read('styles/10-tree-and-map.css');
    const focusHelper = startup.match(
        /function focusPisiTextInput\(input, shouldSelect = true\) \{[\s\S]*?\n\}/
    )?.[0] || '';

    assert.match(operations, /entry\.name\.toLowerCase\(\) === '\.pisi-history'/);
    assert.match(operations, /'\.pisi-history',[\s\S]*'node_modules'/);
    assert.match(startup, /center-tab-rename-input pisi-rename-input/);
    assert.match(tree, /tree-rename-input pisi-rename-input/);
    assert.match(tree, /focusPisiTextInput\(input, true\)/);
    assert.match(map, /map-node-title-input pisi-rename-input/);
    assert.match(commands, /closest\?\.\('\.pisi-rename-input'\)/);
    assert.match(focusHelper, /beforeinput/);
    assert.match(focusHelper, /pisiUserEdited/);
    assert.doesNotMatch(focusHelper, /focusRenderer/);
    assert.match(styles, /\.pisi-rename-input/);
    assert.match(styles, /user-select: text/);
});

test('map seçimi, ağaç tıklamaları ve node yazma odağı birbirine karışmaz', () => {
    const treeDnd = read('renderer/tree/pisi-tree-dnd.mjs');
    const treeView = read('renderer/tree/pisi-tree-view.mjs');
    const map = read('renderer/map/pisi-map-workspace.mjs');
    const nodeEditor = read('renderer/editor/pisi-node-editor.mjs');
    const editorStyles = read('styles/40-editor.css');

    assert.match(treeDnd, /PISI_TREE_FILE_CLICK_DELAY_MS/);
    assert.match(treeDnd, /if \(event\.detail > 1\) \{\s*cancelPendingPisiTreeFileClick\(\)/);
    assert.match(
        treeDnd,
        /row\.addEventListener\('dblclick'[\s\S]*?cancelPendingPisiTreeFileClick\(\);[\s\S]*?startRenameTreeFile/
    );
    assert.equal((treeDnd.match(/await openPisiFileTab/g) || []).length, 1);
    assert.match(
        map,
        /const moved = hasDragged[\s\S]*?if \(moved\) \{\s*clearSelectedMapNodes\(\);/
    );
    assert.match(treeView, /result\.items\.filter\(\(item\) => !isPisiInternalTreeItem\(item\)\)/);
    assert.match(treeView, /return name === '\.pisi-history'/);
    assert.match(nodeEditor, /function ensurePisiEditorWritable\(editor\)/);
    assert.match(nodeEditor, /editor\.contentEditable = 'true'/);
    assert.match(editorStyles, /\.pisi-rich-editor \{[\s\S]*?user-select: text;[\s\S]*?pointer-events: auto;/);
});

test('map portu kendi alt node ağacını ve bu ağa bağlı çizgileri daraltır', () => {
    const interactions = read('renderer/map/pisi-map-interactions.mjs');
    const edges = read('renderer/map/pisi-map-edges.mjs');
    const styles = read('styles/20-map-interactions.css');

    assert.match(interactions, /collectPisiCollapsedHubNodeIds/);
    assert.match(interactions, /pisi-hub-descendant-hidden/);
    assert.match(edges, /syncCollapsedHubNodeVisibility\(\)/);
    assert.match(edges, /isHubEdgeCollapsed\(edge, hiddenNodeIds\)/);
    assert.match(styles, /\.map-node-box\.pisi-hub-descendant-hidden \{\s*display: none;/);
    assert.match(styles, /\.map-port\.hub-collapsed/);
    assert.match(interactions, /\.map-node-box:not\(\.pisi-hub-descendant-hidden\)/);
    assert.match(
        read('renderer/map/pisi-map-workspace.mjs'),
        /width: box\.offsetWidth \|\| parseFloat\(box\.style\.width/
    );
});

test('map ok uçları ve çizgileri node zoom oranını izler', () => {
    const interactions = read('renderer/map/pisi-map-interactions.mjs');
    const edges = read('renderer/map/pisi-map-edges.mjs');
    const mapStyles = read('styles/10-tree-and-map.css');
    const interactionStyles = read('styles/20-map-interactions.css');
    const html = read('index.html');

    assert.match(interactions, /getPisiMapConnectionMetrics\(activeMapCamera\?\.zoom\)/);
    assert.match(interactions, /syncMapConnectionZoomStyles\(\)/);
    assert.match(edges, /syncMapConnectionZoomStyles\(svg\)/);
    assert.match(mapStyles, /stroke-width: var\(--pisi-map-edge-stroke-width, 2\.5px\)/);
    assert.match(
        interactionStyles,
        /stroke-width: var\(--pisi-map-temp-edge-stroke-width, 2px\)/
    );
    assert.match(html, /markerUnits="strokeWidth"/);
});

test('günlük takvimi açılan günü seçili bırakmaz ve dil değişikliğini izler', () => {
    const runtime = read('renderer/runtime.mjs');
    const styles = read('styles/50-tags-and-missions.css');

    assert.match(runtime, /function translatePisiCalendarText\(value\)/);
    assert.match(runtime, /monthLabel\.textContent = `\$\{translatePisiCalendarText\(monthName\)\} \$\{state\.year\}`/);
    assert.match(runtime, /weekday\.textContent = translatePisiCalendarText\(name\)/);
    assert.match(runtime, /todayButton\.textContent = translatePisiCalendarText\('Bugün'\)/);
    assert.match(runtime, /document\.addEventListener\('pisi:language-changed'/);
    assert.match(runtime, /opened && getCalendarState\(\) === state && state\.selectedDate === isoDate/);
    assert.match(runtime, /state\.selectedDate = null;\s*saveCalendarStateToStorage\(\);\s*renderCalendar\(\);/);
    assert.doesNotMatch(runtime, /selectedDate: state\.selectedDate/);
    assert.match(styles, /\.pisi-calendar-footer \{[\s\S]*?justify-content: center;/);
    assert.match(styles, /\.pisi-calendar-today-btn \{[\s\S]*?flex: 0 0 auto;[\s\S]*?width: fit-content;/);
});

test('mantıksal, metin ve bilimsel tablo formülleri etkin hesap motoruna bağlıdır', () => {
    const sheet = read('renderer/editor/pisi-editor-sheet.mjs');
    const formulaCore = read('renderer/editor/pisi-editor-sheet-formula-core.mjs');
    const menus = read('renderer/editor/pisi-editor-toolbar-menus.mjs');
    const styles = read('styles/65-unified-toolbar.css');

    assert.match(sheet, /import \{ evaluatePisiFormulaExpression \}/);
    assert.match(sheet, /formatPisiSheetValue\(result\.value\)/);
    assert.match(formulaCore, /name === 'IF'/);
    assert.match(formulaCore, /name === 'CONCAT'/);
    assert.match(formulaCore, /SIN: Math\.sin/);
    assert.match(formulaCore, /name === 'LOG'/);
    assert.match(menus, /PISI_TOOLBAR_FORMULA_GROUPS = PISI_FORMULA_CATALOG/);
    assert.doesNotMatch(menus, /hesap motoru desteği hazırlanıyor/);
    assert.match(styles, /\.pisi-office-formula-list \{[\s\S]*?overflow-y: auto;/);
});
