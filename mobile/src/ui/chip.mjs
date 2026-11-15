// Chips (independent on/off filters) and the segmented control (one choice out of a few).

import { h } from './dom.mjs';

export function renderChip({ label, selected = false, count = null, dataset = null, onClick }) {
    return h(
        'button',
        { type: 'button', class: 'pisi-chip', 'aria-pressed': selected ? 'true' : 'false', dataset, onClick },
        h('span', { class: 'pisi-chip-label' }, label),
        count === null ? null : h('span', { class: 'pisi-chip-count' }, count)
    );
}

/**
 * Marks which edges of a chip row have more chips beyond them (`data-fade`:
 * none, start, end or both); the stylesheet fades those edges (G14).
 */
export function syncChipRowFade(row) {
    const hidden = row.scrollWidth - row.clientWidth;
    const atStart = row.scrollLeft <= 1;
    const atEnd = row.scrollLeft >= hidden - 1;
    row.dataset.fade = hidden <= 1 ? 'none' : atStart ? 'end' : atEnd ? 'start' : 'both';
}

/** A horizontally scrolling row of chips. An edge that hides more chips fades out. */
export function renderChipRow({ label, chips }) {
    const row = h('div', { class: 'pisi-chip-row', role: 'group', 'aria-label': label, dataset: { fade: 'none' } }, chips);
    const sync = () => syncChipRowFade(row);
    row.addEventListener('scroll', sync, { passive: true });
    // The row has no size until it is in the document, and its size changes with the window and the text size.
    const Observer = globalThis.ResizeObserver;
    if (Observer) new Observer(sync).observe(row);
    return row;
}

export function renderSegmented({ label, options, selected, onSelect }) {
    return h(
        'div',
        { class: 'pisi-segmented', role: 'radiogroup', 'aria-label': label },
        options.map((option) =>
            h(
                'button',
                {
                    type: 'button',
                    class: 'pisi-segment',
                    role: 'radio',
                    'aria-checked': option.value === selected ? 'true' : 'false',
                    dataset: { value: option.value },
                    onClick: () => option.value !== selected && onSelect(option.value)
                },
                option.label
            )
        )
    );
}
