import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_MAP_TIER_FAR,
    PISI_MAP_TIER_TITLE,
    buildPisiMapSpatialIndex,
    diffPisiMapMounted,
    getPisiMapViewportBounds,
    getPisiMapZoomTier,
    isPisiMapEdgeVisible,
    queryPisiMapSpatialIndex
} from '../renderer/map/pisi-map-viewport-core.mjs';

const grid = (count, columns = 50) =>
    Array.from({ length: count }, (_value, index) => ({
        id: `n${index}`,
        x: (index % columns) * 260,
        y: Math.floor(index / columns) * 150,
        width: 220,
        height: 92
    }));

test('the viewport covers the camera view plus the margin on every side', () => {
    assert.deepEqual(getPisiMapViewportBounds({ x: 0, y: 0, zoom: 1 }, 1000, 500, 0), { x: 0, y: 0, width: 1000, height: 500 });
    assert.deepEqual(getPisiMapViewportBounds({ x: -200, y: 100, zoom: 2 }, 1000, 500, 0), { x: 100, y: -50, width: 500, height: 250 });
    assert.deepEqual(getPisiMapViewportBounds({ x: 0, y: 0, zoom: 1 }, 1000, 500, 0.25), { x: -250, y: -125, width: 1500, height: 750 });
    assert.equal(getPisiMapViewportBounds({ x: 0, y: 0, zoom: 0 }, 100, 100, 0).width, 100, 'zero zoom falls back to 1');
});

test('the spatial index returns exactly the rectangles that intersect the view', () => {
    const rects = grid(1000);
    const index = buildPisiMapSpatialIndex(rects);
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const expected = rects.filter((rect) => rect.x <= 1000 && rect.x + rect.width >= 0 && rect.y <= 500 && rect.y + rect.height >= 0).map((rect) => rect.id);
    assert.deepEqual([...queryPisiMapSpatialIndex(index, bounds)].sort(), expected.sort());
    assert.equal(queryPisiMapSpatialIndex(index, { x: -5000, y: -5000, width: 10, height: 10 }).size, 0);
    // A view covering the whole map (far zoom) returns every node.
    assert.equal(queryPisiMapSpatialIndex(index, { x: -100, y: -100, width: 1e6, height: 1e6 }).size, 1000);
    // A wide node spanning several cells is found once.
    const wide = buildPisiMapSpatialIndex([{ id: 'wide', x: 0, y: 0, width: 5000, height: 50 }], 512);
    assert.deepEqual([...queryPisiMapSpatialIndex(wide, { x: 4000, y: 0, width: 10, height: 10 })], ['wide']);
    assert.equal(queryPisiMapSpatialIndex(null, bounds).size, 0);
});

test('a connection is drawn when an end is visible or when it crosses the view', () => {
    const rects = new Map([
        ['left', { x: -2000, y: 100, width: 100, height: 50 }],
        ['right', { x: 2000, y: 100, width: 100, height: 50 }],
        ['in', { x: 100, y: 100, width: 100, height: 50 }],
        ['far', { x: 5000, y: 5000, width: 100, height: 50 }]
    ]);
    const rectOf = (id) => rects.get(id) || null;
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const visible = new Set(['in']);
    assert.equal(isPisiMapEdgeVisible({ sourceId: 'in', targetId: 'far' }, visible, rectOf, bounds), true);
    assert.equal(isPisiMapEdgeVisible({ sourceId: 'left', targetId: 'right' }, visible, rectOf, bounds), true, 'crosses the view');
    assert.equal(isPisiMapEdgeVisible({ sourceId: 'right', targetId: 'far' }, visible, rectOf, bounds), false);
    assert.equal(isPisiMapEdgeVisible({ sourceId: 'missing', targetId: 'far' }, visible, rectOf, bounds), false);
});

test('zoom tiers: full card, title card (also with "titles only"), far canvas', () => {
    assert.equal(PISI_MAP_TIER_TITLE, 0.6);
    assert.equal(PISI_MAP_TIER_FAR, 0.3);
    assert.equal(getPisiMapZoomTier(1), 'full');
    assert.equal(getPisiMapZoomTier(0.6), 'full');
    assert.equal(getPisiMapZoomTier(0.59), 'title');
    assert.equal(getPisiMapZoomTier(0.3), 'title');
    assert.equal(getPisiMapZoomTier(0.29), 'far');
    assert.equal(getPisiMapZoomTier(2, true), 'title', 'titles only forces the title tier');
    assert.equal(getPisiMapZoomTier(0.1, true), 'far', 'far stays far');
    assert.equal(getPisiMapZoomTier(undefined), 'full');
});

test('mount diff adds what scrolled in and removes what left', () => {
    assert.deepEqual(diffPisiMapMounted(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), { add: ['d'], remove: ['a'] });
    assert.deepEqual(diffPisiMapMounted(new Set(), new Set()), { add: [], remove: [] });
});
