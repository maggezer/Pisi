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

/** A horizontally scrolling row of chips. */
export function renderChipRow({ label, chips }) {
    return h('div', { class: 'pisi-chip-row', role: 'group', 'aria-label': label }, chips);
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
