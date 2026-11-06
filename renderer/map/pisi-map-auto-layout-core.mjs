// Pure tree layout for maps from hierarchy (down-hub) edges. No DOM; unit-tested.
//
// Layered layout, top to bottom: every parent is centred over its children,
// siblings keep their current left-to-right order, and each subtree gets the
// width it needs so subtrees never overlap. A node with several parents is
// placed under the first one (edge order); cycles are broken by visiting each
// node once. Nodes outside every hierarchy go into one row below the trees.

export const PISI_MAP_LAYOUT_GAP_X = 40;
export const PISI_MAP_LAYOUT_GAP_Y = 80;

function rectOf(rect) {
    return { id: String(rect.id), x: Number(rect.x) || 0, y: Number(rect.y) || 0, width: Number(rect.width) || 220, height: Number(rect.height) || 92 };
}

function buildChildren(rects, edges) {
    const byId = new Map(rects.map((rect) => [rect.id, rect]));
    const children = new Map(rects.map((rect) => [rect.id, []]));
    const parentOf = new Map();
    for (const edge of edges) {
        if (edge?.type !== 'down-hub') continue;
        const source = String(edge.sourceId);
        const target = String(edge.targetId);
        if (!byId.has(source) || !byId.has(target) || source === target || parentOf.has(target)) continue;
        parentOf.set(target, source);
        children.get(source).push(target);
    }
    for (const list of children.values()) list.sort((a, b) => byId.get(a).x - byId.get(b).x || a.localeCompare(b));
    return { byId, children, parentOf };
}

function layoutSubtree(rootId, origin, tree, visited, placed) {
    const { byId, children } = tree;
    const measure = (id, seen) => {
        if (seen.has(id)) return 0;
        seen.add(id);
        const own = byId.get(id).width;
        const kids = children.get(id).filter((child) => !seen.has(child));
        if (!kids.length) return own;
        const widths = kids.map((child) => measure(child, seen));
        return Math.max(own, widths.reduce((sum, value) => sum + value, 0) + PISI_MAP_LAYOUT_GAP_X * (kids.length - 1));
    };
    const place = (id, left, top) => {
        if (visited.has(id)) return 0;
        visited.add(id);
        const rect = byId.get(id);
        const kids = children.get(id).filter((child) => !visited.has(child));
        const widths = kids.map((child) => measure(child, new Set(visited)));
        const childrenWidth = widths.reduce((sum, value) => sum + value, 0) + PISI_MAP_LAYOUT_GAP_X * Math.max(0, kids.length - 1);
        const width = Math.max(rect.width, childrenWidth);
        placed.set(id, { ...rect, x: Math.round(left + width / 2 - rect.width / 2), y: Math.round(top) });
        let cursor = left + (width - childrenWidth) / 2;
        const rowTop = top + rect.height + PISI_MAP_LAYOUT_GAP_Y;
        kids.forEach((child, index) => {
            place(child, cursor, rowTop);
            cursor += widths[index] + PISI_MAP_LAYOUT_GAP_X;
        });
        return width;
    };
    return place(rootId, origin.x, origin.y);
}

/**
 * Lays out the subtree under `rootId`; the root stays where it is.
 * @returns {any[]} new rectangles of the subtree (root included)
 */
export function layoutPisiMapSubtree(rects = [], edges = [], rootId) {
    const items = rects.map(rectOf);
    const tree = buildChildren(items, edges);
    const root = tree.byId.get(String(rootId));
    if (!root) return [];
    const placed = new Map();
    layoutSubtree(root.id, { x: 0, y: root.y }, tree, new Set(), placed);
    // Shift so the root keeps its x.
    const shift = root.x - placed.get(root.id).x;
    return Array.from(placed.values()).map((rect) => ({ ...rect, x: rect.x + shift }));
}

/**
 * Lays out the whole map: trees left to right from the current top-left of
 * the map, then unconnected nodes in one row underneath.
 */
export function layoutPisiMapAll(rects = [], edges = []) {
    const items = rects.map(rectOf);
    if (!items.length) return [];
    const tree = buildChildren(items, edges);
    const originX = Math.min(...items.map((rect) => rect.x));
    const originY = Math.min(...items.map((rect) => rect.y));
    const hasEdges = new Set();
    for (const [parent, kids] of tree.children) {
        if (kids.length) {
            hasEdges.add(parent);
            kids.forEach((kid) => hasEdges.add(kid));
        }
    }
    const roots = items
        .filter((rect) => hasEdges.has(rect.id) && !tree.parentOf.has(rect.id))
        .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
    const placed = new Map();
    const visited = new Set();
    let cursor = originX;
    for (const root of roots) {
        cursor += layoutSubtree(root.id, { x: cursor, y: originY }, tree, visited, placed) + PISI_MAP_LAYOUT_GAP_X * 2;
    }
    // Nodes only reachable through a cycle have no root; start a tree at each.
    for (const rect of items) {
        if (hasEdges.has(rect.id) && !visited.has(rect.id)) {
            cursor += layoutSubtree(rect.id, { x: cursor, y: originY }, tree, visited, placed) + PISI_MAP_LAYOUT_GAP_X * 2;
        }
    }
    const treeBottom = placed.size ? Math.max(...Array.from(placed.values()).map((rect) => rect.y + rect.height)) + PISI_MAP_LAYOUT_GAP_Y : originY;
    let rowX = originX;
    for (const rect of items.filter((item) => !visited.has(item.id)).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))) {
        placed.set(rect.id, { ...rect, x: Math.round(rowX), y: Math.round(treeBottom) });
        rowX += rect.width + PISI_MAP_LAYOUT_GAP_X;
    }
    return items.map((rect) => placed.get(rect.id));
}
