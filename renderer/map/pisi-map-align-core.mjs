// Pure geometry for map editing: alignment, even distribution, snap guides,
// grid snapping and nearest-neighbour keyboard navigation. Rectangles are
// { id, x, y, width, height } in map (world) coordinates. No DOM; unit-tested.

export const PISI_MAP_GRID_STEP = 20;
export const PISI_MAP_SNAP_THRESHOLD = 6;
export const PISI_MAP_ALIGN_MODES = Object.freeze(['left', 'center', 'right', 'top', 'middle', 'bottom']);

function normalizeRect(rect) {
    return {
        id: String(rect.id),
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Math.max(0, Number(rect.width) || 0),
        height: Math.max(0, Number(rect.height) || 0)
    };
}

/**
 * Aligns rectangles to the selection's left/center/right edge or
 * top/middle/bottom edge. Returns new positions for every rectangle.
 * @param {any[]} rects
 * @param {string} mode
 */
export function alignPisiMapRects(rects = [], mode = 'left') {
    const items = rects.map(normalizeRect);
    if (items.length < 2 || !PISI_MAP_ALIGN_MODES.includes(mode)) return items;
    const left = Math.min(...items.map((item) => item.x));
    const right = Math.max(...items.map((item) => item.x + item.width));
    const top = Math.min(...items.map((item) => item.y));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    return items.map((item) => {
        const next = { ...item };
        if (mode === 'left') next.x = left;
        if (mode === 'right') next.x = right - item.width;
        if (mode === 'center') next.x = Math.round((left + right) / 2 - item.width / 2);
        if (mode === 'top') next.y = top;
        if (mode === 'bottom') next.y = bottom - item.height;
        if (mode === 'middle') next.y = Math.round((top + bottom) / 2 - item.height / 2);
        return next;
    });
}

/**
 * Spaces rectangles so the gaps between neighbours are equal. The first and
 * last rectangle (by position) stay where they are. Needs three or more.
 * @param {any[]} rects
 * @param {'horizontal' | 'vertical' | string} axis
 */
export function distributePisiMapRects(rects = [], axis = 'horizontal') {
    const items = rects.map(normalizeRect);
    if (items.length < 3) return items;
    const horizontal = axis !== 'vertical';
    const pos = horizontal ? 'x' : 'y';
    const size = horizontal ? 'width' : 'height';
    const sorted = [...items].sort((a, b) => a[pos] - b[pos] || a.id.localeCompare(b.id));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last[pos] + last[size] - first[pos];
    const occupied = sorted.reduce((sum, item) => sum + item[size], 0);
    const gap = (span - occupied) / (sorted.length - 1);
    const placed = new Map();
    let cursor = first[pos];
    for (const item of sorted) {
        placed.set(item.id, { ...item, [pos]: Math.round(cursor) });
        cursor += item[size] + gap;
    }
    placed.set(last.id, { ...last });
    return items.map((item) => placed.get(item.id));
}

export function snapPisiMapValueToGrid(value, step = PISI_MAP_GRID_STEP) {
    const size = Math.max(1, Number(step) || PISI_MAP_GRID_STEP);
    return Math.round((Number(value) || 0) / size) * size;
}

function edgesOf(rect, horizontal) {
    return horizontal ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width] : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

/**
 * Finds the closest alignment of a moving rectangle (its edges and centre)
 * with any other rectangle, per axis, within `threshold` world units.
 * Returns the snapped position and the guide lines to draw.
 * @param {any} moving
 * @param {any[]} others
 * @param {number} [threshold]
 */
export function findPisiMapSnapGuides(moving, others = [], threshold = PISI_MAP_SNAP_THRESHOLD) {
    const rect = normalizeRect(moving);
    const result = { x: rect.x, y: rect.y, guides: [] };
    for (const horizontal of [true, false]) {
        const own = edgesOf(rect, horizontal);
        /** @type {any} */
        let best = null;
        for (const other of others.map(normalizeRect)) {
            if (other.id === rect.id) continue;
            for (const target of edgesOf(other, horizontal)) {
                own.forEach((value, index) => {
                    const delta = target - value;
                    if (Math.abs(delta) > threshold) return;
                    if (!best || Math.abs(delta) < Math.abs(best.delta) || (Math.abs(delta) === Math.abs(best.delta) && index < best.index)) {
                        best = { delta, target, index, other };
                    }
                });
            }
        }
        if (!best) continue;
        if (horizontal) result.x = rect.x + best.delta;
        else result.y = rect.y + best.delta;
        const span = horizontal
            ? [Math.min(rect.y, best.other.y), Math.max(rect.y + rect.height, best.other.y + best.other.height)]
            : [Math.min(rect.x, best.other.x), Math.max(rect.x + rect.width, best.other.x + best.other.width)];
        result.guides.push({ axis: horizontal ? 'x' : 'y', position: best.target, from: span[0], to: span[1] });
    }
    return result;
}

function centreOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Nearest node in a direction for arrow-key navigation. Candidates must lie
 * within a 45° cone around the direction; the score weights sideways offset
 * twice as much as forward distance. Ties fall back to id order.
 * @param {any} from
 * @param {any[]} candidates
 * @param {'up' | 'down' | 'left' | 'right' | string} direction
 */
export function findPisiNearestMapRect(from, candidates = [], direction = 'right') {
    const origin = centreOf(normalizeRect(from));
    const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const vector = vectors[direction];
    if (!vector) return null;
    let best = null;
    for (const candidate of candidates.map(normalizeRect)) {
        if (candidate.id === String(from.id)) continue;
        const centre = centreOf(candidate);
        const dx = centre.x - origin.x;
        const dy = centre.y - origin.y;
        const forward = dx * vector[0] + dy * vector[1];
        const sideways = Math.abs(dx * vector[1] - dy * vector[0]);
        if (forward <= 0 || sideways > forward) continue;
        const score = forward + 2 * sideways;
        if (!best || score < best.score || (score === best.score && candidate.id < best.id)) best = { id: candidate.id, score };
    }
    return best ? best.id : null;
}

/** Ids of nodes connected to `nodeId`, in the order the edges are listed. */
export function getPisiMapConnectedIds(nodeId, edges = []) {
    const ids = [];
    for (const edge of edges) {
        const other = edge?.sourceId === nodeId ? edge.targetId : edge?.targetId === nodeId ? edge.sourceId : null;
        if (other && !ids.includes(other)) ids.push(other);
    }
    return ids;
}

/**
 * Tab / Shift+Tab order. Traversal starts at an anchor node and cycles through
 * the anchor and the nodes connected to it, in edge order. An anchor without
 * connections cycles through all nodes in reading order (top to bottom, then
 * left to right).
 * @param {string} anchorId
 * @param {string} currentId
 * @param {any[]} rects
 * @param {any[]} edges
 * @param {boolean} [backwards]
 */
export function getPisiMapTabTarget(anchorId, currentId, rects = [], edges = [], backwards = false) {
    const present = new Set(rects.map((rect) => String(rect.id)));
    const connected = getPisiMapConnectedIds(String(anchorId), edges).filter((id) => present.has(id));
    const order = connected.length
        ? [String(anchorId), ...connected]
        : rects
              .map(normalizeRect)
              .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
              .map((rect) => rect.id);
    if (!order.length) return null;
    const index = order.indexOf(String(currentId));
    if (index < 0) return order[0];
    return order[(index + (backwards ? -1 : 1) + order.length) % order.length];
}
