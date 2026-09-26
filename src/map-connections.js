const MAP_PORTS = new Set(['top', 'right', 'bottom', 'left']);
const MAP_EDGE_TYPES = new Set(['down-hub', 'stream', 'co-level']);
const NODE_ID = /^node_[A-Za-z0-9_-]{1,96}$/;
const EDGE_ID = /^edge_[A-Za-z0-9_-]{1,101}$/;

function fallbackEdgeId() {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `edge_${random}`;
}

function normalizeNodeId(value) {
  const id = String(value || '').trim();
  return NODE_ID.test(id) ? id : null;
}

function validTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(value || ''));
}

export function normalizeMapEdgeCustomization(customization = {}) {
  const color = String(customization?.color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? { color: color.toLowerCase() } : {};
}

export function normalizeRelationshipProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = String(rawKey || '').trim().slice(0, 120);
    if (!key) continue;
    if (
      rawValue === null ||
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean'
    ) {
      clean[key] = typeof rawValue === 'string'
        ? rawValue.slice(0, 4000)
        : rawValue;
    }
  }
  return clean;
}

export function normalizeMapEdge(edge = {}, { idFactory = fallbackEdgeId } = {}) {
  const sourceId = normalizeNodeId(edge.sourceId);
  const targetId = normalizeNodeId(edge.targetId);
  if (!sourceId || !targetId || sourceId === targetId) return null;

  let type = String(edge.type || '');
  if (!MAP_EDGE_TYPES.has(type)) return null;

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

  const sourcePort = MAP_PORTS.has(edge.sourcePort) ? edge.sourcePort : 'bottom';
  const targetPort = MAP_PORTS.has(edge.targetPort) ? edge.targetPort : 'top';

  const normalized = {
    id: EDGE_ID.test(String(edge.id || '')) ? String(edge.id) : idFactory(),
    sourceId,
    targetId,
    sourcePort,
    targetPort,
    type,
    sourceRole,
    targetRole
  };
  const customization = normalizeMapEdgeCustomization(edge.customization);
  if (Object.keys(customization).length) normalized.customization = customization;
  return normalized;
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

export function normalizeMapEdgeProjections(rawEdges = [], validNodeIds = null) {
  const rawById = new Map(
    (Array.isArray(rawEdges) ? rawEdges : [])
      .filter((edge) => edge?.id)
      .map((edge) => [String(edge.id), edge])
  );
  return normalizeMapEdges(rawEdges, validNodeIds).edges.map((edge) => {
    const raw = rawById.get(edge.id) || {};
    const projected = { ...edge };
    const label = String(raw.label || '').trim().slice(0, 500);
    if (label) projected.label = label;
    const properties = normalizeRelationshipProperties(raw.properties);
    if (Object.keys(properties).length) projected.properties = properties;
    if (validTimestamp(raw.createdAt)) projected.createdAt = String(raw.createdAt);
    if (validTimestamp(raw.updatedAt)) projected.updatedAt = String(raw.updatedAt);
    projected.relationshipId = edge.id;
    return projected;
  });
}

export function normalizeSemanticRelationship(raw = {}, options = {}) {
  const edge = normalizeMapEdge(raw);
  if (!edge) return null;
  const now = new Date().toISOString();
  const relationship = {
    id: EDGE_ID.test(String(raw.id || '')) ? String(raw.id) : edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    type: edge.type,
    sourceRole: edge.sourceRole,
    targetRole: edge.targetRole,
    direction: edge.type === 'co-level' ? 'undirected' : 'directed',
    createdAt: validTimestamp(raw.createdAt)
      ? String(raw.createdAt)
      : (options.createdAt || now),
    updatedAt: validTimestamp(raw.updatedAt)
      ? String(raw.updatedAt)
      : now
  };
  const label = String(raw.label || '').trim().slice(0, 500);
  if (label) relationship.label = label;
  const properties = normalizeRelationshipProperties(raw.properties);
  if (Object.keys(properties).length) relationship.properties = properties;
  return relationship;
}

export function normalizeRelationshipCollection(rawRelationships = []) {
  const relationships = [];
  const seenIds = new Set();
  const seenSemanticKeys = new Set();
  const parentByChild = new Map();
  const warnings = [];

  for (const raw of Array.isArray(rawRelationships) ? rawRelationships : []) {
    let relationship = normalizeSemanticRelationship(raw);
    if (!relationship) {
      warnings.push('Geçersiz semantic relationship atlandı.');
      continue;
    }
    if (seenIds.has(relationship.id)) {
      warnings.push(`Tekrarlanan relationship id atlandı: ${relationship.id}`);
      continue;
    }

    if (isHierarchyMapEdge(relationship)) {
      const existingParent = parentByChild.get(relationship.targetId);
      if (existingParent && existingParent !== relationship.sourceId) {
        relationship = normalizeSemanticRelationship({
          ...relationship,
          type: 'stream',
          sourceRole: 'downstream',
          targetRole: 'upstream'
        });
        warnings.push(`İkinci semantic parent stream olarak kurtarıldı: ${relationship.id}`);
      } else if (
        !existingParent
        && wouldCreateMapHierarchyCycle(
          parentByChild,
          relationship.sourceId,
          relationship.targetId
        )
      ) {
        relationship = normalizeSemanticRelationship({
          ...relationship,
          type: 'stream',
          sourceRole: 'downstream',
          targetRole: 'upstream'
        });
        warnings.push(`Döngü oluşturan semantic relationship stream olarak kurtarıldı: ${relationship.id}`);
      } else if (!existingParent) {
        parentByChild.set(relationship.targetId, relationship.sourceId);
      }
    }

    const semanticKey = getMapEdgeSemanticKey(relationship);
    if (!semanticKey || seenSemanticKeys.has(semanticKey)) {
      warnings.push(`Tekrarlanan semantic relationship atlandı: ${relationship.id}`);
      continue;
    }
    seenIds.add(relationship.id);
    seenSemanticKeys.add(semanticKey);
    relationships.push(relationship);
  }
  return { relationships, warnings };
}

export function prepareSemanticRelationshipUpsert(currentRelationships, raw, options = {}) {
  let incoming = normalizeSemanticRelationship(raw);
  if (!incoming) {
    return { ok: false, error: 'Semantic relationship normalize edilemedi.' };
  }

  const normalizedCurrent = normalizeRelationshipCollection(currentRelationships).relationships;
  const incomingKey = getMapEdgeSemanticKey(incoming);
  const sameSemantic = normalizedCurrent.find(
    (relationship) => getMapEdgeSemanticKey(relationship) === incomingKey
  );
  const sameId = normalizedCurrent.find(
    (relationship) => relationship.id === incoming.id
  );
  const existing = sameId || sameSemantic || null;

  if (sameSemantic && !sameId) incoming.id = sameSemantic.id;
  if (existing?.createdAt) incoming.createdAt = existing.createdAt;
  incoming.updatedAt = new Date().toISOString();

  const withoutCurrent = normalizedCurrent.filter((relationship) => (
    relationship.id !== incoming.id
    && getMapEdgeSemanticKey(relationship) !== incomingKey
  ));

  if (isHierarchyMapEdge(incoming)) {
    const existingParent = withoutCurrent.find((relationship) => (
      isHierarchyMapEdge(relationship)
      && relationship.targetId === incoming.targetId
      && relationship.sourceId !== incoming.sourceId
    ));

    if (existingParent) {
      if (options.confirmSecondParentAsStream !== true) {
        return {
          ok: false,
          code: 'SECOND_PARENT_CONFIRM_REQUIRED',
          requiresConfirmation: true,
          error: 'Hedef node zaten semantic bir parent ilişkisine sahip.',
          suggestedRelationship: convertMapEdgeToStream(incoming)
        };
      }
      incoming = normalizeSemanticRelationship(convertMapEdgeToStream(incoming), {
        createdAt: incoming.createdAt
      });
    } else {
      const parentByChild = new Map();
      withoutCurrent.filter(isHierarchyMapEdge).forEach((relationship) => {
        parentByChild.set(relationship.targetId, relationship.sourceId);
      });
      if (wouldCreateMapHierarchyCycle(
        parentByChild,
        incoming.sourceId,
        incoming.targetId
      )) {
        return {
          ok: false,
          code: 'HIERARCHY_CYCLE',
          error: 'Bu semantic ilişki hiyerarşide döngü oluşturur.'
        };
      }
    }
  }

  return {
    ok: true,
    relationship: incoming,
    relationships: [...withoutCurrent, incoming]
  };
}

export function prepareMapConnection(existingEdges = [], rawEdge = {}, options = {}) {
  const currentRelationships = (Array.isArray(existingEdges) ? existingEdges : [])
    .map((edge) => normalizeSemanticRelationship(edge))
    .filter(Boolean);
  const prepared = prepareSemanticRelationshipUpsert(
    currentRelationships,
    rawEdge,
    options
  );
  const viewFor = (relationship) => ({
    relationshipId: relationship.id,
    sourcePort: rawEdge.sourcePort,
    targetPort: rawEdge.targetPort,
    customization: rawEdge.customization
  });
  if (!prepared.ok) {
    return {
      ...prepared,
      suggestedEdge: prepared.suggestedRelationship
        ? projectSemanticRelationshipToMapEdge(
            prepared.suggestedRelationship,
            viewFor(prepared.suggestedRelationship)
          )
        : undefined
    };
  }
  const edge = projectSemanticRelationshipToMapEdge(
    prepared.relationship,
    viewFor(prepared.relationship)
  );
  const unchanged = currentRelationships.some((current) => (
    current.id === prepared.relationship.id
    && getMapEdgeSemanticKey(current) === getMapEdgeSemanticKey(prepared.relationship)
    && current.type === prepared.relationship.type
  ));
  return { ok: true, unchanged, edge, relationship: prepared.relationship };
}

export function normalizeRelationshipView(raw = {}) {
  const relationshipId = EDGE_ID.test(String(raw.relationshipId || ''))
    ? String(raw.relationshipId)
    : '';
  if (!relationshipId) return null;
  const view = {
    relationshipId,
    sourcePort: MAP_PORTS.has(raw.sourcePort) ? raw.sourcePort : 'bottom',
    targetPort: MAP_PORTS.has(raw.targetPort) ? raw.targetPort : 'top'
  };
  const customization = normalizeMapEdgeCustomization(raw.customization);
  if (Object.keys(customization).length) view.customization = customization;
  return view;
}

export function normalizeRelationshipViews(rawViews = []) {
  const views = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawViews) ? rawViews : []) {
    const view = normalizeRelationshipView(raw);
    if (!view || seen.has(view.relationshipId)) continue;
    seen.add(view.relationshipId);
    views.push(view);
  }
  return views;
}

export function mapEdgeToRelationship(edge) {
  return normalizeSemanticRelationship(edge);
}

export function mapEdgeToRelationshipView(edge) {
  const normalized = normalizeMapEdge(edge);
  if (!normalized) return null;
  return normalizeRelationshipView({
    relationshipId: normalized.id,
    sourcePort: normalized.sourcePort,
    targetPort: normalized.targetPort,
    customization: normalized.customization
  });
}

export function projectSemanticRelationshipToMapEdge(relationship, rawView = null) {
  if (!relationship?.id || !rawView) return null;
  const view = normalizeRelationshipView(rawView);
  if (!view || view.relationshipId !== relationship.id) return null;

  const projected = normalizeMapEdge({
    id: relationship.id,
    sourceId: relationship.sourceId,
    targetId: relationship.targetId,
    type: relationship.type,
    sourceRole: relationship.sourceRole,
    targetRole: relationship.targetRole,
    sourcePort: view.sourcePort,
    targetPort: view.targetPort,
    customization: view.customization
  });
  if (!projected) return null;

  if (relationship.label) projected.label = relationship.label;
  if (relationship.properties) projected.properties = structuredClone(relationship.properties);
  if (relationship.createdAt) projected.createdAt = relationship.createdAt;
  if (relationship.updatedAt) projected.updatedAt = relationship.updatedAt;
  projected.relationshipId = relationship.id;
  return projected;
}

export function projectRelationshipsToMapEdges(
  relationships = [],
  rawViews = [],
  validNodeIds = null
) {
  const views = new Map(
    normalizeRelationshipViews(rawViews)
      .map((view) => [view.relationshipId, view])
  );
  const projected = (Array.isArray(relationships) ? relationships : [])
    .map((relationship) => {
      const view = views.get(relationship.id);
      return view
        ? projectSemanticRelationshipToMapEdge(relationship, view)
        : null;
    })
    .filter(Boolean)
    .filter((edge) => (
      !(validNodeIds instanceof Set)
      || (validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId))
    ));

  // Desktop relationship store is authoritative. Normalization here only removes
  // invalid/duplicate projections and applies the same recovery rules.
  return normalizeMapEdges(projected, validNodeIds).edges.map((edge) => {
    const original = projected.find((candidate) => candidate.id === edge.id);
    return original ? { ...edge, ...{
      ...(original.label ? { label: original.label } : {}),
      ...(original.properties ? { properties: original.properties } : {}),
      ...(original.createdAt ? { createdAt: original.createdAt } : {}),
      ...(original.updatedAt ? { updatedAt: original.updatedAt } : {}),
      relationshipId: edge.id
    }} : edge;
  });
}
