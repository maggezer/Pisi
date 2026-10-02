'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storageLayer = require('../main/functions/storage');
const bridge = require('../main/functions/storage-project-fs-bridge');

function makeTempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-storage-wave2-'));
}

test('active project document and sidecar fs operations route through project storage', () => {
    const project = makeTempProject();
    const nodePath = path.join(project, 'Alpha.node');
    const renamedPath = path.join(project, 'Beta.node');
    const sidecarPath = path.join(project, 'inv_Alpha__node_demo1234');
    fs.writeFileSync(nodePath, '{"pisi":{"type":"node"}}', 'utf8');

    bridge.resetPisiStorageFsBridgeStats();
    try {
        bridge.runPisiStorageBridgeForProject(project, () => {
            assert.equal(fs.existsSync(nodePath), true);
            assert.match(fs.readFileSync(nodePath, 'utf8'), /"node"/);
            assert.equal(fs.statSync(nodePath).isFile(), true);

            const initialEntries = fs.readdirSync(project, { withFileTypes: true });
            assert.equal(
                initialEntries.some((entry) => entry.name === 'Alpha.node' && entry.isFile()),
                true
            );

            fs.mkdirSync(sidecarPath, { recursive: true });
            assert.equal(fs.statSync(sidecarPath).isDirectory(), true);

            fs.renameSync(nodePath, renamedPath);
            assert.equal(fs.existsSync(renamedPath), true);
            fs.unlinkSync(renamedPath);
            assert.equal(fs.existsSync(renamedPath), false);
        });

        const stats = bridge.getPisiStorageFsBridgeStats();
        assert.ok(stats.exists >= 3, `expected routed exists calls, got ${stats.exists}`);
        assert.ok(stats.read >= 1, `expected routed read calls, got ${stats.read}`);
        assert.ok(stats.list >= 1, `expected routed list calls, got ${stats.list}`);
        assert.ok(stats.stat >= 2, `expected routed stat calls, got ${stats.stat}`);
        assert.ok(stats.mkdir >= 1, `expected routed mkdir calls, got ${stats.mkdir}`);
        assert.ok(stats.rename >= 1, `expected routed rename calls, got ${stats.rename}`);
        assert.ok(stats.remove >= 1, `expected routed remove calls, got ${stats.remove}`);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('storage driver IO does not recurse back into the fs bridge', () => {
    const project = makeTempProject();
    try {
        bridge.runPisiStorageBridgeForProject(project, () => {
            const storage = storageLayer.getPisiProjectStorage(project);
            const write = storage.writeJson(
                '.pisi/bridge-driver.json',
                {
                    version: 1,
                    ok: true
                },
                { backup: false }
            );
            assert.equal(write.ok, true);

            const read = storage.readJson('.pisi/bridge-driver.json');
            assert.equal(read.ok, true);
            assert.equal(read.data.ok, true);
        });
    } finally {
        storageLayer.clearPisiProjectStorageCache(project);
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('atomic journal and paths outside the active project remain infrastructure IO', () => {
    const project = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-storage-outside-'));
    const mutationDir = path.join(project, '.pisi', 'mutations');
    const mutationFile = path.join(mutationDir, 'manifest.json');
    const outsideFile = path.join(outside, 'outside.txt');
    fs.mkdirSync(mutationDir, { recursive: true });
    fs.writeFileSync(mutationFile, '{}', 'utf8');
    fs.writeFileSync(outsideFile, 'outside', 'utf8');

    bridge.resetPisiStorageFsBridgeStats();
    try {
        bridge.runPisiStorageBridgeForProject(project, () => {
            assert.equal(fs.readFileSync(mutationFile, 'utf8'), '{}');
            assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
        });
        const stats = bridge.getPisiStorageFsBridgeStats();
        assert.equal(stats.read, 0);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('binary reads stay at the physical IO layer while UTF-8 document reads use storage', () => {
    const project = makeTempProject();
    const filePath = path.join(project, 'Binary.node');
    fs.writeFileSync(filePath, Buffer.from([0x50, 0x49, 0x53, 0x49]));

    bridge.resetPisiStorageFsBridgeStats();
    try {
        bridge.runPisiStorageBridgeForProject(project, () => {
            const binary = fs.readFileSync(filePath);
            assert.equal(Buffer.isBuffer(binary), true);
            assert.equal(binary.toString('utf8'), 'PISI');
            assert.equal(fs.readFileSync(filePath, 'utf8'), 'PISI');
        });
        const stats = bridge.getPisiStorageFsBridgeStats();
        assert.equal(stats.read, 1);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});
