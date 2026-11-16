// Form controls: text field, search field and checkbox.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

/**
 * A labelled single-line or multi-line text field. `hint` and `error` are tied
 * to the control with aria-describedby; an error also sets aria-invalid.
 */
export function renderTextField({ id, label, value = '', placeholder = null, hint = null, error = null, multiline = false, onInput = null }) {
    const noteId = hint || error ? `${id}-note` : null;
    const attributes = {
        id,
        class: 'pisi-field-input',
        placeholder,
        'aria-describedby': noteId,
        'aria-invalid': error ? 'true' : null,
        onInput: onInput ? (event) => onInput(event.target.value) : null
    };
    const control = multiline ? h('textarea', { ...attributes, rows: 3 }, value) : h('input', { ...attributes, type: 'text', value });
    return h(
        'div',
        { class: `pisi-field${error ? ' pisi-field-invalid' : ''}` },
        h('label', { class: 'pisi-field-label', for: id }, label),
        control,
        noteId ? h('p', { class: error ? 'pisi-field-error' : 'pisi-field-hint', id: noteId }, error || hint) : null
    );
}

/**
 * A search line: a magnifier, the input and, while there is text, a button
 * that clears it. `label` names the input for screen readers.
 */
export function renderSearchField({ id, label, placeholder = null, value = '', clearLabel, onInput }) {
    const input = h('input', {
        id,
        class: 'pisi-search-input',
        type: 'search',
        'aria-label': label,
        placeholder,
        value,
        enterkeyhint: 'search',
        autocomplete: 'off'
    });
    const clear = h(
        'button',
        { type: 'button', class: 'pisi-search-clear', 'aria-label': clearLabel, hidden: !value, dataset: { action: 'clear-search' } },
        icon('close')
    );
    const changed = () => {
        clear.hidden = !input.value;
        onInput(input.value);
    };
    input.addEventListener('input', changed);
    clear.addEventListener('click', () => {
        input.value = '';
        changed();
        input.focus();
    });
    return h('div', { class: 'pisi-search' }, icon('search'), input, clear);
}

/**
 * Checkbox: the visible box is 24 px, the button around it is at least 48 dp.
 * With a visible `text` the row is the label; without one `label` names the box.
 */
export function renderCheckbox({ checked = false, label, text = null, disabled = false, dataset = null, onChange }) {
    if (!label && !text) throw new Error('A checkbox needs an accessible name.');
    return h(
        'button',
        {
            type: 'button',
            class: 'pisi-checkbox',
            role: 'checkbox',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': text ? null : label,
            disabled,
            dataset,
            onClick: () => onChange(!checked)
        },
        h('span', { class: 'pisi-checkbox-box' }, checked ? icon('check') : null),
        text ? h('span', { class: 'pisi-checkbox-text' }, text) : null
    );
}
