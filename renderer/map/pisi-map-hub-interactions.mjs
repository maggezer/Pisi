import {
    collectPisiCollapsedHubCounts,
    collectPisiCollapsedHubNodeIds,
    isPisiHierarchyEdge,
    isPisiMapEdgeHiddenByCollapsedHub,
    makePisiCollapsedHubPortKey
} from './pisi-map-collapse-core.mjs';
import { saveActiveMapCameraSoon } from './pisi-map-camera-interactions.mjs';

export function getCollapsedHubPortSet() {
    if (!window.Pisi) {
        window.Pisi = { state: {} };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    if (!(window.Pisi.state.collapsedHubPorts instanceof Set)) {
        window.Pisi.state.collapsedHubPorts = new Set();
    }

    return window.Pisi.state.collapsedHubPorts;
}

export function makeCollapsedHubPortKey(nodeId, port) {
    return makePisiCollapsedHubPortKey(nodeId, port);
}

export function hasOutgoingHubEdgesFromPort(nodeId, port) {
    return (
        Array.isArray(activeMapEdges) &&
        activeMapEdges.some((edge) => {
            return isPisiHierarchyEdge(edge) && edge.sourceId === nodeId && (edge.sourcePort || 'right') === (port || 'right');
        })
    );
}

export function collectCollapsedHubNodeIds() {
    return collectPisiCollapsedHubNodeIds(activeMapEdges, Array.from(getCollapsedHubPortSet()));
}

export function syncCollapsedHubNodeVisibility() {
    const hiddenNodeIds = collectCollapsedHubNodeIds();
    let selectionChanged = false;

    document.querySelectorAll('.map-node-box[data-node-id]').forEach((box) => {
        const shouldHide = hiddenNodeIds.has(String(box.dataset.nodeId || ''));
        box.classList.toggle('pisi-hub-descendant-hidden', shouldHide);

        if (shouldHide) {
            selectionChanged = selectionChanged || box.classList.contains('selected');
            box.classList.remove('selected', 'dragging');
            box.setAttribute('aria-hidden', 'true');
        } else {
            box.removeAttribute('aria-hidden');
        }
    });

    if (selectionChanged) {
        document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
    }

    return hiddenNodeIds;
}

export function isHubEdgeCollapsed(edge, hiddenNodeIds = collectCollapsedHubNodeIds()) {
    // Sets are passed as they are; converting them per edge made drawing O(edges × hubs).
    return isPisiMapEdgeHiddenByCollapsedHub(edge, hiddenNodeIds instanceof Set ? hiddenNodeIds : new Set(hiddenNodeIds || []), getCollapsedHubPortSet());
}

export function syncHubPortCollapseVisuals() {
    document.querySelectorAll('.map-port.hub-collapsed').forEach((port) => {
        port.classList.remove('hub-collapsed');
        port.title = '';
        delete port.dataset.collapsedCount;
    });

    const collapsedCounts = collectPisiCollapsedHubCounts(Array.isArray(activeMapEdges) ? activeMapEdges : [], getCollapsedHubPortSet());
    for (const key of getCollapsedHubPortSet()) {
        const [nodeId, port] = String(key).split('::');
        if (!nodeId || !port) continue;

        const portEl = document.querySelector(`.map-node-box[data-node-id="${CSS.escape(nodeId)}"] .map-port.${CSS.escape(port)}`);

        if (portEl) {
            const hiddenCount = collapsedCounts.get(key) || 0;
            portEl.classList.add('hub-collapsed');
            portEl.dataset.collapsedCount = String(hiddenCount);
            portEl.title = `${hiddenCount} gizli node. Hub bağlantılarını açmak için tıkla.`;
            portEl.setAttribute('aria-label', `${hiddenCount} gizli node; bağlantıları aç`);
        }
    }
}

export function toggleHubConnectionsFromPort(nodeId, port) {
    if (!hasOutgoingHubEdgesFromPort(nodeId, port)) {
        return false;
    }

    const set = getCollapsedHubPortSet();
    const key = makeCollapsedHubPortKey(nodeId, port);
    const before = Array.from(set);

    if (set.has(key)) {
        set.delete(key);
    } else {
        set.add(key);
    }

    drawMapConnections();
    syncHubPortCollapseVisuals();
    saveActiveMapCameraSoon();
    window.recordPisiMapHistoryCollapse?.(activeMapPath, before, Array.from(set));
    return true;
}
