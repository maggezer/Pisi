import { registerModule } from "../core/module-registry.mjs";
import { PISI_TODO_REPEAT_OPTIONS, getPisiTodoRepeatOption } from "../tags/pisi-todo-utils.mjs";

const pisiQuickAddRepeatPolicyState = {
    observer: null,
    originalDomainCommand: null,
    pendingRepeat: null
};

function pisiQuickAddRepeatTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function removePisiTodoCardRepeatControls(root = document) {
    const controls = [];
    if (root?.matches?.('.pisi-mission-repeat')) controls.push(root);
    root?.querySelectorAll?.('.pisi-mission-repeat').forEach((control) => controls.push(control));

    controls.forEach((control) => {
        const actions = control.closest('.pisi-mission-second-actions');
        control.remove();
        if (actions && !actions.children.length) actions.remove();
    });

    return controls.length;
}

function makePisiQuickAddRepeatField(form) {
    if (!form || form.querySelector('select[name="pisiRepeat"]')) return null;

    form.querySelector('input[name="durationMinutes"]')
        ?.closest('.pisi-quick-field')
        ?.remove();
    form.querySelector('input[name="actualMinutes"]')
        ?.closest('.pisi-quick-field')
        ?.remove();

    const select = document.createElement('select');
    select.name = 'pisiRepeat';
    select.setAttribute('aria-label', pisiQuickAddRepeatTranslate('Tekrarlama'));

    for (const repeatOption of PISI_TODO_REPEAT_OPTIONS) {
        const option = document.createElement('option');
        option.value = repeatOption.value;
        option.textContent = pisiQuickAddRepeatTranslate(repeatOption.label);
        option.selected = repeatOption.value === 'none';
        select.appendChild(option);
    }

    const field = document.createElement('label');
    field.className = 'pisi-quick-field';
    field.dataset.field = 'pisiRepeat';
    const caption = document.createElement('span');
    caption.textContent = pisiQuickAddRepeatTranslate('Tekrarlama');
    field.append(caption, select);

    const grid = form.querySelector('.pisi-quick-add-grid');
    const nodeField = grid?.querySelector('.pisi-quick-field[data-field="nodePath"]');
    if (nodeField) nodeField.after(field);
    else grid?.appendChild(field);

    form.addEventListener('submit', () => {
        pisiQuickAddRepeatPolicyState.pendingRepeat = getPisiTodoRepeatOption(select.value).value;
    }, { capture: true });

    return field;
}

function enhancePisiQuickAddRepeatUi(root = document) {
    const forms = [];
    if (root?.matches?.('.pisi-quick-add-form')) forms.push(root);
    root?.querySelectorAll?.('.pisi-quick-add-form').forEach((form) => forms.push(form));
    forms.forEach(makePisiQuickAddRepeatField);
    removePisiTodoCardRepeatControls(root);
    return forms.length;
}

function patchPisiQuickAddRepeatCommand() {
    const domain = window.Pisi?.modules?.['domain.client'];
    if (!domain?.command || pisiQuickAddRepeatPolicyState.originalDomainCommand) return false;

    const originalCommand = domain.command.bind(domain);
    pisiQuickAddRepeatPolicyState.originalDomainCommand = originalCommand;

    domain.command = async (name, payload = {}) => {
        if (
            name !== 'task.capture.v1' ||
            pisiQuickAddRepeatPolicyState.pendingRepeat === null
        ) {
            return originalCommand(name, payload);
        }

        const repeat = pisiQuickAddRepeatPolicyState.pendingRepeat;
        pisiQuickAddRepeatPolicyState.pendingRepeat = null;
        return originalCommand(name, {
            ...payload,
            task: {
                ...(payload.task || {}),
                repeat,
                durationMinutes: 0,
                actualMinutes: 0
            }
        });
    };

    return true;
}

function initializePisiQuickAddRepeatPolicy() {
    patchPisiQuickAddRepeatCommand();
    enhancePisiQuickAddRepeatUi(document);

    if (!pisiQuickAddRepeatPolicyState.observer && document.body) {
        pisiQuickAddRepeatPolicyState.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node?.nodeType === Node.ELEMENT_NODE) {
                        enhancePisiQuickAddRepeatUi(node);
                    }
                });
            }
        });
        pisiQuickAddRepeatPolicyState.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiQuickAddRepeatPolicy, { once: true });
} else {
    initializePisiQuickAddRepeatPolicy();
}

registerModule('productivity.quickAddRepeatPolicy', {
    enhancePisiQuickAddRepeatUi,
    initializePisiQuickAddRepeatPolicy,
    makePisiQuickAddRepeatField,
    patchPisiQuickAddRepeatCommand,
    removePisiTodoCardRepeatControls,
    state: pisiQuickAddRepeatPolicyState
});

export {
    enhancePisiQuickAddRepeatUi,
    initializePisiQuickAddRepeatPolicy,
    makePisiQuickAddRepeatField,
    patchPisiQuickAddRepeatCommand,
    removePisiTodoCardRepeatControls
};
