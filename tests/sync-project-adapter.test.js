'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { modules, registerMainModule } = require('../main/module-registry');

function sidecar(title, _extension, id) {
    return `.pisi-${String(title).replace(/[^A-Za-z0-9_-]+/g, '_')}__${id}`;
}

registerMainModule('main.filesystemCore', {
    createPisiDocumentData({ ext, title, id, parentMap = 'none' }) {
        const pisi = {
            version: 1,
            type: ext === '.map' ? 'map' : 'node',
            id,
            title,
            sidecar: sidecar(title, ext, id),
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        };
        if (ext === '.node') return { pisi: { ...pisi, parentMap, connectionTypes: {} }, content: '' };
        return {
            pisi,
            map: {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            }
        };
    },
    getPisiSidecarName: sidecar,
    writePisiDocumentsTransaction(changes) {
        for (const change of changes) {
            fs.mkdirSync(path.dirname(change.filePath), { recursive: true });
            fs.writeFileSync(change.filePath, JSON.stringify(change.data, null, 2));
        }
    }
});
registerMainModule('main.pathSecurity', {
    getDefaultNodeConnectionTypes: () => ({
        'up-hub': [], 'down-hub': [], 'co-level': [], upstream: [], downstream: []
    })
});
registerMainModule('main.mapSemanticCore', {
    PISI_MAP_RELATIONSHIP_VIEW_VERSION: 1,
    normalizePisiRelationshipViews(rawViews = []) {
        const views = [];
        const seen = new Set();
        for (const raw of Array.isArray(rawViews) ? rawViews : []) {
            const id = String(raw?.relationshipId || '');
            if (!/^edge_[A-Za-z0-9_-]{1,101}$/.test(id) || seen.has(id)) continue;
            seen.add(id);
            const view = {
                relationshipId: id,
                sourcePort: ['top', 'right', 'bottom', 'left'].includes(raw.sourcePort)
                    ? raw.sourcePort : 'bottom',
                targetPort: ['top', 'right', 'bottom', 'left'].includes(raw.targetPort)
                    ? raw.targetPort : 'top'
            };
            if (raw.customization?.color && /^#[0-9a-fA-F]{6}$/.test(raw.customization.color)) {
                view.customization = { color: raw.customization.color.toLowerCase() };
            }
            views.push(view);
        }
        return views;
    }
});

let storedTasks = [];
let storedRelationships = [];
registerMainModule('main.taskStore', {
    readPisiTaskStore: () => ({ version: 1, tasks: storedTasks }),
    writePisiTaskStore: (_project, store) => { storedTasks = store.tasks; return store; }
});
registerMainModule('main.relationshipStore', {
    readPisiRelationshipStore: () => ({ ok: true, relationships: storedRelationships }),
    writePisiRelationshipStore: (_project, rows) => {
        storedRelationships = rows;
        return { ok: true, relationships: rows };
    }
});

require('../main/functions/sync-project-adapter');
const adapter = modules['main.syncProjectAdapter'];

test('desktop adapter node, map, görev ve config kayıtlarını kayıpsız round-trip eder', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-adapter-'));
    try {
        const mapId = 'map_alpha';
        const nodeId = 'node_alpha';
        const mapSidecar = sidecar('Harita', '.map', mapId);
        const nodeSidecar = sidecar('Not', '.node', nodeId);
        fs.mkdirSync(path.join(project, mapSidecar));
        fs.writeFileSync(path.join(project, 'Harita.map'), JSON.stringify({
            pisi: { version: 1, type: 'map', id: mapId, title: 'Harita', sidecar: mapSidecar },
            map: {
                nodes: [{ id: nodeId, x: 10, y: 20 }],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            }
        }));
        fs.writeFileSync(path.join(project, mapSidecar, 'Not.node'), JSON.stringify({
            pisi: {
                version: 1, type: 'node', id: nodeId, title: 'Not', parentMap: mapId,
                sidecar: nodeSidecar, futureMetadata: { keep: true }
            },
            content: '<p>İlk</p>', properties: { durum: 'aktif' },
            attachments: [{ path: 'attachment.bin' }], futureTopLevel: ['kept']
        }));
        fs.mkdirSync(path.join(project, mapSidecar, nodeSidecar));
        fs.writeFileSync(path.join(project, mapSidecar, nodeSidecar, 'attachment.bin'), Buffer.from([0, 1, 2, 255]));
        storedTasks = [{
            id: 'task_alpha', title: 'Görev', status: 'todo',
            source: { nodePath: path.join(project, mapSidecar, 'Not.node'), blockId: 'block_1' }
        }];
        storedRelationships = [];

        const entities = adapter.exportPisiSyncEntities(project);
        assert.deepEqual(new Set(entities.map(({ kind }) => kind)), new Set(['map', 'node', 'task', 'config']));
        const records = entities.map((entity, index) => ({
            ...entity,
            key: `${entity.kind}:${entity.id}`,
            deleted: false,
            hash: `hash_${index}`,
            version: { counter: index + 1, deviceId: 'device_test' },
            updatedAt: '2026-01-01T00:00:00.000Z'
        }));
        const node = records.find((record) => record.kind === 'node');
        node.payload.content = '<p>Mobil değişiklik</p>';
        node.payload.title = 'Mobil başlık';
        const result = adapter.applyPisiSyncRecords(project, records, []);
        assert.equal(result.documents, 2);
        assert.equal(result.tasks, 1);

        const exported = adapter.exportPisiSyncEntities(project);
        const exportedNode = exported.find((entity) => entity.kind === 'node' && entity.id === nodeId);
        const exportedTask = exported.find((entity) => entity.kind === 'task');
        assert.equal(exportedNode.payload.content, '<p>Mobil değişiklik</p>');
        assert.deepEqual(exportedNode.payload.native.pisi.futureMetadata, { keep: true });
        assert.deepEqual(exportedNode.payload.native.futureTopLevel, ['kept']);
        assert.equal(exportedNode.payload.native.pisi.sidecar, nodeSidecar);
        assert.deepEqual(
            fs.readFileSync(path.join(project, mapSidecar, nodeSidecar, 'attachment.bin')),
            Buffer.from([0, 1, 2, 255])
        );
        assert.equal(exportedTask.payload.source.documentId, nodeId);

        const propertyRecord = records.find((record) =>
            record.kind === 'config' && record.id === 'propertySchema'
        );
        propertyRecord.payload.value = [{ id: 'prop_status', name: 'Durum', type: 'text' }];
        const merged = adapter.applyPisiSyncRecords(project, records, [{
            loser: {
                ...structuredClone(propertyRecord),
                payload: { value: [
                    { id: 'prop_status', name: 'Durum', type: 'number' },
                    { id: 'prop_owner', name: 'Sahip', type: 'text' }
                ] },
                version: { counter: 7, deviceId: 'device_mobile' }
            }
        }]);
        assert.equal(merged.conflicts, 1);
        const mergedSchema = adapter.exportPisiSyncEntities(project)
            .find((entity) => entity.kind === 'config' && entity.id === 'propertySchema');
        assert.equal(mergedSchema.payload.value.length, 3);
        assert.ok(mergedSchema.payload.value.some(({ name }) => name.includes('Sync çakışması')));

        const secondRecords = records.map((record) => record === propertyRecord
            ? { ...record, payload: structuredClone(mergedSchema.payload) }
            : record);
        adapter.applyPisiSyncRecords(project, secondRecords, [{
            loser: {
                ...structuredClone(propertyRecord),
                payload: { value: [
                    { id: 'prop_status', name: 'Durum', type: 'number' },
                    { id: 'prop_owner', name: 'Sahip', type: 'text' }
                ] },
                version: { counter: 7, deviceId: 'device_mobile' }
            }
        }]);
        const repeatedSchema = adapter.exportPisiSyncEntities(project)
            .find((entity) => entity.kind === 'config' && entity.id === 'propertySchema');
        assert.equal(repeatedSchema.payload.value.length, 3, 'çakışma kopyası tekrarlanmamalı');
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('desktop map sync preserves semantic relationship views, ports, type and collapsed hubs', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-map-semantics-'));
    try {
        const mapId = 'map_semantic';
        const parentId = 'node_parent';
        const childId = 'node_child';
        const edgeId = 'edge_parent_child';
        const mapSidecar = sidecar('Semantic', '.map', mapId);
        fs.mkdirSync(path.join(project, mapSidecar), { recursive: true });

        fs.writeFileSync(path.join(project, 'Semantic.map'), JSON.stringify({
            pisi: {
                version: 1, type: 'map', id: mapId, title: 'Semantic', sidecar: mapSidecar
            },
            map: {
                nodes: [
                    { id: parentId, x: 10, y: 20 },
                    { id: childId, x: 320, y: 180 }
                ],
                relationshipViews: [{
                    relationshipId: edgeId,
                    sourcePort: 'right',
                    targetPort: 'top',
                    customization: { color: '#112233' }
                }],
                relationshipViewVersion: 1,
                collapsedHubs: [`${parentId}::right`],
                camera: { x: 15, y: -20, zoom: 1.25 }
            }
        }));
        for (const [id, title] of [[parentId, 'Parent'], [childId, 'Child']]) {
            fs.writeFileSync(path.join(project, mapSidecar, `${title}.node`), JSON.stringify({
                pisi: {
                    version: 1, type: 'node', id, title, parentMap: mapId,
                    sidecar: sidecar(title, '.node', id)
                },
                content: `<p>${title}</p>`
            }));
        }

        storedTasks = [];
        storedRelationships = [{
            id: edgeId,
            sourceId: parentId,
            targetId: childId,
            type: 'down-hub',
            sourceRole: 'down-hub',
            targetRole: 'up-hub',
            direction: 'directed',
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T10:00:00.000Z'
        }];

        const entities = adapter.exportPisiSyncEntities(project);
        const mapEntity = entities.find(({ kind, id }) => kind === 'map' && id === mapId);
        const parentEntity = entities.find(({ kind, id }) => kind === 'node' && id === parentId);

        assert.equal(mapEntity.payload.map.edges, undefined);
        assert.equal(mapEntity.payload.map.collapsedAnchors, undefined);
        assert.deepEqual(mapEntity.payload.map.relationshipViews, [{
            relationshipId: edgeId,
            sourcePort: 'right',
            targetPort: 'top',
            customization: { color: '#112233' }
        }]);
        assert.deepEqual(mapEntity.payload.map.collapsedHubs, [`${parentId}::right`]);
        assert.equal(parentEntity.payload.relations[0].id, edgeId);
        assert.equal(parentEntity.payload.relations[0].type, 'down-hub');

        const records = entities.map((entity, index) => ({
            ...entity,
            key: `${entity.kind}:${entity.id}`,
            deleted: false,
            hash: `semantic_${index}`,
            version: { counter: index + 1, deviceId: 'device_mobile' },
            updatedAt: '2026-09-26T10:05:00.000Z'
        }));

        mapEntity.payload.map.relationshipViews[0].sourcePort = 'left';
        mapEntity.payload.map.relationshipViews[0].targetPort = 'bottom';
        mapEntity.payload.map.collapsedHubs = [`${parentId}::left`];
        parentEntity.payload.relations[0].type = 'stream';
        parentEntity.payload.relations[0].sourceRole = 'downstream';
        parentEntity.payload.relations[0].targetRole = 'upstream';

        adapter.applyPisiSyncRecords(project, records, []);

        const exported = adapter.exportPisiSyncEntities(project);
        const exportedMap = exported.find(({ kind, id }) => kind === 'map' && id === mapId);
        const exportedParent = exported.find(({ kind, id }) => kind === 'node' && id === parentId);
        assert.deepEqual(exportedMap.payload.map.relationshipViews[0], {
            relationshipId: edgeId,
            sourcePort: 'left',
            targetPort: 'bottom',
            customization: { color: '#112233' }
        });
        assert.deepEqual(exportedMap.payload.map.collapsedHubs, [`${parentId}::left`]);
        assert.equal(exportedParent.payload.relations[0].type, 'stream');
        assert.equal(exportedParent.payload.relations[0].sourceRole, 'downstream');
        assert.equal(exportedParent.payload.relations[0].targetRole, 'upstream');

        const mapFile = JSON.parse(fs.readFileSync(path.join(project, 'Semantic.map'), 'utf8'));
        assert.equal(mapFile.map.edges, undefined);
        assert.equal(mapFile.map.collapsedAnchors, undefined);
        assert.deepEqual(mapFile.map.relationshipViews, exportedMap.payload.map.relationshipViews);
        assert.deepEqual(mapFile.map.collapsedHubs, exportedMap.payload.map.collapsedHubs);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('DriveSync conflict-named duplicate files remain visible as stable separate entities', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-conflict-file-'));
    try {
        const data = (content) => ({
            pisi: {
                version: 1, type: 'node', id: 'node_same', title: 'Ortak',
                sidecar: sidecar('Ortak', '.node', 'node_same'), parentMap: 'none'
            },
            content
        });
        fs.writeFileSync(path.join(project, 'Ortak.node'), JSON.stringify(data('asıl')));
        fs.writeFileSync(
            path.join(project, 'Ortak (conflict 2026-08-23-12-30-45).node'),
            JSON.stringify(data('çakışan'))
        );
        storedTasks = [];
        storedRelationships = [];

        const first = adapter.exportPisiSyncEntities(project).filter(({ kind }) => kind === 'node');
        const original = first.find(({ id }) => id === 'node_same');
        const conflict = first.find(({ id }) => id !== 'node_same');

        assert.equal(first.length, 2);
        assert.equal(original.payload.content, 'asıl');
        assert.match(conflict.id, /^node_conflict_[A-Za-z0-9_-]+$/);
        assert.equal(conflict.payload.content, 'çakışan');
        assert.equal(conflict.payload.native.pisi.conflictOf, 'node_same');

        const records = first.map((entity, index) => ({
            ...entity,
            key: `${entity.kind}:${entity.id}`,
            deleted: false,
            hash: `hash_${index}`,
            version: { counter: index + 1, deviceId: 'device_test' },
            updatedAt: '2026-08-23T12:30:46.000Z'
        }));
        adapter.applyPisiSyncRecords(project, records, []);
        const second = adapter.exportPisiSyncEntities(project).filter(({ kind }) => kind === 'node');
        assert.deepEqual(new Set(second.map(({ id }) => id)), new Set(first.map(({ id }) => id)));
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('reparenting a node moves its binary sidecar beside the new desktop path', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-sidecar-move-'));
    try {
        const mapA = 'map_a';
        const mapB = 'map_b';
        const nodeId = 'node_move';
        const mapASidecar = sidecar('A', '.map', mapA);
        const mapBSidecar = sidecar('B', '.map', mapB);
        const nodeSidecar = sidecar('Ekli', '.node', nodeId);
        fs.mkdirSync(path.join(project, mapASidecar, nodeSidecar), { recursive: true });
        fs.mkdirSync(path.join(project, mapBSidecar), { recursive: true });
        fs.writeFileSync(path.join(project, 'A.map'), JSON.stringify({
            pisi: { version: 1, type: 'map', id: mapA, title: 'A', sidecar: mapASidecar },
            map: {
                nodes: [{ id: nodeId }],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: []
            }
        }));
        fs.writeFileSync(path.join(project, 'B.map'), JSON.stringify({
            pisi: { version: 1, type: 'map', id: mapB, title: 'B', sidecar: mapBSidecar },
            map: {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: []
            }
        }));
        fs.writeFileSync(path.join(project, mapASidecar, 'Ekli.node'), JSON.stringify({
            pisi: {
                version: 1, type: 'node', id: nodeId, title: 'Ekli',
                sidecar: nodeSidecar, parentMap: mapA
            },
            content: 'ekli'
        }));
        fs.writeFileSync(
            path.join(project, mapASidecar, nodeSidecar, 'asset.bin'),
            Buffer.from([9, 8, 7, 6])
        );
        storedTasks = [];
        storedRelationships = [];

        const entities = adapter.exportPisiSyncEntities(project);
        entities.find(({ id }) => id === nodeId).payload.parentMap = mapB;
        const records = entities.map((entity, index) => ({
            ...entity,
            key: `${entity.kind}:${entity.id}`,
            deleted: false,
            hash: `move_${index}`,
            version: { counter: index + 1, deviceId: 'device_test' },
            updatedAt: '2026-08-23T12:40:00.000Z'
        }));
        adapter.applyPisiSyncRecords(project, records, []);

        assert.deepEqual(
            fs.readFileSync(path.join(project, mapBSidecar, nodeSidecar, 'asset.bin')),
            Buffer.from([9, 8, 7, 6])
        );
        assert.equal(fs.existsSync(path.join(project, mapASidecar, nodeSidecar)), false);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('sync-created desktop names are NFC, case-safe, bounded and Windows compatible', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-windows-name-'));
    try {
        storedTasks = [];
        storedRelationships = [];
        const id = `node_${'a'.repeat(96)}`;
        adapter.applyPisiSyncRecords(project, [{
            key: `node:${id}`,
            kind: 'node',
            id,
            deleted: false,
            hash: 'windows-name',
            version: { counter: 1, deviceId: 'device_test' },
            updatedAt: '2026-08-23T12:50:00.000Z',
            payload: { title: 'CON', content: 'safe', parentMap: 'none' }
        }], []);
        const inventory = adapter.readProjectDocuments(project);
        const name = path.basename(inventory.documents[0].path);

        assert.match(name, /^_CON(?:__node_|\.node)/);
        assert.ok(name.length <= 180);
        assert.equal(name, name.normalize('NFC'));
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});
