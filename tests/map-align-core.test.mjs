import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_MAP_GRID_STEP,
    alignPisiMapRects,
    distributePisiMapRects,
    findPisiMapSnapGuides,
    findPisiNearestMapRect,
    getPisiMapConnectedIds,
    getPisiMapTabTarget,
    snapPisiMapValueToGrid
} from '../renderer/map/pisi-map-align-core.mjs';

const a = { id: 'a', x: 10, y: 10, width: 100, height: 50 };
const b = { id: 'b', x: 200, y: 80, width: 60, height: 40 };
const c = { id: 'c', x: 90, y: 200, width: 120, height: 30 };
const pick = (rects, key) => Object.fromEntries(rects.map((rect) => [rect.id, rect[key]]));

test('align to the selection edges and centres', () => {
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'left'), 'x'), { a: 10, b: 10, c: 10 });
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'right'), 'x'), { a: 160, b: 200, c: 140 });
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'center'), 'x'), { a: 85, b: 105, c: 75 });
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'top'), 'y'), { a: 10, b: 10, c: 10 });
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'bottom'), 'y'), { a: 180, b: 190, c: 200 });
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'middle'), 'y'), { a: 95, b: 100, c: 105 });
    // The other axis is untouched and order follows the input.
    assert.deepEqual(pick(alignPisiMapRects([a, b, c], 'left'), 'y'), { a: 10, b: 80, c: 200 });
    assert.deepEqual(alignPisiMapRects([a], 'left'), [a], 'one node is not aligned');
    assert.deepEqual(alignPisiMapRects([a, b], 'diagonal'), [a, b]);
});

test('distribute makes the gaps equal and keeps the outer nodes in place', () => {
    const rects = [
        { id: 'p', x: 0, y: 0, width: 100, height: 10 },
        { id: 'q', x: 130, y: 0, width: 50, height: 10 },
        { id: 'r', x: 400, y: 0, width: 100, height: 10 }
    ];
    const horizontal = pick(distributePisiMapRects(rects, 'horizontal'), 'x');
    assert.equal(horizontal.p, 0);
    assert.equal(horizontal.r, 400);
    // span 500, occupied 250, gap 125: q starts at 100 + 125.
    assert.equal(horizontal.q, 225);
    const vertical = distributePisiMapRects(
        [
            { id: 'v1', x: 0, y: 300, width: 10, height: 20 },
            { id: 'v2', x: 0, y: 0, width: 10, height: 20 },
            { id: 'v3', x: 0, y: 40, width: 10, height: 20 }
        ],
        'vertical'
    );
    assert.deepEqual(pick(vertical, 'y'), { v1: 300, v2: 0, v3: 150 });
    assert.deepEqual(distributePisiMapRects([a, b], 'horizontal'), [a, b], 'two nodes are not distributed');
});

test('snap guides catch edges and centres within the threshold and grid snapping rounds', () => {
    const moving = { id: 'm', x: 13, y: 300, width: 100, height: 50 };
    const snapped = findPisiMapSnapGuides(moving, [a, b, moving]);
    assert.equal(snapped.x, 10, 'left edge snaps to a.left');
    assert.equal(snapped.y, 300, 'no vertical match');
    assert.deepEqual(snapped.guides, [{ axis: 'x', position: 10, from: 10, to: 350 }]);
    const centre = findPisiMapSnapGuides({ id: 'm', x: 500, y: 62, width: 40, height: 40 }, [b]);
    assert.equal(centre.y, 60, 'the centre snaps to b.top');
    assert.deepEqual(findPisiMapSnapGuides({ id: 'm', x: 500, y: 500, width: 10, height: 10 }, [a]).guides, []);
    assert.equal(PISI_MAP_GRID_STEP, 20);
    assert.equal(snapPisiMapValueToGrid(29), 20);
    assert.equal(snapPisiMapValueToGrid(31), 40);
    assert.equal(snapPisiMapValueToGrid(-11), -20);
    assert.equal(snapPisiMapValueToGrid(17, 5), 15);
});

test('arrow keys move to the nearest node in that direction', () => {
    const grid = [
        { id: 'centre', x: 200, y: 200, width: 100, height: 50 },
        { id: 'east', x: 400, y: 210, width: 100, height: 50 },
        { id: 'far-east', x: 700, y: 200, width: 100, height: 50 },
        { id: 'north-east', x: 300, y: 20, width: 100, height: 50 },
        { id: 'south', x: 210, y: 400, width: 100, height: 50 },
        { id: 'west', x: 0, y: 190, width: 100, height: 50 }
    ];
    const from = grid[0];
    assert.equal(findPisiNearestMapRect(from, grid, 'right'), 'east');
    assert.equal(findPisiNearestMapRect(from, grid, 'down'), 'south');
    assert.equal(findPisiNearestMapRect(from, grid, 'left'), 'west');
    assert.equal(findPisiNearestMapRect(from, grid, 'up'), 'north-east', 'within the 45° cone');
    assert.equal(findPisiNearestMapRect(grid[2], grid, 'right'), null, 'nothing further east');
    assert.equal(findPisiNearestMapRect(from, grid, 'diagonal'), null);
    const tie = [from, { id: 'b2', x: 400, y: 200, width: 100, height: 50 }, { id: 'b1', x: 400, y: 200, width: 100, height: 50 }];
    assert.equal(findPisiNearestMapRect(from, tie, 'right'), 'b1', 'ties fall back to id order');
});

test('Tab cycles through the anchor and its connected nodes, else in reading order', () => {
    const rects = [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 300, y: 0 },
        { id: 'c', x: 0, y: 300 },
        { id: 'd', x: 300, y: 300 }
    ];
    const edges = [
        { sourceId: 'a', targetId: 'c' },
        { sourceId: 'b', targetId: 'a' },
        { sourceId: 'a', targetId: 'missing' }
    ];
    assert.deepEqual(getPisiMapConnectedIds('a', edges), ['c', 'b', 'missing']);
    assert.equal(getPisiMapTabTarget('a', 'a', rects, edges), 'c');
    assert.equal(getPisiMapTabTarget('a', 'c', rects, edges), 'b');
    assert.equal(getPisiMapTabTarget('a', 'b', rects, edges), 'a', 'cycles back to the anchor');
    assert.equal(getPisiMapTabTarget('a', 'a', rects, edges, true), 'b');
    // d has no connections: reading order a, b, c, d.
    assert.equal(getPisiMapTabTarget('d', 'd', rects, edges), 'a');
    assert.equal(getPisiMapTabTarget('d', 'b', rects, edges), 'c');
    assert.equal(getPisiMapTabTarget('d', 'a', rects, edges, true), 'd');
    assert.equal(getPisiMapTabTarget('x', 'x', [], []), null);
});
