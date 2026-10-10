import { isPisiHierarchyEdge } from './pisi-map-collapse-core.mjs';

export function getConnectionDataFromEvent(event) {
    // Ctrl / Cmd: denk bağlam
    if (event.ctrlKey || event.metaKey) {
        return {
            type: 'co-level',
            sourceRole: 'co-level',
            targetRole: 'co-level'
        };
    }

    // Alt: süreç ilişkisi
    if (event.altKey) {
        return {
            type: 'stream',
            sourceRole: 'downstream',
            targetRole: 'upstream'
        };
    }

    // Normal sürükleme: hiyerarşik ilişki
    return {
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    };
}

export function convertEdgeToStream(edge) {
    return {
        ...edge,
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    };
}

export function getConnectionClass(edgeOrType) {
    const type = typeof edgeOrType === 'string' ? edgeOrType : edgeOrType?.type;

    if (type === 'co-level' || type === 'colevel') return 'co-level';
    if (type === 'stream' || type === 'upstream' || type === 'downstream') return 'stream';

    return 'down-hub';
}

export function getPortDirection(port) {
    if (port === 'top') return { x: 0, y: -1 };
    if (port === 'right') return { x: 1, y: 0 };
    if (port === 'bottom') return { x: 0, y: 1 };
    if (port === 'left') return { x: -1, y: 0 };

    return { x: 1, y: 0 };
}

export function offsetPoint(point, direction, distance) {
    return {
        x: point.x + direction.x * distance,
        y: point.y + direction.y * distance
    };
}

export function getDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    return Math.sqrt(dx * dx + dy * dy);
}

export function getClientSelectionRect(startX, startY, currentX, currentY) {
    return {
        left: Math.min(startX, currentX),
        right: Math.max(startX, currentX),
        top: Math.min(startY, currentY),
        bottom: Math.max(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
        direction: currentX >= startX ? 'left-to-right' : 'right-to-left'
    };
}

export function rectsIntersect(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function rectContainsRect(outer, inner) {
    return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}
