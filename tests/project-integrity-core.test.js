'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const integrity = require('../main/functions/project-integrity-core');

test('integrity issue identities are deterministic but distinct by code path and entity', () => {
    const first = integrity.makePisiIntegrityIssue({
        severity: 'error',
        code: 'task-source-node-missing',
        domain: 'tasks',
        path: '.pisi/tasks.json',
        entityId: 'task_demo',
        message: 'missing'
    });
    const same = integrity.makePisiIntegrityIssue({
        severity: 'error',
        code: 'task-source-node-missing',
        domain: 'tasks',
        path: '.pisi/tasks.json',
        entityId: 'task_demo',
        message: 'missing'
    });
    const other = integrity.makePisiIntegrityIssue({
        severity: 'error',
        code: 'task-dependency-missing',
        domain: 'tasks',
        path: '.pisi/tasks.json',
        entityId: 'task_demo',
        message: 'missing'
    });
    assert.equal(first.id, same.id);
    assert.notEqual(first.id, other.id);
});

test('integrity summary separates severity and repair safety', () => {
    const report = integrity.makePisiIntegrityReport(
        [
            {
                severity: 'critical',
                code: 'duplicate-id',
                message: 'duplicate',
                repair: {
                    safety: 'manual',
                    action: 'resolve-id',
                    description: 'manual'
                }
            },
            {
                severity: 'warning',
                code: 'missing-sidecar',
                message: 'sidecar',
                repair: {
                    safety: 'safe',
                    action: 'ensure-sidecar',
                    description: 'safe'
                }
            },
            {
                severity: 'error',
                code: 'task-source',
                message: 'source',
                repair: {
                    safety: 'review',
                    action: 'review-task',
                    description: 'review'
                }
            }
        ],
        {
            files: 4,
            nodes: 2,
            maps: 1,
            tasks: 3,
            relationships: 2,
            trashItems: 1,
            mutationJournals: 1
        }
    );

    assert.equal(report.healthy, false);
    assert.equal(report.clean, false);
    assert.equal(report.summary.critical, 1);
    assert.equal(report.summary.errors, 1);
    assert.equal(report.summary.warnings, 1);
    assert.equal(report.summary.safeRepairs, 1);
    assert.equal(report.summary.reviewRepairs, 1);
    assert.equal(report.summary.manualRepairs, 1);
    assert.equal(report.summary.tasks, 3);
    assert.equal(report.summary.relationships, 2);
});

test('integrity issues sort critical before error warning and info', () => {
    const report = integrity.makePisiIntegrityReport([
        { severity: 'info', code: 'i', message: 'i' },
        { severity: 'warning', code: 'w', message: 'w' },
        { severity: 'critical', code: 'c', message: 'c' },
        { severity: 'error', code: 'e', message: 'e' }
    ]);
    assert.deepEqual(
        report.issues.map((issue) => issue.severity),
        ['critical', 'error', 'warning', 'info']
    );
});

test('integrity ID validation keeps canonical identity namespaces distinct', () => {
    assert.equal(integrity.validPisiIntegrityId('node', 'node_abc_123'), true);
    assert.equal(integrity.validPisiIntegrityId('map', 'map_abc_123'), true);
    assert.equal(integrity.validPisiIntegrityId('task', 'task_abc:123'), true);
    assert.equal(integrity.validPisiIntegrityId('relationship', 'edge_abc_123'), true);
    assert.equal(integrity.validPisiIntegrityId('node', 'map_abc_123'), false);
    assert.equal(integrity.validPisiIntegrityId('task', 'node_abc_123'), false);
});

test('integrity project path guard rejects traversal outside project', () => {
    const root = process.platform === 'win32' ? 'C:\\Pisi\\Project' : '/tmp/Pisi/Project';
    const inside = process.platform === 'win32' ? 'C:\\Pisi\\Project\\Map.node' : '/tmp/Pisi/Project/Map.node';
    const outside = process.platform === 'win32' ? 'C:\\Pisi\\Elsewhere\\Map.node' : '/tmp/Pisi/Elsewhere/Map.node';
    assert.equal(integrity.isPisiIntegrityPathInsideProject(root, inside), true);
    assert.equal(integrity.isPisiIntegrityPathInsideProject(root, outside), false);
});

test('duplicate collector reports later occurrences without losing first owner', () => {
    const duplicates = integrity.collectDuplicateValues([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }], (item) => item.id);
    assert.deepEqual(
        duplicates.map((item) => [item.value, item.firstIndex, item.index]),
        [
            ['a', 0, 2],
            ['a', 0, 3]
        ]
    );
});
