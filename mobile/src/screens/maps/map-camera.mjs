// Camera of the map viewer, as plain numbers. A world point p is drawn at
// p × zoom + (x, y) on the screen, the desktop's convention for `map.camera`.
// The zoom range is the desktop's (0.1 to 3).

export const PISI_MAP_MIN_ZOOM = 0.1;
export const PISI_MAP_MAX_ZOOM = 3;
const FIT_PADDING = 24;

export const clampZoom = (zoom) => Math.min(PISI_MAP_MAX_ZOOM, Math.max(PISI_MAP_MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));

/** The world rect that holds every given layout, or null when there is none. */
export function getLayoutBounds(layouts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const layout of layouts) {
        minX = Math.min(minX, layout.x);
        minY = Math.min(minY, layout.y);
        maxX = Math.max(maxX, layout.x + layout.width);
        maxY = Math.max(maxY, layout.y + layout.height);
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** The camera that shows all of `bounds` centred in a `viewport` of `{ width, height }` pixels, never above zoom 1. */
export function fitCamera(bounds, viewport, padding = FIT_PADDING) {
    if (!bounds) return { x: viewport.width / 2, y: viewport.height / 2, zoom: 1 };
    const room = { width: Math.max(1, viewport.width - padding * 2), height: Math.max(1, viewport.height - padding * 2) };
    const zoom = clampZoom(Math.min(1, room.width / Math.max(1, bounds.width), room.height / Math.max(1, bounds.height)));
    return {
        x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom
    };
}

/** The world point under a screen point. */
export const toWorld = (camera, point) => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

/** Zooms by `factor` keeping the world point under the screen `point` where it is. */
export function zoomAt(camera, factor, point) {
    const zoom = clampZoom(camera.zoom * factor);
    const world = toWorld(camera, point);
    return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}

export const panBy = (camera, dx, dy) => ({ ...camera, x: camera.x + dx, y: camera.y + dy });

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Two-finger gesture: from the camera at the start of the gesture and the two
 * fingers then and now. The world point under the fingers' midpoint follows
 * the midpoint, and the zoom follows the distance between the fingers.
 */
export function pinchCamera(start, from, to) {
    const before = distance(from[0], from[1]);
    const factor = before > 0 ? distance(to[0], to[1]) / before : 1;
    const zoom = clampZoom(start.zoom * factor);
    const world = toWorld(start, midpoint(from[0], from[1]));
    const center = midpoint(to[0], to[1]);
    return { x: center.x - world.x * zoom, y: center.y - world.y * zoom, zoom };
}
