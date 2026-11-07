import { getPisiMapConnectionMetrics } from './pisi-map-zoom-core.mjs';
import { getPortDirection, offsetPoint, getDistance } from './pisi-map-interaction-helpers.mjs';

// Connections live in map (world) coordinates inside #map-edge-layer, which
// moves with the camera like #map-board. Geometry therefore comes from the
// layout numbers on the box style (or the model for boxes that are not in the
// DOM), never from getBoundingClientRect: reading layout per edge forced a
// reflow per edge on every frame.
export function getPisiMapBoxWorldRect(box) {
    return {
        x: parseFloat(box.style.left) || 0,
        y: parseFloat(box.style.top) || 0,
        width: parseFloat(box.style.width) || box.offsetWidth || 220,
        height: parseFloat(box.style.height) || box.offsetHeight || 92
    };
}

/** Port point in world coordinates; accepts a node box or a { x, y, width, height } rect. */
export function getPortPoint(boxOrRect, port) {
    const rect = boxOrRect?.nodeType === 1 ? getPisiMapBoxWorldRect(boxOrRect) : boxOrRect || { x: 0, y: 0, width: 0, height: 0 };
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;

    if (port === 'top') return { x: x + w / 2, y };
    if (port === 'right') return { x: x + w, y: y + h / 2 };
    if (port === 'bottom') return { x: x + w / 2, y: y + h };
    return { x, y: y + h / 2 };
}

/** Pointer position in world coordinates (the connection layer's space). */
export function getMousePointInCanvas(event) {
    const canvas = document.getElementById('map-canvas');
    const rect = canvas.getBoundingClientRect();
    const zoom = activeMapCamera?.zoom || 1;

    return {
        x: (event.clientX - rect.left - (activeMapCamera?.x || 0)) / zoom,
        y: (event.clientY - rect.top - (activeMapCamera?.y || 0)) / zoom
    };
}

// World-space geometry: the layer's transform scales strokes, gaps and arrows
// with the zoom exactly as the former per-zoom screen metrics did.
export function getMapConnectionVisualMetrics() {
    return getPisiMapConnectionMetrics(1);
}

export function syncMapConnectionZoomStyles(svg = document.getElementById('map-connections')) {
    const metrics = getMapConnectionVisualMetrics();
    if (!svg) return metrics;

    svg.style.setProperty('--pisi-map-edge-stroke-width', `${metrics.edgeStrokeWidth}px`);
    svg.style.setProperty('--pisi-map-edge-hover-stroke-width', `${metrics.edgeHoverStrokeWidth}px`);
    svg.style.setProperty('--pisi-map-temp-edge-stroke-width', `${metrics.tempEdgeStrokeWidth}px`);

    return metrics;
}

export function makeConnectionPathFromBoxes(sourceBox, sourcePort, targetBox, targetPort, edgeType = 'down-hub') {
    const hasStartArrow = edgeType === 'co-level';
    const hasEndArrow = true;
    const metrics = getMapConnectionVisualMetrics();

    // Ok olmayan çıkış tarafı kutuya yakın başlasın.
    // Ok olan taraflarda çizgi ok tabanında bitsin, ok kutuya doğru uzasın.
    const plainLineGap = metrics.plainLineGap;
    const arrowGap = metrics.arrowGap;

    const sourceOffset = hasStartArrow ? arrowGap : plainLineGap;
    const targetOffset = hasEndArrow ? arrowGap : plainLineGap;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const targetBase = getPortPoint(targetBox, targetPort);

    const sourceDir = getPortDirection(sourcePort);
    const targetDir = getPortDirection(targetPort);

    const start = offsetPoint(sourceBase, sourceDir, sourceOffset);
    const end = offsetPoint(targetBase, targetDir, targetOffset);

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

export function makeTempConnectionPath(sourceBox, sourcePort, mousePoint) {
    const metrics = getMapConnectionVisualMetrics();
    const endpointOffset = metrics.tempEndpointOffset;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const sourceDir = getPortDirection(sourcePort);

    const start = offsetPoint(sourceBase, sourceDir, endpointOffset);
    const distance = getDistance(start, mousePoint);
    const control = Math.max(metrics.tempControlMin, Math.min(metrics.tempControlMax, distance * 0.35));

    const c1 = {
        x: start.x + sourceDir.x * control,
        y: start.y + sourceDir.y * control
    };

    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${mousePoint.x} ${mousePoint.y}, ${mousePoint.x} ${mousePoint.y}`;
}

export function ensureTempEdgePath() {
    const svg = document.getElementById('map-connections');
    if (!svg) return null;

    let path = /** @type {SVGPathElement | null} */ (document.querySelector('#map-temp-edge'));

    if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.id = 'map-temp-edge';
        path.classList.add('map-temp-edge');
        svg.appendChild(path);
    }

    return path;
}

export function clearTempEdgePath() {
    const path = document.getElementById('map-temp-edge');
    if (path) path.remove();
}
