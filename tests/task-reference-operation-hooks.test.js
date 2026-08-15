'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('rename and move operations expose pathChanges consumed by task reference hooks', () => {
    const documentStore = read('main/functions/document-store.js');
    const mapStore = read('main/functions/map-store.js');
    const hooks = read('main/functions/task-reference-operation-hooks.js');

    assert.match(documentStore, /function renamePisiFile/);
    assert.match(documentStore, /pathChanges/);
    assert.match(mapStore, /function movePisiItem/);
    assert.match(mapStore, /pathChanges/);

    assert.match(hooks, /result\.pathChanges/);
    assert.match(hooks, /rewritePisiTaskSourcePathsForPathChanges\(result\.pathChanges\)/);
    assert.match(hooks, /renamePisiFile\(safeOldPath, newBaseName\)/);
    assert.match(hooks, /movePisiItem\(/);
});

test('task reference hooks replace the original IPC handlers only after runtime registered them', () => {
    const bootstrap = read('main.js');
    const hooks = read('main/functions/task-reference-operation-hooks.js');

    assert.ok(
        bootstrap.indexOf('main/runtime') <
        bootstrap.indexOf('task-reference-operation-hooks'),
        'operation hooks must load after the original runtime handlers'
    );

    for (const channel of [
        'project:rename-pisi-file',
        'project:move-pisi-item'
    ]) {
        assert.ok(hooks.includes(`ipcMain.removeHandler('${channel}')`));
        assert.ok(hooks.includes(`ipcMain.handle('${channel}'`) ||
            hooks.includes(`'${channel}',`));
    }

    assert.match(hooks, /taskReferences:/);
});

test('task reference hook failures are surfaced without pretending references were updated', () => {
    const hooks = read('main/functions/task-reference-operation-hooks.js');

    assert.match(hooks, /if \(!taskReferences\?\.ok\)/);
    assert.match(hooks, /console\.warn/);
    assert.match(hooks, /taskReferences: taskReferences \|\| \{ ok: false, updated: 0 \}/);
});
