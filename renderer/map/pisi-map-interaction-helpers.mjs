// Port direction, offset and distance come from shared/map-view.mjs (the mobile map viewer uses them too).
export { getDistance, getPortDirection, offsetPoint } from '../../shared/map-view.mjs';

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
