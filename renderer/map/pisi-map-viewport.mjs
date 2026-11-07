import { registerModule } from '../core/module-registry.mjs';
import {
    buildPisiMapSpatialIndex,
    diffPisiMapMounted,
    getPisiMapViewportBounds,
    getPisiMapZoomTier,
    intersectsPisiMapRect,
    isPisiMapEdgeVisible,
    queryPisiMapSpatialIndex
} from './pisi-map-viewport-core.mjs';

// Viewport culling for maps. Only nodes inside the camera's view (plus a
// margin) are in the DOM; the camera's requestAnimationFrame sync mounts nodes
// that scroll in and unmounts those that leave. Unmounted nodes keep their
// current layout in activeMapNodes, so connections, saving, search focus,
// keyboard navigation and export still see every node.
//
// Never unmounted: selected, focused, dragged or renamed boxes and boxes
// pinned by ensurePisiMapNodeMounted (search focus, keyboard navigation).
// Export runs inside withAllPisiMapNodesMounted. Far zoom (< 0.3) draws nodes
// on a canvas (pisi-map-far-layer.mjs) instead of the DOM.

const PISI_MAP_PIN_MS = 4000;
const pisiMapViewportState = {
    index: null,
    indexNodes: null,
    dirty: true,
    frame: null,
    allMounted: 0,
    pins: new Map(),
    lastEdgeBounds: null,
    wanted: new Set(),
    bounds: null,
    tier: 'full',
    lastSync: null
};

function getPisiMapBoard() {
    return document.getElementById('map-board');
}

function getMountedPisiMapBoxes() {
    const mounted = new Map();
    getPisiMapBoard()
        ?.querySelectorAll(':scope > .map-node-box[data-node-id]')
        .forEach((box) => mounted.set(box.dataset.nodeId, /** @type {HTMLElement} */ (box)));
    return mounted;
}

const pisiMapNodeLookup = { nodes: null, byId: new Map() };

function getPisiMapNodeById(id) {
    const nodes = Array.isArray(window.activeMapNodes) ? window.activeMapNodes : [];
    if (pisiMapNodeLookup.nodes !== nodes || pisiMapNodeLookup.byId.size !== nodes.length) {
        pisiMapNodeLookup.nodes = nodes;
        pisiMapNodeLookup.byId = new Map(nodes.map((node) => [node.id, node]));
    }
    return pisiMapNodeLookup.byId.get(String(id)) || null;
}

function layoutToRect(id, layout) {
    return { id, x: Number(layout?.x) || 0, y: Number(layout?.y) || 0, width: Number(layout?.width) || 220, height: Number(layout?.height) || 92 };
}

/** World rect of a node: a mounted box's style wins over the model. */
function getPisiMapNodeRect(id, mounted = null) {
    const box = mounted ? mounted.get(id) : getPisiMapBoard()?.querySelector(`:scope > .map-node-box[data-node-id="${CSS.escape(String(id))}"]`);
    if (box) return { id, ...window.getPisiMapBoxWorldRect(box) };
    const node = getPisiMapNodeById(id);
    return node ? layoutToRect(id, node.layout) : null;
}

/** World rects of every node of the active map, mounted or not. */
function getPisiMapAllNodeRects() {
    const mounted = getMountedPisiMapBoxes();
    return (Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []).map((node) =>
        mounted.has(node.id) ? { id: node.id, ...window.getPisiMapBoxWorldRect(mounted.get(node.id)) } : layoutToRect(node.id, node.layout)
    );
}

/** Layout changed outside a sync (drag end, auto layout, nudge): rebuild the index next time. */
function markPisiMapViewportDirty() {
    pisiMapViewportState.dirty = true;
    schedulePisiMapViewportSync();
}

function ensurePisiMapIndex() {
    const nodes = Array.isArray(window.activeMapNodes) ? window.activeMapNodes : [];
    if (!pisiMapViewportState.dirty && pisiMapViewportState.indexNodes === nodes && pisiMapViewportState.index) return pisiMapViewportState.index;
    pisiMapViewportState.index = buildPisiMapSpatialIndex(getPisiMapAllNodeRects());
    pisiMapViewportState.indexNodes = nodes;
    pisiMapViewportState.dirty = false;
    return pisiMapViewportState.index;
}

function isPisiMapBoxSticky(box) {
    return (
        box.classList.contains('selected') ||
        box.classList.contains('dragging') ||
        box.dataset.renaming === '1' ||
        box.contains(document.activeElement) ||
        (pisiMapViewportState.pins.get(box.dataset.nodeId) || 0) > Date.now()
    );
}

function unmountPisiMapBox(box) {
    // The model keeps the latest layout of a node that leaves the DOM.
    const node = getPisiMapNodeById(box.dataset.nodeId);
    if (node) node.layout = { ...(node.layout || {}), ...window.getPisiMapBoxWorldRect(box) };
    box.remove();
}

function mountPisiMapNodes(ids, board) {
    const fragment = document.createDocumentFragment();
    const boxes = [];
    for (const id of ids) {
        const node = getPisiMapNodeById(id);
        if (!node || typeof window.createMapNodeBox !== 'function') continue;
        const box = window.createMapNodeBox(node);
        fragment.appendChild(box);
        boxes.push(box);
    }
    if (boxes.length) board.appendChild(fragment);
    return boxes;
}

function getPisiMapCanvasSize() {
    const canvas = document.getElementById('map-canvas');
    return { width: canvas?.clientWidth || window.innerWidth, height: canvas?.clientHeight || window.innerHeight };
}

function boundsMovedFar(previous, next) {
    if (!previous) return true;
    const threshold = Math.min(next.width, next.height) * 0.1;
    return (
        Math.abs(previous.x - next.x) > threshold ||
        Math.abs(previous.y - next.y) > threshold ||
        Math.abs(previous.width - next.width) > threshold ||
        Math.abs(previous.height - next.height) > threshold
    );
}

/** Mounts and unmounts nodes for the current camera. Returns what changed. */
function syncPisiMapViewport() {
    pisiMapViewportState.frame = null;
    const board = getPisiMapBoard();
    if (!board || !window.activeMapPath || !window.activeMapCamera) return { add: [], remove: [] };
    const camera = window.activeMapCamera;
    const titleOnly = document.getElementById('map-canvas')?.dataset.nodeView === 'title';
    const tier = getPisiMapZoomTier(camera.zoom, titleOnly);
    pisiMapViewportState.tier = tier;
    document.getElementById('map-canvas')?.setAttribute('data-zoom-tier', tier);
    const size = getPisiMapCanvasSize();
    const bounds = getPisiMapViewportBounds(camera, size.width, size.height);
    pisiMapViewportState.bounds = bounds;
    const index = ensurePisiMapIndex();
    const mounted = getMountedPisiMapBoxes();
    const all = pisiMapViewportState.allMounted > 0;
    let wanted;
    if (all) wanted = new Set(index.byId.keys());
    else if (tier === 'far') wanted = new Set();
    else wanted = queryPisiMapSpatialIndex(index, bounds);
    const now = Date.now();
    for (const [id, until] of pisiMapViewportState.pins) {
        if (until > now && index.byId.has(id)) wanted.add(id);
        else if (until <= now) pisiMapViewportState.pins.delete(id);
    }
    for (const [id, box] of mounted) if (isPisiMapBoxSticky(box)) wanted.add(id);
    pisiMapViewportState.wanted = wanted;
    const diff = diffPisiMapMounted(new Set(mounted.keys()), wanted);
    for (const id of diff.remove) unmountPisiMapBox(mounted.get(id));
    const added = mountPisiMapNodes(diff.add, board);
    const changed = diff.add.length > 0 || diff.remove.length > 0;
    if (changed || all || boundsMovedFar(pisiMapViewportState.lastEdgeBounds, bounds)) {
        pisiMapViewportState.lastEdgeBounds = bounds;
        window.drawMapConnections?.();
    }
    if (changed) {
        window.syncHubPortCollapseVisuals?.();
        document.dispatchEvent(new CustomEvent('pisi:map-nodes-mounted', { detail: { added, removed: diff.remove } }));
    }
    window.drawPisiMapFarLayer?.();
    pisiMapViewportState.lastSync = { tier, mounted: wanted.size, total: index.byId.size, added: diff.add.length, removed: diff.remove.length };
    return diff;
}

function schedulePisiMapViewportSync() {
    if (pisiMapViewportState.frame !== null) return;
    pisiMapViewportState.frame = requestAnimationFrame(syncPisiMapViewport);
}

/** First render of a freshly opened map: mount only what the camera shows. */
function mountPisiMapViewport() {
    if (pisiMapViewportState.frame !== null) cancelAnimationFrame(pisiMapViewportState.frame);
    pisiMapViewportState.frame = null;
    pisiMapViewportState.dirty = true;
    pisiMapViewportState.pins.clear();
    pisiMapViewportState.lastEdgeBounds = null;
    return syncPisiMapViewport();
}

/** Edge filter used by drawMapConnections. */
function isPisiMapEdgeInViewport(edge) {
    if (pisiMapViewportState.allMounted > 0) return true;
    if (pisiMapViewportState.tier === 'far') return false;
    const index = pisiMapViewportState.index;
    if (!index) return true;
    return isPisiMapEdgeVisible(edge, pisiMapViewportState.wanted, (id) => index.byId.get(id) || null, pisiMapViewportState.bounds);
}

/** Mounts a node now and keeps it mounted for a few seconds (or while selected/focused). */
function ensurePisiMapNodeMounted(id) {
    if (!id || !getPisiMapNodeById(id)) return null;
    pisiMapViewportState.pins.set(String(id), Date.now() + PISI_MAP_PIN_MS);
    const existing = getMountedPisiMapBoxes().get(String(id));
    if (existing) return existing;
    const board = getPisiMapBoard();
    if (!board) return null;
    const [box] = mountPisiMapNodes([String(id)], board);
    if (box) {
        window.drawMapConnections?.();
        document.dispatchEvent(new CustomEvent('pisi:map-nodes-mounted', { detail: { added: [box], removed: [] } }));
    }
    return box || null;
}

function ensurePisiMapNodeMountedByPath(nodePath) {
    const key = String(nodePath || '')
        .replace(/\\/g, '/')
        .toLowerCase();
    const node = (Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []).find(
        (candidate) =>
            String(candidate.fullPath || '')
                .replace(/\\/g, '/')
                .toLowerCase() === key
    );
    return node ? ensurePisiMapNodeMounted(node.id) : null;
}

/** Moves the camera so the node is on screen (keeping the zoom) and returns its box. */
function revealPisiMapNode(id) {
    const rect = getPisiMapNodeRect(String(id));
    const camera = window.activeMapCamera;
    if (!rect || !camera) return null;
    const size = getPisiMapCanvasSize();
    const visible = getPisiMapViewportBounds(camera, size.width, size.height, 0);
    if (!intersectsPisiMapRect(rect, { x: visible.x + 20, y: visible.y + 20, width: visible.width - 40, height: visible.height - 40 })) {
        const zoom = camera.zoom || 1;
        camera.x = size.width / 2 - (rect.x + rect.width / 2) * zoom;
        camera.y = size.height / 2 - (rect.y + rect.height / 2) * zoom;
        window.applyMapCamera?.();
        window.scheduleMapCameraSave?.();
    }
    const box = ensurePisiMapNodeMounted(String(id));
    syncPisiMapViewport();
    return box;
}

/** Runs `task` with every node mounted (export), then returns to culling. */
async function withAllPisiMapNodesMounted(task) {
    pisiMapViewportState.allMounted += 1;
    try {
        syncPisiMapViewport();
        return await task();
    } finally {
        pisiMapViewportState.allMounted -= 1;
        syncPisiMapViewport();
    }
}

function getPisiMapViewportStats() {
    return { ...(pisiMapViewportState.lastSync || {}), domBoxes: getMountedPisiMapBoxes().size };
}

function initializePisiMapViewport() {
    window.addEventListener('resize', schedulePisiMapViewportSync);
    window.addEventListener('mouseup', () => {
        if (window.activeMapPath) markPisiMapViewportDirty();
    });
    return true;
}

const moduleApi = {
    pisiMapViewportState,
    getPisiMapNodeRect,
    getPisiMapAllNodeRects,
    markPisiMapViewportDirty,
    syncPisiMapViewport,
    schedulePisiMapViewportSync,
    mountPisiMapViewport,
    isPisiMapEdgeInViewport,
    ensurePisiMapNodeMounted,
    ensurePisiMapNodeMountedByPath,
    revealPisiMapNode,
    withAllPisiMapNodesMounted,
    getPisiMapViewportStats,
    initializePisiMapViewport
};

registerModule('map.viewport', moduleApi);
initializePisiMapViewport();

export {
    ensurePisiMapNodeMounted,
    getPisiMapAllNodeRects,
    getPisiMapNodeRect,
    markPisiMapViewportDirty,
    mountPisiMapViewport,
    revealPisiMapNode,
    schedulePisiMapViewportSync,
    syncPisiMapViewport,
    withAllPisiMapNodesMounted
};
