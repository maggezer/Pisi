// The "add task" line of the Pisi tab and the quick add of the Tasks tab: one
// text field that takes Turkish natural language, and under it the chips that
// show how the line was read before it is saved. It is built once, so what is
// being typed survives the redraws around it.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

/**
 * `describe(text)` returns the chips for what has been typed, or []. A chip is
 * `{ kind, text, icon? }`; with `onClick` (and `label`, its accessible name) it
 * is a button that changes the draft, e.g. the priority.
 */
export function createTaskAddRow({ t, id = 'pisi-task-add', describe, onSubmit }) {
    const input = h('input', {
        type: 'text',
        id,
        class: 'pisi-task-add-input',
        placeholder: t('pisi.addTask'),
        'aria-label': t('pisi.addTask'),
        'aria-describedby': `${id}-chips`,
        autocomplete: 'off',
        autocapitalize: 'sentences',
        enterkeyhint: 'done',
        dataset: { action: 'add-task-input' }
    });
    const submit = h(
        'button',
        { type: 'submit', class: 'pisi-task-add-submit', 'aria-label': t('pisi.addTaskSubmit'), disabled: true, dataset: { action: 'add-task' } },
        icon('check')
    );
    const chips = h('div', { class: 'pisi-task-add-chips', id: `${id}-chips`, 'aria-live': 'polite', hidden: true });
    const form = h(
        'form',
        { class: 'pisi-task-add', novalidate: true },
        h('div', { class: 'pisi-task-add-line' }, h('span', { class: 'pisi-task-add-icon' }, icon('plus')), input, submit),
        chips
    );

    function renderChip(item) {
        const chip = h('span', { class: 'pisi-parse-chip', dataset: item.onClick ? null : { chip: item.kind } }, item.icon ? icon(item.icon) : null, item.text);
        if (!item.onClick) return chip;
        chip.append(icon('chevron-down'));
        return h(
            'button',
            {
                type: 'button',
                class: 'pisi-parse-action',
                'aria-label': item.label,
                'aria-haspopup': 'dialog',
                dataset: { chip: item.kind },
                onClick: item.onClick
            },
            chip
        );
    }

    function refresh() {
        const items = input.value.trim() ? describe(input.value) : [];
        submit.disabled = !input.value.trim() || input.readOnly;
        chips.replaceChildren(...items.map(renderChip));
        chips.hidden = !items.length;
    }

    input.addEventListener('input', refresh);
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || input.readOnly) return;
        input.value = '';
        refresh();
        onSubmit(text);
    });

    return {
        element: form,
        input,
        refresh,
        setReadOnly(readOnly) {
            input.readOnly = readOnly;
            refresh();
        }
    };
}
