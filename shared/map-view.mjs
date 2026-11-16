// How a map is drawn (pisi-definition.md § ".map belgesi"): which notes and
// connections a collapsed hub hides, and the geometry of a connection between
// two note boxes. The desktop map (renderer/map/pisi-map-collapse-core.mjs,
// pisi-map-interaction-helpers.mjs, pisi-map-connection-interactions.mjs) and
// the mobile map viewer use the same rules, so a map looks the same on both.
//
// Rects are world coordinates `{ x, y, width, height }` (the layout a .map
// stores for each note); ports are 'top' | 'right' | 'bottom' | 'left'.

// ----- collapsed hubs -----

/** A collapsed hub is stored in `map.collapsedHubs` as `<nodeId>::<port>`. */
function makePisiCollapsedHubPortKey(nodeId, port) {
    return `${nodeId || ''}::${port || 'right'}`;
}

function isPisiHierarchyEdge(edge) {
    return edge?.type === 'down-hub' && edge?.sourceRole === 'down-hub' && edge?.targetRole === 'up-hub';
}

function normalizePisiCollapsedHubKeys(collapsedHubPortKeys) {
    if (collapsedHubPortKeys instanceof Set) {
        return collapsedHubPortKeys;
    }

    return new Set(Array.isArray(collapsedHubPortKeys) ? collapsedHubPortKeys : []);
}

/** Every note under a collapsed hub port: the hierarchy children leaving that port and all their descendants. */
function collectPisiCollapsedHubNodeIds(edges = [], collapsedHubPortKeys = []) {
    const collapsedKeys = normalizePisiCollapsedHubKeys(collapsedHubPortKeys);
    const hierarchyChildren = new Map();
    const collapsedBranches = new Map();

    for (const edge of Array.isArray(edges) ? edges : []) {
        if (!isPisiHierarchyEdge(edge)) continue;

        const sourceId = String(edge.sourceId || '');
        const targetId = String(edge.targetId || '');
        if (!sourceId || !targetId) continue;

        if (!hierarchyChildren.has(sourceId)) {
            hierarchyChildren.set(sourceId, []);
        }
        hierarchyChildren.get(sourceId).push(targetId);

        if (collapsedKeys.has(makePisiCollapsedHubPortKey(sourceId, edge.sourcePort || 'right'))) {
            if (!collapsedBranches.has(sourceId)) {
                collapsedBranches.set(sourceId, []);
            }
            collapsedBranches.get(sourceId).push(targetId);
        }
    }

    const hiddenNodeIds = new Set();

    for (const [collapsedSourceId, branchRoots] of collapsedBranches) {
        const pendingNodeIds = [...branchRoots];
        const visitedNodeIds = new Set([collapsedSourceId]);

        while (pendingNodeIds.length) {
            const nodeId = pendingNodeIds.pop();
            if (!nodeId || visitedNodeIds.has(nodeId)) continue;

            visitedNodeIds.add(nodeId);
            hiddenNodeIds.add(nodeId);

            for (const childId of hierarchyChildren.get(nodeId) || []) {
                if (!visitedNodeIds.has(childId)) {
                    pendingNodeIds.push(childId);
                }
            }
        }
    }

    return hiddenNodeIds;
}

/** How many notes each collapsed hub port hides, by its `<nodeId>::<port>` key. */
function collectPisiCollapsedHubCounts(edges = [], collapsedHubPortKeys = []) {
    const keys = normalizePisiCollapsedHubKeys(collapsedHubPortKeys);
    const counts = new Map();
    for (const key of keys) {
        const [nodeId, port = 'right'] = String(key).split('::');
        if (!nodeId) continue;
        const hidden = collectPisiCollapsedHubNodeIds(edges, [makePisiCollapsedHubPortKey(nodeId, port)]);
        counts.set(makePisiCollapsedHubPortKey(nodeId, port), hidden.size);
    }
    return counts;
}

/**
 * @param {any} edge
 * @param {Set<string> | string[]} [hiddenNodeIds]
 * @param {Set<string> | string[]} [collapsedHubPortKeys]
 */
function isPisiMapEdgeHiddenByCollapsedHub(edge, hiddenNodeIds = [], collapsedHubPortKeys = []) {
    const hiddenIds = hiddenNodeIds instanceof Set ? hiddenNodeIds : new Set(Array.isArray(hiddenNodeIds) ? hiddenNodeIds : []);

    if (hiddenIds.has(String(edge?.sourceId || '')) || hiddenIds.has(String(edge?.targetId || ''))) {
        return true;
    }

    if (!isPisiHierarchyEdge(edge)) return false;

    return normalizePisiCollapsedHubKeys(collapsedHubPortKeys).has(makePisiCollapsedHubPortKey(edge.sourceId, edge.sourcePort || 'right'));
}

// ----- connection geometry -----

/** The desktop's connection metrics at zoom 1, in world units (renderer/map/pisi-map-zoom-core.mjs). */
const PISI_MAP_CONNECTION_GEOMETRY = Object.freeze({
    plainLineGap: 6,
    arrowGap: 24,
    connectionControlMin: 60,
    connectionControlMax: 190
});

function getPortDirection(port) {
    if (port === 'top') return { x: 0, y: -1 };
    if (port === 'right') return { x: 1, y: 0 };
    if (port === 'bottom') return { x: 0, y: 1 };
    if (port === 'left') return { x: -1, y: 0 };

    return { x: 1, y: 0 };
}

function offsetPoint(point, direction, distance) {
    return {
        x: point.x + direction.x * distance,
        y: point.y + direction.y * distance
    };
}

function getDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    return Math.sqrt(dx * dx + dy * dy);
}

/** The middle of a rect's side. */
function getPisiMapRectPortPoint(rect, port) {
    const { x, y, width: w, height: h } = rect || { x: 0, y: 0, width: 0, height: 0 };

    if (port === 'top') return { x: x + w / 2, y };
    if (port === 'right') return { x: x + w, y: y + h / 2 };
    if (port === 'bottom') return { x: x + w / 2, y: y + h };
    return { x, y: y + h / 2 };
}

/**
 * SVG path of a connection: a cubic curve leaving each box straight out of
 * its port. Every connection has an end arrow and co-level ones a start arrow
 * too; an end with an arrow stops at the arrow's base, a plain end close to
 * the box. `metrics` (plainLineGap, arrowGap, connectionControlMin,
 * connectionControlMax) defaults to the zoom-1 geometry.
 *
 * @param {{ x: number, y: number, width: number, height: number }} sourceRect
 * @param {string} sourcePort
 * @param {{ x: number, y: number, width: number, height: number }} targetRect
 * @param {string} targetPort
 * @param {string} [edgeType]
 * @param {Record<string, number>} [metrics]
 */
function makePisiMapConnectionPath(sourceRect, sourcePort, targetRect, targetPort, edgeType = 'down-hub', metrics = PISI_MAP_CONNECTION_GEOMETRY) {
    const hasStartArrow = edgeType === 'co-level';
    const hasEndArrow = true;

    const sourceOffset = hasStartArrow ? metrics.arrowGap : metrics.plainLineGap;
    const targetOffset = hasEndArrow ? metrics.arrowGap : metrics.plainLineGap;

    const sourceDir = getPortDirection(sourcePort);
    const targetDir = getPortDirection(targetPort);

    const start = offsetPoint(getPisiMapRectPortPoint(sourceRect, sourcePort), sourceDir, sourceOffset);
    const end = offsetPoint(getPisiMapRectPortPoint(targetRect, targetPort), targetDir, targetOffset);

    const distance = getDistance(start, end);
    const control = Math.max(metrics.connectionControlMin, Math.min(metrics.connectionControlMax, distance * 0.38));

    const c1 = {
        x: start.x + sourceDir.x * control,
        y: start.y + sourceDir.y * control
    };

    const c2 = {
        x: end.x + targetDir.x * control,
        y: end.y + targetDir.y * control
    };

    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

export {
    PISI_MAP_CONNECTION_GEOMETRY,
    collectPisiCollapsedHubCounts,
    collectPisiCollapsedHubNodeIds,
    getDistance,
    getPisiMapRectPortPoint,
    getPortDirection,
    isPisiHierarchyEdge,
    isPisiMapEdgeHiddenByCollapsedHub,
    makePisiCollapsedHubPortKey,
    makePisiMapConnectionPath,
    offsetPoint
};
