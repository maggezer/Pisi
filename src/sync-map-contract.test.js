import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  documents: [],
  tasks: [],
  settings: new Map(),
  replaced: null
}));

vi.mock('./db.js', () => ({
  getSetting: vi.fn(async (key, fallback = null) => (
    state.settings.has(key) ? structuredClone(state.settings.get(key)) : fallback
  )),
  listDocuments: vi.fn(async () => structuredClone(state.documents)),
  listTasks: vi.fn(async () => structuredClone(state.tasks)),
  replaceSyncedWorkspace: vi.fn(async (payload) => {
    state.replaced = structuredClone(payload);
  })
}));

import {
  applyMobileSyncRecords,
  exportMobileSyncEntities
} from './sync-adapter.js';

function asRecord(entity, index) {
  return {
    ...structuredClone(entity),
    key: `${entity.kind}:${entity.id}`,
    deleted: false,
    hash: `hash_${index}`,
    version: { counter: index + 1, deviceId: 'device_test' },
    updatedAt: '2026-09-26T20:00:00.000Z'
  };
}

describe('canonical desktop/mobile map sync contract', () => {
  beforeEach(() => {
    state.documents = [];
    state.tasks = [];
    state.settings = new Map([
      ['propertySchema', []],
      ['savedViews', []],
      ['templates', []]
    ]);
    state.replaced = null;
  });

  it('exports semantics via node relations and geometry via relationshipViews', async () => {
    state.documents = [{
      id: 'map_contract',
      kind: 'canvas',
      title: 'Contract',
      canvas: {
        nodes: [
          { id: 'node_a', title: 'A', content: '<p>A</p>', x: 10, y: 20 },
          { id: 'node_b', title: 'B', content: '<p>B</p>', x: 300, y: 160 }
        ],
        edges: [{
          id: 'edge_ab',
          sourceId: 'node_a',
          targetId: 'node_b',
          sourcePort: 'right',
          targetPort: 'top',
          type: 'stream',
          sourceRole: 'downstream',
          targetRole: 'upstream',
          customization: { color: '#112233' },
          createdAt: '2026-09-26T10:00:00.000Z',
          updatedAt: '2026-09-26T11:00:00.000Z'
        }],
        collapsedHubs: ['node_a::right'],
        camera: { x: 12, y: -9, zoom: 1.2 }
      },
      createdAt: '2026-09-26T09:00:00.000Z',
      updatedAt: '2026-09-26T11:00:00.000Z'
    }];

    const entities = await exportMobileSyncEntities();
    const map = entities.find(({ kind }) => kind === 'map');
    const source = entities.find(({ kind, id }) => kind === 'node' && id === 'node_a');

    expect(map.payload.map.edges).toBeUndefined();
    expect(map.payload.map.collapsedAnchors).toBeUndefined();
    expect(map.payload.map.relationshipViewVersion).toBe(1);
    expect(map.payload.map.relationshipViews).toEqual([{
      relationshipId: 'edge_ab',
      sourcePort: 'right',
      targetPort: 'top',
      customization: { color: '#112233' }
    }]);
    expect(map.payload.map.collapsedHubs).toEqual(['node_a::right']);
    expect(source.payload.relations).toEqual([
      expect.objectContaining({
        id: 'edge_ab',
        targetId: 'node_b',
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream',
        direction: 'directed'
      })
    ]);
  });

  it('rebuilds mobile canvas edges from node relations plus relationshipViews', async () => {
    const entities = [
      {
        kind: 'map',
        id: 'map_contract',
        payload: {
          schema: 'pisi.map.v1',
          title: 'Contract',
          map: {
            nodes: [
              { id: 'node_a', x: 10, y: 20, width: 220, height: 92 },
              { id: 'node_b', x: 300, y: 160, width: 220, height: 92 }
            ],
            relationshipViews: [{
              relationshipId: 'edge_ab',
              sourcePort: 'left',
              targetPort: 'bottom',
              customization: { color: '#445566' }
            }],
            relationshipViewVersion: 1,
            collapsedHubs: ['node_a::left'],
            camera: { x: 1, y: 2, zoom: 1.1 }
          }
        }
      },
      {
        kind: 'node',
        id: 'node_a',
        payload: {
          schema: 'pisi.node.v1',
          title: 'A',
          content: '<p>A</p>',
          parentMap: 'map_contract',
          relations: [{
            id: 'edge_ab',
            targetId: 'node_b',
            type: 'co-level',
            sourceRole: 'co-level',
            targetRole: 'co-level',
            direction: 'undirected',
            createdAt: '2026-09-26T10:00:00.000Z',
            updatedAt: '2026-09-26T12:00:00.000Z'
          }]
        }
      },
      {
        kind: 'node',
        id: 'node_b',
        payload: {
          schema: 'pisi.node.v1',
          title: 'B',
          content: '<p>B</p>',
          parentMap: 'map_contract',
          relations: []
        }
      }
    ];

    await applyMobileSyncRecords(entities.map(asRecord), []);

    const map = state.replaced.documents.find(({ kind }) => kind === 'canvas');
    expect(map.canvas.edges).toHaveLength(1);
    expect(map.canvas.edges[0]).toMatchObject({
      id: 'edge_ab',
      sourceId: 'node_a',
      targetId: 'node_b',
      sourcePort: 'left',
      targetPort: 'bottom',
      type: 'co-level',
      sourceRole: 'co-level',
      targetRole: 'co-level',
      customization: { color: '#445566' }
    });
    expect(map.canvas.collapsedHubs).toEqual(['node_a::left']);
  });
});
