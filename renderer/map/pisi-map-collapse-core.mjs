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

function isPisiMapEdgeHiddenByCollapsedHub(edge, hiddenNodeIds = [], collapsedHubPortKeys = []) {
    const hiddenIds = hiddenNodeIds instanceof Set ? hiddenNodeIds : new Set(Array.isArray(hiddenNodeIds) ? hiddenNodeIds : []);

    if (hiddenIds.has(String(edge?.sourceId || '')) || hiddenIds.has(String(edge?.targetId || ''))) {
        return true;
    }

    if (!isPisiHierarchyEdge(edge)) return false;

    return normalizePisiCollapsedHubKeys(collapsedHubPortKeys).has(makePisiCollapsedHubPortKey(edge.sourceId, edge.sourcePort || 'right'));
}

export { collectPisiCollapsedHubCounts, collectPisiCollapsedHubNodeIds, isPisiHierarchyEdge, isPisiMapEdgeHiddenByCollapsedHub, makePisiCollapsedHubPortKey };
