import { PISI_TODO_PRIORITY_OPTIONS, PISI_TODO_REPEAT_OPTIONS } from '../../shared/task-model.mjs';
import { PISI_TASK_REMINDER_MODE_LABELS, makePisiTaskView, pisiTaskViewTranslate } from './pisi-task-view.mjs';

// The small window a task chip opens (docs/task-plan.md G3.1): the due day and
// time, the priority, the repeat rule, the reminder, or a list of actions (the
// diary row menu). It reads the record and hands a patch back; it writes
// nothing itself. Escape or a click outside closes it.

const pisiTaskPopoverState = { element: null, anchor: null, onClose: null };

function closePisiTaskPopover({ restoreFocus = true } = {}) {
    const { element, onClose } = pisiTaskPopoverState;
    pisiTaskPopoverState.element = null;
    pisiTaskPopoverState.anchor = null;
    pisiTaskPopoverState.onClose = null;
    element?.remove();
    if (onClose) onClose({ restoreFocus });
}

function placePisiTaskPopover(element, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth || 240;
    const height = element.offsetHeight || 160;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
}

function makePisiTaskPopoverButton(label, onClick, { pressed = null, className = '' } = {}) {
    const button = makePisiTaskView('button', `pisi-task-popover-option ${className}`.trim(), label);
    button.type = 'button';
    if (pressed !== null) button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    button.addEventListener('click', onClick);
    return button;
}

function makePisiTaskPopoverInput(type, value, label) {
    const input = document.createElement('input');
    input.type = type;
    input.value = value || '';
    input.className = 'pisi-task-popover-input';
    input.setAttribute('aria-label', label);
    return input;
}

function buildPisiTaskDateBody(task, apply) {
    const body = makePisiTaskView('div', 'pisi-task-popover-body');
    const day = makePisiTaskPopoverInput('date', task.dueDate, pisiTaskViewTranslate('Tarih'));
    const time = makePisiTaskPopoverInput('time', task.dueTime, pisiTaskViewTranslate('Saat'));
    const row = makePisiTaskView('div', 'pisi-task-popover-row');
    row.append(day, time);
    const actions = makePisiTaskView('div', 'pisi-task-popover-actions');
    const done = () => apply({ dueDate: day.value || null, dueTime: day.value && time.value ? time.value : null });
    actions.append(
        makePisiTaskPopoverButton(pisiTaskViewTranslate('Temizle'), () => apply({ dueDate: null, dueTime: null })),
        makePisiTaskPopoverButton(pisiTaskViewTranslate('Tamam'), done, { className: 'pisi-task-popover-primary' })
    );
    for (const input of [day, time]) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                done();
            }
        });
    }
    body.append(row, actions);
    return { body, focus: day };
}

function buildPisiTaskPriorityBody(task, apply) {
    const body = makePisiTaskView('div', 'pisi-task-popover-body pisi-task-popover-list');
    for (const option of [...PISI_TODO_PRIORITY_OPTIONS].reverse()) {
        body.appendChild(
            makePisiTaskPopoverButton(`!${option.value} ${pisiTaskViewTranslate(option.label)}`, () => apply({ priority: option.value }), {
                pressed: Number(task.priority) === option.value
            })
        );
    }
    return { body, focus: body.querySelector('[aria-pressed="true"]') || body.firstElementChild };
}

function buildPisiTaskRepeatBody(task, apply) {
    const body = makePisiTaskView('div', 'pisi-task-popover-body pisi-task-popover-list');
    const days = makePisiTaskPopoverInput('number', String(task.completionOffsetDays || 1), pisiTaskViewTranslate('Gün'));
    days.min = '1';
    days.max = '3650';
    for (const option of PISI_TODO_REPEAT_OPTIONS) {
        const patch = () =>
            option.value === 'after-completion'
                ? { repeat: option.value, completionOffsetDays: Math.max(1, Math.min(3650, Number(days.value) || 1)) }
                : { repeat: option.value };
        body.appendChild(makePisiTaskPopoverButton(pisiTaskViewTranslate(option.label), () => apply(patch()), { pressed: task.repeat === option.value }));
    }
    const row = makePisiTaskView('label', 'pisi-task-popover-row');
    row.append(makePisiTaskView('span', 'pisi-task-popover-hint', pisiTaskViewTranslate('Tamamlandıktan sonra')), days);
    body.appendChild(row);
    return { body, focus: body.querySelector('[aria-pressed="true"]') || body.firstElementChild };
}

function buildPisiTaskReminderBody(task, apply) {
    const body = makePisiTaskView('div', 'pisi-task-popover-body pisi-task-popover-list');
    for (const [mode, label] of Object.entries(PISI_TASK_REMINDER_MODE_LABELS)) {
        body.appendChild(
            makePisiTaskPopoverButton(pisiTaskViewTranslate(label), () => apply({ reminderMode: mode, reminderAt: null }), {
                pressed: !task.reminderAt && (task.reminderMode || 'none') === mode
            })
        );
    }
    const at = makePisiTaskPopoverInput('datetime-local', task.reminderAt || '', pisiTaskViewTranslate('Belirli bir an'));
    const row = makePisiTaskView('div', 'pisi-task-popover-row');
    row.append(
        at,
        makePisiTaskPopoverButton(pisiTaskViewTranslate('Tamam'), () => apply({ reminderAt: at.value ? at.value.slice(0, 16) : null }), {
            className: 'pisi-task-popover-primary'
        })
    );
    body.appendChild(row);
    return { body, focus: body.querySelector('[aria-pressed="true"]') || body.firstElementChild };
}

function buildPisiTaskMenuBody(items) {
    const body = makePisiTaskView('div', 'pisi-task-popover-body pisi-task-popover-list');
    body.setAttribute('role', 'menu');
    for (const item of items) {
        const button = makePisiTaskPopoverButton(item.label, () => {
            closePisiTaskPopover({ restoreFocus: false });
            item.run();
        });
        button.setAttribute('role', 'menuitem');
        if (item.danger) button.classList.add('pisi-task-popover-danger');
        body.appendChild(button);
    }
    return { body, focus: body.firstElementChild };
}

/**
 * Opens the window of a chip (`kind`: date, priority, repeat, reminder) for
 * `task`, or a menu (`kind: 'menu'`, `items: [{ label, run, danger }]`).
 * `onPatch(patch)` gets the change; `onClose({ restoreFocus })` runs when it closes.
 */
/**
 * @param {HTMLElement} anchor
 * @param {{ kind: string, task?: any, items?: any[], onPatch?: (patch: any) => void, onClose?: ((options: { restoreFocus: boolean }) => void) | null }} options
 */
export function openPisiTaskPopover(anchor, { kind, task = null, items = [], onPatch = () => {}, onClose = null }) {
    closePisiTaskPopover({ restoreFocus: false });
    if (!anchor?.isConnected) return null;
    const apply = (patch) => {
        closePisiTaskPopover();
        onPatch(patch);
    };
    const builders = { date: buildPisiTaskDateBody, priority: buildPisiTaskPriorityBody, repeat: buildPisiTaskRepeatBody, reminder: buildPisiTaskReminderBody };
    const built = kind === 'menu' ? buildPisiTaskMenuBody(items) : builders[kind]?.(task, apply);
    if (!built) return null;
    const element = makePisiTaskView('div', 'pisi-task-popover');
    element.dataset.pisiTaskPopover = kind;
    element.setAttribute('role', kind === 'menu' ? 'presentation' : 'dialog');
    element.appendChild(built.body);
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePisiTaskPopover();
        }
    });
    document.body.appendChild(element);
    placePisiTaskPopover(element, anchor);
    pisiTaskPopoverState.element = element;
    pisiTaskPopoverState.anchor = anchor;
    pisiTaskPopoverState.onClose = onClose;
    built.focus?.focus?.({ preventScroll: true });
    return element;
}

export function isPisiTaskPopoverOpen() {
    return Boolean(pisiTaskPopoverState.element?.isConnected);
}

export { closePisiTaskPopover };

document.addEventListener(
    'mousedown',
    (event) => {
        const { element, anchor } = pisiTaskPopoverState;
        if (!element || element.contains(event.target) || anchor?.contains(event.target)) return;
        closePisiTaskPopover({ restoreFocus: false });
    },
    true
);
