const MAP_PORTS = new Set(['top', 'right', 'bottom', 'left']);
const MAP_EDGE_TYPES = new Set(['down-hub', 'stream', 'co-level']);

function fallbackEdgeId() {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `edge_${random}`;
}

function cleanId(value) {
  return String(value || '').trim();
}

export function isHierarchyMapEdge(edge) {
  return edge?.type === 'down-hub'
    && edge?.sourceRole === 'down-hub'
    && edge?.targetRole === 'up-hub';
}

export function convertMapEdgeToStream(edge) {
  return {
    ...edge,
    type: 'stream',
    sourceRole: 'downstream',
    targetRole: 'upstream'
  };
}

export function normalizeMapEdge(edge = {}, { idFactory = fallbackEdgeId } = {}) {
  const sourceId = cleanId(edge.sourceId || edge.from);
  const targetId = cleanId(edge.targetId || edge.to);
  if (!sourceId || !targetId || sourceId === targetId) return null;

  let type = String(edge.type || 'down-hub');
  if (type === 'colevel') type = 'co-level';
  if (!MAP_EDGE_TYPES.has(type)) type = 'down-hub';

  let sourceRole;
  let targetRole;
  if (type === 'co-level') {
    sourceRole = 'co-level';
    targetRole = 'co-level';
  } else if (type === 'stream') {
    sourceRole = 'downstream';
    targetRole = 'upstream';
  } else {
    type = 'down-hub';
    sourceRole = 'down-hub';
    targetRole = 'up-hub';
  }

  const sourcePort = MAP_PORTS.has(edge.sourcePort)
    ? edge.sourcePort
    : (MAP_PORTS.has(edge.fromAnchor) ? edge.fromAnchor : 'bottom');
  const targetPort = MAP_PORTS.has(edge.targetPort)
    ? edge.targetPort
    : (MAP_PORTS.has(edge.toAnchor) ? edge.toAnchor : 'top');
  const id = /^edge_[A-Za-z0-9_-]{1,101}$/.test(String(edge.id || ''))
    ? String(edge.id)
    : idFactory();

  const normalized = {
    ...edge,
    id,
    sourceId,
    targetId,
    sourcePort,
    targetPort,
    type,
    sourceRole,
    targetRole,

    // Mobile renderer aliases. Canonical desktop fields above remain authoritative.
    from: sourceId,
    to: targetId,
    fromAnchor: sourcePort,
    toAnchor: targetPort
  };
  if (edge.customization && typeof edge.customization === 'object') {
    normalized.customization = structuredClone(edge.customization);
  }
  return normalized;
}

export function getMapEdgeSemanticKey(edge) {
  const normalized = normalizeMapEdge(edge);
  if (!normalized) return '';
  if (normalized.type === 'co-level') {
    const pair = [normalized.sourceId, normalized.targetId].sort();
    return `co-level:${pair[0]}:${pair[1]}`;
  }
  return [
    normalized.type,
    normalized.sourceId,
    normalized.targetId,
    normalized.sourceRole,
    normalized.targetRole
  ].join(':');
}

export function wouldCreateMapHierarchyCycle(parentByChild, parentId, childId) {
  let current = parentId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === childId) return true;
    visited.add(current);
    current = parentByChild.get(current) || null;
  }
  return false;
}

export function normalizeMapEdges(rawEdges = [], validNodeIds = null) {
  const cleanEdges = [];
  const seenSemanticEdges = new Set();
  const parentByChild = new Map();
  const warnings = [];

  for (const rawEdge of Array.isArray(rawEdges) ? rawEdges : []) {
    let edge = normalizeMapEdge(rawEdge);
    if (!edge) {
      warnings.push('Geçersiz veya self-loop bağlantı atlandı.');
      continue;
    }
    if (
      validNodeIds instanceof Set
      && (!validNodeIds.has(edge.sourceId) || !validNodeIds.has(edge.targetId))
    ) {
      warnings.push(`Eksik node referanslı bağlantı atlandı: ${edge.id}`);
      continue;
    }

    if (isHierarchyMapEdge(edge)) {
      const existingParentId = parentByChild.get(edge.targetId);
      if (existingParentId && existingParentId !== edge.sourceId) {
        edge = convertMapEdgeToStream(edge);
        warnings.push(`İkinci parent bağlantısı stream olarak kurtarıldı: ${edge.id}`);
      } else if (
        !existingParentId
        && wouldCreateMapHierarchyCycle(parentByChild, edge.sourceId, edge.targetId)
      ) {
        edge = convertMapEdgeToStream(edge);
        warnings.push(`Döngü oluşturan bağlantı stream olarak kurtarıldı: ${edge.id}`);
      } else if (!existingParentId) {
        parentByChild.set(edge.targetId, edge.sourceId);
      }
    }

    const semanticKey = getMapEdgeSemanticKey(edge);
    if (!semanticKey || seenSemanticEdges.has(semanticKey)) {
      warnings.push(`Tekrarlanan bağlantı atlandı: ${edge.id}`);
      continue;
    }
    seenSemanticEdges.add(semanticKey);
    cleanEdges.push(edge);
  }

  return { edges: cleanEdges, warnings };
}

export function prepareMapConnection(existingEdges = [], rawEdge = {}, options = {}) {
  let edge = normalizeMapEdge(rawEdge, options);
  if (!edge) {
    return { ok: false, code: 'INVALID_EDGE', error: 'Geçersiz bağlantı.' };
  }

  const existing = normalizeMapEdges(existingEdges).edges;
  if (isHierarchyMapEdge(edge)) {
    const existingParent = existing.find((candidate) => (
      isHierarchyMapEdge(candidate)
      && candidate.targetId === edge.targetId
      && candidate.sourceId !== edge.sourceId
    ));

    if (existingParent && options.confirmSecondParentAsStream !== true) {
      return {
        ok: false,
        code: 'SECOND_PARENT_CONFIRM_REQUIRED',
        requiresConfirmation: true,
        error: 'Hedef node zaten bir parent bağlantısına sahip.',
        suggestedEdge: convertMapEdgeToStream(edge)
      };
    }

    if (existingParent) {
      edge = convertMapEdgeToStream(edge);
    } else {
      const parentByChild = new Map();
      existing.filter(isHierarchyMapEdge).forEach((candidate) => {
        parentByChild.set(candidate.targetId, candidate.sourceId);
      });
      if (wouldCreateMapHierarchyCycle(parentByChild, edge.sourceId, edge.targetId)) {
        return {
          ok: false,
          code: 'HIERARCHY_CYCLE',
          error: 'Bu bağlantı hiyerarşide döngü oluşturur.'
        };
      }
    }
  }

  const key = getMapEdgeSemanticKey(edge);
  const sameSemantic = existing.find((candidate) => getMapEdgeSemanticKey(candidate) === key);
  if (sameSemantic) {
    return { ok: true, unchanged: true, edge: sameSemantic };
  }
  return { ok: true, edge };
}

export function mapEdgeToRelationship(edge) {
  const normalized = normalizeMapEdge(edge);
  if (!normalized) return null;
  const relationship = {
    id: normalized.id,
    sourceId: normalized.sourceId,
    targetId: normalized.targetId,
    type: normalized.type,
    sourceRole: normalized.sourceRole,
    targetRole: normalized.targetRole,
    direction: normalized.type === 'co-level' ? 'undirected' : 'directed'
  };
  if (edge.label) relationship.label = String(edge.label);
  if (edge.properties && typeof edge.properties === 'object') {
    relationship.properties = structuredClone(edge.properties);
  }
  return relationship;
}

export function mapEdgeToRelationshipView(edge) {
  const normalized = normalizeMapEdge(edge);
  if (!normalized) return null;
  const view = {
    relationshipId: normalized.id,
    sourcePort: normalized.sourcePort,
    targetPort: normalized.targetPort
  };
  if (normalized.customization && typeof normalized.customization === 'object') {
    view.customization = structuredClone(normalized.customization);
  }
  return view;
}

export function projectRelationshipsToMapEdges(relationships = [], relationshipViews = [], validNodeIds = null) {
  const relationshipsById = new Map(
    (Array.isArray(relationships) ? relationships : [])
      .filter((relationship) => relationship?.id)
      .map((relationship) => [String(relationship.id), relationship])
  );
  const projected = [];
  for (const rawView of Array.isArray(relationshipViews) ? relationshipViews : []) {
    const relationshipId = String(rawView?.relationshipId || rawView?.id || '');
    const relationship = relationshipsById.get(relationshipId);
    if (!relationship) continue;
    const edge = normalizeMapEdge({
      ...relationship,
      sourcePort: rawView.sourcePort,
      targetPort: rawView.targetPort,
      customization: rawView.customization
    });
    if (!edge) continue;
    if (
      validNodeIds instanceof Set
      && (!validNodeIds.has(edge.sourceId) || !validNodeIds.has(edge.targetId))
    ) continue;
    projected.push(edge);
  }
  return normalizeMapEdges(projected, validNodeIds).edges;
}
