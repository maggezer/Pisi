'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const history = require('../main/functions/version-history-core');
const editorAssets = require('../main/functions/editor-asset-store');

function makeEntry(historyId, capturedAt, size) {
    return { historyId, capturedAt, size, reason: 'save', hash: historyId };
}

function makeFixture() {
    const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-history-cost-'));
    const nodePath = path.join(projectFolder, 'Large.node');
    const sidecarPath = path.join(projectFolder, 'Large - node_history_cost.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });
    const metadata = {
        version: 1,
        type: 'node',
        id: 'node_history_cost',
        title: 'Large',
        updatedAt: new Date().toISOString()
    };
    const writeNode = (content) => {
        fs.writeFileSync(nodePath, JSON.stringify({ pisi: metadata, content }, null, 2));
    };
    const ensurePisiFileMetadata = () => {
        const data = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
        return { ok: true, metadata: data.pisi, data, sidecarPath };
    };
    const writeFileAtomic = (filePath, content) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    };
    return {
        projectFolder,
        nodePath,
        sidecarPath,
        writeNode,
        options: { projectFolder, ensurePisiFileMetadata, writeFileAtomic }
    };
}

test('retention is bounded by count and bytes while always preserving the newest version', () => {
    const entries = [
        makeEntry('3-a.json.gz', '2026-08-16T03:00:00.000Z', 80),
        makeEntry('2-b.json.gz', '2026-08-16T02:00:00.000Z', 40),
        makeEntry('1-c.json.gz', '2026-08-16T01:00:00.000Z', 40)
    ];
    const selected = history.selectPisiVersionHistoryRetention(entries, {
        maxVersions: 50,
        maxBytes: 100
    });
    assert.deepEqual(
        selected.keep.map((entry) => entry.historyId),
        ['3-a.json.gz']
    );
    assert.deepEqual(
        selected.remove.map((entry) => entry.historyId),
        ['2-b.json.gz', '1-c.json.gz']
    );
    assert.equal(selected.bytes, 80);

    const oversized = history.selectPisiVersionHistoryRetention([makeEntry('4-big.json.gz', '2026-08-16T04:00:00.000Z', 500)], { maxBytes: 100 });
    assert.equal(oversized.keep.length, 1);
    assert.equal(oversized.keep[0].historyId, '4-big.json.gz');
});

test('history IDs accept only gzip snapshots without accepting traversal', () => {
    assert.equal(history.isPisiVersionHistoryId('123-test.json'), false);
    assert.equal(history.isPisiVersionHistoryId('123-test.json.gz'), true);
    assert.equal(history.isPisiVersionHistoryId('../123-test.json.gz'), false);
    assert.equal(history.isPisiVersionHistoryId('123\\test.json.gz'), false);
    assert.equal(history.isPisiVersionHistoryId('index.json'), false);
});

test('new snapshots are gzip compressed, indexed, deduplicated and readable', (t) => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.projectFolder, { recursive: true, force: true }));
    fixture.writeNode(`<p>${'repeatable text '.repeat(5000)}</p>`);

    const first = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'editor-save', fixture.options);
    assert.equal(first.ok, true);
    assert.equal(first.compressed, true);
    assert.match(first.historyId, /\.json\.gz$/);
    assert.ok(first.storedBytes < first.rawBytes);

    const duplicate = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'editor-save', fixture.options);
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.duplicate, true);

    const listed = history.listPisiNodeHistoryBounded(fixture.nodePath, fixture.options);
    assert.equal(listed.ok, true);
    assert.equal(listed.versions.length, 1);
    assert.equal(listed.versions[0].historyId, first.historyId);
    assert.equal(listed.versions[0].compressed, true);
    assert.equal(fs.existsSync(path.join(fixture.projectFolder, '.pisi-history', 'node_history_cost', 'index.json')), true);

    const loaded = history.getPisiNodeHistoryVersionBounded(fixture.nodePath, first.historyId, {
        ...fixture.options,
        pisiHtmlToPlainText: (value) => String(value).replace(/<[^>]+>/g, '')
    });
    assert.equal(loaded.ok, true);
    assert.match(loaded.text, /repeatable text/);
});

test('byte budget prunes older snapshots instead of letting a large node multiply indefinitely', async (t) => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.projectFolder, { recursive: true, force: true }));
    const options = { ...fixture.options, maxBytes: 1, maxVersions: 50 };

    fixture.writeNode(crypto.randomBytes(4096).toString('base64'));
    const first = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options);
    assert.equal(first.ok, true);

    // History ordering is millisecond based. Keep this retention test focused on
    // byte pruning rather than making two intentionally distinct snapshots share
    // the same timestamp and then relying on their content hash as a tiebreaker.
    await new Promise((resolve) => setTimeout(resolve, 2));
    fixture.writeNode(crypto.randomBytes(4096).toString('base64'));
    const second = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options);
    assert.equal(second.ok, true);
    assert.equal(second.retainedVersions, 1);

    const directory = path.join(fixture.projectFolder, '.pisi-history', 'node_history_cost');
    const snapshots = fs.readdirSync(directory).filter((name) => /\.json\.gz$/.test(name));
    assert.deepEqual(snapshots, [second.historyId]);
});

test('history retention garbage-collects sidecar assets no longer referenced by live content or kept snapshots', async (t) => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.projectFolder, { recursive: true, force: true }));

    const paintDirectory = path.join(fixture.sidecarPath, 'paint');
    fs.mkdirSync(paintDirectory, { recursive: true });

    const firstBytes = Buffer.from('first-paint-asset');
    const secondBytes = Buffer.from('second-paint-asset');
    const firstHash = crypto.createHash('sha256').update(firstBytes).digest('hex');
    const secondHash = crypto.createHash('sha256').update(secondBytes).digest('hex');
    const firstAsset = path.join(paintDirectory, `${firstHash}.png`);
    const secondAsset = path.join(paintDirectory, `${secondHash}.png`);

    fs.writeFileSync(firstAsset, firstBytes);
    fixture.writeNode(`<canvas data-pisi-canvas="1" data-pisi-asset="paint/${firstHash}.png"></canvas>`);

    const options = { ...fixture.options, maxVersions: 1, maxBytes: 1024 * 1024 };
    const first = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options);
    assert.equal(first.ok, true);
    assert.equal(fs.existsSync(firstAsset), true);

    await new Promise((resolve) => setTimeout(resolve, 2));

    fs.writeFileSync(secondAsset, secondBytes);
    fixture.writeNode(`<canvas data-pisi-canvas="1" data-pisi-asset="paint/${secondHash}.png"></canvas>`);
    const second = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options);

    assert.equal(second.ok, true);
    assert.equal(second.retainedVersions, 1);
    assert.equal(second.assetGc?.ok, true);
    assert.ok(second.assetGc?.removed?.includes(`paint/${firstHash}.png`));
    assert.equal(fs.existsSync(firstAsset), false);
    assert.equal(fs.existsSync(secondAsset), true);
});

for (const limit of ['count', 'bytes']) {
    test(`restore preserves target Canvas and Sheet assets when ${limit} retention evicts the target snapshot`, (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T10:00:00Z') });
        const fixture = makeFixture();
        t.after(() => fs.rmSync(fixture.projectFolder, { recursive: true, force: true }));
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=';
        const model = { databaseId: 'history-restore-sheet', fields: [], items: [{ value: 'retained cell' }], views: [] };
        const content =
            `<canvas data-pisi-canvas="1" data-image="data:image/png;base64,${png}"></canvas>` +
            `<table data-pisi-sheet="1" data-pisi-sheet-model='${JSON.stringify(model)}'></table>`;
        const normalized = editorAssets.normalizePisiEditorAssets(content, { sidecarPath: fixture.sidecarPath });
        const expectedAssets = normalized.assets.map((reference) => ({
            path: path.join(fixture.sidecarPath, reference),
            bytes: fs.readFileSync(path.join(fixture.sidecarPath, reference))
        }));
        assert.equal(expectedAssets.length, 2);
        const hydrated = editorAssets.hydratePisiEditorAssets(normalized.content, { sidecarPath: fixture.sidecarPath });
        const options = {
            ...fixture.options,
            ...(limit === 'bytes' ? { maxBytes: 1 } : {}),
            writePisiDocument: (nodePath, data) => fs.writeFileSync(nodePath, JSON.stringify(data))
        };
        fixture.writeNode(normalized.content);
        const target = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options);
        assert.equal(target.ok, true);
        const count = limit === 'count' ? history.PISI_VERSION_HISTORY_MAX_VERSIONS : 1;
        for (let index = 1; index < count; index++) {
            t.mock.timers.tick(1);
            fixture.writeNode(`<p>revision ${index}</p>`);
            assert.equal(history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options).ok, true);
        }
        assert.equal(history.listPisiNodeHistoryBounded(fixture.nodePath, options).versions.length, count);
        t.mock.timers.tick(1);
        fixture.writeNode('<p>current unsnapshotted content</p>');
        // Unrelated garbage must still be collected during restore.
        const orphan = path.join(fixture.sidecarPath, 'paint', `${'f'.repeat(64)}.png`);
        fs.writeFileSync(orphan, 'orphan');
        const restored = history.restorePisiNodeHistoryVersionBounded(fixture.nodePath, target.historyId, options);
        assert.equal(restored.ok, true, restored.error);
        assert.equal(fs.existsSync(target.snapshotPath), false, 'target snapshot must actually be evicted');
        assert.equal(fs.existsSync(orphan), false, 'GC remains enabled');
        for (const asset of expectedAssets) assert.deepEqual(fs.readFileSync(asset.path), asset.bytes);
        const document = JSON.parse(fs.readFileSync(fixture.nodePath, 'utf8'));
        assert.equal(document.content, normalized.content);
        assert.equal(editorAssets.hydratePisiEditorAssets(document.content, { sidecarPath: fixture.sidecarPath }), hydrated);
        // Protection is scoped to restore; subsequent snapshots use the live document.
        t.mock.timers.tick(1);
        assert.equal(history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', options).ok, true);
        for (const asset of expectedAssets) assert.deepEqual(fs.readFileSync(asset.path), asset.bytes);
    });
}

test('version-history IPC hooks replace unbounded save/list routes and skip project-wide backup scans', () => {
    const root = path.resolve(__dirname, '..');
    const hooks = fs.readFileSync(path.join(root, 'main/functions/version-history-operation-hooks.js'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'main.mjs'), 'utf8');

    for (const channel of [
        'project:save-node-content',
        'project:list-node-history',
        'project:get-node-history-version',
        'project:restore-node-history',
        'project:list-backups'
    ]) {
        assert.match(hooks, new RegExp(`removeHandler\\('${channel}'\\)`));
        assert.match(hooks, new RegExp(`handle\\('${channel}'`));
    }
    assert.match(hooks, /saveNodeContentWithBoundedHistory/);
    assert.match(hooks, /listPisiNodeHistoryBounded/);
    assert.match(hooks, /runPisiAtomicMutation\([\s\S]*version-history\.restore\.v1/);
    assert.match(hooks, /if \(!filePath\)[\s\S]*skippedProjectScan: true/);
    assert.ok(main.indexOf('version-history-operation-hooks') > main.indexOf('main/runtime'));
});

for (const parentMap of ['map_destination', 'none']) {
    test(`history restore preserves renamed node placement in ${parentMap}`, (t) => {
        const fixture = makeFixture();
        t.after(() => fs.rmSync(fixture.projectFolder, { recursive: true, force: true }));
        fixture.writeNode('<p>historical content</p>');
        const original = JSON.parse(fs.readFileSync(fixture.nodePath, 'utf8'));
        original.pisi.parentMap = 'map_source';
        original.pisi.sidecar = path.basename(fixture.sidecarPath);
        original.pisi.systemRole = 'old-role';
        original.properties = { status: 'historical' };
        fs.writeFileSync(fixture.nodePath, JSON.stringify(original));
        const target = history.snapshotPisiNodeVersionBounded(fixture.nodePath, 'save', fixture.options);
        assert.equal(target.ok, true);

        const destination = path.join(fixture.projectFolder, parentMap);
        fs.mkdirSync(destination);
        const movedPath = path.join(destination, 'Renamed.node');
        const movedSidecar = path.join(destination, 'Renamed - node_history_cost.pisi-node');
        fs.renameSync(fixture.nodePath, movedPath);
        fs.renameSync(fixture.sidecarPath, movedSidecar);
        const current = structuredClone(original);
        current.pisi = {
            version: 1,
            type: 'node',
            id: original.pisi.id,
            title: 'Renamed',
            sidecar: path.basename(movedSidecar),
            parentMap,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z'
        };
        current.content = '<p>current content</p>';
        current.properties = { status: 'current' };
        fs.writeFileSync(movedPath, JSON.stringify(current));
        const options = {
            ...fixture.options,
            ensurePisiFileMetadata: (filePath) => {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return { ok: true, metadata: data.pisi, data, sidecarPath: movedSidecar };
            },
            writePisiDocument: (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data))
        };
        const result = history.restorePisiNodeHistoryVersionBounded(movedPath, target.historyId, options);
        assert.equal(result.ok, true, result.error);
        const restored = JSON.parse(fs.readFileSync(movedPath, 'utf8'));
        assert.deepEqual(restored.pisi, { ...current.pisi, updatedAt: restored.pisi.updatedAt });
        assert.notEqual(restored.pisi.updatedAt, current.pisi.updatedAt);
        assert.equal(restored.content, original.content);
        assert.deepEqual(restored.properties, original.properties);
        assert.equal(fs.existsSync(fixture.nodePath), false);
        assert.equal(fs.existsSync(fixture.sidecarPath), false);
        assert.equal(fs.existsSync(movedSidecar), true);
        const versions = history.listPisiNodeHistoryBounded(movedPath, options);
        const beforeRestore = versions.versions.find((entry) => entry.reason === 'before-restore');
        assert.ok(beforeRestore);
        assert.deepEqual(history.getPisiNodeHistoryVersionBounded(movedPath, beforeRestore.historyId, options).data, current);
    });
}
