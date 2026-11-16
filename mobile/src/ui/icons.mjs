// The icon set: Lucide (https://lucide.dev, ISC and MIT licences, see mobile/THIRD-PARTY-LICENSES.md).
// Only the icons the app uses are kept here, as inline SVG shapes copied from
// lucide-static 1.73.0. Icons are decorative: the control that holds one
// carries the accessible name.

const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPES = Object.freeze({
    // lucide: cat
    pisi: [
        [
            'path',
            {
                d: 'M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z'
            }
        ],
        ['path', { d: 'M8 14v.5' }],
        ['path', { d: 'M16 14v.5' }],
        ['path', { d: 'M11.25 16.25h1.5L12 17l-.75-.75Z' }]
    ],
    // lucide: list-todo
    tasks: [
        ['path', { d: 'M13 5h8' }],
        ['path', { d: 'M13 12h8' }],
        ['path', { d: 'M13 19h8' }],
        ['path', { d: 'm3 17 2 2 4-4' }],
        ['rect', { x: '3', y: '4', width: '6', height: '6', rx: '1' }]
    ],
    // lucide: file-text
    notes: [
        ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
        ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
        ['path', { d: 'M10 9H8' }],
        ['path', { d: 'M16 13H8' }],
        ['path', { d: 'M16 17H8' }]
    ],
    // lucide: calendar-days
    calendar: [
        ['path', { d: 'M8 2v3' }],
        ['path', { d: 'M16 2v3' }],
        ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
        ['path', { d: 'M3 9h18' }],
        ['path', { d: 'M8 13h.01' }],
        ['path', { d: 'M12 13h.01' }],
        ['path', { d: 'M16 13h.01' }],
        ['path', { d: 'M8 17h.01' }],
        ['path', { d: 'M12 17h.01' }],
        ['path', { d: 'M16 17h.01' }]
    ],
    // lucide: waypoints
    maps: [
        ['path', { d: 'm10.586 5.414-5.172 5.172' }],
        ['path', { d: 'm18.586 13.414-5.172 5.172' }],
        ['path', { d: 'M6 12h12' }],
        ['circle', { cx: '12', cy: '20', r: '2' }],
        ['circle', { cx: '12', cy: '4', r: '2' }],
        ['circle', { cx: '20', cy: '12', r: '2' }],
        ['circle', { cx: '4', cy: '12', r: '2' }]
    ],
    // lucide: settings
    settings: [
        [
            'path',
            {
                d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'
            }
        ],
        ['circle', { cx: '12', cy: '12', r: '3' }]
    ],
    // lucide: arrow-left
    back: [
        ['path', { d: 'm12 19-7-7 7-7' }],
        ['path', { d: 'M19 12H5' }]
    ],
    // lucide: x
    close: [
        ['path', { d: 'M18 6 6 18' }],
        ['path', { d: 'm6 6 12 12' }]
    ],
    // lucide: plus
    plus: [
        ['path', { d: 'M5 12h14' }],
        ['path', { d: 'M12 5v14' }]
    ],
    // lucide: check
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    // lucide: chevron-right
    'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
    // lucide: search
    search: [
        ['path', { d: 'm21 21-4.34-4.34' }],
        ['circle', { cx: '11', cy: '11', r: '8' }]
    ],
    // lucide: undo-2
    undo: [
        ['path', { d: 'M9 14 4 9l5-5' }],
        ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }]
    ],
    // lucide: menu
    menu: [
        ['path', { d: 'M4 5h16' }],
        ['path', { d: 'M4 12h16' }],
        ['path', { d: 'M4 19h16' }]
    ],
    // lucide: chevron-down
    'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
    // lucide: chevron-left
    'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
    // lucide: repeat
    repeat: [
        ['path', { d: 'm17 2 4 4-4 4' }],
        ['path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }],
        ['path', { d: 'm7 22-4-4 4-4' }],
        ['path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }]
    ],
    // lucide: clock
    clock: [
        ['circle', { cx: '12', cy: '12', r: '10' }],
        ['path', { d: 'M12 6v6l4 2' }]
    ],
    // lucide: inbox
    inbox: [
        ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
        ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }]
    ],
    // lucide: bold
    bold: [['path', { d: 'M6 12h9a4 4 0 010 8H7a1 1 0 01-1-1V5a1 1 0 011-1h7a4 4 0 010 8' }]],
    // lucide: italic
    italic: [
        ['line', { x1: '19', x2: '10', y1: '4', y2: '4' }],
        ['line', { x1: '14', x2: '5', y1: '20', y2: '20' }],
        ['line', { x1: '15', x2: '9', y1: '4', y2: '20' }]
    ],
    // lucide: heading
    heading: [
        ['path', { d: 'M18 20V4' }],
        ['path', { d: 'M6 12H18' }],
        ['path', { d: 'M6 20V4' }]
    ],
    // lucide: list
    'list-bullet': [
        ['path', { d: 'M3 5h.01' }],
        ['path', { d: 'M3 12h.01' }],
        ['path', { d: 'M3 19h.01' }],
        ['path', { d: 'M8 5h13' }],
        ['path', { d: 'M8 12h13' }],
        ['path', { d: 'M8 19h13' }]
    ],
    // lucide: list-ordered
    'list-number': [
        ['path', { d: 'M11 5h10' }],
        ['path', { d: 'M11 12h10' }],
        ['path', { d: 'M11 19h10' }],
        ['path', { d: 'M4 4h1v5' }],
        ['path', { d: 'M4 9h2' }],
        ['path', { d: 'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02' }]
    ],
    // lucide: monitor
    desktop: [
        ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
        ['line', { x1: '8', x2: '16', y1: '21', y2: '21' }],
        ['line', { x1: '12', x2: '12', y1: '17', y2: '21' }]
    ]
});

export const PISI_ICON_NAMES = Object.freeze(Object.keys(SHAPES));

export function icon(name) {
    const shapes = SHAPES[name];
    if (!shapes) throw new Error(`Unknown icon: ${name}`);
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attributes = {
        class: 'pisi-icon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false'
    };
    for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
    svg.dataset.icon = name;
    for (const [tag, shapeAttributes] of shapes) {
        const shape = document.createElementNS(SVG_NS, tag);
        for (const [key, value] of Object.entries(shapeAttributes)) shape.setAttribute(key, value);
        svg.append(shape);
    }
    return svg;
}
