import { describe, expect, it } from 'vitest';
import {
  getMapEdgeSemanticKey,
  normalizeMapEdge,
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
  it('normalizes legacy mobile geometry into canonical desktop fields', () => {
    expect(normalizeMapEdge({
      id: 'edge_legacy',
      from: 'node_a',
      to: 'node_b',
      fromAnchor: 'left',
      toAnchor: 'right'
    })).toMatchObject({
      sourceId: 'node_a',
      targetId: 'node_b',
      sourcePort: 'left',
      targetPort: 'right',
      type: 'down-hub',
      sourceRole: 'down-hub',
      targetRole: 'up-hub'
    });
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

  it('projects desktop relationshipViews back into mobile-renderable edges', () => {
    const projected = projectRelationshipsToMapEdges(
      [{
        id: 'edge_desktop',
        sourceId: 'node_a',
        targetId: 'node_b',
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
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
      sourceId: 'node_a',
      targetId: 'node_b',
      sourcePort: 'top',
      targetPort: 'bottom',
      type: 'stream',
      from: 'node_a',
      to: 'node_b',
      fromAnchor: 'top',
      toAnchor: 'bottom'
    });
  });
});
