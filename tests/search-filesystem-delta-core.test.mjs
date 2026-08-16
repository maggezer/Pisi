import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PISI_SEARCH_SCOPED_DELTA_MAX_PATHS,
    classifyPisiSearchChangedPaths,
    removePisiSearchMapMemberships,
    replacePisiSearchMapRecord,
    replacePisiSearchNodeRecords,
    upsertPisiSearchMapMembership
} from '../renderer/search/pisi-search-filesystem-delta-core.mjs';

test('node and map filesystem changes stay document scoped while unrelated files are ignored', () => {
    const result = classifyPisiSearchChangedPaths([
        '/Project/A.node',
        '/Project/Map.map',
        '/Project/.pisi/tasks.json',
        '/Project/A.node'
    ]);

    assert.equal(result.mode, 'scoped');
    assert.deepEqual(result.nodePaths, ['/Project/A.node']);
    assert.deepEqual(result.mapPaths, ['/Project/Map.map']);
    assert.deepEqual(result.ignoredPaths, ['/Project/.pisi/tasks.json']);
});

test('directory ambiguity and oversized source batches fail closed to rebuild', () => {
    const ambiguous = classifyPisiSearchChangedPaths(['/Project/Folder']);
    assert.equal(ambiguous.mode, 'rebuild');
    assert.equal(ambiguous.reason, 'ambiguous-path');

    const oversized = classifyPisiSearchChangedPaths(
        Array.from(
            { length: PISI_SEARCH_SCOPED_DELTA_MAX_PATHS + 1 },
            (_, index) => `/Project/N${index}.node`
        )
    );
    assert.equal(oversized.mode, 'rebuild');
    assert.equal(oversized.reason, 'delta-too-large');
});

test('non search source changes do not invalidate the search projection', () => {
    const result = classifyPisiSearchChangedPaths([
        '/Project/readme.md',
        '/Project/.pisi/tasks.json',
        '/Project/image.png'
    ]);
    assert.equal(result.mode, 'ignore');
    assert.equal(result.nodePaths.length, 0);
    assert.equal(result.mapPaths.length, 0);
});

test('node record replacement removes every projection row owned by the changed document', () => {
    const records = [
        { id: 'node:a', kind: 'node', nodePath: '/Project/A.node' },
        { id: 'content:a:1', kind: 'content', nodePath: '/Project/A.node' },
        { id: 'node:b', kind: 'node', nodePath: '/Project/B.node' }
    ];
    const next = replacePisiSearchNodeRecords(records, '/project/a.node', [
        { id: 'node:a2', kind: 'node', nodePath: '/Project/A.node' }
    ]);
    assert.deepEqual(next.map((record) => record.id), ['node:b', 'node:a2']);
});

test('map record and membership helpers change presentation projection only', () => {
    const memberships = [
        { mapPath: '/Project/One.map', mapTitle: 'One' },
        { mapPath: '/Project/Two.map', mapTitle: 'Two' }
    ];
    const replacedMemberships = upsertPisiSearchMapMembership(memberships, {
        mapPath: '/project/one.map',
        mapTitle: 'One renamed'
    });
    assert.equal(replacedMemberships.length, 2);
    assert.equal(replacedMemberships.at(-1).mapTitle, 'One renamed');
    assert.deepEqual(
        removePisiSearchMapMemberships(replacedMemberships, '/Project/One.map')
            .map((item) => item.mapTitle),
        ['Two']
    );

    const records = [
        { id: 'map:one', kind: 'map', mapPath: '/Project/One.map' },
        { id: 'node:a', kind: 'node', nodePath: '/Project/A.node' }
    ];
    const next = replacePisiSearchMapRecord(records, '/project/one.map', {
        id: 'map:one-new',
        kind: 'map',
        mapPath: '/Project/One.map'
    });
    assert.deepEqual(next.map((record) => record.id), ['node:a', 'map:one-new']);
});