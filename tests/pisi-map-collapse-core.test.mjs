import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectPisiCollapsedHubNodeIds,
    isPisiMapEdgeHiddenByCollapsedHub,
    makePisiCollapsedHubPortKey
} from '../renderer/map/pisi-map-collapse-core.mjs';

const hierarchyEdge = (
    id,
    sourceId,
    targetId,
    sourcePort = 'right',
    targetPort = 'left'
) => ({
    id,
    sourceId,
    targetId,
    sourcePort,
    targetPort,
    type: 'down-hub',
    sourceRole: 'down-hub',
    targetRole: 'up-hub'
});

const edges = [
    hierarchyEdge('root-right', 'root', 'right-child', 'right'),
    hierarchyEdge('root-bottom', 'root', 'bottom-child', 'bottom', 'top'),
    hierarchyEdge('right-grandchild', 'right-child', 'right-grandchild', 'bottom', 'top'),
    hierarchyEdge('bottom-grandchild', 'bottom-child', 'bottom-grandchild', 'bottom', 'top'),
    {
        id: 'related-note',
        sourceId: 'right-grandchild',
        targetId: 'related-note',
        sourcePort: 'right',
        targetPort: 'left',
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    }
];

test('yalnızca tıklanan porttan başlayan alt node ağacını toplar', () => {
    const collapsedKeys = new Set([
        makePisiCollapsedHubPortKey('root', 'right')
    ]);
    const hiddenNodeIds = collectPisiCollapsedHubNodeIds(edges, collapsedKeys);

    assert.deepEqual(
        [...hiddenNodeIds].sort(),
        ['right-child', 'right-grandchild']
    );
    assert.equal(hiddenNodeIds.has('bottom-child'), false);
    assert.equal(hiddenNodeIds.has('bottom-grandchild'), false);
});

test('gizlenen alt nodea bağlı tüm bağlantıları görünmez sayar', () => {
    const collapsedKeys = new Set([
        makePisiCollapsedHubPortKey('root', 'right')
    ]);
    const hiddenNodeIds = collectPisiCollapsedHubNodeIds(edges, collapsedKeys);

    assert.equal(
        isPisiMapEdgeHiddenByCollapsedHub(edges[0], hiddenNodeIds, collapsedKeys),
        true
    );
    assert.equal(
        isPisiMapEdgeHiddenByCollapsedHub(edges[4], hiddenNodeIds, collapsedKeys),
        true
    );
    assert.equal(
        isPisiMapEdgeHiddenByCollapsedHub(edges[1], hiddenNodeIds, collapsedKeys),
        false
    );
});

test('iç içe port daraltmaları üst dal tekrar açıldığında korunur', () => {
    const nestedCollapse = makePisiCollapsedHubPortKey('right-child', 'bottom');
    const parentCollapse = makePisiCollapsedHubPortKey('root', 'right');
    const collapsedKeys = new Set([nestedCollapse, parentCollapse]);

    assert.deepEqual(
        [...collectPisiCollapsedHubNodeIds(edges, collapsedKeys)].sort(),
        ['right-child', 'right-grandchild']
    );

    collapsedKeys.delete(parentCollapse);

    assert.deepEqual(
        [...collectPisiCollapsedHubNodeIds(edges, collapsedKeys)],
        ['right-grandchild']
    );
});

test('bozuk döngüsel hiyerarşi verisinde hesaplama sonlanır', () => {
    const cyclicEdges = [
        hierarchyEdge('a-b', 'a', 'b'),
        hierarchyEdge('b-a', 'b', 'a')
    ];
    const hiddenNodeIds = collectPisiCollapsedHubNodeIds(cyclicEdges, [
        makePisiCollapsedHubPortKey('a', 'right')
    ]);

    assert.deepEqual([...hiddenNodeIds], ['b']);
});
