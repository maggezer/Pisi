// A long list that draws only the rows near the visible part (docs/mobile-plan.md
// M7: 2,000 notes scroll smoothly). Every row has the same height, the CSS
// length `--pisi-virtual-row` (in rem, so it follows the text size). The list
// is as tall as all its rows; a row sits at its index times that height.

import { h } from './dom.mjs';

// Used when the layout cannot be measured (the list is not on screen yet).
const FALLBACK_ROW_PX = 88;
const FALLBACK_VIEW_PX = 800;

/**
 * `renderRow(item, index)` returns the content of one row. `overscan` is how
 * many rows beyond each edge are kept drawn. Call `attach(scroller)` once the
 * list is inside the element that scrolls.
 */
export function createVirtualList({ label, renderRow, overscan = 6 }) {
    const element = h('ul', { class: 'pisi-virtual', 'aria-label': label });
    const probe = h('li', { class: 'pisi-virtual-row pisi-virtual-probe', 'aria-hidden': 'true' });
    const drawn = new Map();
    let items = [];
    let scroller = null;
    let observer = null;
    let frame = null;
    let rowHeight = FALLBACK_ROW_PX;

    function measure() {
        element.append(probe);
        rowHeight = probe.getBoundingClientRect().height || FALLBACK_ROW_PX;
        probe.remove();
    }

    function draw() {
        frame = null;
        const view = scroller?.getBoundingClientRect();
        const viewHeight = view?.height || FALLBACK_VIEW_PX;
        // How far the top of the list has scrolled above the top of the scroller.
        const above = view ? Math.max(0, view.top - element.getBoundingClientRect().top) : 0;
        const first = Math.max(0, Math.floor(above / rowHeight) - overscan);
        const last = Math.min(items.length, Math.ceil((above + viewHeight) / rowHeight) + overscan);

        for (const [index, row] of drawn) {
            if (index >= first && index < last && row.item === items[index]) continue;
            row.element.remove();
            drawn.delete(index);
        }
        for (let index = first; index < last; index += 1) {
            if (drawn.has(index)) continue;
            const row = h(
                'li',
                { class: 'pisi-virtual-row', style: `--pisi-virtual-index:${index}`, 'aria-setsize': items.length, 'aria-posinset': index + 1 },
                renderRow(items[index], index)
            );
            drawn.set(index, { item: items[index], element: row });
            element.append(row);
        }
    }

    function schedule() {
        const view = element.ownerDocument.defaultView;
        if (frame !== null || !view?.requestAnimationFrame) return frame === null && draw();
        frame = view.requestAnimationFrame(draw);
    }

    const refresh = () => {
        measure();
        draw();
    };

    return {
        element,

        /** Replaces the rows. A row whose item is the same object as before is kept as it is drawn. */
        setItems(next) {
            items = next;
            element.style.setProperty('--pisi-virtual-count', String(items.length));
            draw();
        },

        /** The list is in the document, inside `scroller`: it can be measured and follows the scrolling. */
        attach(next) {
            if (scroller !== next) {
                scroller?.removeEventListener('scroll', schedule);
                scroller = next;
                scroller?.addEventListener('scroll', schedule, { passive: true });
                observer?.disconnect();
                const Observer = globalThis.ResizeObserver;
                // The row height follows the text size and the visible part follows the window (and the keyboard).
                if (Observer && scroller) {
                    observer = new Observer(refresh);
                    observer.observe(scroller);
                    observer.observe(element);
                }
            }
            refresh();
        },

        /** Rows currently drawn, for tests. */
        getDrawnCount: () => drawn.size,

        destroy() {
            scroller?.removeEventListener('scroll', schedule);
            observer?.disconnect();
            scroller = null;
        }
    };
}
