// shared/map-view.mjs: the map drawing rules the desktop map and the mobile
// map viewer share (collapsed hubs, port points, connection curves).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sharedMapView from '../shared/map-view.mjs';
import * as rendererCollapseCore from '../renderer/map/pisi-map-collapse-core.mjs';
import * as rendererInteractionHelpers from '../renderer/map/pisi-map-interaction-helpers.mjs';
import { getPortPoint, makeConnectionPathFromBoxes } from '../renderer/map/pisi-map-connection-interactions.mjs';
import { PISI_MAP_CONNECTION_BASE_METRICS } from '../renderer/map/pisi-map-zoom-core.mjs';

const {
    PISI_MAP_CONNECTION_GEOMETRY,
    collectPisiCollapsedHubCounts,
    collectPisiCollapsedHubNodeIds,
    getPisiMapRectPortPoint,
    isPisiMapEdgeHiddenByCollapsedHub,
    makePisiCollapsedHubPortKey,
    makePisiMapConnectionPath
} = sharedMapView;

const hub = (sourceId, targetId, sourcePort = 'bottom') => ({
    id: `edge_${sourceId}_${targetId}`,
    sourceId,
    targetId,
    type: 'down-hub',
    sourceRole: 'down-hub',
    targetRole: 'up-hub',
    sourcePort,
    targetPort: 'top'
});
const stream = (sourceId, targetId) => ({
    id: `edge_s_${sourceId}_${targetId}`,
    sourceId,
    targetId,
    type: 'stream',
    sourceRole: 'downstream',
    targetRole: 'upstream'
});

test('masaüstü harita dosyaları shared kurallarının kendisini dışa aktarır', () => {
    for (const name of Object.keys(rendererCollapseCore)) assert.equal(rendererCollapseCore[name], sharedMapView[name], name);
    for (const name of ['getPortDirection', 'offsetPoint', 'getDistance']) assert.equal(rendererInteractionHelpers[name], sharedMapView[name], name);
    // The zoom-1 metrics of the desktop are the shared geometry.
    for (const [name, value] of Object.entries(PISI_MAP_CONNECTION_GEOMETRY)) assert.equal(PISI_MAP_CONNECTION_BASE_METRICS[name], value, name);
});

test('daraltılmış hub portu altındaki bütün torunları gizler; başka porttan çıkan dallar ve stream bağlantıları kalır', () => {
    const edges = [hub('a', 'b'), hub('b', 'c'), hub('c', 'd'), hub('a', 'e', 'right'), stream('b', 'f'), hub('f', 'g')];
    const hidden = collectPisiCollapsedHubNodeIds(edges, [makePisiCollapsedHubPortKey('a', 'bottom')]);
    assert.deepEqual([...hidden].sort(), ['b', 'c', 'd']);
    assert.deepEqual(
        [...collectPisiCollapsedHubCounts(edges, ['a::bottom', 'f::bottom'])],
        [
            ['a::bottom', 3],
            ['f::bottom', 1]
        ]
    );
    // The hub edges leaving the collapsed port are hidden, and so is every edge touching a hidden note.
    assert.equal(isPisiMapEdgeHiddenByCollapsedHub(edges[0], hidden, ['a::bottom']), true);
    assert.equal(isPisiMapEdgeHiddenByCollapsedHub(edges[4], hidden, ['a::bottom']), true);
    assert.equal(isPisiMapEdgeHiddenByCollapsedHub(edges[3], hidden, ['a::bottom']), false);
    assert.equal(isPisiMapEdgeHiddenByCollapsedHub(edges[5], hidden, ['a::bottom']), false);
    // A port key without port means "right", as the desktop stores it.
    assert.equal(makePisiCollapsedHubPortKey('a'), 'a::right');
});

test('bağlantı yolu masaüstüyle aynıdır: port ortasından dik çıkar, ok olan uç ok tabanında biter', () => {
    const source = { x: 80, y: 80, width: 220, height: 92 };
    const target = { x: 80, y: 400, width: 220, height: 92 };
    assert.deepEqual(getPisiMapRectPortPoint(source, 'bottom'), { x: 190, y: 172 });
    assert.deepEqual(getPisiMapRectPortPoint(source, 'right'), { x: 300, y: 126 });
    assert.deepEqual(getPisiMapRectPortPoint(source, 'top'), getPortPoint(source, 'top'));

    const path = makePisiMapConnectionPath(source, 'bottom', target, 'top', 'down-hub');
    // Start 6 below the box (no start arrow), end 24 above the target (end arrow), control = 0.38 × distance within 60..190.
    assert.equal(path, 'M 190 178 C 190 253.24, 190 300.76, 190 376');
    assert.equal(makeConnectionPathFromBoxes(source, 'bottom', target, 'top', 'down-hub'), path);
    // A co-level connection has an arrow at both ends.
    assert.match(makePisiMapConnectionPath(source, 'bottom', target, 'top', 'co-level'), /^M 190 196 /);
});
