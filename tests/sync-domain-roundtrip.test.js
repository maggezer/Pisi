'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { modules, registerMainModule } = require('../main/module-registry');

let currentDevice = 'device_desktop_a';
registerMainModule('main.pathSecurity', {
    readSettings: () => ({
        pisiSync: { deviceId: currentDevice, deviceName: currentDevice, projects: {} }
    }),
    writeSettings: () => {}
});
registerMainModule('main.atomicMutation', {
    runPisiAtomicMutation: (_project, _command, operation) => operation()
});

const projectEntities = new Map();
const appliedConflicts = new Map();
registerMainModule('main.syncProjectAdapter', {
    exportPisiSyncEntities(project) {
        return structuredClone(projectEntities.get(project) || []);
    },
    applyPisiSyncRecords(project, records, conflicts) {
        projectEntities.set(
            project,
            records
                .filter(({ deleted }) => !deleted)
                .map(({ kind, id, payload }) => ({
                    kind,
                    id,
                    payload: structuredClone(payload)
                }))
        );
        appliedConflicts.set(project, conflicts.length);
        return { conflicts: conflicts.length, recoveredToSyncTrash: 0 };
    }
});

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
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

const node = (title) => ({
    kind: 'node',
    id: 'node_alpha',
    payload: { title, content: title }
});

test('açık projenin gerçek kökü sync hedefi olarak seçilebilir', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-root-'));
    const child = path.join(root, 'alt-klasor');
    fs.mkdirSync(child);
    try {
        assert.equal(domain.assertFolder(root, root), fs.realpathSync.native(root));
        assert.throws(() => domain.assertFolder(child, root), /Proje kökünün kendisini seçin/);
        currentDevice = 'device_desktop_root';
        projectEntities.set(root, [node('Kökteki gerçek not')]);
        const result = await domain.performPisiSync(root, root, 'project-root');
        assert.equal(result.filesVerified, 1);
        assert.ok(fs.existsSync(path.join(root, '.pisi-sync', 'manifest.json')));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('ortak klasör domaini iki bağımsız cihazda push, pull ve çakışma turunu tamamlar', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-domain-'));
    const shared = path.join(root, 'shared');
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    fs.mkdirSync(shared);
    fs.mkdirSync(projectA);
    fs.mkdirSync(projectB);
    projectEntities.set(projectA, [node('Desktop')]);
    projectEntities.set(projectB, []);
    try {
        currentDevice = 'device_desktop_a';
        await domain.performPisiSync(projectA, shared, 'test-a-push');
        currentDevice = 'device_mobile_b';
        await domain.performPisiSync(projectB, shared, 'test-b-pull');
        assert.equal(projectEntities.get(projectB)[0].payload.title, 'Desktop');

        projectEntities.set(projectB, [node('Mobile')]);
        await domain.performPisiSync(projectB, shared, 'test-b-push');
        currentDevice = 'device_desktop_a';
        await domain.performPisiSync(projectA, shared, 'test-a-pull');
        assert.equal(projectEntities.get(projectA)[0].payload.title, 'Mobile');

        projectEntities.set(projectA, [node('Desktop offline')]);
        projectEntities.set(projectB, [node('Mobile offline')]);
        currentDevice = 'device_mobile_b';
        await domain.performPisiSync(projectB, shared, 'test-conflict-b');
        currentDevice = 'device_desktop_a';
        const conflictResult = await domain.performPisiSync(projectA, shared, 'test-conflict-a');
        assert.equal(conflictResult.conflicts, 1);
        assert.equal(appliedConflicts.get(projectA), 1);

        const indexPath = path.join(shared, '.pisi-sync', 'devices', 'device_desktop_a', 'index.json');
        const indexBeforeRepeat = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const repeated = await domain.performPisiSync(projectA, shared, 'test-conflict-repeat');
        assert.equal(repeated.conflicts, 0, 'aynı uzak çakışma ikinci kez üretilmemeli');
        const indexAfterRepeat = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        assert.equal(indexAfterRepeat.createdAt, indexBeforeRepeat.createdAt, 'değişmeyen snapshot bulut klasörüne tekrar yazılmamalı');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function makePaintAsset(seed = 1) {
    const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed, seed + 1, seed + 2, seed + 3])]);
    const hash = require('node:crypto').createHash('sha256').update(buffer).digest('hex');

    return {
        buffer,
        hash,
        relativePath: `paint/${hash}.png`
    };
}

function nodeWithPaintAsset(title, asset, sidecar) {
    return {
        kind: 'node',
        id: 'node_asset_alpha',
        payload: {
            title,
            content: `<canvas data-pisi-canvas="1" data-pisi-asset="${asset.relativePath}"></canvas>`,
            relativePath: 'Asset.node',
            native: {
                pisi: {
                    sidecar
                }
            }
        }
    };
}

test('editor sidecar asset shared klasör üzerinden ikinci cihaza taşınır', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-editor-asset-'));
    const shared = path.join(root, 'shared');
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    const sidecarName = 'inv_Asset__node_asset_alpha';
    const asset = makePaintAsset(91);

    fs.mkdirSync(shared);
    fs.mkdirSync(projectA);
    fs.mkdirSync(projectB);

    const sidecarA = path.join(projectA, sidecarName, 'paint');
    fs.mkdirSync(sidecarA, { recursive: true });
    fs.writeFileSync(path.join(sidecarA, `${asset.hash}.png`), asset.buffer);

    projectEntities.set(projectA, [nodeWithPaintAsset('Desktop asset', asset, sidecarName)]);
    projectEntities.set(projectB, []);

    try {
        currentDevice = 'device_asset_a';
        const pushed = await domain.performPisiSync(projectA, shared, 'asset-push');

        assert.equal(pushed.editorAssetsUploaded >= 1, true);
        assert.equal(fs.existsSync(path.join(shared, '.pisi-sync', 'assets', 'paint', `${asset.hash}.png`)), true);

        currentDevice = 'device_asset_b';
        const pulled = await domain.performPisiSync(projectB, shared, 'asset-pull');

        assert.equal(pulled.editorAssetsDownloaded >= 1, true);
        assert.deepEqual(fs.readFileSync(path.join(projectB, sidecarName, 'paint', `${asset.hash}.png`)), asset.buffer);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
