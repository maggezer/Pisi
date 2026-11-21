import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { parsePisiTurkishDateExpression } from '../../shared/date-parser.mjs';
import { PISI_TODO_REPEAT_OPTIONS } from '../../shared/task-model.mjs';
import { getPisiQuickAddDay, getPisiQuickAddRepeat, readPisiQuickAddTask } from './pisi-task-panel-core.mjs';
import {
    formatPisiTaskPanelDay,
    listPisiTaskNoteChoices,
    loadPisiTaskNoteTitles,
    makePisiTaskPanelElement,
    makePisiTaskPanelSelect,
    pisiTaskPanelText as t
} from './pisi-task-panel-dom.mjs';
import { PISI_TASK_REMINDER_MODE_LABELS } from './pisi-task-view.mjs';

// Quick Add (docs/task-plan.md §1.3, §1.4, G4.5): one form and one
// task.create.v1. The fields are the title, a Turkish date expression with its
// preview (the day becomes `dueDate`, the time `dueTime`; no date, no day),
// the priority, the target (the open note the user worked in last, else
// today's diary; another note can be chosen), the repeat (filled from the
// expression until the user picks one) and the reminder. There is no
// observer and no wrapper around domain.command.

const pisiQuickAddState = { modal: null, openSequence: 0, returnFocus: null };

function makePisiQuickAddField(labelText, control) {
    const label = makePisiTaskPanelElement('label', 'pisi-quick-field');
    label.dataset.field = control.name || '';
    label.append(makePisiTaskPanelElement('span', '', t(labelText)), control);
    return label;
}

function makePisiQuickAddInput(type, name, placeholder = '') {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    if (placeholder) input.placeholder = t(placeholder);
    return input;
}

function getPisiQuickAddRepeatLabel(value) {
    return t(PISI_TODO_REPEAT_OPTIONS.find((option) => option.value === value)?.label || 'Tekrarlama yok');
}

/** Shows what the date expression gives and returns the parse. */
function renderPisiQuickAddPreview(container, expression) {
    const parsed = parsePisiTurkishDateExpression(expression);
    const { dueDate, dueTime } = getPisiQuickAddDay(parsed);
    const parts = [];
    if (dueDate) parts.push(`${t('Gün')}: ${[formatPisiTaskPanelDay(dueDate), dueTime].filter(Boolean).join(' ')}`);
    if (parsed.repeat !== 'none') parts.push(`${t('Tekrar')}: ${getPisiQuickAddRepeatLabel(parsed.repeat)}`);
    if (parsed.reminderAt) parts.push(`${t('Hatırlatma')}: ${formatPisiTaskPanelDay(parsed.reminderAt.slice(0, 10))} ${parsed.reminderAt.slice(11, 16)}`);
    container.textContent = parts.join(' · ') || t(String(expression || '').trim() ? 'Tarih ifadesi algılanmadı.' : 'Tarih yok: görev tarihsiz eklenir.');
    container.classList.toggle('empty', !parts.length);
    return parsed;
}

/** The place the form names: the last open note, today's diary or another note (`note:<id>:<path>`). */
function readPisiQuickAddTarget(value, lastNote) {
    if (value === 'last' && lastNote) return lastNote.diaryDate ? { diaryDate: lastNote.diaryDate } : { noteId: lastNote.noteId, notePath: lastNote.path };
    const match = /^note:([^:]+):(.+)$/.exec(String(value || ''));
    if (match) return { noteId: match[1], notePath: match[2] };
    return { diaryDate: window.getPisiTaskToday?.() };
}

function buildPisiQuickAddTargetSelect(lastNote) {
    const options = [];
    if (lastNote) options.push({ value: 'last', label: `${t('Açık not')}: ${lastNote.title || lastNote.path.split(/[\\/]/).pop()}` });
    options.push({ value: 'today', label: t('Bugünün günlüğü') });
    for (const note of listPisiTaskNoteChoices()) {
        if (lastNote && note.id === lastNote.noteId) continue;
        options.push({ value: `note:${note.id}:${note.path}`, label: note.relativePath ? `${note.title} · ${note.relativePath}` : note.title });
    }
    const select = makePisiTaskPanelSelect('', t('Hedef'), options, lastNote ? 'last' : 'today');
    select.name = 'target';
    return select;
}

function buildPisiQuickAddForm(container, { lastNote = null, onCancel, onSuccess }) {
    const form = makePisiTaskPanelElement('form', 'pisi-quick-add-form');
    const text = makePisiQuickAddInput('text', 'text', 'Görev nedir?');
    text.required = true;
    text.maxLength = 500;
    const dateExpression = makePisiQuickAddInput('text', 'dateExpression', 'yarın 14:00, her pazartesi…');
    const preview = makePisiTaskPanelElement('div', 'pisi-date-parse-preview empty');
    preview.setAttribute('aria-live', 'polite');
    const priority = makePisiTaskPanelSelect(
        '',
        t('Öncelik'),
        [5, 4, 3, 2, 1].map((value) => ({ value, label: `${t('Öncelik')} ${value}` })),
        3
    );
    priority.name = 'priority';
    const target = buildPisiQuickAddTargetSelect(lastNote);
    const repeat = makePisiTaskPanelSelect(
        '',
        t('Tekrar'),
        PISI_TODO_REPEAT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
        'none'
    );
    repeat.name = 'repeat';
    const offset = makePisiQuickAddInput('number', 'completionOffsetDays');
    offset.min = '1';
    offset.max = '3650';
    offset.value = '1';
    const offsetField = makePisiQuickAddField('Tamamlandıktan sonra (gün)', offset);
    const reminder = makePisiTaskPanelSelect(
        '',
        t('Hatırlatma'),
        Object.entries(PISI_TASK_REMINDER_MODE_LABELS).map(([value, label]) => ({ value, label: t(label) })),
        'none'
    );
    reminder.name = 'reminderMode';
    let repeatChosen = false;
    const sync = () => {
        const parsed = renderPisiQuickAddPreview(preview, dateExpression.value);
        if (!repeatChosen) {
            const read = getPisiQuickAddRepeat(parsed);
            repeat.value = read.repeat;
            if (read.completionOffsetDays) offset.value = String(read.completionOffsetDays);
        }
        offsetField.hidden = repeat.value !== 'after-completion';
        reminder.disabled = !getPisiQuickAddDay(parsed).dueDate;
        return parsed;
    };
    dateExpression.addEventListener('input', sync);
    repeat.addEventListener('change', () => {
        repeatChosen = true;
        sync();
    });
    sync();

    const grid = makePisiTaskPanelElement('div', 'pisi-quick-add-grid');
    grid.append(
        makePisiQuickAddField('Görev', text),
        makePisiQuickAddField('Türkçe tarih', dateExpression),
        makePisiQuickAddField('Öncelik', priority),
        makePisiQuickAddField('Hedef', target),
        makePisiQuickAddField('Tekrar', repeat),
        offsetField,
        makePisiQuickAddField('Hatırlatma', reminder)
    );
    const submit = makePisiTaskPanelElement('button', 'pisi-primary-button pisi-quick-add-submit', t('Görevi ekle'));
    submit.type = 'submit';
    const cancel = makePisiTaskPanelElement('button', 'pisi-secondary-button pisi-quick-add-cancel', t('Vazgeç'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => onCancel?.());
    const status = makePisiTaskPanelElement('div', 'pisi-command-inline-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = makePisiTaskPanelElement('div', 'pisi-quick-add-actions');
    actions.append(status, cancel, submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const read = readPisiQuickAddTask(
            {
                title: text.value,
                priority: priority.value,
                repeat: repeat.value,
                completionOffsetDays: offset.value,
                reminderMode: reminder.disabled ? 'none' : reminder.value
            },
            sync()
        );
        if (read.error) {
            status.textContent = t('Görev metni boş olamaz.');
            text.focus();
            return;
        }
        submit.disabled = true;
        status.textContent = t('Kaydediliyor…');
        const result = await window.createPisiTaskInTarget?.(read.task, readPisiQuickAddTarget(target.value, lastNote));
        if (!result?.ok) {
            status.textContent = result?.error || t('Görev eklenemedi.');
            submit.disabled = false;
            return;
        }
        onSuccess?.(result);
    });
    form.append(grid, preview, actions);
    container.appendChild(form);
    queueMicrotask(() => text.focus());
    return form;
}

function closePisiQuickAddModal() {
    const modal = pisiQuickAddState.modal;
    if (!modal || modal.overlay.hidden) return false;
    pisiQuickAddState.openSequence += 1;
    modal.overlay.hidden = true;
    modal.body.removeAttribute('aria-busy');
    const focus = pisiQuickAddState.returnFocus;
    pisiQuickAddState.returnFocus = null;
    focus?.focus?.({ preventScroll: true });
    return true;
}

function handlePisiQuickAddKeydown(event) {
    const modal = pisiQuickAddState.modal;
    if (!modal || modal.overlay.hidden) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePisiQuickAddModal();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(modal.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')).filter(
        (element) => !element.hidden && element.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function ensurePisiQuickAddModal() {
    if (pisiQuickAddState.modal?.overlay?.isConnected) return pisiQuickAddState.modal;
    const overlay = makePisiTaskPanelElement('div', 'pisi-quick-add-overlay');
    overlay.id = 'pisi-quick-add-overlay';
    overlay.hidden = true;
    const dialog = makePisiTaskPanelElement('section', 'pisi-quick-add-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pisi-quick-add-title');
    const header = makePisiTaskPanelElement('header', 'pisi-quick-add-header');
    const heading = makePisiTaskPanelElement('div', 'pisi-quick-add-heading');
    const icon = makePisiTaskPanelElement('span', 'pisi-quick-add-heading-icon');
    icon.setAttribute('aria-hidden', 'true');
    const copy = makePisiTaskPanelElement('div');
    const title = makePisiTaskPanelElement('h2', '', t('Görev ekle'));
    title.id = 'pisi-quick-add-title';
    copy.append(title, makePisiTaskPanelElement('p', '', t('Son açık nota ya da bugünün günlüğüne hızlı görev ekler.')));
    heading.append(icon, copy);
    const close = makePisiTaskPanelElement('button', 'pisi-quick-add-close', '×');
    close.type = 'button';
    close.title = t('Kapat');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', closePisiQuickAddModal);
    header.append(heading, close);
    const body = makePisiTaskPanelElement('div', 'pisi-quick-add-body');
    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePisiQuickAddModal();
    });
    overlay.addEventListener('keydown', handlePisiQuickAddKeydown);
    document.body.appendChild(overlay);
    pisiQuickAddState.modal = { overlay, dialog, body, close };
    return pisiQuickAddState.modal;
}

/** Opens Quick Add. The target is read before the dialog takes the focus: the note the user was working in. */
async function openPisiQuickAddModal() {
    const modal = ensurePisiQuickAddModal();
    if (!modal.overlay.hidden) {
        modal.dialog.querySelector('input[name="text"]')?.focus();
        return true;
    }
    const sequence = ++pisiQuickAddState.openSequence;
    pisiQuickAddState.returnFocus = document.activeElement;
    const lastNote = window.getPisiLastFocusedNote?.() || null;
    modal.overlay.hidden = false;
    modal.body.setAttribute('aria-busy', 'true');
    if (!window.currentProjectFolder) {
        modal.body.replaceChildren(makePisiTaskPanelElement('div', 'pisi-quick-add-empty', t('Görev eklemek için önce bir proje klasörü seçin.')));
        modal.body.removeAttribute('aria-busy');
        modal.close.focus();
        return false;
    }
    modal.body.replaceChildren(makePisiTaskPanelElement('div', 'pisi-quick-add-loading', t('Yükleniyor…')));
    try {
        await loadPisiTaskNoteTitles();
        if (sequence !== pisiQuickAddState.openSequence || modal.overlay.hidden) return false;
        modal.body.replaceChildren();
        buildPisiQuickAddForm(modal.body, { lastNote, onCancel: closePisiQuickAddModal, onSuccess: closePisiQuickAddModal });
        modal.body.removeAttribute('aria-busy');
        return true;
    } catch (error) {
        if (sequence !== pisiQuickAddState.openSequence) return false;
        modal.body.replaceChildren(makePisiTaskPanelElement('div', 'pisi-quick-add-error', error?.message || t('Görev eklenemedi.')));
        modal.body.removeAttribute('aria-busy');
        modal.close.focus();
        return false;
    }
}

document.addEventListener('pisi:quick-add-requested', () => void openPisiQuickAddModal());
registerPisiCommand({
    id: 'pisi.quick-add',
    label: 'Görev ekle',
    description: 'Son açık nota ya da bugünün günlüğüne hızlı görev ekler.',
    category: 'Görevler',
    defaultShortcut: 'Mod+M',
    allowInInput: true,
    handler: openPisiQuickAddModal
});

const moduleApi = { pisiQuickAddState, openPisiQuickAddModal, closePisiQuickAddModal };

registerModule('tasks.quickAdd', moduleApi);

export { openPisiQuickAddModal, closePisiQuickAddModal };
