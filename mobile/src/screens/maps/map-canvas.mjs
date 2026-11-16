// The drawn map: one world layer that the camera moves as a whole, holding
// the connections (one SVG) under the notes (one button each, at its layout).
// Panning and zooming change only the layer's transform, so a map of a few
// hundred notes moves without drawing anything again (docs/mobile-plan.md M9).
// Connections use the desktop's curve and arrows (shared/map-view.mjs).

import { makePisiMapConnectionPath } from '../../../../shared/map-view.mjs';
import { h } from '../../ui/dom.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The desktop's arrow: a triangle 7 stroke widths long, its base where the line ends.
const ARROW_END = 'M 0 -5 L 10 0 L 0 5 z';
const ARROW_START = 'M 0 -5 L -10 0 L 0 5 z';
export const PISI_MAP_EDGE_KINDS = Object.freeze({ 'down-hub': 'hub', stream: 'stream', 'co-level': 'peer' });

function svg(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    return element;
}

function marker(id, start, color = null) {
    const element = svg('marker', {
        id,
        viewBox: start ? '-10 -5 10 10' : '0 -5 10 10',
        refX: 0,
        refY: 0,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto',
        markerUnits: 'strokeWidth'
    });
    element.append(svg('path', { d: start ? ARROW_START : ARROW_END, class: color ? null : 'pisi-map-arrow', fill: color }));
    return element;
}

/**
 * Builds the world layer for a map read by MapRepo. `labels.node(note)` gives
 * a note button's accessible name; `onOpen(note)` is called when a note is
 * tapped (the viewer decides whether a gesture was a tap).
 */
export function renderMapWorld({ map, idPrefix, labels, onOpen }) {
    const visible = map.nodes.filter((note) => !note.hidden);
    const rects = new Map(visible.map((note) => [note.id, note.layout]));
    const defs = svg('defs');
    const markers = new Map();
    const markerFor = (kind, start, color) => {
        const key = `${kind}-${start ? 'start' : 'end'}-${color ?? ''}`;
        if (!markers.has(key)) {
            const id = `${idPrefix}-arrow-${markers.size}`;
            const element = marker(id, start, color);
            element.dataset.kind = kind;
            defs.append(element);
            markers.set(key, id);
        }
        return `url(#${markers.get(key)})`;
    };

    const edges = svg('svg', { class: 'pisi-map-edges', 'aria-hidden': 'true', focusable: 'false', width: 1, height: 1 });
    edges.append(defs);
    let drawnEdges = 0;
    for (const edge of map.edges) {
        const source = rects.get(edge.sourceId);
        const target = rects.get(edge.targetId);
        if (edge.hidden || !source || !target) continue;
        const kind = PISI_MAP_EDGE_KINDS[edge.type] ?? 'hub';
        const color = edge.customization?.color ?? null;
        const path = svg('path', {
            class: `pisi-map-edge pisi-map-edge-${kind}`,
            d: makePisiMapConnectionPath(source, edge.sourcePort, target, edge.targetPort, edge.type),
            'marker-end': markerFor(kind, false, color),
            'marker-start': edge.type === 'co-level' ? markerFor(kind, true, color) : null
        });
        // A colour the map gives this connection wins over the colour of its kind.
        if (color) path.style.stroke = color;
        path.dataset.edge = edge.id;
        edges.append(path);
        drawnEdges += 1;
    }

    // Notes in reading order (top to bottom, then left to right), so a screen reader walks the map as it looks.
    const ordered = [...visible].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
    const notes = ordered.map((note) => {
        const hidden = map.hubCounts.get(note.id) ?? 0;
        const button = h(
            'button',
            {
                type: 'button',
                class: `pisi-map-node${note.customization.cardColor ? ' pisi-map-node-colored' : ''}`,
                'aria-label': labels.node(note, hidden),
                dataset: { node: note.id },
                onClick: () => onOpen(note)
            },
            h('span', { class: 'pisi-map-node-title' }, note.title || labels.untitled),
            note.preview ? h('span', { class: 'pisi-map-node-preview' }, note.preview) : null,
            hidden ? h('span', { class: 'pisi-map-node-hub', 'aria-hidden': 'true' }, `+${hidden}`) : null
        );
        const { x, y, width, height } = note.layout;
        button.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
        if (note.customization.cardColor) button.style.setProperty('--pisi-map-card-accent', note.customization.cardColor);
        return button;
    });

    const element = h('div', { class: 'pisi-map-world' }, edges, notes);
    return { element, nodeCount: notes.length, edgeCount: drawnEdges };
}
