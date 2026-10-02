'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

function node(id, fullPath) {
    return {
        id,
        fullPath,
        metadata: { title: id, updatedAt: '2026-08-15T10:00:00.000Z' },
        properties: {}
    };
}

function task(id, nodePath, priority) {
    return {
        id,
        title: id,
        status: 'todo',
        priority,
        dependencies: [],
        source: { nodePath }
    };
}

test('operational Next respects Pisi priority direction: 5 outranks 1', async () => {
    const core = await import(pathToFileURL(path.join(root, 'renderer/map/pisi-map-operational-core.mjs')).href);
    const nodes = [node('node_low', '/project/low.node'), node('node_high', '/project/high.node')];
    const states = core.buildPisiOperationalNodeStates(
        nodes,
        [task('task_low', '/project/low.node', 1), task('task_high', '/project/high.node', 5)],
        Date.parse('2026-08-15T12:00:00Z')
    );

    assert.equal(states.get('node_high').highestPriority, 5);
    assert.deepEqual(
        core.rankPisiOperationalNextNodes(nodes, states).map((item) => item.node.id),
        ['node_high', 'node_low']
    );
});
