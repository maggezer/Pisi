'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const history = require('../main/functions/version-history-core');

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
