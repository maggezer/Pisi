// Layers above the screen: bottom sheet, choice sheet and dialog.
// They only render; whoever opens one keeps its open state (the router's
// overlay list in the app) and closes it from onClose/onCancel. The Android
// back button reaches them through that same state.

import { renderButton, renderIconButton } from './button.mjs';
import { h } from './dom.mjs';

const closeOnBackdrop = (close) => (event) => event.target === event.currentTarget && close();

export function renderSheet({ id, title, children, closeLabel, onClose }) {
    const titleId = `${id}-title`;
    return h(
        'div',
        { class: 'pisi-backdrop pisi-backdrop-sheet', dataset: { sheet: id }, onClick: closeOnBackdrop(onClose) },
        h(
            'section',
            { class: 'pisi-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
            h('span', { class: 'pisi-sheet-grip', 'aria-hidden': 'true' }),
            h(
                'header',
                { class: 'pisi-sheet-header' },
                h('h2', { class: 'pisi-sheet-title', id: titleId }, title),
                renderIconButton({ icon: 'close', label: closeLabel, dataset: { action: 'close-sheet' }, onClick: onClose })
            ),
            children
        )
    );
}

/** A bottom sheet that offers one choice out of a short list. */
export function renderChoiceSheet({ id, title, options, selected, closeLabel, onSelect, onClose }) {
    return renderSheet({
        id,
        title,
        closeLabel,
        onClose,
        children: h(
            'div',
            { class: 'pisi-sheet-options', role: 'radiogroup', 'aria-labelledby': `${id}-title` },
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
                    h('span', { class: 'pisi-sheet-option-mark', 'aria-hidden': 'true' }),
                    h('span', { class: 'pisi-sheet-option-label' }, option.label)
                )
            )
        )
    });
}

/** A question that needs an answer. `danger` marks a confirm button that destroys something. */
export function renderDialog({ id, title, message = null, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }) {
    const titleId = `${id}-title`;
    const messageId = message ? `${id}-message` : null;
    return h(
        'div',
        { class: 'pisi-backdrop pisi-backdrop-dialog', dataset: { dialog: id }, onClick: closeOnBackdrop(onCancel) },
        h(
            'section',
            { class: 'pisi-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': messageId },
            h('h2', { class: 'pisi-dialog-title', id: titleId }, title),
            message ? h('p', { class: 'pisi-dialog-message', id: messageId }, message) : null,
            h(
                'div',
                { class: 'pisi-dialog-actions' },
                renderButton({ label: cancelLabel, variant: 'text', dataset: { action: 'cancel' }, onClick: onCancel }),
                renderButton({ label: confirmLabel, variant: danger ? 'danger' : 'primary', dataset: { action: 'confirm' }, onClick: onConfirm })
            )
        )
    );
}
