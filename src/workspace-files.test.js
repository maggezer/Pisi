import { describe, expect, it } from 'vitest';
import { buildWorkspaceProjection, parseWorkspaceFiles } from './workspace-files.js';

const updatedAt = '2026-08-23T08:30:00.000Z';

function record(kind, id, payload) {
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    payload,
    deleted: false,
    hash: `hash_${id}`,
    version: { counter: 1, deviceId: 'device_mobile' },
    ancestors: [],
    updatedAt
  };
}

describe('visible Pisi workspace files', () => {
  it('materializes and parses desktop-compatible node, map and authority files', () => {
    const records = [
      record('map', 'map_alpha', {
        title: 'Türkçe Harita',
        map: {
          nodes: [{ id: 'node_child', x: 10, y: 20, width: 220, height: 92 }],
          edges: [],
          camera: { x: 2, y: 3, zoom: 1.1 },
          collapsedAnchors: []
        },
        tags: ['plan'],
        properties: {},
        createdAt: updatedAt,
        updatedAt
      }),
      record('node', 'node_child', {
        title: 'Çocuk düğüm',
        content: '<p>Harita içeriği</p>',
        blocks: [],
        tags: [],
        properties: {},
        relations: [{ id: 'edge_alpha', targetId: 'node_standalone', type: 'co-level' }],
        sources: [],
        parentMap: 'map_alpha',
        documentKind: 'note',
        createdAt: updatedAt,
        updatedAt
      }),
      record('node', 'node_standalone', {
        title: 'Özel Not',
        content: '<p>Bağımsız içerik</p>',
        blocks: [],
        tags: ['mobil'],
        properties: { durum: 'aktif' },
        relations: [],
        sources: [],
        parentMap: 'none',
        documentKind: 'note',
        relativePath: 'Klasör/Özel Not.node',
        createdAt: updatedAt,
        updatedAt
      }),
      record('task', 'task_alpha', {
        title: 'Dosyayı doğrula',
        status: 'todo',
        source: { documentId: 'node_standalone', blockId: 'block_1', mapId: null }
      }),
      record('config', 'propertySchema', {
        value: [{ id: 'prop_status', name: 'Durum', type: 'text' }]
      }),
      record('config', 'savedViews', { value: [] }),
      record('config', 'templates', { value: [] })
    ];

    const projection = buildWorkspaceProjection(records);
    const mapPath = projection.index.records['map:map_alpha'];
    const childPath = projection.index.records['node:node_child'];

    expect(mapPath).toMatch(/Türkçe Harita__map_alpha\.map$/);
    expect(childPath).toMatch(/^nd_Türkçe Harita__map_alpha\/Çocuk düğüm__node_child\.node$/);
    expect(projection.visibleFiles).toContain('Klasör/Özel Not.node');
    expect(JSON.parse(projection.files.find(({ path }) => path === mapPath).content).pisi.sidecar)
      .toBe('nd_Türkçe Harita__map_alpha');

    const parsed = parseWorkspaceFiles(projection.files);
    const child = parsed.entities.find(({ kind, id }) => kind === 'node' && id === 'node_child');
    const task = parsed.entities.find(({ kind, id }) => kind === 'task' && id === 'task_alpha');
    const schema = parsed.entities.find(({ kind, id }) => kind === 'config' && id === 'propertySchema');

    expect(parsed.warnings).toEqual([]);
    expect(child.payload.content).toBe('<p>Harita içeriği</p>');
    expect(child.payload.parentMap).toBe('map_alpha');
    expect(child.payload.relations[0].targetId).toBe('node_standalone');
    expect(task.payload.source.documentId).toBe('node_standalone');
    expect(task.payload.source.blockId).toBe('block_1');
    expect(schema.payload.value[0].name).toBe('Durum');
  });
});
