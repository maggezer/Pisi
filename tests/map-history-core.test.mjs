import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_MAP_HISTORY_LIMIT,
    applyPisiMapStepResults,
    createPisiMapHistory,
    getPisiMapStepCommands,
    getPisiMapStepLabel,
    makePisiMapCollapseStep,
    makePisiMapEdgeStep,
    makePisiMapLayoutStep,
    makePisiMapNodeStep,
    makePisiMapReferenceStep,
    makePisiMapRenameStep
} from '../renderer/map/pisi-map-history-core.mjs';

const mapPath = '/p/Harita.map';
const edge = { id: 'edge_1', sourceId: 'node_a', targetId: 'node_b', sourcePort: 'bottom', targetPort: 'top', type: 'down-hub' };

test('push, undo and redo move steps between two stacks; a new step clears redo', () => {
    const history = createPisiMapHistory();
    assert.equal(history.canUndo(), false);
    assert.equal(history.push({ kind: 'collapse', mapPath, before: [], after: ['x'] }), true);
    history.push({ kind: 'collapse', mapPath, before: ['x'], after: [] });
    assert.deepEqual(history.size(), { undo: 2, redo: 0 });
    assert.deepEqual(history.peekUndo().before, ['x']);
    history.commitUndo();
    assert.deepEqual(history.size(), { undo: 1, redo: 1 });
    assert.deepEqual(history.peekRedo().before, ['x']);
    history.commitRedo();
    history.commitUndo();
    history.push({ kind: 'collapse', mapPath, before: [], after: ['y'] });
    assert.equal(history.canRedo(), false, 'a new step drops the redo stack');
    assert.equal(history.push({ kind: 'collapse' }), false, 'a step needs a map');
    history.clear();
    assert.deepEqual(history.size(), { undo: 0, redo: 0 });
});

test('the history keeps at most 200 steps and drops the oldest', () => {
    assert.equal(PISI_MAP_HISTORY_LIMIT, 200);
    const history = createPisiMapHistory();
    for (let index = 0; index < 205; index += 1) history.push({ kind: 'collapse', mapPath, before: [], after: [String(index)] });
    assert.equal(history.size().undo, 200);
    let oldest = null;
    while (history.canUndo()) {
        oldest = history.peekUndo();
        history.commitUndo();
    }
    assert.deepEqual(oldest.after, ['5']);
    assert.equal(createPisiMapHistory({ limit: 2 }).push({ kind: 'collapse', mapPath }), true);
});

test('stored steps are copies: later changes to the caller objects do not leak in', () => {
    const history = createPisiMapHistory();
    const step = { kind: 'edge-add', mapPath, edge: { ...edge } };
    history.push(step);
    step.edge.type = 'stream';
    assert.equal(history.peekUndo().edge.type, 'down-hub');
    const peeked = history.peekUndo();
    peeked.edge.type = 'co-level';
    assert.equal(history.peekUndo().edge.type, 'down-hub');
});

test('one drag of several nodes is one layout step; untouched nodes and no-op drags are dropped', () => {
    const before = [
        { id: 'node_a', x: 10, y: 20, width: 220, height: 92 },
        { id: 'node_b', x: 300, y: 20, width: 220, height: 92 },
        { id: 'node_c', x: 600, y: 20, width: 220, height: 92 }
    ];
    const after = [
        { id: 'node_a', x: 60.4, y: 70, width: 220, height: 92 },
        { id: 'node_b', x: 350, y: 70, width: 220, height: 92 },
        { id: 'node_c', x: 600, y: 20, width: 220, height: 92 }
    ];
    const step = makePisiMapLayoutStep(mapPath, before, after);
    assert.equal(step.kind, 'layout');
    assert.deepEqual(
        step.after.map((entry) => entry.id),
        ['node_a', 'node_b']
    );
    assert.equal(step.after[0].x, 60);
    assert.deepEqual(getPisiMapStepCommands(step, 'undo'), [{ name: 'map.layout.save.v1', payload: { mapPath, nodes: step.before } }]);
    assert.deepEqual(getPisiMapStepCommands(step, 'redo')[0].payload.nodes, step.after);
    assert.equal(makePisiMapLayoutStep(mapPath, before, before), null);
    assert.equal(makePisiMapLayoutStep(mapPath, before, [{ ...before[0], x: 10.3 }]), null, 'sub-pixel jitter is not a move');
    assert.equal(makePisiMapLayoutStep(mapPath, before, [{ ...before[0], width: 300 }], 'resize').kind, 'resize');
});

test('edge steps run the relationship commands in both directions and keep the edge id', () => {
    const added = makePisiMapEdgeStep(mapPath, 'edge-add', null, { ...edge, confirmSecondParentAsStream: true });
    assert.equal('confirmSecondParentAsStream' in added.edge, false);
    assert.deepEqual(getPisiMapStepCommands(added, 'undo'), [{ name: 'map.relationship.delete.v1', payload: { mapPath, edgeId: 'edge_1' } }]);
    assert.deepEqual(getPisiMapStepCommands(added, 'redo'), [{ name: 'map.relationship.upsert.v1', payload: { mapPath, edge } }]);

    const removed = makePisiMapEdgeStep(mapPath, 'edge-delete', { ...edge, customization: { color: '#ff0000' } });
    assert.deepEqual(getPisiMapStepCommands(removed, 'undo')[0], {
        name: 'map.relationship.upsert.v1',
        payload: { mapPath, edge: { ...edge, customization: { color: '#ff0000' } } }
    });
    assert.equal(getPisiMapStepCommands(removed, 'redo')[0].name, 'map.relationship.delete.v1');

    const changed = makePisiMapEdgeStep(mapPath, 'edge-change', edge, { ...edge, type: 'stream' });
    assert.equal(getPisiMapStepCommands(changed, 'undo')[0].payload.edge.type, 'down-hub');
    assert.equal(getPisiMapStepCommands(changed, 'redo')[0].payload.edge.type, 'stream');
    assert.equal(makePisiMapEdgeStep(mapPath, 'edge-change', edge, { ...edge }), null);
    assert.equal(makePisiMapEdgeStep(mapPath, 'edge-change', edge, { ...edge, id: 'edge_2', type: 'stream' }), null);
    assert.equal(makePisiMapEdgeStep(mapPath, 'edge-add', null, { sourceId: 'node_a' }), null);
});

test('collapse steps change only collapsedHubs and keep the current camera', () => {
    const step = makePisiMapCollapseStep(mapPath, ['node_a:right'], ['node_a:right', 'node_b:bottom', 'node_b:bottom']);
    const camera = { x: 120, y: -40, zoom: 1.5 };
    const undo = getPisiMapStepCommands(step, 'undo', { camera });
    assert.deepEqual(undo, [{ name: 'map.camera.save.v1', payload: { mapPath, camera: { x: 120, y: -40, zoom: 1.5, collapsedHubs: ['node_a:right'] } } }]);
    assert.deepEqual(getPisiMapStepCommands(step, 'redo', { camera }).at(0).payload.camera.collapsedHubs, ['node_a:right', 'node_b:bottom']);
    assert.equal(makePisiMapCollapseStep(mapPath, ['a', 'b'], ['b', 'a']), null);
});

test('camera movement is never a step', () => {
    const history = createPisiMapHistory();
    for (const kind of ['camera', 'zoom', 'pan']) assert.deepEqual(getPisiMapStepCommands({ kind, mapPath }, 'undo'), []);
    assert.equal(getPisiMapStepLabel({ kind: 'camera' }), '');
    assert.equal(history.canUndo(), false);
});

test('rename steps follow the path the rename actually produced', () => {
    const step = makePisiMapRenameStep(mapPath, {
        nodeId: 'node_a',
        beforePath: '/p/Eski.node',
        afterPath: '/p/Yeni.node',
        beforeTitle: 'Eski',
        afterTitle: 'Yeni'
    });
    assert.deepEqual(getPisiMapStepCommands(step, 'undo'), [{ name: 'project.item.rename.v1', payload: { oldPath: '/p/Yeni.node', newBaseName: 'Eski' } }]);
    const undone = applyPisiMapStepResults(step, 'undo', [{ ok: true, fullPath: '/p/Eski 2.node' }]);
    assert.deepEqual(getPisiMapStepCommands(undone, 'redo'), [{ name: 'project.item.rename.v1', payload: { oldPath: '/p/Eski 2.node', newBaseName: 'Yeni' } }]);
    assert.equal(makePisiMapRenameStep(mapPath, { beforePath: '/a', afterPath: '/a', beforeTitle: 'X', afterTitle: 'X' }), null);
});

test('node creation undoes into Trash and redoes by restoring the same node', () => {
    const step = makePisiMapNodeStep(mapPath, 'node-create', { nodeId: 'node_n', nodePath: '/p/Harita/Yeni.node' });
    assert.deepEqual(getPisiMapStepCommands(step, 'undo'), [{ name: 'project.item.delete.v1', payload: { targetPath: '/p/Harita/Yeni.node' } }]);
    const undone = applyPisiMapStepResults(step, 'undo', [{ ok: true, trashId: 'trash_1' }]);
    assert.deepEqual(getPisiMapStepCommands(undone, 'redo', { projectFolder: '/p' }), [
        { name: 'trash.restore.v1', payload: { projectFolder: '/p', trashId: 'trash_1' } }
    ]);
    const redone = applyPisiMapStepResults(undone, 'redo', [{ ok: true, trashId: 'trash_1', restoredPath: '/p/Harita/Yeni.node' }]);
    assert.equal(redone.trashId, null);
    assert.equal(redone.nodePath, '/p/Harita/Yeni.node');
});

test('node deletion undoes by restoring from Trash and redo records the new Trash id', () => {
    const step = makePisiMapNodeStep(mapPath, 'node-delete', { nodeId: 'node_d', nodePath: '/p/Not.node', trashId: 'trash_9' });
    assert.deepEqual(getPisiMapStepCommands(step, 'undo', { projectFolder: '/p' }), [
        { name: 'trash.restore.v1', payload: { projectFolder: '/p', trashId: 'trash_9' } }
    ]);
    const undone = applyPisiMapStepResults(step, 'undo', [{ ok: true, trashId: 'trash_9', restoredPath: '/p/Not.node' }]);
    assert.equal(undone.trashId, null);
    assert.deepEqual(getPisiMapStepCommands(undone, 'redo'), [{ name: 'project.item.delete.v1', payload: { targetPath: '/p/Not.node' } }]);
    assert.equal(applyPisiMapStepResults(undone, 'redo', [{ ok: true, trashId: 'trash_10' }]).trashId, 'trash_10');
    assert.equal(
        makePisiMapNodeStep(mapPath, 'node-delete', { nodeId: 'node_d', nodePath: '/p/Not.node' }),
        null,
        'a delete without a Trash id cannot be undone'
    );
});

test('a removed map reference is re-attached with its layout', () => {
    const layout = { id: 'node_r', x: 40, y: 50, width: 220, height: 92 };
    const step = makePisiMapReferenceStep(mapPath, { reference: { id: 'node_r', path: 'Notlar/R.node' }, layout });
    assert.deepEqual(getPisiMapStepCommands(step, 'undo'), [
        { name: 'map.reference.attach.v1', payload: { mapPath, reference: { id: 'node_r', path: 'Notlar/R.node' }, layout } }
    ]);
    assert.deepEqual(getPisiMapStepCommands(step, 'redo'), [{ name: 'map.reference.detach.v1', payload: { mapPath, nodeId: 'node_r' } }]);
    assert.equal(makePisiMapReferenceStep(mapPath, { reference: { id: 'node_r' } }), null);
    assert.equal(getPisiMapStepLabel(step), 'Referansı kaldırma');
});
