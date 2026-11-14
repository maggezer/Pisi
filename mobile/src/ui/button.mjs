// Buttons: text buttons in four kinds, icon-only buttons and the floating action button.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

export const PISI_BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'text', 'danger']);

export function renderButton({ label, variant = 'secondary', icon: iconName = null, block = false, disabled = false, dataset = null, onClick }) {
    if (!PISI_BUTTON_VARIANTS.includes(variant)) throw new Error(`Unknown button variant: ${variant}`);
    return h(
        'button',
        { type: 'button', class: `pisi-button pisi-button-${variant}${block ? ' pisi-button-block' : ''}`, disabled, dataset, onClick },
        iconName ? icon(iconName) : null,
        h('span', { class: 'pisi-button-label' }, label)
    );
}

/** A button that shows only an icon. `label` is its accessible name and is required. */
export function renderIconButton({ icon: iconName, label, disabled = false, dataset = null, onClick }) {
    if (!label) throw new Error('An icon button needs an accessible name.');
    return h('button', { type: 'button', class: 'pisi-icon-button', 'aria-label': label, disabled, dataset, onClick }, icon(iconName));
}

/** Floating action button. With `extended` the label is shown next to the icon; it is the accessible name either way. */
export function renderFab({ icon: iconName = 'plus', label, extended = false, dataset = null, onClick }) {
    if (!label) throw new Error('A floating action button needs an accessible name.');
    return h(
        'button',
        { type: 'button', class: `pisi-fab${extended ? ' pisi-fab-extended' : ''}`, 'aria-label': extended ? null : label, dataset, onClick },
        icon(iconName),
        extended ? h('span', { class: 'pisi-fab-label' }, label) : null
    );
}
