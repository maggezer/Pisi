import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PISI_PROJECTION_INDEX_CONTRACT_VERSION,
    PISI_PROJECTION_INDEX_STATES,
    createPisiRebuildableProjectionIndex,
    makePisiProjectionSourceFingerprint
} from '../renderer/search/pisi-projection-index-core.mjs';
import { PISI_SEARCH_MEMORY_DRIVER_ID, createPisiRebuildableSearchIndex } from '../renderer/search/pisi-search-index-adapter.mjs';
import { searchPisiIndex } from '../renderer/search/pisi-search-core.mjs';

test('projection fingerprint is deterministic and independent of source enumeration order', () => {
    const first = makePisiProjectionSourceFingerprint(['node:b:2', 'node:a:1', 'task:t1:todo']);
    const second = makePisiProjectionSourceFingerprint(['task:t1:todo', 'node:a:1', 'node:b:2']);
    const changed = makePisiProjectionSourceFingerprint(['task:t1:done', 'node:a:1', 'node:b:2']);
    assert.equal(first, second);
    assert.notEqual(first, changed);
    assert.match(first, /^fp1:/);
});

test('rebuildable search projection exposes a versioned disposable manifest', () => {
    const index = createPisiRebuildableSearchIndex('search-test');
    const snapshot = index.replaceAll([{ id: 'node:a', kind: 'node', title: 'Alpha', searchFields: [{ kind: 'title', value: 'Alpha' }] }], {
        sourceFingerprint: 'fp1:test'
    });

    assert.equal(snapshot.projection.contractVersion, PISI_PROJECTION_INDEX_CONTRACT_VERSION);
    assert.equal(snapshot.projection.schemaVersion, 1);
    assert.equal(snapshot.projection.driver, PISI_SEARCH_MEMORY_DRIVER_ID);
    assert.equal(snapshot.projection.state, PISI_PROJECTION_INDEX_STATES.READY);
    assert.equal(snapshot.projection.sourceFingerprint, 'fp1:test');
    assert.equal(snapshot.projection.recordCount, 1);
    assert.equal(searchPisiIndex(snapshot, 'alpha')[0]?.id, 'node:a');
});

test('delta gateway upserts and removes records without changing the consumer index shape', () => {
    const index = createPisiRebuildableSearchIndex('search-test');
    index.replaceAll(
        [
            { id: 'node:a', kind: 'node', title: 'Alpha', searchFields: [{ kind: 'title', value: 'Alpha' }] },
            { id: 'task:old', kind: 'task', title: 'Old task', searchFields: [{ kind: 'task', value: 'Old task' }] }
        ],
        { sourceFingerprint: 'fp1:before' }
    );

    const delta = index.applyDelta(
        {
            remove: ['task:old'],
            upsert: [{ id: 'task:new', kind: 'task', title: 'New task', searchFields: [{ kind: 'task', value: 'New task' }] }]
        },
        { sourceFingerprint: 'fp1:after' }
    );

    assert.equal(delta.ok, true);
    assert.ok(Array.isArray(delta.records));
    assert.ok(delta.accelerator?.postings instanceof Map);
    assert.deepEqual(
        delta.records.map((record) => record.id),
        ['node:a', 'task:new']
    );
    assert.equal(delta.projection.sourceFingerprint, 'fp1:after');
    assert.equal(searchPisiIndex(delta, 'new task')[0]?.id, 'task:new');
    assert.equal(searchPisiIndex(delta, 'old task').length, 0);
});

test('stale projection refuses deltas until rebuilt and compatibility is fail closed', () => {
    const index = createPisiRebuildableSearchIndex('search-test');
    const ready = index.replaceAll([], { sourceFingerprint: 'fp1:ready' });
    assert.equal(index.isCompatible(ready.projection), true);
    assert.equal(index.isCompatible({ ...ready.projection, schemaVersion: 99 }), false);

    const stale = index.invalidate('filesystem');
    assert.equal(stale.state, PISI_PROJECTION_INDEX_STATES.STALE);
    const delta = index.applyDelta({ upsert: [{ id: 'node:a' }] });
    assert.equal(delta.ok, false);
    assert.equal(delta.requiresRebuild, true);

    const rebuilt = index.replaceAll([{ id: 'node:a', title: 'A' }], {
        sourceFingerprint: 'fp1:rebuilt'
    });
    assert.equal(rebuilt.projection.state, PISI_PROJECTION_INDEX_STATES.READY);
    assert.equal(rebuilt.projection.recordCount, 1);
});

test('generic projection contract owns lifecycle but not domain semantics', () => {
    let records = [];
    const driver = {
        id: 'test-driver',
        replaceAll(next) {
            records = [...next];
        },
        applyDelta({ upsert = [], remove = [] }) {
            const removed = new Set(remove);
            const byId = new Map(records.filter((record) => !removed.has(record.id)).map((record) => [record.id, record]));
            upsert.forEach((record) => byId.set(record.id, record));
            records = [...byId.values()];
        },
        snapshot() {
            return { records: [...records], payload: 'opaque' };
        },
        clear() {
            records = [];
        }
    };
    const projection = createPisiRebuildableProjectionIndex({
        name: 'opaque-projection',
        schemaVersion: 3,
        driver
    });
    const snapshot = projection.replaceAll([{ id: 'anything', arbitrary: true }]);
    assert.equal(snapshot.payload, 'opaque');
    assert.equal(snapshot.records[0].arbitrary, true);
    assert.equal(snapshot.projection.schemaVersion, 3);
});
