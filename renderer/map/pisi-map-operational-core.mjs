const PISI_OPERATIONAL_SCOPE_MODES = new Set([
    'all',
    'active',
    'blocked',
    'overdue',
    'missing-next-action',
    'owner-missing',
    'neighbors',
    'manual'
]);

const PISI_OPERATIONAL_RELATIONSHIP_TYPES = new Set([
    'down-hub',
    'stream',
    'co-level'
]);

function normalizePisiOperationalPath(value = '') {
    return String(value || '').replace(/[\\/]+/g, '/').toLowerCase();
}

function normalizePisiOperationalScope(raw = {}) {
    return {
        mode: PISI_OPERATIONAL_SCOPE_MODES.has(String(raw.mode || ''))
            ? String(raw.mode)
            : 'all',
        query: String(raw.query || '').trim().toLowerCase().slice(0, 240),
        relationshipTypes: Array.from(new Set(
            (Array.isArray(raw.relationshipTypes) ? raw.relationshipTypes : [])
                .map((value) => String(value || ''))
                .filter((value) => PISI_OPERATIONAL_RELATIONSHIP_TYPES.has(value))
        )),
        includedNodeIds: Array.from(new Set(
            (Array.isArray(raw.includedNodeIds) ? raw.includedNodeIds : [])
                .map((value) => String(value || ''))
                .filter((value) => /^node_[A-Za-z0-9_-]+$/.test(value))
        )),
        focusRootNodeId: /^node_[A-Za-z0-9_-]+$/.test(String(raw.focusRootNodeId || ''))
            ? String(raw.focusRootNodeId)
            : null,
        focusDepth: Math.min(3, Math.max(1, Number(raw.focusDepth) || 1))
    };
}

function normalizePisiOperationalDisplay(raw = {}) {
    return {
        showTaskDependencies: raw.showTaskDependencies !== false,
        showRelationshipLabels: raw.showRelationshipLabels !== false,
        showWorkBadges: raw.showWorkBadges !== false,
        dimFiltered: raw.dimFiltered === true
    };
}

function isPisiOperationalTaskDone(task) {
    return String(task?.status || '').toLowerCase() === 'done';
}

function getPisiOperationalTaskTime(task) {
    const value = task?.deadline || task?.dueDate || task?.scheduledAt || '';
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? time : null;
}

function isPisiOperationalTaskOverdue(task, now = Date.now()) {
    if (isPisiOperationalTaskDone(task)) return false;
    const time = getPisiOperationalTaskTime(task);
    return time !== null && time < now;
}

function isPisiOperationalTaskBlocked(task, taskById) {
    if (isPisiOperationalTaskDone(task)) return false;
    return (Array.isArray(task?.dependencies) ? task.dependencies : []).some((taskId) => {
        const dependency = taskById.get(String(taskId || ''));
        return dependency && !isPisiOperationalTaskDone(dependency);
    });
}

function getPisiOperationalPropertyEntries(node) {
    const properties = node?.properties && typeof node.properties === 'object'
        ? node.properties
        : {};
    return Object.entries(properties).map(([id, property]) => ({
        id: String(property?.id || id || '').toLowerCase(),
        name: String(property?.name || id || '').toLowerCase(),
        value: property?.value
    }));
}

function hasPisiOperationalOwner(node) {
    const ownerPattern = /(?:^|[-_\s])(owner|assignee|sorumlu|sahip)(?:$|[-_\s])/i;
    const entry = getPisiOperationalPropertyEntries(node).find((property) => {
        return ownerPattern.test(property.id) || ownerPattern.test(property.name);
    });
    if (!entry) return false;
    if (Array.isArray(entry.value)) return entry.value.some(Boolean);
    return Boolean(String(entry.value ?? '').trim());
}

function getPisiOperationalReviewedAt(node) {
    const reviewPattern = /(?:reviewed[-_\s]?at|last[-_\s]?review|son[-_\s]?inceleme)/i;
    const entry = getPisiOperationalPropertyEntries(node).find((property) => {
        return reviewPattern.test(property.id) || reviewPattern.test(property.name);
    });
    const value = entry?.value;
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? time : null;
}

function buildPisiOperationalNodeStates(nodes = [], tasks = [], now = Date.now()) {
    const taskById = new Map(
        (Array.isArray(tasks) ? tasks : []).map((task) => [String(task?.id || ''), task])
    );
    const tasksByNodePath = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        const nodePath = normalizePisiOperationalPath(task?.source?.nodePath);
        if (!nodePath) continue;
        if (!tasksByNodePath.has(nodePath)) tasksByNodePath.set(nodePath, []);
        tasksByNodePath.get(nodePath).push(task);
    }

    return new Map((Array.isArray(nodes) ? nodes : []).map((node) => {
        const nodeTasks = tasksByNodePath.get(
            normalizePisiOperationalPath(node?.fullPath)
        ) || [];
        const openTasks = nodeTasks.filter((task) => !isPisiOperationalTaskDone(task));
        const blockedTasks = openTasks.filter((task) => {
            return isPisiOperationalTaskBlocked(task, taskById);
        });
        const overdueTasks = openTasks.filter((task) => {
            return isPisiOperationalTaskOverdue(task, now);
        });
        const reviewedAt = getPisiOperationalReviewedAt(node);
        const updatedAt = Date.parse(String(node?.metadata?.updatedAt || ''));
        const changedSinceReview = reviewedAt !== null &&
            Number.isFinite(updatedAt) &&
            updatedAt > reviewedAt;
        const state = {
            nodeId: node?.id || '',
            tasks: nodeTasks,
            openTasks,
            blockedTasks,
            overdueTasks,
            completedTasks: nodeTasks.filter(isPisiOperationalTaskDone),
            blocked: blockedTasks.length > 0,
            overdue: overdueTasks.length > 0,
            missingNextAction: openTasks.length === 0,
            ownerMissing: !hasPisiOperationalOwner(node),
            changedSinceReview,
            highestPriority: openTasks.reduce((best, task) => {
                const priority = Number(task?.priority) || 3;
                return Math.min(best, priority);
            }, 5)
        };
        return [node?.id || '', state];
    }));
}

function collectPisiOperationalNeighborIds(rootNodeId, edges = [], depth = 1) {
    const root = String(rootNodeId || '');
    if (!root) return new Set();
    const adjacency = new Map();
    for (const edge of Array.isArray(edges) ? edges : []) {
        const source = String(edge?.sourceId || '');
        const target = String(edge?.targetId || '');
        if (!source || !target) continue;
        if (!adjacency.has(source)) adjacency.set(source, new Set());
        if (!adjacency.has(target)) adjacency.set(target, new Set());
        adjacency.get(source).add(target);
        adjacency.get(target).add(source);
    }

    const wantedDepth = Math.min(3, Math.max(1, Number(depth) || 1));
    const visible = new Set([root]);
    let frontier = new Set([root]);
    for (let level = 0; level < wantedDepth; level += 1) {
        const next = new Set();
        for (const nodeId of frontier) {
            for (const neighbor of adjacency.get(nodeId) || []) {
                if (visible.has(neighbor)) continue;
                visible.add(neighbor);
                next.add(neighbor);
            }
        }
        frontier = next;
        if (!frontier.size) break;
    }
    return visible;
}

function nodeMatchesPisiOperationalQuery(node, query) {
    const clean = String(query || '').trim().toLowerCase();
    if (!clean) return true;
    const haystack = [
        node?.metadata?.title,
        node?.fileName,
        node?.preview,
        ...getPisiOperationalPropertyEntries(node).flatMap((property) => [
            property.name,
            Array.isArray(property.value) ? property.value.join(' ') : property.value
        ])
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    return clean.split(/\s+/).every((term) => haystack.includes(term));
}

function getPisiOperationalVisibleNodeIds(nodes, edges, nodeStates, rawScope = {}) {
    const scope = normalizePisiOperationalScope(rawScope);
    const manualIds = new Set(scope.includedNodeIds);
    const neighborIds = scope.focusRootNodeId
        ? collectPisiOperationalNeighborIds(
            scope.focusRootNodeId,
            edges,
            scope.focusDepth
        )
        : null;
    const visible = new Set();

    for (const node of Array.isArray(nodes) ? nodes : []) {
        const state = nodeStates.get(node?.id) || {};
        let accepted = true;
        if (scope.mode === 'active') accepted = (state.openTasks?.length || 0) > 0;
        if (scope.mode === 'blocked') accepted = state.blocked === true;
        if (scope.mode === 'overdue') accepted = state.overdue === true;
        if (scope.mode === 'missing-next-action') accepted = state.missingNextAction === true;
        if (scope.mode === 'owner-missing') accepted = state.ownerMissing === true;
        if (scope.mode === 'manual') accepted = manualIds.has(node?.id);
        if (scope.mode === 'neighbors') accepted = Boolean(neighborIds?.has(node?.id));
        if (accepted && scope.focusRootNodeId && scope.mode !== 'neighbors') {
            accepted = Boolean(neighborIds?.has(node?.id));
        }
        if (accepted && !nodeMatchesPisiOperationalQuery(node, scope.query)) {
            accepted = false;
        }
        if (accepted) visible.add(node?.id);
    }
    return visible;
}

function getPisiOperationalVisibleEdges(edges = [], visibleNodeIds, rawScope = {}) {
    const scope = normalizePisiOperationalScope(rawScope);
    const relationshipTypes = new Set(scope.relationshipTypes);
    return (Array.isArray(edges) ? edges : []).filter((edge) => {
        if (!visibleNodeIds.has(edge?.sourceId) || !visibleNodeIds.has(edge?.targetId)) {
            return false;
        }
        return !relationshipTypes.size || relationshipTypes.has(String(edge?.type || ''));
    });
}

function buildPisiTaskDependencyProjections(nodes = [], tasks = [], visibleNodeIds = null) {
    const nodeIdByPath = new Map(
        (Array.isArray(nodes) ? nodes : []).map((node) => [
            normalizePisiOperationalPath(node?.fullPath),
            node?.id
        ])
    );
    const taskById = new Map(
        (Array.isArray(tasks) ? tasks : []).map((task) => [String(task?.id || ''), task])
    );
    const seen = new Set();
    const result = [];

    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (isPisiOperationalTaskDone(task)) continue;
        const targetNodeId = nodeIdByPath.get(
            normalizePisiOperationalPath(task?.source?.nodePath)
        );
        if (!targetNodeId) continue;
        for (const dependencyId of Array.isArray(task?.dependencies) ? task.dependencies : []) {
            const dependency = taskById.get(String(dependencyId || ''));
            if (!dependency || isPisiOperationalTaskDone(dependency)) continue;
            const sourceNodeId = nodeIdByPath.get(
                normalizePisiOperationalPath(dependency?.source?.nodePath)
            );
            if (!sourceNodeId || sourceNodeId === targetNodeId) continue;
            if (visibleNodeIds && (
                !visibleNodeIds.has(sourceNodeId) || !visibleNodeIds.has(targetNodeId)
            )) continue;
            const key = `${sourceNodeId}->${targetNodeId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({
                id: `task-dependency:${key}`,
                sourceId: sourceNodeId,
                targetId: targetNodeId,
                blockedTaskId: task.id,
                dependencyTaskId: dependency.id
            });
        }
    }
    return result;
}

function rankPisiOperationalNextNodes(nodes = [], nodeStates = {}) {
    const stateMap = nodeStates instanceof Map ? nodeStates : new Map();
    return (Array.isArray(nodes) ? nodes : [])
        .map((node) => {
            const state = stateMap.get(node?.id) || {};
            if (state.blocked || !(state.openTasks?.length > 0)) return null;
            const score =
                (state.overdueTasks?.length || 0) * 100 +
                (6 - (state.highestPriority || 5)) * 15 +
                (state.openTasks?.length || 0) * 2 +
                (state.ownerMissing ? -10 : 0);
            return { node, state, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score ||
            String(a.node?.metadata?.title || '').localeCompare(
                String(b.node?.metadata?.title || '')
            ));
}

function getPisiOperationalRelationshipLabel(edge = {}) {
    if (String(edge.label || '').trim()) return String(edge.label).trim();
    if (edge.type === 'stream') return 'Flow';
    if (edge.type === 'co-level') return 'Peer';
    return 'Hierarchy';
}

export {
    buildPisiOperationalNodeStates,
    buildPisiTaskDependencyProjections,
    collectPisiOperationalNeighborIds,
    getPisiOperationalRelationshipLabel,
    getPisiOperationalVisibleEdges,
    getPisiOperationalVisibleNodeIds,
    hasPisiOperationalOwner,
    isPisiOperationalTaskBlocked,
    isPisiOperationalTaskOverdue,
    normalizePisiOperationalDisplay,
    normalizePisiOperationalPath,
    normalizePisiOperationalScope,
    rankPisiOperationalNextNodes
};
