import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceProjection, parseWorkspaceFiles, sanitizePisiFileTitle
} from './workspace-files.js';

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
          collapsedHubs: []
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

  it('writes property map references as real desktop node paths without duplicating nodes', () => {
    const records = [
      record('map', 'map_property', {
        title: 'Durum haritası',
        map: {
          nodes: [{ id: 'node_source', x: 100, y: 120, width: 220, height: 92 }],
          references: [{ id: 'node_source' }],
          edges: [],
          collapsedHubs: [],
          generated: { kind: 'properties', property: 'durum' },
          camera: { x: 20, y: 20, zoom: 0.85 }
        },
        updatedAt
      }),
      record('node', 'node_source', {
        title: 'Kaynak',
        content: '<p>Asıl içerik</p>',
        parentMap: 'none',
        relations: [],
        relativePath: 'Notlar/Kaynak.node',
        updatedAt
      })
    ];

    const projection = buildWorkspaceProjection(records);
    const mapPath = projection.index.records['map:map_property'];
    const sourcePath = projection.index.records['node:node_source'];
    const writtenMap = JSON.parse(
      projection.files.find(({ path }) => path === mapPath).content
    );

    expect(sourcePath).toBe('Notlar/Kaynak.node');
    expect(writtenMap.map.references).toEqual([{
      id: 'node_source',
      path: 'Notlar/Kaynak.node'
    }]);
    expect(
      projection.files.filter(({ recordKey }) => recordKey === 'node:node_source')
    ).toHaveLength(1);

    const parsed = parseWorkspaceFiles(projection.files);
    const map = parsed.entities.find(({ kind, id }) => (
      kind === 'map' && id === 'map_property'
    ));
    const source = parsed.entities.find(({ kind, id }) => (
      kind === 'node' && id === 'node_source'
    ));

    expect(map.payload.map.references).toEqual([{ id: 'node_source' }]);
    expect(map.payload.map.nodes).toHaveLength(1);
    expect(map.payload.map.generated).toMatchObject({
      kind: 'properties',
      property: 'durum'
    });
    expect(source.payload.parentMap).toBe('none');
  });

  it('round-trips the canonical desktop semantic map relationship schema', () => {
    const records = [
      record('map', 'map_semantic', {
        title: 'Semantic Harita',
        map: {
          nodes: [
            { id: 'node_parent', x: 20, y: 20 },
            { id: 'node_child', x: 280, y: 20 }
          ],
          edges: [{
            id: 'edge_semantic',
            sourceId: 'node_parent',
            targetId: 'node_child',
            sourcePort: 'right',
            targetPort: 'left',
            type: 'down-hub',
            sourceRole: 'down-hub',
            targetRole: 'up-hub'
          }],
          camera: { x: 0, y: 0, zoom: 1 },
          collapsedHubs: ['node_parent::right']
        },
        updatedAt
      }),
      record('node', 'node_parent', {
        title: 'Parent', content: '', parentMap: 'map_semantic', relations: [], updatedAt
      }),
      record('node', 'node_child', {
        title: 'Child', content: '', parentMap: 'map_semantic', relations: [], updatedAt
      })
    ];

    const projection = buildWorkspaceProjection(records);
    const mapPath = projection.index.records['map:map_semantic'];
    const writtenMap = JSON.parse(
      projection.files.find(({ path }) => path === mapPath).content
    );
    const relationshipFile = projection.files.find(
      ({ path }) => path === '.pisi/relationships.json'
    );
    const relationshipStore = JSON.parse(relationshipFile.content);

    expect(relationshipFile.content.endsWith('\n')).toBe(false);
    expect(writtenMap.map.edges).toBeUndefined();
    expect(writtenMap.map.collapsedHubs).toEqual(['node_parent::right']);
    expect(writtenMap.map.relationshipViewVersion).toBe(1);
    expect(writtenMap.map.relationshipViews).toEqual([{
      relationshipId: 'edge_semantic',
      sourcePort: 'right',
      targetPort: 'left'
    }]);
    expect(relationshipStore.updatedAt).toBeUndefined();
    const parentPath = projection.index.records['node:node_parent'];
    const childPath = projection.index.records['node:node_child'];
    const parentFile = JSON.parse(
      projection.files.find(({ path }) => path === parentPath).content
    );
    const childFile = JSON.parse(
      projection.files.find(({ path }) => path === childPath).content
    );
    expect(parentFile.pisi.connectionTypes['down-hub']).toEqual(['node_child']);
    expect(childFile.pisi.connectionTypes['up-hub']).toEqual(['node_parent']);

    expect(relationshipStore.relationships).toContainEqual(expect.objectContaining({
      id: 'edge_semantic',
      sourceId: 'node_parent',
      targetId: 'node_child',
      type: 'down-hub',
      sourceRole: 'down-hub',
      targetRole: 'up-hub',
      direction: 'directed'
    }));

    const parsed = parseWorkspaceFiles(projection.files);
    const map = parsed.entities.find(({ kind, id }) => kind === 'map' && id === 'map_semantic');
    const parent = parsed.entities.find(({ kind, id }) => kind === 'node' && id === 'node_parent');
    expect(map.payload.map.collapsedHubs).toEqual(['node_parent::right']);
    expect(map.payload.map.edges).toHaveLength(1);
    expect(map.payload.map.edges[0]).toMatchObject({
      id: 'edge_semantic',
      sourceId: 'node_parent',
      targetId: 'node_child',
      sourcePort: 'right',
      targetPort: 'left',
      type: 'down-hub'
    });
    expect(parent.payload.relations).toEqual([]);

    const secondProjection = buildWorkspaceProjection(
      parsed.entities.map((entity) => record(entity.kind, entity.id, entity.payload))
    );
    const secondRelationshipStore = JSON.parse(
      secondProjection.files.find(({ path }) => path === '.pisi/relationships.json').content
    );
    const firstSemantic = relationshipStore.relationships.find(
      ({ id }) => id === 'edge_semantic'
    );
    const secondSemantic = secondRelationshipStore.relationships.find(
      ({ id }) => id === 'edge_semantic'
    );
    expect(secondSemantic.createdAt).toBe(firstSemantic.createdAt);
    expect(secondSemantic.updatedAt).toBe(firstSemantic.updatedAt);
  });

  it('keeps relationships without relationshipViews out of the map projection', () => {
    const mapFile = JSON.stringify({
      pisi: {
        version: 1,
        type: 'map',
        id: 'map_missing_view',
        title: 'Eksik görünüm',
        sidecar: 'nd_Eksik__map_missing_view',
        updatedAt
      },
      map: {
        nodes: [
          { id: 'node_mv_a', x: 0, y: 0 },
          { id: 'node_mv_b', x: 240, y: 0 }
        ],
        relationshipViews: [],
        relationshipViewVersion: 1,
        camera: { x: 0, y: 0, zoom: 1 },
        collapsedHubs: []
      }
    });
    const relationships = JSON.stringify({
      version: 1,
      relationships: [{
        id: 'edge_missing_view',
        sourceId: 'node_mv_a',
        targetId: 'node_mv_b',
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream',
        direction: 'directed',
        createdAt: updatedAt,
        updatedAt
      }]
    });
    const nodeFile = (id, title) => JSON.stringify({
      pisi: {
        version: 1,
        type: 'node',
        id,
        title,
        sidecar: `inv_${id}`,
        parentMap: 'map_missing_view',
        updatedAt
      },
      content: '',
      blocks: [],
      tags: [],
      properties: {},
      sources: []
    });

    const parsed = parseWorkspaceFiles([
      { path: 'Eksik.map', content: mapFile },
      { path: 'nd_Eksik__map_missing_view/A.node', content: nodeFile('node_mv_a', 'A') },
      { path: 'nd_Eksik__map_missing_view/B.node', content: nodeFile('node_mv_b', 'B') },
      { path: '.pisi/relationships.json', content: relationships }
    ]);
    const map = parsed.entities.find(({ kind }) => kind === 'map');
    const sourceNode = parsed.entities.find(({ id }) => id === 'node_mv_a');

    expect(map.payload.map.edges).toEqual([]);
    expect(sourceNode.payload.relations).toContainEqual(expect.objectContaining({
      id: 'edge_missing_view',
      targetId: 'node_mv_b',
      type: 'stream'
    }));
  });

  it('preserves unknown desktop fields and a binary sidecar reference across a mobile round-trip', () => {
    const native = {
      pisi: {
        version: 1,
        type: 'node',
        id: 'node_unknown',
        title: 'Eski başlık',
        sidecar: 'inv_Eski başlık__node_unknown',
        parentMap: 'none',
        desktopExtension: { future: true }
      },
      content: '<p>Özgün</p>',
      attachments: [{ path: 'photo.bin', mime: 'application/octet-stream' }],
      futureTopLevel: { nested: ['kept'] }
    };
    const projection = buildWorkspaceProjection([record('node', 'node_unknown', {
      title: 'Yeni başlık',
      content: '<p>Mobil düzenleme</p>',
      native,
      relativePath: 'Arşiv/Eski.node',
      updatedAt
    })]);
    const file = projection.files.find(({ visible }) => visible);
    const written = JSON.parse(file.content);

    expect(file.path).toBe('Arşiv/Eski.node');
    expect(written.pisi.sidecar).toBe('inv_Eski başlık__node_unknown');
    expect(written.pisi.desktopExtension).toEqual({ future: true });
    expect(written.attachments[0].path).toBe('photo.bin');
    expect(written.futureTopLevel.nested).toEqual(['kept']);

    const parsed = parseWorkspaceFiles(projection.files);
    const roundTrip = buildWorkspaceProjection(parsed.entities.map((entity) => record(
      entity.kind, entity.id, entity.payload
    )));
    const second = JSON.parse(roundTrip.files.find(({ visible }) => visible).content);
    expect(second.pisi.desktopExtension).toEqual({ future: true });
    expect(second.futureTopLevel.nested).toEqual(['kept']);
    expect(second.pisi.sidecar).toBe('inv_Eski başlık__node_unknown');
  });

  it('keeps DriveSync conflict files as stable, separately addressable copies', () => {
    const makeContent = (content) => JSON.stringify({
      pisi: {
        version: 1, type: 'node', id: 'node_shared', title: 'Ortak',
        sidecar: 'inv_Ortak__node_shared', parentMap: 'none',
        updatedAt
      },
      content, blocks: [], tags: [], properties: {}, sources: []
    });
    const conflictPath = 'Ortak (conflict 2026-08-23-12-30-45).node';
    const parsed = parseWorkspaceFiles([
      { path: 'Ortak.node', content: makeContent('<p>Asıl</p>') },
      { path: conflictPath, content: makeContent('<p>Çakışan</p>') }
    ]);
    const original = parsed.entities.find(({ id }) => id === 'node_shared');
    const conflict = parsed.entities.find(({ id }) => id !== 'node_shared');

    expect(parsed.warnings).toEqual([]);
    expect(parsed.fileConflicts).toHaveLength(1);
    expect(original.payload.content).toBe('<p>Asıl</p>');
    expect(conflict.id).toMatch(/^node_conflict_[a-f0-9]{8}$/);
    expect(conflict.payload.native.pisi.conflictOf).toBe('node_shared');

    const projection = buildWorkspaceProjection(parsed.entities.map((entity) => record(
      entity.kind, entity.id, entity.payload
    )));
    const reparsed = parseWorkspaceFiles(projection.files);
    expect(reparsed.entities.some(({ id }) => id === conflict.id)).toBe(true);
    expect(reparsed.entities.filter(({ kind }) => kind === 'node')).toHaveLength(2);
  });

  it('normalizes Unicode and avoids Windows-reserved file names', () => {
    expect(sanitizePisiFileTitle('CON')).toBe('_CON');
    expect(sanitizePisiFileTitle('baslik. ')).toBe('baslik');
    expect(sanitizePisiFileTitle('Çalışma')).toBe('Çalışma');

    const longId = `node_${'a'.repeat(96)}`;
    const projection = buildWorkspaceProjection([
      record('node', longId, { title: 'Çok '.repeat(100), content: '' }),
      record('node', 'node_case_a', {
        title: 'Bir', content: '', relativePath: 'Klasör/Not.node'
      }),
      record('node', 'node_case_b', {
        title: 'İki', content: '', relativePath: 'klasör/not.node'
      })
    ]);
    const visible = projection.visibleFiles;
    expect(visible.every((path) => path.split('/').every((part) => part.length <= 180))).toBe(true);
    expect(new Set(visible.map((path) => path.toLocaleLowerCase('en-US'))).size).toBe(visible.length);

    expect(() => buildWorkspaceProjection([record('node', 'node_legacy', {
      title: 'CON',
      content: '',
      relativePath: 'CON.node',
      native: {
        pisi: {
          version: 1, type: 'node', id: 'node_legacy', title: 'CON',
          sidecar: 'inv_CON__node_legacy', parentMap: 'none'
        }
      }
    })])).toThrow('Windows ile uyumsuz mevcut node yolu otomatik taşınmadı');
  });
});
