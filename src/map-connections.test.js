import { describe, expect, it } from 'vitest';
import {
  getMapEdgeSemanticKey,
  normalizeMapEdge,
  normalizeMapEdgeCustomization,
  normalizeRelationshipCollection,
  prepareMapConnection,
  projectRelationshipsToMapEdges
} from './map-connections.js';

function edge(id, sourceId, targetId, extra = {}) {
  return {
    id,
    sourceId,
    targetId,
    sourcePort: 'right',
    targetPort: 'left',
    type: 'down-hub',
    sourceRole: 'down-hub',
    targetRole: 'up-hub',
    ...extra
  };
}

describe('desktop-compatible map connection rules', () => {
  it('accepts legacy mobile geometry but emits canonical desktop fields', () => {
    const normalized = normalizeMapEdge({
      id: 'edge_legacy',
      from: 'node_a',
      to: 'node_b',
      fromAnchor: 'left',
      toAnchor: 'right'
    });
    expect(normalized).toMatchObject({
      id: 'edge_legacy',
      sourceId: 'node_a',
      targetId: 'node_b',
      sourcePort: 'left',
      targetPort: 'right',
      type: 'down-hub',
      sourceRole: 'down-hub',
      targetRole: 'up-hub'
    });
    expect(normalized.from).toBeUndefined();
    expect(normalized.to).toBeUndefined();
    expect(normalized.fromAnchor).toBeUndefined();
    expect(normalized.toAnchor).toBeUndefined();
  });

  it('requires confirmation for a second hierarchy parent and then stores it as stream', () => {
    const existing = [edge('edge_parent_a', 'node_a', 'node_child')];
    const proposed = edge('edge_parent_b', 'node_b', 'node_child');

    const blocked = prepareMapConnection(existing, proposed);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('SECOND_PARENT_CONFIRM_REQUIRED');
    expect(blocked.suggestedEdge.type).toBe('stream');

    const confirmed = prepareMapConnection(existing, proposed, {
      confirmSecondParentAsStream: true
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.edge).toMatchObject({
      type: 'stream',
      sourceRole: 'downstream',
      targetRole: 'upstream'
    });
  });

  it('rejects hierarchy cycles', () => {
    const existing = [
      edge('edge_ab', 'node_a', 'node_b'),
      edge('edge_bc', 'node_b', 'node_c')
    ];
    const result = prepareMapConnection(
      existing,
      edge('edge_ca', 'node_c', 'node_a')
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('HIERARCHY_CYCLE');
  });

  it('treats co-level relationships as undirected semantic duplicates', () => {
    const first = edge('edge_co_1', 'node_a', 'node_b', { type: 'co-level' });
    const reverse = edge('edge_co_2', 'node_b', 'node_a', { type: 'co-level' });
    expect(getMapEdgeSemanticKey(first)).toBe(getMapEdgeSemanticKey(reverse));
  });

  it('rejects duplicate relationship IDs like desktop relationship store', () => {
    const normalized = normalizeRelationshipCollection([
      edge('edge_same', 'node_a', 'node_b'),
      edge('edge_same', 'node_c', 'node_d', { type: 'stream' })
    ]);
    expect(normalized.relationships).toHaveLength(1);
    expect(normalized.warnings.some((warning) => warning.includes('relationship id'))).toBe(true);
  });

  it('preserves createdAt when an existing relationship changes type', () => {
    const createdAt = '2026-09-01T10:00:00.000Z';
    const existing = [edge('edge_change', 'node_a', 'node_b', {
      createdAt,
      updatedAt: createdAt
    })];
    const result = prepareMapConnection(existing, edge('edge_change', 'node_a', 'node_b', {
      type: 'stream'
    }));
    expect(result.ok).toBe(true);
    expect(result.relationship.createdAt).toBe(createdAt);
    expect(result.relationship.type).toBe('stream');
    expect(result.relationship.updatedAt).not.toBe(createdAt);
  });

  it('uses desktop edge customization rules', () => {
    expect(normalizeMapEdgeCustomization({ color: '#AABBCC', width: 99 }))
      .toEqual({ color: '#aabbcc' });
    expect(normalizeMapEdgeCustomization({ color: 'red' })).toEqual({});
  });

  it('projects desktop relationshipViews back into mobile-renderable edges', () => {
    const projected = projectRelationshipsToMapEdges(
      [{
        id: 'edge_desktop',
        sourceId: 'node_a',
        targetId: 'node_b',
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-02T10:00:00.000Z'
      }],
      [{
        relationshipId: 'edge_desktop',
        sourcePort: 'top',
        targetPort: 'bottom'
      }],
      new Set(['node_a', 'node_b'])
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      id: 'edge_desktop',
      relationshipId: 'edge_desktop',
      sourceId: 'node_a',
      targetId: 'node_b',
      sourcePort: 'top',
      targetPort: 'bottom',
      type: 'stream',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    });
  });

  it('projects a desktop semantic relationship even when its view is missing', () => {
    const projected = projectRelationshipsToMapEdges(
      [edge('edge_no_view', 'node_a', 'node_b')],
      [],
      new Set(['node_a', 'node_b'])
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      id: 'edge_no_view',
      sourcePort: 'bottom',
      targetPort: 'top'
    });
  });
});
