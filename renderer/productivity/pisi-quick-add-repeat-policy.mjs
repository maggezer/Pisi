import { registerModule } from '../core/module-registry.mjs';
import { ensurePisiSearchIndex } from '../search/pisi-search-index.mjs';
import { PISI_TODO_REPEAT_OPTIONS, getPisiTodoRepeatOption } from '../tags/pisi-todo-utils.mjs';

const pisiQuickAddRepeatPolicyState = {
    observer: null,
    originalDomainCommand: null,
    pendingRepeat: null,
    pendingDate: null
};

function pisiQuickAddRepeatTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiQuickAddPath(value) {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .toLowerCase();
}

/** @param {Document | Element | Node} [root] */
function removePisiTodoCardRepeatControls(root = document) {
    /** @type {Element[]} */
    const controls = [];
    if (root instanceof Element && root.matches('.pisi-mission-repeat')) {
        controls.push(root);
    }
    root?.querySelectorAll?.('.pisi-mission-repeat').forEach((control) => controls.push(control));

    controls.forEach((control) => {
        const actions = control.closest('.pisi-mission-second-actions');
        control.remove();
        if (actions && !actions.children.length) actions.remove();
    });

    return controls.length;
}

function makePisiQuickAddDateField(form) {
    if (!form) return null;

    form.querySelector('input[name="dateExpression"]')?.closest('.pisi-quick-field')?.remove();
    form.querySelector('.pisi-date-parse-preview')?.remove();

    const existing = form.querySelector('input[name="pisiDate"]');
    if (existing) return existing.closest('.pisi-quick-field');

    const date = document.createElement('input');
    date.type = 'date';
    date.name = 'pisiDate';
    date.setAttribute('aria-label', pisiQuickAddRepeatTranslate('Tarih'));

    const field = document.createElement('label');
    field.className = 'pisi-quick-field';
    field.dataset.field = 'pisiDate';
    const caption = document.createElement('span');
    caption.textContent = pisiQuickAddRepeatTranslate('Tarih');
    field.append(caption, date);

    const grid = form.querySelector('.pisi-quick-add-grid');
    const taskField = grid?.querySelector('.pisi-quick-field[data-field="text"]');
    if (taskField) taskField.after(field);
    else grid?.prepend(field);
    return field;
}

async function relabelPisiQuickAddNodeOptions(form) {
    const select = form?.querySelector?.('select[name="nodePath"]');
    if (!select) return false;

    let index;
    try {
        index = await ensurePisiSearchIndex();
    } catch {
        return false;
    }

    const documents = Array.from(index?.documents?.values?.() || []);
    const byPath = new Map(documents.map((record) => [normalizePisiQuickAddPath(record.path), record]));

    for (const option of Array.from(select.options || [])) {
        if (!option.value) {
            option.textContent = pisiQuickAddRepeatTranslate('Node seçilmezse Inbox');
            continue;
        }
        const record = byPath.get(normalizePisiQuickAddPath(option.value));
        if (!record) continue;

        const mapNames = Array.from(new Set((record.memberships || []).map((membership) => String(membership?.mapTitle || '').trim()).filter(Boolean)));
        const mapLabel = mapNames.length ? mapNames.join(' / ') : pisiQuickAddRepeatTranslate('Inbox');
        const nodeLabel = String(record.title || '').trim() || pisiQuickAddRepeatTranslate('Node');
        option.textContent = `${mapLabel} — ${nodeLabel}`;
    }
    return true;
}

function bindPisiQuickAddPolicySubmission(form, repeatSelect) {
    if (!form || form.dataset.pisiQuickAddPolicyBound === 'true') return false;
    form.dataset.pisiQuickAddPolicyBound = 'true';
    form.addEventListener(
        'submit',
        () => {
            pisiQuickAddRepeatPolicyState.pendingRepeat = getPisiTodoRepeatOption(repeatSelect?.value).value;
            pisiQuickAddRepeatPolicyState.pendingDate = String(form.querySelector('input[name="pisiDate"]')?.value || '').trim() || null;
        },
        { capture: true }
    );
    return true;
}

function makePisiQuickAddRepeatField(form) {
    if (!form) return null;

    form.querySelector('input[name="durationMinutes"]')?.closest('.pisi-quick-field')?.remove();
    form.querySelector('input[name="actualMinutes"]')?.closest('.pisi-quick-field')?.remove();

    makePisiQuickAddDateField(form);
    void relabelPisiQuickAddNodeOptions(form);

    let select = form.querySelector('select[name="pisiRepeat"]');
    let field = select?.closest('.pisi-quick-field') || null;
    if (!select) {
        select = document.createElement('select');
        select.name = 'pisiRepeat';
        select.setAttribute('aria-label', pisiQuickAddRepeatTranslate('Tekrarlama'));

        for (const repeatOption of PISI_TODO_REPEAT_OPTIONS) {
            const option = document.createElement('option');
            option.value = repeatOption.value;
            option.textContent = pisiQuickAddRepeatTranslate(repeatOption.label);
            option.selected = repeatOption.value === 'none';
            select.appendChild(option);
        }

        field = document.createElement('label');
        field.className = 'pisi-quick-field';
        field.dataset.field = 'pisiRepeat';
        const caption = document.createElement('span');
        caption.textContent = pisiQuickAddRepeatTranslate('Tekrarlama');
        field.append(caption, select);

        const grid = form.querySelector('.pisi-quick-add-grid');
        const nodeField = grid?.querySelector('.pisi-quick-field[data-field="nodePath"]');
        if (nodeField) nodeField.after(field);
        else grid?.appendChild(field);
    }

    bindPisiQuickAddPolicySubmission(form, select);
    return field;
}

/** @param {Document | Element | Node} [root] */
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
        if (name !== 'task.capture.v1' || pisiQuickAddRepeatPolicyState.pendingRepeat === null) {
            return originalCommand(name, payload);
        }

        const repeat = pisiQuickAddRepeatPolicyState.pendingRepeat;
        const scheduledAt = pisiQuickAddRepeatPolicyState.pendingDate;
        pisiQuickAddRepeatPolicyState.pendingRepeat = null;
        pisiQuickAddRepeatPolicyState.pendingDate = null;
        return originalCommand(name, {
            ...payload,
            task: {
                ...(payload.task || {}),
                scheduledAt,
                deadline: null,
                reminderAt: null,
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
    makePisiQuickAddDateField,
    makePisiQuickAddRepeatField,
    patchPisiQuickAddRepeatCommand,
    relabelPisiQuickAddNodeOptions,
    removePisiTodoCardRepeatControls,
    state: pisiQuickAddRepeatPolicyState
});

export {
    enhancePisiQuickAddRepeatUi,
    initializePisiQuickAddRepeatPolicy,
    makePisiQuickAddDateField,
    makePisiQuickAddRepeatField,
    patchPisiQuickAddRepeatCommand,
    relabelPisiQuickAddNodeOptions,
    removePisiTodoCardRepeatControls
};
