'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const history = require('../main/functions/version-history-core');
const assets = require('../main/functions/editor-asset-store');
const backupStorage = require('../main/functions/backup-storage');

// Load the real main services, replacing only the Electron host boundary.
const originalLoad = Module._load;
Module._load = function (id, ...args) {
    if (id === 'electron') return { ipcMain: { removeHandler() {}, handle() {} } };
    return originalLoad.call(this, id, ...args);
};
let backup;
try {
    require('../main/functions/portability');
    require('../main/functions/structured-nodes');
    require('../main/functions/property-schema-store');
    require('../main/functions/property-schema-mutations');
    backup = require('../main/functions/backup-directory-ipc');
} finally {
    Module._load = originalLoad;
}
const { modules } = require('../main/module-registry');
const properties = modules['main.propertySchemaMutations'];

globalThis.writeFileAtomic = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
};
globalThis.writePisiDocument = (file, data) => globalThis.writeFileAtomic(file, JSON.stringify(data));
globalThis.readJsonFileResult = (file) => ({ ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
globalThis.runPisiAtomicMutation = (_project, _command, action) => action();

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-history-writers-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    globalThis.activeProjectFolder = root;
    const node = path.join(root, 'Note.node');
    const sidecar = path.join(root, 'Note.pisi-node');
    const model = { databaseId: 'history-writer-sheet', fields: [], items: [], views: [] };
    const content = assets.normalizePisiEditorAssets(
        `<canvas data-pisi-canvas="1" data-image="data:image/png;base64,iVBORw0KGgo="></canvas>` +
            `<table data-pisi-sheet="1" data-pisi-sheet-model='${JSON.stringify(model)}'></table>`,
        { sidecarPath: sidecar }
    );
    const data = { pisi: { id: 'node_writer', type: 'node', title: 'Note' }, content: content.content, properties: {} };
    globalThis.writePisiDocument(node, data);
    globalThis.ensurePisiFileMetadata = (file) => {
        const result = globalThis.readJsonFileResult(file);
        return { ...result, metadata: result.data.pisi, sidecarPath: sidecar };
    };
    return { root, node, sidecar, data, content };
}

for (const operation of ['property', 'template', 'backup']) {
    test(`${operation} writes visible gzip history and preserves its Canvas/Sheet assets during later GC`, (t) => {
        const f = fixture(t);
        let result;
        if (operation === 'property') {
            result = properties.savePisiNodePropertiesBySchema(f.root, f.node, []);
        } else if (operation === 'template') {
            const saved = globalThis.savePisiDatabaseTemplate(f.root, { name: 'Text', content: '<p>replacement</p>' });
            assert.equal(saved.ok, true, saved.error);
            result = globalThis.applyPisiDatabaseTemplate(f.node, saved.template.id, { applyContent: true, contentMode: 'replace' });
        } else {
            const backupPath = backupStorage.getPisiAtomicBackupPath(f.root, f.node);
            globalThis.writePisiDocument(backupPath, { ...f.data, content: '<p>backup</p>' });
            result = backup.restoreCentralizedPisiAtomicBackup(f.root, path.relative(f.root, backupPath));
        }
        assert.equal(result.ok, true, result.error);
        const listed = history.listPisiNodeHistoryBounded(f.node, { projectFolder: f.root });
        assert.equal(listed.versions.length, 1);
        const version = listed.versions[0];
        assert.match(version.historyId, /\.json\.gz$/);
        assert.equal(history.getPisiNodeHistoryVersionBounded(f.node, version.historyId, { projectFolder: f.root }).data.content, f.data.content);
        globalThis.writePisiDocument(f.node, { ...f.data, content: '<p>later version</p>' });
        const later = history.snapshotPisiNodeVersionBounded(f.node, 'editor-save', { projectFolder: f.root });
        assert.equal(later.ok, true, later.error);
        for (const reference of f.content.assets) assert.equal(fs.existsSync(path.join(f.sidecar, reference)), true);
        const files = fs.readdirSync(path.join(f.root, '.pisi-history', 'node_writer'));
        assert.ok(files.every((file) => file === 'index.json' || file.endsWith('.json.gz')));
    });
}

test('backup restore protects incoming assets when its last history reference is evicted', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T05:00:00Z') });
    const f = fixture(t);
    const first = history.snapshotPisiNodeVersionBounded(f.node);
    assert.equal(first.ok, true);
    for (let index = 1; index < history.PISI_VERSION_HISTORY_MAX_VERSIONS; index++) {
        t.mock.timers.tick(1);
        globalThis.writePisiDocument(f.node, { ...f.data, content: `<p>version ${index}</p>` });
        assert.equal(history.snapshotPisiNodeVersionBounded(f.node).ok, true);
    }
    const backupPath = backupStorage.getPisiAtomicBackupPath(f.root, f.node);
    globalThis.writePisiDocument(backupPath, f.data);
    t.mock.timers.tick(1);
    globalThis.writePisiDocument(f.node, { ...f.data, content: '<p>current</p>' });
    const result = backup.restoreCentralizedPisiAtomicBackup(f.root, path.relative(f.root, backupPath));
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(first.snapshotPath), false);
    assert.equal(globalThis.readJsonFileResult(f.node).data.content, f.data.content);
    for (const reference of f.content.assets) assert.equal(fs.existsSync(path.join(f.sidecar, reference)), true);
});
