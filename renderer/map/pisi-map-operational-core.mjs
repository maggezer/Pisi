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

const PISI_OPERATIONAL_SCOPE_STRATEGIES = new Set([
    'live',
    'snapshot'
]);

const PISI_OPERATIONAL_RELATIONSHIP_TYPES = new Set([
    'down-hub',
    'stream',
    'co-level'
]);

const PISI_OPERATIONAL_PROPERTY_OPERATORS = new Set([
    'exists',
    'not-empty',
    'equals',
    'not-equals',
    'contains',
    'one-of',
    'gt',
    'gte',
    'lt',
    'lte'
]);

function normalizePisiOperationalPath(value = '') {
    const normalized = String(value || '').replace(/[\\/]+/g, '/');
    return globalThis.window?.pisiEnvironment?.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
}

function normalizePisiOperationalPropertyFilter(raw = {}) {
    const property = String(
        raw.property || raw.propertyId || raw.name || ''
    ).trim().toLowerCase().slice(0, 120);
    if (!property) return null;
    const operator = PISI_OPERATIONAL_PROPERTY_OPERATORS.has(String(raw.operator || ''))
        ? String(raw.operator)
        : 'contains';
    return {
        property,
        operator,
        value: ['exists', 'not-empty'].includes(operator)
            ? ''
            : String(raw.value ?? '').trim().slice(0, 2400)
    };
}

function normalizePisiOperationalScope(raw = {}) {
    return {
        strategy: PISI_OPERATIONAL_SCOPE_STRATEGIES.has(String(raw.strategy || ''))
            ? String(raw.strategy)
            : 'live',
        mode: PISI_OPERATIONAL_SCOPE_MODES.has(String(raw.mode || ''))
            ? String(raw.mode)
            : 'all',
        query: String(raw.query || '').trim().toLowerCase().slice(0, 240),
        relationshipTypes: Array.from(new Set(
            (Array.isArray(raw.relationshipTypes) ? raw.relationshipTypes : [])
                .map((value) => String(value || ''))
                .filter((value) => PISI_OPERATIONAL_RELATIONSHIP_TYPES.has(value))
        )),
        propertyFilters: (Array.isArray(raw.propertyFilters) ? raw.propertyFilters : [])
            .map(normalizePisiOperationalPropertyFilter)
            .filter(Boolean)
            .slice(0, 20),
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

function getPisiOperationalPropertyEntry(node, propertyKey) {
    const key = String(propertyKey || '').trim().toLowerCase();
    if (!key) return null;
    return getPisiOperationalPropertyEntries(node).find((property) => {
        return property.id === key || property.name === key;
    }) || null;
}

function normalizePisiOperationalComparableValues(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean);
    }
    if (value === null || value === undefined) return [];
    return [String(value).trim().toLowerCase()];
}

function isPisiOperationalPropertyValueEmpty(value) {
    if (Array.isArray(value)) return value.length === 0 || !value.some(Boolean);
    return value === null || value === undefined || String(value).trim() === '';
}

function nodeMatchesPisiOperationalPropertyFilter(node, rawFilter = {}) {
    const filter = normalizePisiOperationalPropertyFilter(rawFilter);
    if (!filter) return true;
    const entry = getPisiOperationalPropertyEntry(node, filter.property);
    if (filter.operator === 'exists') return Boolean(entry);
    if (filter.operator === 'not-empty') {
        return Boolean(entry) && !isPisiOperationalPropertyValueEmpty(entry.value);
    }
    if (!entry) return filter.operator === 'not-equals';

    const values = normalizePisiOperationalComparableValues(entry.value);
    const expected = String(filter.value || '').trim().toLowerCase();
    if (filter.operator === 'equals') return values.some((value) => value === expected);
    if (filter.operator === 'not-equals') return values.every((value) => value !== expected);
    if (filter.operator === 'contains') return values.some((value) => value.includes(expected));
    if (filter.operator === 'one-of') {
        const wanted = new Set(expected.split(',').map((value) => value.trim()).filter(Boolean));
        return values.some((value) => wanted.has(value));
    }

    const left = Number(Array.isArray(entry.value) ? entry.value[0] : entry.value);
    const right = Number(filter.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (filter.operator === 'gt') return left > right;
    if (filter.operator === 'gte') return left >= right;
    if (filter.operator === 'lt') return left < right;
    if (filter.operator === 'lte') return left <= right;
    return true;
}

function nodeMatchesPisiOperationalPropertyFilters(node, filters = []) {
    return (Array.isArray(filters) ? filters : []).every((filter) => {
        return nodeMatchesPisiOperationalPropertyFilter(node, filter);
    });
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
                const priority = Math.min(5, Math.max(1, Number(task?.priority) || 3));
                return Math.max(best, priority);
            }, 1)
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
    if (scope.strategy === 'snapshot') {
        return new Set((Array.isArray(nodes) ? nodes : [])
            .map((node) => node?.id)
            .filter((nodeId) => manualIds.has(nodeId)));
    }

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
        if (accepted && !nodeMatchesPisiOperationalPropertyFilters(
            node,
            scope.propertyFilters
        )) {
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
                (state.highestPriority || 1) * 15 +
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
    getPisiOperationalPropertyEntry,
    getPisiOperationalRelationshipLabel,
    getPisiOperationalVisibleEdges,
    getPisiOperationalVisibleNodeIds,
    hasPisiOperationalOwner,
    isPisiOperationalTaskBlocked,
    isPisiOperationalTaskOverdue,
    nodeMatchesPisiOperationalPropertyFilter,
    nodeMatchesPisiOperationalPropertyFilters,
    normalizePisiOperationalDisplay,
    normalizePisiOperationalPath,
    normalizePisiOperationalPropertyFilter,
    normalizePisiOperationalScope,
    rankPisiOperationalNextNodes
};
