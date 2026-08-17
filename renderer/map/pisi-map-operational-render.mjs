import { registerModule } from '../core/module-registry.mjs';
import {
    buildPisiOperationalNodeStates,
    buildPisiTaskDependencyProjections,
    getPisiOperationalRelationshipLabel,
    getPisiOperationalVisibleEdges,
    getPisiOperationalVisibleNodeIds,
    rankPisiOperationalNextNodes
} from './pisi-map-operational-core.mjs';

const PISI_RELATIONSHIP_LABELS_STORAGE_KEY = 'pisi.map.relationshipLabels.v1';

function getPisiRelationshipLabelsPreference() {
    try {
        const value = String(localStorage.getItem(PISI_RELATIONSHIP_LABELS_STORAGE_KEY) || '').toLowerCase();
        return value === '1' || value === 'true' || value === 'on';
    } catch {
        return false;
    }
}

function setPisiRelationshipLabelsPreference(enabled) {
    const normalized = enabled === true;
    try {
        localStorage.setItem(PISI_RELATIONSHIP_LABELS_STORAGE_KEY, normalized ? '1' : '0');
    } catch (error) {
        console.warn('[PISI] Relationship labels preference could not be saved:', error);
    }
    return normalized;
}

function getPisiOperationalTasks() {
    const state = window.Pisi?.modules?.['tags.taskStore']?.pisiFirstClassTaskState;
    return Array.isArray(state?.tasks) ? state.tasks : [];
}

function clearPisiOperationalBadges(box) {
    box.querySelector('.pisi-map-work-badges')?.remove();
    box.classList.remove(
        'pisi-map-work-blocked',
        'pisi-map-work-overdue',
        'pisi-map-work-next',
        'pisi-operational-filter-hidden',
        'pisi-operational-dimmed'
    );
}

function makePisiOperationalBadge(text, className = '') {
    const badge = document.createElement('span');
    badge.className = `pisi-map-work-badge ${className}`.trim();
    badge.textContent = text;
    return badge;
}

function syncPisiOperationalNodeDecorations(
    nodeStates,
    visibleNodeIds,
    display,
    nextNodeId = null
) {
    for (const box of document.querySelectorAll('.map-node-box[data-node-id]')) {
        clearPisiOperationalBadges(box);
        const nodeId = String(box.dataset.nodeId || '');
        const state = nodeStates.get(nodeId) || {};
        const visible = visibleNodeIds.has(nodeId);
        if (!visible) {
            box.classList.toggle('pisi-operational-dimmed', display.dimFiltered === true);
            box.classList.toggle('pisi-operational-filter-hidden', display.dimFiltered !== true);
        }
        box.classList.toggle('pisi-map-work-blocked', state.blocked === true);
        box.classList.toggle(
            'pisi-map-work-overdue',
            state.overdue === true && state.blocked !== true
        );
        box.classList.toggle('pisi-map-work-next', nodeId === nextNodeId);

        const title = box.querySelector('.map-node-title')?.textContent?.trim() || 'Node';
        const openCount = state.openTasks?.length || 0;
        const blockedCount = state.blockedTasks?.length || 0;
        const overdueCount = state.overdueTasks?.length || 0;
        box.setAttribute(
            'aria-label',
            `${title}; ${openCount} open; ${blockedCount} blocked; ${overdueCount} overdue`
        );

        if (!display.showWorkBadges) continue;
        const badges = document.createElement('div');
        badges.className = 'pisi-map-work-badges';
        if (openCount > 0) {
            badges.appendChild(makePisiOperationalBadge(`${openCount} open`, 'ready'));
        }
        if (blockedCount > 0) {
            badges.appendChild(makePisiOperationalBadge(`${blockedCount} blocked`, 'blocked'));
        }
        if (overdueCount > 0) {
            badges.appendChild(makePisiOperationalBadge(`${overdueCount} overdue`, 'overdue'));
        }
        if (state.missingNextAction) {
            badges.appendChild(makePisiOperationalBadge('next?', 'gap'));
        }
        if (state.ownerMissing && openCount > 0) {
            badges.appendChild(makePisiOperationalBadge('owner?', 'gap'));
        }
        if (state.changedSinceReview) {
            badges.appendChild(makePisiOperationalBadge('changed', 'gap'));
        }
        if (badges.childElementCount) box.appendChild(badges);
    }
}

function syncPisiOperationalSemanticEdgeVisibility(visibleEdges) {
    const visibleIds = new Set(visibleEdges.map((edge) => edge?.id).filter(Boolean));
    document.querySelectorAll('.map-edge-group[data-edge-id]').forEach((group) => {
        group.classList.toggle(
            'pisi-operational-filter-hidden',
            !visibleIds.has(group.dataset.edgeId)
        );
    });
}

function removePisiOperationalRelationshipLabels() {
    document.querySelectorAll('.pisi-map-edge-operational-label').forEach((label) => {
        label.remove();
    });
}

function syncPisiOperationalRelationshipLabels(visibleEdges) {
    removePisiOperationalRelationshipLabels();
    if (!getPisiRelationshipLabelsPreference()) return;
    const svg = document.getElementById('map-connections');
    if (!svg) return;

    for (const edge of visibleEdges) {
        const group = svg.querySelector(
            `.map-edge-group[data-edge-id="${CSS.escape(edge.id)}"]`
        );
        const pathEl = group?.querySelector('.map-edge');
        if (!group || !pathEl || group.classList.contains('pisi-operational-filter-hidden')) {
            continue;
        }
        try {
            const length = pathEl.getTotalLength();
            const point = pathEl.getPointAtLength(length / 2);
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('pisi-map-edge-operational-label');
            label.setAttribute('x', String(point.x));
            label.setAttribute('y', String(point.y - 8));
            label.textContent = getPisiOperationalRelationshipLabel(edge);
            group.appendChild(label);
        } catch {
            // Geometry can be unavailable while the map is switching tabs.
        }
    }
}

function removePisiOperationalTaskDependencyLayer() {
    document.getElementById('pisi-map-task-dependencies')?.remove();
}

function makePisiOperationalDependencyPath(sourceBox, targetBox) {
    const interactions = window.Pisi?.modules?.['map.interactions'];
    if (typeof interactions?.makeConnectionPathFromBoxes === 'function') {
        return interactions.makeConnectionPathFromBoxes(
            sourceBox,
            'right',
            targetBox,
            'left',
            'stream'
        );
    }
    return '';
}

function syncPisiOperationalTaskDependencies(projections, display) {
    removePisiOperationalTaskDependencyLayer();
    if (!display.showTaskDependencies || !projections.length) return;
    const svg = document.getElementById('map-connections');
    if (!svg) return;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.id = 'pisi-map-task-dependencies';
    group.setAttribute('data-pisi-derived', 'task-dependencies');

    for (const projection of projections) {
        const sourceBox = document.querySelector(
            `.map-node-box[data-node-id="${CSS.escape(projection.sourceId)}"]`
        );
        const targetBox = document.querySelector(
            `.map-node-box[data-node-id="${CSS.escape(projection.targetId)}"]`
        );
        if (!sourceBox || !targetBox) continue;
        const pathData = makePisiOperationalDependencyPath(sourceBox, targetBox);
        if (!pathData) continue;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('pisi-map-task-dependency');
        path.dataset.blockedTaskId = projection.blockedTaskId;
        path.dataset.dependencyTaskId = projection.dependencyTaskId;
        path.setAttribute('d', pathData);
        group.appendChild(path);

        try {
            const length = path.getTotalLength();
            const point = path.getPointAtLength(length / 2);
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('pisi-map-task-dependency-label');
            label.setAttribute('x', String(point.x));
            label.setAttribute('y', String(point.y + 9));
            label.textContent = 'blocked by';
            group.appendChild(label);
        } catch {}
    }

    svg.appendChild(group);
}

function getPisiOperationalSummary(nodes, nodeStates, visibleNodeIds) {
    let blocked = 0;
    let overdue = 0;
    let active = 0;
    for (const node of nodes) {
        if (!visibleNodeIds.has(node?.id)) continue;
        const state = nodeStates.get(node?.id) || {};
        if (state.blocked) blocked += 1;
        if (state.overdue) overdue += 1;
        if ((state.openTasks?.length || 0) > 0) active += 1;
    }
    return {
        visible: visibleNodeIds.size,
        total: nodes.length,
        active,
        blocked,
        overdue
    };
}

function renderPisiOperationalMap(scope = {}, display = {}) {
    const nodes = Array.isArray(window.activeMapNodes) ? window.activeMapNodes : [];
    const edges = Array.isArray(window.activeMapEdges) ? window.activeMapEdges : [];
    const tasks = getPisiOperationalTasks();
    const nodeStates = buildPisiOperationalNodeStates(nodes, tasks);
    const visibleNodeIds = getPisiOperationalVisibleNodeIds(
        nodes,
        edges,
        nodeStates,
        scope
    );
    const visibleEdges = getPisiOperationalVisibleEdges(
        edges,
        visibleNodeIds,
        scope
    );
    const ranked = rankPisiOperationalNextNodes(nodes, nodeStates)
        .filter((item) => visibleNodeIds.has(item.node?.id));
    const nextNodeId = ranked[0]?.node?.id || null;

    syncPisiOperationalNodeDecorations(
        nodeStates,
        visibleNodeIds,
        display,
        nextNodeId
    );
    syncPisiOperationalSemanticEdgeVisibility(visibleEdges);
    syncPisiOperationalRelationshipLabels(visibleEdges);
    syncPisiOperationalTaskDependencies(
        buildPisiTaskDependencyProjections(nodes, tasks, visibleNodeIds),
        display
    );

    return {
        nodeStates,
        visibleNodeIds,
        visibleEdges,
        ranked,
        nextNodeId,
        summary: getPisiOperationalSummary(nodes, nodeStates, visibleNodeIds)
    };
}

function clearPisiOperationalMapRender() {
    document.querySelectorAll('.map-node-box[data-node-id]').forEach(clearPisiOperationalBadges);
    document.querySelectorAll('.map-edge-group[data-edge-id]').forEach((group) => {
        group.classList.remove('pisi-operational-filter-hidden');
    });
    removePisiOperationalRelationshipLabels();
    removePisiOperationalTaskDependencyLayer();
}

registerModule('map.operationalRender', {
    clearPisiOperationalMapRender,
    getPisiOperationalTasks,
    getPisiRelationshipLabelsPreference,
    renderPisiOperationalMap,
    setPisiRelationshipLabelsPreference,
    syncPisiOperationalRelationshipLabels,
    syncPisiOperationalTaskDependencies
});

export {
    clearPisiOperationalMapRender,
    getPisiOperationalTasks,
    getPisiRelationshipLabelsPreference,
    renderPisiOperationalMap,
    setPisiRelationshipLabelsPreference,
    syncPisiOperationalRelationshipLabels,
    syncPisiOperationalTaskDependencies
};