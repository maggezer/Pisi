'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { modules, registerMainModule } = require('../main/module-registry');

const calls = { readSettings: 0, writeSettings: 0, dialog: 0, exportEntities: 0, applyRecords: 0 };
let configuredSettings = {};

registerMainModule('main.pathSecurity', {
    readSettings: () => {
        calls.readSettings += 1;
        return structuredClone(configuredSettings);
    },
    writeSettings: () => {
        calls.writeSettings += 1;
    }
});
registerMainModule('main.atomicMutation', {
    runPisiAtomicMutation: (_project, _command, operation) => operation()
});
registerMainModule('main.syncProjectAdapter', {
    exportPisiSyncEntities() {
        calls.exportEntities += 1;
        return [];
    },
    applyPisiSyncRecords() {
        calls.applyRecords += 1;
        return { conflicts: 0, recoveredToSyncTrash: 0 };
    }
});

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            dialog: {
                showOpenDialog: async () => {
                    calls.dialog += 1;
                    return { canceled: true, filePaths: [] };
                }
            },
            ipcMain: { handle: () => {} }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    require('../main/functions/sync-domain');
} finally {
    Module._load = originalLoad;
}
const domain = modules['main.syncDomain'];

// Mirrors projectKey() in main/functions/sync-domain.js.
const projectKey = (projectFolder) => crypto.createHash('sha256').update(path.resolve(projectFolder).toLowerCase()).digest('hex').slice(0, 24);

function snapshotTree(root) {
    const entries = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            const stat = fs.statSync(fullPath);
            entries.push([path.relative(root, fullPath), entry.isDirectory() ? 'dir' : `${stat.size}:${stat.mtimeMs}`]);
            if (entry.isDirectory()) visit(fullPath);
        }
    };
    visit(root);
    return entries.sort(([a], [b]) => a.localeCompare(b));
}

test('legacy Pisi Sync is disabled by its single feature flag', () => {
    assert.equal(domain.isPisiLegacySyncEnabled(), false);
});

test('disabled sync writes no file even when a sync folder is configured', async () => {
    const project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-disabled-project-')));
    const shared = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-disabled-shared-')));
    try {
        fs.writeFileSync(path.join(project, 'Not.node'), JSON.stringify({ title: 'Not', content: 'gövde' }));
        fs.mkdirSync(path.join(project, '.pisi'));
        fs.writeFileSync(path.join(project, '.pisi', 'tasks.json'), '{"version":1,"tasks":[]}');
        configuredSettings = {
            pisiSync: {
                deviceId: 'device_desktop_disabled',
                deviceName: 'Test',
                projects: { [projectKey(project)]: { projectPath: project, folderPath: shared } }
            }
        };
        globalThis.activeProjectFolder = project;
        const projectBefore = snapshotTree(project);
        const sharedBefore = snapshotTree(shared);

        const disabled = { ok: false, disabled: true, code: domain.PISI_SYNC_DISABLED_CODE };
        assert.equal(domain.PISI_SYNC_DISABLED_CODE, 'PISI_SYNC_DISABLED');
        assert.partialDeepStrictEqual(await domain.runPisiSync({ reason: 'interval' }), disabled);
        assert.partialDeepStrictEqual(await domain.selectPisiSyncFolder(), disabled);
        assert.partialDeepStrictEqual(domain.disconnectPisiSync(), disabled);
        assert.deepEqual(domain.getPisiSyncStatus(), { ok: true, enabled: false, configured: false, running: false });

        assert.deepEqual(calls, { readSettings: 0, writeSettings: 0, dialog: 0, exportEntities: 0, applyRecords: 0 });
        assert.deepEqual(snapshotTree(project), projectBefore);
        assert.deepEqual(snapshotTree(shared), sharedBefore);
        assert.equal(fs.existsSync(path.join(project, '.pisi', 'sync-state.json')), false);
        assert.equal(fs.existsSync(path.join(shared, '.pisi-sync')), false);
    } finally {
        delete globalThis.activeProjectFolder;
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(shared, { recursive: true, force: true });
    }
});
