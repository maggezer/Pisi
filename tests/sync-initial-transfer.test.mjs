// The first transfer of a real desktop project to the phone (docs/sync-plan.md S6
// acceptance): the project the desktop app wrote (tests/fixtures/desktop-project)
// goes up through the shared engine and comes down to the phone's data layer on
// disk. Afterwards the phone's copy is byte for byte the desktop's, except the
// attachments, which wait on the server until they are opened; the desktop's
// Project Integrity audit finds nothing new on the phone's copy, the missing
// attachments it reports aside (they are not "missing", only not downloaded),
// and nothing at all once they are opened.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNodeFsDriver } from '../mobile/src/data/drivers/node-fs-driver.mjs';
import { createFakeSyncServer } from '../mobile/tests/helpers/fake-sync-server.mjs';
import { createDesktop, createPhone, pairWithCode } from '../mobile/tests/helpers/sync-devices.mjs';
import { checkPisiSyncPath, getPisiSyncFileClass } from '../shared/sync-paths.mjs';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
// The desktop main modules are loaded for real; only Electron itself is stubbed.
const electronUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-compat-userdata-'));
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
    Menu: quiet(),
    nativeImage: quiet(),
    dialog: quiet(),
    shell: quiet(),
    net: { fetch: async () => ({ ok: false, status: 500 }) }
};
Module._load = function pisiTestElectronStub(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
};
// The same modules, in the same order, that main.mjs loads before Project Integrity.
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
    // The map operations (connections, views) the M9 test builds a map with, and the IPC module they bind to.
    'electron-ipc',
    'map-semantic-operation-hooks'
]) {
    require(`../main/functions/${name}.js`);
}
// Constants the stores read as registry globals (connection keys).
require('../main/runtime.js');
Module._load = originalLoad;
const { modules } = require('../main/module-registry.js');
const desktopAudit = modules['main.projectIntegrity'].auditPisiProjectIntegrity;

const fixture = path.join(import.meta.dirname, 'fixtures', 'desktop-project');
const issueKeys = (report) => report.issues.map((issue) => [issue.code, issue.path, issue.message ?? ''].join(' | ')).sort();
const isAttachment = (key) => getPisiSyncFileClass(key) === 'asset';

function tempFolder(t, name) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), name));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    return folder;
}

/** Every file of a folder as `key → bytes`. */
function snapshot(root) {
    const files = new Map();
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else files.set(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full));
        }
    };
    walk(root);
    return files;
}

test('ilk indirme: telefondaki kopya ekler dışında masaüstüyle bayt bayt aynı; Integrity yeni bulgu vermez, inmemiş ekler eksik sayılmaz', async (t) => {
    const desktopRoot = tempFolder(t, 'pisi-s6-desktop-');
    fs.cpSync(fixture, desktopRoot, { recursive: true });
    for (const folder of JSON.parse(fs.readFileSync(`${fixture}.directories.json`, 'utf8'))) fs.mkdirSync(path.join(desktopRoot, folder), { recursive: true });
    const baseline = issueKeys(desktopAudit(desktopRoot));
    assert.deepEqual(baseline, []);

    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    const synced = [...snapshot(desktopRoot)].filter(([key]) => checkPisiSyncPath(key).ok);
    for (const [key, bytes] of synced) desktop.writeBytes(key, new Uint8Array(bytes));
    assert.equal((await desktop.sync()).ok, true);

    const phoneRoot = tempFolder(t, 'pisi-s6-phone-');
    const phone = createPhone(server, { driver: createNodeFsDriver(phoneRoot) });
    await phone.project.open();
    await phone.service.init();
    assert.deepEqual(await phone.service.inspectProject(), { skeleton: true });
    await pairWithCode(desktop, phone, { initial: 'replace' });
    await phone.service.sync('test');
    assert.equal(phone.service.getStatus().state, 'idle');

    // Byte for byte, the attachments aside; nothing else on the phone.
    const onPhone = snapshot(phoneRoot);
    const expected = synced.filter(([key]) => !isAttachment(key));
    assert.deepEqual([...onPhone.keys()].sort(), expected.map(([key]) => key).sort());
    for (const [key, bytes] of expected) assert.ok(onPhone.get(key).equals(bytes), key);
    const attachments = synced.filter(([key]) => isAttachment(key)).map(([key]) => key);
    assert.ok(attachments.length >= 3, 'the fixture has an image, a file and a sheet');
    for (const key of attachments) assert.equal(await phone.service.hasRemoteAttachment(key), true, key);

    // The audit's only findings are the attachments that have not come down yet.
    const pending = desktopAudit(phoneRoot).issues;
    for (const issue of pending) {
        assert.equal(issue.code, 'attachment-target-missing', issueKeys({ issues: [issue] })[0]);
        assert.ok(
            attachments.some((key) => issue.message.endsWith(key.slice(key.indexOf('/') + 1))),
            issue.message
        );
    }

    // Opened, they come down byte for byte and the audit finds nothing.
    for (const key of attachments) assert.equal((await phone.service.fetchAttachment(key)).ok, true, key);
    const complete = snapshot(phoneRoot);
    for (const [key, bytes] of synced) assert.ok(complete.get(key)?.equals(bytes), key);
    assert.deepEqual(issueKeys(desktopAudit(phoneRoot)), baseline);
    phone.service.destroy();
});
