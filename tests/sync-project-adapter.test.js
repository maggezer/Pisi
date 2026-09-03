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
        return { pisi, map: { nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 } } };
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
        fs.mkdirSync(path.join(project, mapSidecar));
        fs.writeFileSync(path.join(project, 'Harita.map'), JSON.stringify({
            pisi: { version: 1, type: 'map', id: mapId, title: 'Harita', sidecar: mapSidecar },
            map: { nodes: [{ id: nodeId, x: 10, y: 20 }], edges: [], camera: { x: 0, y: 0, zoom: 1 } }
        }));
        fs.writeFileSync(path.join(project, mapSidecar, 'Not.node'), JSON.stringify({
            pisi: { version: 1, type: 'node', id: nodeId, title: 'Not', parentMap: mapId },
            content: '<p>İlk</p>', properties: { durum: 'aktif' }
        }));
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
        const result = adapter.applyPisiSyncRecords(project, records, []);
        assert.equal(result.documents, 2);
        assert.equal(result.tasks, 1);

        const exported = adapter.exportPisiSyncEntities(project);
        const exportedNode = exported.find((entity) => entity.kind === 'node' && entity.id === nodeId);
        const exportedTask = exported.find((entity) => entity.kind === 'task');
        assert.equal(exportedNode.payload.content, '<p>Mobil değişiklik</p>');
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
