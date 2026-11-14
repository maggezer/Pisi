// A bottom sheet that offers one choice out of a short list.

import { h } from './dom.mjs';

export function renderChoiceSheet({ id, title, options, selected, closeLabel, onSelect, onClose }) {
    const titleId = `${id}-title`;
    return h(
        'div',
        { class: 'pisi-sheet-backdrop', dataset: { sheet: id }, onClick: (event) => event.target === event.currentTarget && onClose() },
        h(
            'section',
            { class: 'pisi-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
            h('h2', { class: 'pisi-sheet-title', id: titleId }, title),
            h(
                'div',
                { class: 'pisi-sheet-options', role: 'radiogroup', 'aria-labelledby': titleId },
                options.map((option) =>
                    h(
                        'button',
                        {
                            type: 'button',
                            class: 'pisi-sheet-option',
                            role: 'radio',
                            'aria-checked': option.value === selected ? 'true' : 'false',
                            dataset: { value: option.value },
                            onClick: () => onSelect(option.value)
                        },
                        option.label
                    )
                )
            ),
            h('button', { type: 'button', class: 'pisi-button pisi-sheet-close', onClick: onClose }, closeLabel)
        )
    );
}
