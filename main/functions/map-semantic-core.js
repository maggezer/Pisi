'use strict';

const { modules, registerMainModule } = require('../module-registry');

const filesystemCore = modules['main.filesystemCore'];
const pathSecurity = modules['main.pathSecurity'];

const PISI_MAP_RELATIONSHIP_VIEW_VERSION = 1;
const PISI_MAP_PORTS = new Set(['top', 'right', 'bottom', 'left']);

function normalizePisiRelationshipView(raw = {}) {
    const relationshipId = /^edge_[A-Za-z0-9_-]{1,101}$/.test(
        String(raw.relationshipId || raw.id || '')
    )
        ? String(raw.relationshipId || raw.id)
        : '';
    if (!relationshipId) return null;

    const view = {
        relationshipId,
        sourcePort: PISI_MAP_PORTS.has(raw.sourcePort) ? raw.sourcePort : 'bottom',
        targetPort: PISI_MAP_PORTS.has(raw.targetPort) ? raw.targetPort : 'top'
    };
    const customization = filesystemCore.normalizePisiMapEdgeCustomization(
        raw.customization
    );
    if (Object.keys(customization).length) {
        view.customization = customization;
    }
    return view;
}

function normalizePisiRelationshipViews(rawViews = []) {
    const views = [];
    const seen = new Set();
    for (const raw of Array.isArray(rawViews) ? rawViews : []) {
        const view = normalizePisiRelationshipView(raw);
        if (!view || seen.has(view.relationshipId)) continue;
        seen.add(view.relationshipId);
        views.push(view);
    }
    return views;
}

function makePisiRelationshipView(relationship, presentation = {}) {
    return normalizePisiRelationshipView({
        relationshipId: relationship?.id,
        sourcePort: presentation.sourcePort,
        targetPort: presentation.targetPort,
        customization: presentation.customization
    });
}

function upsertPisiRelationshipView(mapData, relationship, presentation = {}) {
    if (!mapData || typeof mapData !== 'object') return null;
    const view = makePisiRelationshipView(relationship, presentation);
    if (!view) return null;
    const current = normalizePisiRelationshipViews(mapData.relationshipViews);
    mapData.relationshipViews = [
        ...current.filter((item) => item.relationshipId !== view.relationshipId),
        view
    ];
    mapData.relationshipViewVersion = PISI_MAP_RELATIONSHIP_VIEW_VERSION;
    return view;
}

function removePisiRelationshipView(mapData, relationshipId) {
    if (!mapData || typeof mapData !== 'object') return false;
    const id = String(relationshipId || '');
    const current = normalizePisiRelationshipViews(mapData.relationshipViews);
    const next = current.filter((view) => view.relationshipId !== id);
    mapData.relationshipViews = next;
    mapData.relationshipViewVersion = PISI_MAP_RELATIONSHIP_VIEW_VERSION;
    return next.length !== current.length;
}

function migratePisiLegacyMapEdgesData(mapData, resolveSemanticRelationship) {
    if (!mapData || typeof mapData !== 'object') {
        return { changed: false, migrated: 0, relationships: [], warnings: [] };
    }

    const legacyEdges = Array.isArray(mapData.edges) ? mapData.edges : [];
    const relationships = [];
    const warnings = [];
    let migrated = 0;

    for (const rawEdge of legacyEdges) {
        const edge = filesystemCore.normalizeMapEdge(rawEdge);
        if (!edge) {
            warnings.push('Geçersiz legacy map edge atlandı.');
            continue;
        }
        const resolved = resolveSemanticRelationship(edge, rawEdge);
        const relationship = resolved?.relationship || resolved;
        if (!relationship?.id) {
            warnings.push(`Legacy edge semantic store'a taşınamadı: ${edge.id}`);
            continue;
        }
        upsertPisiRelationshipView(mapData, relationship, edge);
        relationships.push(relationship);
        migrated += 1;
    }

    const hadLegacyField = Object.prototype.hasOwnProperty.call(mapData, 'edges');
    if (hadLegacyField) {
        delete mapData.edges;
    }
    mapData.relationshipViews = normalizePisiRelationshipViews(
        mapData.relationshipViews
    );
    mapData.relationshipViewVersion = PISI_MAP_RELATIONSHIP_VIEW_VERSION;

    return {
        changed: hadLegacyField || migrated > 0,
        migrated,
        relationships,
        warnings
    };
}

function projectPisiSemanticRelationshipToMapEdge(relationship, rawView = null) {
    if (!relationship?.id) return null;
    const view = normalizePisiRelationshipView(
        rawView || { relationshipId: relationship.id }
    ) || normalizePisiRelationshipView({ relationshipId: relationship.id });
    if (!view) return null;

    const projected = filesystemCore.normalizeMapEdge({
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
    if (relationship.properties) projected.properties = relationship.properties;
    projected.relationshipId = relationship.id;
    return projected;
}

function projectPisiRelationshipsForMap(relationships = [], rawViews = []) {
    const views = new Map(
        normalizePisiRelationshipViews(rawViews)
            .map((view) => [view.relationshipId, view])
    );
    return (Array.isArray(relationships) ? relationships : [])
        .map((relationship) => {
            return projectPisiSemanticRelationshipToMapEdge(
                relationship,
                views.get(relationship.id) || null
            );
        })
        .filter(Boolean);
}

function derivePisiConnectionTypesFromRelationships(nodeIds = [], relationships = []) {
    const result = new Map();
    for (const rawId of nodeIds) {
        const nodeId = pathSecurity.normalizePisiId(rawId, '.node');
        if (!nodeId) continue;
        result.set(nodeId, pathSecurity.getDefaultNodeConnectionTypes());
    }

    for (const relationship of Array.isArray(relationships) ? relationships : []) {
        const source = result.get(relationship.sourceId);
        const target = result.get(relationship.targetId);
        if (!source || !target) continue;

        const sourceRole = relationship.sourceRole;
        const targetRole = relationship.targetRole;
        if (Array.isArray(source[sourceRole]) && !source[sourceRole].includes(relationship.targetId)) {
            source[sourceRole].push(relationship.targetId);
        }
        if (Array.isArray(target[targetRole]) && !target[targetRole].includes(relationship.sourceId)) {
            target[targetRole].push(relationship.sourceId);
        }
    }
    return result;
}

function applyPisiDerivedConnectionTypes(nodes = [], relationships = []) {
    const byId = derivePisiConnectionTypesFromRelationships(
        nodes.map((node) => node?.id).filter(Boolean),
        relationships
    );
    for (const node of nodes) {
        if (!node?.id || !byId.has(node.id)) continue;
        if (!node.metadata || typeof node.metadata !== 'object') {
            node.metadata = {};
        }
        node.metadata.connectionTypes = byId.get(node.id);
    }
    return nodes;
}

function assertPisiMapViewHasNoSemanticFields(view = {}) {
    return ![
        'sourceId',
        'targetId',
        'type',
        'sourceRole',
        'targetRole',
        'direction',
        'label',
        'properties'
    ].some((key) => Object.prototype.hasOwnProperty.call(view, key));
}

const moduleApi = {
    PISI_MAP_RELATIONSHIP_VIEW_VERSION,
    normalizePisiRelationshipView,
    normalizePisiRelationshipViews,
    makePisiRelationshipView,
    upsertPisiRelationshipView,
    removePisiRelationshipView,
    migratePisiLegacyMapEdgesData,
    projectPisiSemanticRelationshipToMapEdge,
    projectPisiRelationshipsForMap,
    derivePisiConnectionTypesFromRelationships,
    applyPisiDerivedConnectionTypes,
    assertPisiMapViewHasNoSemanticFields
};

registerMainModule('main.mapSemanticCore', moduleApi);
