import test from 'node:test';
import assert from 'node:assert/strict';
import { diffPisiStoreVersion } from '../main/functions/store-history-diff-core.js';

test('tasks: restored, removed and changed by id; updatedAt alone is not a change', () => {
    const current = {
        tasks: [
            { id: 'a', title: 'A', status: 'todo' },
            { id: 'b', title: 'B', status: 'done' },
            { id: 'new', title: 'Yeni' }
        ]
    };
    const version = {
        tasks: [
            { id: 'a', title: 'A', status: 'todo', updatedAt: 'x' },
            { id: 'b', title: 'B', status: 'todo' },
            { id: 'gone', title: 'Silinen' }
        ]
    };
    const diff = diffPisiStoreVersion('tasks', current, version);
    assert.deepEqual(
        { restored: diff.restored, removed: diff.removed, changed: diff.changed, total: diff.total },
        { restored: 1, removed: 1, changed: 1, total: 3 }
    );
    assert.deepEqual(diff.items.map((item) => `${item.change}:${item.label}`).sort(), ['changed:B', 'removed:Yeni', 'restored:Silinen']);
});

test('relationships and maps: connection labels, moved cards and changed views', () => {
    const edges = diffPisiStoreVersion(
        'relationships',
        { relationships: [] },
        { relationships: [{ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'stream' }] }
    );
    assert.equal(edges.restored, 1);
    assert.equal(edges.items[0].label, 'n1 → n2 (stream)');
    const map = diffPisiStoreVersion(
        'map',
        {
            map: {
                nodes: [
                    { id: 'n1', x: 0, y: 0 },
                    { id: 'n3', x: 5, y: 5 }
                ],
                relationshipViews: [{ relationshipId: 'e1', sourcePort: 'left' }]
            }
        },
        {
            map: {
                nodes: [
                    { id: 'n1', x: 100, y: 0 },
                    { id: 'n2', x: 1, y: 1 }
                ],
                relationshipViews: [{ relationshipId: 'e1', sourcePort: 'right' }]
            }
        }
    );
    assert.deepEqual({ restored: map.restored, removed: map.removed, moved: map.moved, views: map.views }, { restored: 1, removed: 1, moved: 1, views: 1 });
});

test('a missing current store counts everything as coming back; long lists are cut', () => {
    const tasks = Array.from({ length: 250 }, (_v, index) => ({ id: `t${index}`, title: `G${index}` }));
    const diff = diffPisiStoreVersion('tasks', null, { tasks });
    assert.equal(diff.restored, 250);
    assert.equal(diff.items.length, 200);
    assert.equal(diff.truncated, true);
    assert.deepEqual(diffPisiStoreVersion('views', { views: [1] }, { views: [1] }).changed, 0);
});
