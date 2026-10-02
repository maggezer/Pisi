'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const trash = require('../main/functions/trash-core');

test('trash path coverage is project-relative and segment safe', () => {
    assert.equal(trash.isPisiTrashPathCovered('Area/Map.nodes/a.node', ['Area']), true);
    assert.equal(trash.isPisiTrashPathCovered('Area2/a.node', ['Area']), false);
    assert.equal(trash.isPisiTrashPathCovered('Area/map.node', ['Area/map.node']), true);
    assert.equal(trash.isPisiTrashPathCovered('area/map.node', ['Area']), process.platform === 'win32');
});

test('trash relative path normalization rejects traversal', () => {
    assert.equal(trash.normalizePisiTrashRelativePath('Folder\\node.node'), 'Folder/node.node');
    assert.equal(trash.normalizePisiTrashRelativePath('../outside.node'), null);
    assert.equal(trash.normalizePisiTrashRelativePath('Folder/../outside.node'), null);
    assert.equal(trash.normalizePisiTrashRelativePath('/Folder/map.map'), 'Folder/map.map');
});

test('tasks sourced from deleted roots are archived and surviving dependencies are detached', () => {
    const tasks = [
        {
            id: 'task_deleted',
            source: { nodePath: 'Folder/A.node', mapPath: null },
            dependencies: []
        },
        {
            id: 'task_live',
            source: { nodePath: 'Elsewhere/B.node', mapPath: null },
            dependencies: ['task_deleted', 'task_other']
        }
    ];
    const split = trash.splitPisiTrashTaskStore(tasks, ['Folder']);
    assert.deepEqual(
        split.archived.map((task) => task.id),
        ['task_deleted']
    );
    assert.deepEqual(split.remaining[0].dependencies, ['task_other']);
    assert.deepEqual(split.dependencyRefs, [
        {
            taskId: 'task_live',
            dependencies: ['task_deleted']
        }
    ]);
});

test('restoring tasks merges only archived dependency edges and keeps later dependencies', () => {
    const tasks = [
        { id: 'task_live', dependencies: ['task_added_later'] },
        { id: 'task_deleted', dependencies: [] }
    ];
    const restored = trash.mergePisiTrashTaskDependencies(
        tasks,
        [{ taskId: 'task_live', dependencies: ['task_deleted', 'task_not_restored'] }],
        new Set(['task_deleted'])
    );
    assert.deepEqual(restored.find((task) => task.id === 'task_live').dependencies, ['task_added_later', 'task_deleted']);
});

test('semantic relationships touching deleted node identities are archived', () => {
    const relationships = [
        { id: 'edge_a', sourceId: 'node_deleted', targetId: 'node_live' },
        { id: 'edge_b', sourceId: 'node_live', targetId: 'node_deleted_2' },
        { id: 'edge_c', sourceId: 'node_live', targetId: 'node_other' }
    ];
    const split = trash.splitPisiTrashRelationships(relationships, new Set(['node_deleted', 'node_deleted_2']));
    assert.deepEqual(
        split.archived.map((edge) => edge.id),
        ['edge_a', 'edge_b']
    );
    assert.deepEqual(
        split.remaining.map((edge) => edge.id),
        ['edge_c']
    );
});

test('trash summary exposes reviewable linked-record counts without payload internals', () => {
    const summary = trash.summarizePisiTrashManifest({
        version: 1,
        id: 'trash_example',
        kind: 'map',
        label: 'Plan.map',
        deletedAt: '2026-08-16T00:00:00.000Z',
        originalTarget: 'Plan.map',
        entries: [{}, {}],
        nodeIds: ['n1', 'n2'],
        mapIds: ['m1'],
        references: {
            tasks: [{ id: 't1' }],
            relationships: [{ id: 'r1' }, { id: 'r2' }],
            mapReferences: [{ mapPath: 'Other.map' }]
        }
    });
    assert.equal(summary.entryCount, 2);
    assert.equal(summary.nodeCount, 2);
    assert.equal(summary.mapCount, 1);
    assert.equal(summary.taskCount, 1);
    assert.equal(summary.relationshipCount, 2);
    assert.equal(summary.mapReferenceCount, 1);
    assert.equal(Object.hasOwn(summary, 'references'), false);
});
