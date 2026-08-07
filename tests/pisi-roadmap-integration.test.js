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
        'quickAddTask', 'saveNodeProperties', 'createPropertyMap',
        'exportProjectMarkdown', 'listNodeHistory', 'auditIntegrity',
        'restoreBackup', 'captureWebSource', 'listDatabaseTemplates',
        'applyDatabaseTemplate', 'pisiTeamTransport'
    ]) assert.ok(preload.includes(marker), marker);
    for (const channel of [
        'project:quick-add-task', 'project:save-node-properties',
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

test('alt görev sistemi bağımlılıklardan ayrı bir ilişkiyle geri getirilmiştir', () => {
    const todo = read('renderer/tags/pisi-todo-second-release.mjs');
    assert.match(todo, /subtask:/);
    assert.match(todo, /addPisiSubtaskSecondRelease\(mission\)/);
    assert.match(todo, /completedChildren/);
    assert.match(todo, /pisi-mission-add-child/);
    assert.doesNotMatch(todo, /Alt görev sistemi kaldırıldı/);
    assert.match(read('renderer/tags/pisi-todo-third-release.mjs'), /startsWith\('dep:'\)/);
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
