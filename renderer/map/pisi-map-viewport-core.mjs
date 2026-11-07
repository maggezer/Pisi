// Pure viewport rules for large maps: a uniform-grid spatial index of node
// rectangles, the world rectangle the camera shows (plus a margin), which
// connections can be visible, and the zoom tier. No DOM; unit-tested directly.

export const PISI_MAP_INDEX_CELL = 512;
export const PISI_MAP_VIEWPORT_MARGIN = 0.25;
export const PISI_MAP_TIER_TITLE = 0.6;
export const PISI_MAP_TIER_FAR = 0.3;

function cellRange(min, max, cell) {
    return [Math.floor(min / cell), Math.floor(max / cell)];
}

function toRect(rect) {
    return { x: Number(rect.x) || 0, y: Number(rect.y) || 0, width: Math.max(0, Number(rect.width) || 0), height: Math.max(0, Number(rect.height) || 0) };
}

/**
 * @param {Iterable<{ id: string, x: number, y: number, width: number, height: number }>} rects
 * @param {number} [cell]
 */
export function buildPisiMapSpatialIndex(rects, cell = PISI_MAP_INDEX_CELL) {
    const cells = new Map();
    const byId = new Map();
    for (const raw of rects) {
        if (!raw?.id) continue;
        const rect = { id: String(raw.id), ...toRect(raw) };
        byId.set(rect.id, rect);
        const [x0, x1] = cellRange(rect.x, rect.x + rect.width, cell);
        const [y0, y1] = cellRange(rect.y, rect.y + rect.height, cell);
        for (let cx = x0; cx <= x1; cx += 1) {
            for (let cy = y0; cy <= y1; cy += 1) {
                const key = `${cx},${cy}`;
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push(rect.id);
            }
        }
    }
    return { cell, cells, byId };
}

export function intersectsPisiMapRect(a, b) {
    return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** Ids of rectangles intersecting `bounds`. */
export function queryPisiMapSpatialIndex(index, bounds) {
    const found = new Set();
    if (!index || !bounds) return found;
    const [x0, x1] = cellRange(bounds.x, bounds.x + bounds.width, index.cell);
    const [y0, y1] = cellRange(bounds.y, bounds.y + bounds.height, index.cell);
    // A huge viewport (far zoom-out) is cheaper as a linear scan than as cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > index.byId.size) {
        for (const rect of index.byId.values()) if (intersectsPisiMapRect(rect, bounds)) found.add(rect.id);
        return found;
    }
    for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
            for (const id of index.cells.get(`${cx},${cy}`) || []) {
                if (!found.has(id) && intersectsPisiMapRect(index.byId.get(id), bounds)) found.add(id);
            }
        }
    }
    return found;
}

/**
 * The world rectangle shown by the camera, grown by `margin` of its size on
 * every side so nodes are mounted slightly before they scroll in.
 * @param {{ x: number, y: number, zoom: number }} camera
 * @param {number} width canvas width in screen pixels
 * @param {number} height canvas height in screen pixels
 * @param {number} [margin]
 */
export function getPisiMapViewportBounds(camera, width, height, margin = PISI_MAP_VIEWPORT_MARGIN) {
    const zoom = Number(camera?.zoom) > 0 ? Number(camera.zoom) : 1;
    const worldWidth = Math.max(0, width) / zoom;
    const worldHeight = Math.max(0, height) / zoom;
    const x = -(Number(camera?.x) || 0) / zoom;
    const y = -(Number(camera?.y) || 0) / zoom;
    return { x: x - worldWidth * margin, y: y - worldHeight * margin, width: worldWidth * (1 + 2 * margin), height: worldHeight * (1 + 2 * margin) };
}

/**
 * A connection is drawn when either end is visible, or when the box spanned by
 * both ends crosses the viewport (a long edge passing through the screen).
 */
export function isPisiMapEdgeVisible(edge, visibleIds, rectOf, bounds) {
    if (visibleIds.has(edge.sourceId) || visibleIds.has(edge.targetId)) return true;
    const a = rectOf(edge.sourceId);
    const b = rectOf(edge.targetId);
    if (!a || !b || !bounds) return false;
    const span = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
    };
    return intersectsPisiMapRect(span, bounds);
}

/**
 * 'full' card at zoom ≥ 0.6, 'title' card from 0.3 (or at any zoom when the
 * "titles only" view is on), 'far' below 0.3 where nodes are drawn on a canvas.
 */
export function getPisiMapZoomTier(zoom, titleOnly = false) {
    const value = Number(zoom) > 0 ? Number(zoom) : 1;
    if (value < PISI_MAP_TIER_FAR) return 'far';
    if (value < PISI_MAP_TIER_TITLE || titleOnly) return 'title';
    return 'full';
}

/** Ids to add to and remove from the DOM to go from `mounted` to `wanted`. */
export function diffPisiMapMounted(mounted, wanted) {
    const add = [];
    const remove = [];
    for (const id of wanted) if (!mounted.has(id)) add.push(id);
    for (const id of mounted) if (!wanted.has(id)) remove.push(id);
    return { add, remove };
}
