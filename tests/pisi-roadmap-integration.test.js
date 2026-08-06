'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('1.2–1.5 modülleri bootstrap ve preload köprüsünde kayıtlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const preload = read('preload.js');
    const runtime = read('main/runtime.js');
    for (const marker of [
        'productivity/pisi-quick-capture.mjs',
        'data/pisi-structured-views.mjs',
        'portability/pisi-portability-panel.mjs',
        'research/pisi-research-panel.mjs'
    ]) assert.ok(bootstrap.includes(marker), marker);
    for (const marker of [
        'quickAddTask', 'saveNodeProperties', 'createPropertyMap',
        'exportProjectMarkdown', 'listNodeHistory', 'auditIntegrity',
        'restoreBackup', 'captureWebSource'
    ]) assert.ok(preload.includes(marker), marker);
    for (const channel of [
        'project:quick-add-task', 'project:save-node-properties',
        'project:create-property-map', 'project:export-node',
        'project:import-markdown', 'project:list-node-history',
        'project:audit-integrity', 'project:restore-backup',
        'project:capture-web-source'
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
        'data-pisi-block-ref'
    ]) assert.ok(editor.includes(attribute), attribute);
});

test('alt görev sistemi geri getirilmemiştir', () => {
    const todo = read('renderer/tags/pisi-todo-second-release.mjs');
    assert.match(todo, /Alt görev sistemi kaldırıldı/);
    assert.doesNotMatch(read('renderer/productivity/pisi-quick-capture.mjs'), /subtask/i);
});
