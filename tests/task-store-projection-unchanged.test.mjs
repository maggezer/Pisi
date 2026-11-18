// The task projection (`sync-index`, renderer/tags/pisi-source-of-truth.mjs and
// pisi-task-store.mjs) runs after note saves and panel refreshes. When it changes no
// task, tasks.json is not written again: no new `updatedAt`, no new version for Pisi
// Sync to send to the other devices (docs/sync-plan.md S7, found by the scenario matrix).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const electronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-projection-userdata-'));
process.on('exit', () => fs.rmSync(electronUserData, { recursive: true, force: true }));
const quiet = () => new Proxy(function () {}, { get: (_target, name) => (name === 'then' ? undefined : quiet()), apply: () => undefined });
const electronStub = {
    app: new Proxy(
        {},
        {
            get(_target, name) {
                if (name === 'isPackaged') return false;
                if (name === 'getPath' || name === 'getAppPath') return () => electronUserData;
                if (name === 'getName') return () => 'Pisi';
                if (name === 'getVersion') return () => '0.0.0';
                if (name === 'getLocale') return () => 'tr';
                if (name === 'whenReady') return () => new Promise(() => {});
                return quiet();
            }
        }
    ),
    BrowserWindow: class BrowserWindow {
        static getAllWindows() {
            return [];
        }
    },
    ipcMain: quiet(),
    dialog: quiet(),
    shell: quiet(),
    net: { fetch: async () => ({ ok: false, status: 500 }) }
};
Module._load = function pisiTestElectronStub(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
};
for (const name of [
    'path-security',
    'logger',
    'i18n',
    'filesystem-core',
    'storage',
    'atomic-mutation',
    'atomic-recovery-hardening',
    'document-store',
    'map-store',
    'project-operations',
    'relationship-store',
    'map-semantic-core',
    'map-operational-store',
    'task-capture',
    'task-store',
    'trash-store',
    'task-reference-integrity',
    'source-of-truth',
    'structured-nodes',
    'property-schema-store',
    'property-schema-mutations',
    'project-integrity',
    'portability',
    'auto-update',
    'electron-ipc'
]) {
    require(`../main/functions/${name}.js`);
}
// Constants the stores read as registry globals.
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const { syncPisiFirstClassTaskIndex, upsertPisiFirstClassTask } = modules['main.taskStore'];

function project(t) {
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-projection-')));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    fs.writeFileSync(path.join(folder, 'Inbox.node'), JSON.stringify({ pisi: { version: 1, type: 'node', id: 'node_inbox', title: 'Inbox' }, content: '' }));
    return folder;
}

const projected = (folder, title = 'Raporu gönder') => ({
    id: 'task_source_projection_1',
    title,
    status: 'todo',
    dueDate: '2026-11-14',
    source: { nodePath: path.join(folder, 'Inbox.node'), blockId: 'blk_1', mapPath: null, nodeTitle: 'Inbox', mapTitle: '' },
    todoTag: 'todo.2.14-11-2026'
});

const tasksFile = (folder) => path.join(folder, '.pisi', 'tasks.json');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('değişiklik getirmeyen yansıtma tasks.json dosyasını yeniden yazmaz', async (t) => {
    const folder = project(t);
    assert.equal(syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [projected(folder)] }).ok, true);
    const before = fs.readFileSync(tasksFile(folder), 'utf8');
    const statBefore = fs.statSync(tasksFile(folder)).mtimeMs;
    await tick();

    const again = syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [projected(folder)] });
    assert.equal(again.ok, true);
    assert.equal(again.updated, 1);
    assert.equal(fs.readFileSync(tasksFile(folder), 'utf8'), before, 'aynı içerik, aynı updatedAt');
    assert.equal(fs.statSync(tasksFile(folder)).mtimeMs, statBefore, 'dosya yazılmadı');
});

test('yansıtma bir görevi değiştirince yalnız o görevin updatedAt değeri ilerler', async (t) => {
    const folder = project(t);
    upsertPisiFirstClassTask(folder, { id: 'task_inbox_other', title: 'Başka görev', status: 'todo' });
    syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [projected(folder)] });
    const first = JSON.parse(fs.readFileSync(tasksFile(folder), 'utf8'));
    await tick();

    syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [projected(folder, 'Raporu bugün gönder')] });
    const second = JSON.parse(fs.readFileSync(tasksFile(folder), 'utf8'));
    const byId = (store, id) => store.tasks.find((task) => task.id === id);
    assert.equal(byId(second, 'task_source_projection_1').title, 'Raporu bugün gönder');
    assert.notEqual(byId(second, 'task_source_projection_1').updatedAt, byId(first, 'task_source_projection_1').updatedAt);
    assert.deepEqual(byId(second, 'task_inbox_other'), byId(first, 'task_inbox_other'), 'öbür görev olduğu gibi kalır');
    assert.notEqual(second.updatedAt, first.updatedAt);
});

test('kaynağı silinen görevin budanması dosyayı yazar', async (t) => {
    const folder = project(t);
    syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [projected(folder)] });
    const result = syncPisiFirstClassTaskIndex(folder, { complete: true, tasks: [] });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(tasksFile(folder), 'utf8')).tasks, []);
});
