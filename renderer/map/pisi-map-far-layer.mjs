import { registerModule } from '../core/module-registry.mjs';

// The farthest zoom tier (< 0.3, pisi-map-viewport-core.mjs). Instead of DOM
// cards, every node is a small rectangle and every connection a line on one
// <canvas> under the board, so the whole map stays fluid at any size. Nodes
// hidden by a collapsed hub are left out. A click (without dragging) zooms in
// to the title tier at that point; a drag still pans the map.

const PISI_MAP_FAR_CLICK_ZOOM = 0.6;
const PISI_MAP_FAR_DRAG_TOLERANCE = 4;
const pisiMapFarLayerState = { canvas: null, pointer: null, lastDraw: null };

function ensurePisiMapFarCanvas() {
    if (pisiMapFarLayerState.canvas?.isConnected) return pisiMapFarLayerState.canvas;
    const host = document.getElementById('map-canvas');
    if (!host) return null;
    const canvas = document.createElement('canvas');
    canvas.id = 'map-far-layer';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    host.insertBefore(canvas, host.firstChild);
    canvas.addEventListener('mousedown', (event) => {
        pisiMapFarLayerState.pointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('click', (event) => {
        const start = pisiMapFarLayerState.pointer;
        pisiMapFarLayerState.pointer = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > PISI_MAP_FAR_DRAG_TOLERANCE) return;
        zoomPisiMapFarLayerAt(event.clientX, event.clientY);
    });
    // Double-clicking the overview never creates a node.
    canvas.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    pisiMapFarLayerState.canvas = canvas;
    return canvas;
}

function zoomPisiMapFarLayerAt(clientX, clientY) {
    const host = document.getElementById('map-canvas');
    const camera = window.activeMapCamera;
    if (!host || !camera) return;
    const rect = host.getBoundingClientRect();
    const worldX = (clientX - rect.left - camera.x) / (camera.zoom || 1);
    const worldY = (clientY - rect.top - camera.y) / (camera.zoom || 1);
    camera.zoom = PISI_MAP_FAR_CLICK_ZOOM;
    camera.x = clientX - rect.left - worldX * camera.zoom;
    camera.y = clientY - rect.top - worldY * camera.zoom;
    window.applyMapCamera?.();
    window.scheduleMapCameraSave?.();
}

function readPisiMapFarColors(canvas) {
    const style = getComputedStyle(canvas);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
        node: read('--pisi-map-far-node', '#3a3d44'),
        nodeBorder: read('--accent-color', '#f39c12'),
        edge: read('--pisi-map-far-edge', 'rgba(160, 160, 170, 0.55)'),
        stream: read('--pisi-map-far-stream', 'rgba(52, 152, 219, 0.6)'),
        selected: read('--accent-color', '#f39c12')
    };
}

/** Draws the overview when the viewport is in the far tier; hides the canvas otherwise. */
function drawPisiMapFarLayer() {
    const canvas = ensurePisiMapFarCanvas();
    if (!canvas) return;
    const far = window.pisiMapViewportState?.tier === 'far' && window.pisiMapViewportState?.allMounted === 0;
    if (!far || !window.activeMapPath) {
        if (!canvas.hidden) {
            canvas.hidden = true;
            canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
    }
    const host = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }
    canvas.hidden = false;
    const context = canvas.getContext('2d');
    if (!context) return;
    const camera = window.activeMapCamera || { x: 0, y: 0, zoom: 1 };
    const zoom = camera.zoom || 1;
    const colors = readPisiMapFarColors(canvas);
    const hidden = window.collectCollapsedHubNodeIds?.() || new Set();
    const rects = new Map((window.getPisiMapAllNodeRects?.() || []).filter((rect) => !hidden.has(rect.id)).map((rect) => [rect.id, rect]));
    const selected = new Set((window.getSelectedMapNodeBoxes?.() || []).map((box) => box.dataset.nodeId));
    context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * camera.x, ratio * camera.y);
    context.clearRect(-camera.x / zoom, -camera.y / zoom, width / zoom, height / zoom);
    context.lineWidth = 1.5 / zoom;
    for (const [color, type] of [
        [colors.edge, 'hierarchy'],
        [colors.stream, 'stream']
    ]) {
        context.strokeStyle = color;
        context.beginPath();
        for (const edge of Array.isArray(window.activeMapEdges) ? window.activeMapEdges : []) {
            if ((edge.type === 'stream') !== (type === 'stream')) continue;
            const a = rects.get(edge.sourceId);
            const b = rects.get(edge.targetId);
            if (!a || !b) continue;
            context.moveTo(a.x + a.width / 2, a.y + a.height / 2);
            context.lineTo(b.x + b.width / 2, b.y + b.height / 2);
        }
        context.stroke();
    }
    context.fillStyle = colors.node;
    context.strokeStyle = colors.nodeBorder;
    for (const rect of rects.values()) context.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (selected.size) {
        context.lineWidth = 3 / zoom;
        context.strokeStyle = colors.selected;
        for (const id of selected) {
            const rect = rects.get(id);
            if (rect) context.strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
    }
    pisiMapFarLayerState.lastDraw = { nodes: rects.size, at: performance.now() };
}

const moduleApi = { pisiMapFarLayerState, drawPisiMapFarLayer };

registerModule('map.farLayer', moduleApi);

export { drawPisiMapFarLayer, pisiMapFarLayerState };
