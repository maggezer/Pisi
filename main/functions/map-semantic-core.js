import { modules, registerMainModule } from '../module-registry.js';

const filesystemCore = modules['main.filesystemCore'];
const pathSecurity = modules['main.pathSecurity'];

const PISI_MAP_RELATIONSHIP_VIEW_VERSION = 1;
const PISI_MAP_PORTS = new Set(['top', 'right', 'bottom', 'left']);

function normalizePisiRelationshipView(raw = {}) {
    const relationshipId = /^edge_[A-Za-z0-9_-]{1,101}$/.test(String(raw.relationshipId || '')) ? String(raw.relationshipId) : '';
    if (!relationshipId) return null;

    const view = {
        relationshipId,
        sourcePort: PISI_MAP_PORTS.has(raw.sourcePort) ? raw.sourcePort : 'bottom',
        targetPort: PISI_MAP_PORTS.has(raw.targetPort) ? raw.targetPort : 'top'
    };
    const customization = filesystemCore.normalizePisiMapEdgeCustomization(raw.customization);
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
    mapData.relationshipViews = [...current.filter((item) => item.relationshipId !== view.relationshipId), view];
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

function projectPisiSemanticRelationshipToMapEdge(relationship, rawView = null) {
    if (!relationship?.id || !rawView) return null;
    const view = normalizePisiRelationshipView(rawView);
    if (!view || view.relationshipId !== relationship.id) return null;

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
    const views = new Map(normalizePisiRelationshipViews(rawViews).map((view) => [view.relationshipId, view]));
    return (Array.isArray(relationships) ? relationships : [])
        .map((relationship) => {
            const view = views.get(relationship.id);
            return view ? projectPisiSemanticRelationshipToMapEdge(relationship, view) : null;
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
    const byId = derivePisiConnectionTypesFromRelationships(nodes.map((node) => node?.id).filter(Boolean), relationships);
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
    return !['sourceId', 'targetId', 'type', 'sourceRole', 'targetRole', 'direction', 'label', 'properties'].some((key) =>
        Object.prototype.hasOwnProperty.call(view, key)
    );
}

const moduleApi = {
    PISI_MAP_RELATIONSHIP_VIEW_VERSION,
    normalizePisiRelationshipView,
    normalizePisiRelationshipViews,
    makePisiRelationshipView,
    upsertPisiRelationshipView,
    removePisiRelationshipView,
    projectPisiSemanticRelationshipToMapEdge,
    projectPisiRelationshipsForMap,
    derivePisiConnectionTypesFromRelationships,
    applyPisiDerivedConnectionTypes,
    assertPisiMapViewHasNoSemanticFields
};

registerMainModule('main.mapSemanticCore', moduleApi);
