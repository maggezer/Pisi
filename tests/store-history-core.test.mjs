import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PISI_STORE_HISTORY_BUDGETS,
    PISI_STORE_HISTORY_INTERVAL_MS,
    createPisiStoreHistoryScheduler,
    isPisiStoreSnapshotDue,
    listPisiStoreHistory,
    readPisiStoreHistoryVersion,
    resolvePisiStoreHistoryTarget,
    snapshotPisiStoreFile
} from '../main/functions/store-history-core.js';

function makeProject(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-store-history-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (relative, value) => {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
        return target;
    };
    return { root, write };
}

test('targets: the five store files and live maps by id; nothing else', (t) => {
    const { root, write } = makeProject(t);
    write('.pisi/tasks.json', { tasks: [] });
    write('Harita.map', { pisi: { id: 'map_abc' }, map: {} });
    write('.pisi/trash/items/x/Old.map', { pisi: { id: 'map_old' }, map: {} });
    assert.deepEqual(
        Object.fromEntries(
            ['.pisi/tasks.json', '.pisi/relationships.json', '.pisi/properties.json', '.pisi-views.json', '.pisi-templates.json'].map((file) => [
                file,
                resolvePisiStoreHistoryTarget(root, path.join(root, file))?.key
            ])
        ),
        {
            '.pisi/tasks.json': 'tasks',
            '.pisi/relationships.json': 'relationships',
            '.pisi/properties.json': 'properties',
            '.pisi-views.json': 'views',
            '.pisi-templates.json': 'templates'
        }
    );
    assert.equal(resolvePisiStoreHistoryTarget(root, path.join(root, 'Harita.map')).key, 'map-map_abc');
    assert.equal(resolvePisiStoreHistoryTarget(root, path.join(root, '.pisi/trash/items/x/Old.map')), null, 'maps in hidden folders are not live');
    assert.equal(resolvePisiStoreHistoryTarget(root, path.join(root, 'Not.node')), null);
    assert.equal(resolvePisiStoreHistoryTarget(root, path.join(os.tmpdir(), 'tasks.json')), null, 'outside the project');
});

test('the interval: due without a snapshot, then only after five minutes', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    assert.equal(PISI_STORE_HISTORY_INTERVAL_MS, 5 * 60 * 1000);
    assert.equal(isPisiStoreSnapshotDue(null, now), true);
    assert.equal(isPisiStoreSnapshotDue('2026-11-07T11:56:00Z', now), false);
    assert.equal(isPisiStoreSnapshotDue('2026-11-07T11:55:00Z', now), true);
    assert.equal(isPisiStoreSnapshotDue('bozuk', now), true);
});

test('scheduler: the state before a change is kept, at most once per interval; close keeps the latest', (t) => {
    const { root, write } = makeProject(t);
    let clock = Date.parse('2026-11-07T12:00:00Z');
    const file = write('.pisi/tasks.json', { tasks: [{ id: 'task_1' }] });
    const target = resolvePisiStoreHistoryTarget(root, file);
    const scheduler = createPisiStoreHistoryScheduler({
        now: () => clock,
        lastSnapshotAt: (item) => listPisiStoreHistory(root, item.key)[0]?.capturedAt || null,
        snapshot: (item, reason) => snapshotPisiStoreFile(root, item, { reason, now: clock })
    });
    const summaries = () => listPisiStoreHistory(root, 'tasks').map((entry) => `${entry.reason}:${entry.preview}`);

    scheduler.beforeWrite(target); // state with 1 task is kept before the first write
    write('.pisi/tasks.json', { tasks: [{ id: 'task_1' }, { id: 'task_2' }] });
    clock += 60 * 1000;
    scheduler.beforeWrite(target); // within five minutes: no new snapshot
    write('.pisi/tasks.json', { tasks: [{ id: 'task_1' }, { id: 'task_2' }, { id: 'task_3' }] });
    assert.deepEqual(summaries(), ['auto:1 görev']);

    clock += 5 * 60 * 1000;
    scheduler.beforeWrite(target); // interval passed: the state before this write (3 tasks) is kept
    write('.pisi/tasks.json', { tasks: [] });
    assert.deepEqual(summaries(), ['auto:3 görev', 'auto:1 görev']);

    scheduler.flush('close');
    assert.deepEqual(summaries(), ['close:0 görev', 'auto:3 görev', 'auto:1 görev']);
    assert.deepEqual(scheduler.dirtyKeys(), []);
    scheduler.flush('close');
    assert.equal(summaries().length, 3, 'nothing dirty, nothing written');
});

test('identical content is never stored twice; a version reads back exactly', (t) => {
    const { root, write } = makeProject(t);
    const text = '{\n  "version": 1,\n  "relationships": [ { "id": "edge_1" } ]\n}\n';
    const file = write('.pisi/relationships.json', text);
    const target = resolvePisiStoreHistoryTarget(root, file);
    const first = snapshotPisiStoreFile(root, target, { reason: 'auto' });
    assert.equal(first.ok, true);
    assert.equal(snapshotPisiStoreFile(root, target).duplicate, true);
    const version = readPisiStoreHistoryVersion(root, 'relationships', first.historyId);
    assert.equal(version.raw, text, 'the exact text is kept');
    assert.equal(version.data.relationships[0].id, 'edge_1');
    assert.equal(readPisiStoreHistoryVersion(root, 'tasks', first.historyId).ok, false, 'a version belongs to one store');
    assert.equal(readPisiStoreHistoryVersion(root, 'relationships', '../x').ok, false);
    const stored = fs.readdirSync(path.join(root, '.pisi-history', 'stores', 'relationships'));
    assert.ok(stored.some((name) => name.endsWith('.json.gz')) && stored.includes('index.json'), 'gzip snapshots and an index');
});

test('retention: per-store version count and byte budget, newest always kept', (t) => {
    const { root, write } = makeProject(t);
    assert.deepEqual(PISI_STORE_HISTORY_BUDGETS.tasks, { maxVersions: 50, maxBytes: 24 * 1024 * 1024 });
    assert.deepEqual(PISI_STORE_HISTORY_BUDGETS.map, { maxVersions: 30, maxBytes: 8 * 1024 * 1024 });
    assert.deepEqual(PISI_STORE_HISTORY_BUDGETS.views, { maxVersions: 30, maxBytes: 4 * 1024 * 1024 });
    const file = write('Harita.map', { pisi: { id: 'map_ret' }, map: { nodes: [] } });
    const target = resolvePisiStoreHistoryTarget(root, file);
    let clock = Date.parse('2026-11-07T00:00:00Z');
    for (let index = 0; index < 35; index += 1) {
        write('Harita.map', { pisi: { id: 'map_ret' }, map: { nodes: Array.from({ length: index }, (_v, i) => ({ id: `n${i}` })) } });
        clock += 1000;
        snapshotPisiStoreFile(root, target, { now: clock });
    }
    const entries = listPisiStoreHistory(root, 'map-map_ret');
    assert.equal(entries.length, 30, 'maps keep 30 versions');
    assert.equal(entries[0].preview, '34 not kartı', 'the newest is first');

    // A single version larger than the byte budget is still kept when it is the newest.
    const big = write('.pisi-views.json', { views: [{ id: 'v', blob: crypto.randomUUID().repeat(200000) }] });
    const viewTarget = resolvePisiStoreHistoryTarget(root, big);
    snapshotPisiStoreFile(root, viewTarget);
    write('.pisi-views.json', { views: [{ id: 'v2', blob: crypto.randomUUID().repeat(200000) }] });
    snapshotPisiStoreFile(root, viewTarget);
    const views = listPisiStoreHistory(root, 'views');
    assert.ok(views.length >= 1 && views.reduce((sum, entry) => sum + entry.size, 0) <= 4 * 1024 * 1024 + views[0].size);
});
