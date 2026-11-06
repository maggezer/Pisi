import test from 'node:test';
import assert from 'node:assert/strict';
import { PISI_MAP_LAYOUT_GAP_X, PISI_MAP_LAYOUT_GAP_Y, layoutPisiMapAll, layoutPisiMapSubtree } from '../renderer/map/pisi-map-auto-layout-core.mjs';

const node = (id, x = 0, y = 0) => ({ id, x, y, width: 100, height: 50 });
const hub = (sourceId, targetId) => ({ sourceId, targetId, type: 'down-hub' });
const byId = (rects) => Object.fromEntries(rects.map((rect) => [rect.id, rect]));

test('a hub is centred over its children, which keep their left-to-right order', () => {
    const rects = [node('root', 500, 100), node('right', 900, 0), node('left', 10, 0)];
    const placed = byId(layoutPisiMapSubtree(rects, [hub('root', 'right'), hub('root', 'left')], 'root'));
    assert.equal(placed.root.x, 500, 'the root stays in place');
    assert.equal(placed.root.y, 100);
    assert.ok(placed.left.x < placed.right.x, 'sibling order follows current x');
    assert.equal(placed.left.y, 100 + 50 + PISI_MAP_LAYOUT_GAP_Y);
    assert.equal(placed.right.x - placed.left.x, 100 + PISI_MAP_LAYOUT_GAP_X);
    const childrenCentre = (placed.left.x + placed.right.x + 100) / 2;
    assert.equal(placed.root.x + 50, childrenCentre);
});

test('only hierarchy edges count, and subtrees never overlap', () => {
    const rects = [node('r'), node('a'), node('b'), node('a1'), node('a2'), node('b1'), node('s')];
    const edges = [hub('r', 'a'), hub('r', 'b'), hub('a', 'a1'), hub('a', 'a2'), hub('b', 'b1'), { sourceId: 'r', targetId: 's', type: 'stream' }];
    const placed = byId(layoutPisiMapSubtree(rects, edges, 'r'));
    assert.equal(placed.s, undefined, 'stream targets are not part of the tree');
    const row = ['a1', 'a2', 'b1'].map((id) => placed[id]).sort((x, y) => x.x - y.x);
    for (let index = 1; index < row.length; index += 1) assert.ok(row[index].x >= row[index - 1].x + 100, 'no overlap');
    assert.ok(placed.a.x + 100 <= placed.b.x);
    assert.deepEqual(layoutPisiMapSubtree(rects, edges, 'missing'), []);
});

test('cycles and second parents are handled without looping', () => {
    const rects = [node('x'), node('y'), node('z')];
    const placed = byId(layoutPisiMapAll(rects, [hub('x', 'y'), hub('y', 'z'), hub('z', 'x'), hub('x', 'z')]));
    assert.deepEqual(Object.keys(placed).sort(), ['x', 'y', 'z']);
    const twoParents = byId(layoutPisiMapSubtree([node('p1'), node('p2'), node('c')], [hub('p1', 'c'), hub('p2', 'c')], 'p2'));
    assert.equal(twoParents.c, undefined, 'c stays under its first parent p1');
});

test('the whole map lays trees left to right and unconnected nodes in a row below', () => {
    const rects = [node('t1', 50, 40), node('t1c', 0, 0), node('t2', 900, 300), node('t2c', 0, 0), node('lone1', 5, 5), node('lone2', 60, 5)];
    const placed = byId(layoutPisiMapAll(rects, [hub('t1', 't1c'), hub('t2', 't2c')]));
    assert.equal(placed.t1.x, 0, 'starts at the left of the map');
    assert.equal(placed.t1.y, 0, 'starts at the top of the map');
    assert.ok(placed.t2.x > placed.t1.x + 100);
    assert.equal(placed.t2.y, placed.t1.y);
    assert.ok(placed.lone1.y > placed.t1c.y + 50);
    assert.equal(placed.lone1.y, placed.lone2.y);
    assert.ok(placed.lone1.x < placed.lone2.x);
    assert.deepEqual(layoutPisiMapAll([], []), []);
});
