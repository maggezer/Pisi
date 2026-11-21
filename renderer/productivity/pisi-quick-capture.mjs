import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { ensurePisiSearchIndex } from '../search/pisi-search-index.mjs';
import { parsePisiTurkishDateExpression } from './pisi-date-parser.mjs';

// Quick Add (docs/task-plan.md §1.3, §1.4, G2 step 9): one task.create.v1. The
// target is the open note the user worked in last, else today's diary; the
// form shows it and lets the user pick another note. There is no Inbox. The
// Turkish date field gives the task's day (`dueDate`) and time (`dueTime`);
// without a date the task has none.

const pisiQuickCaptureState = {
    modal: null,
    modalOpenSequence: 0,
    modalReturnFocus: null
};

function pisiQuickTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiTaskMinutes(value) {
    const minutes = Number(value) || 0;
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} dk`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} sa ${remainder} dk` : `${hours} sa`;
}

function makePisiQuickField(labelText, control) {
    const label = document.createElement('label');
    label.className = 'pisi-quick-field';
    label.dataset.field = control.name || '';
    const caption = document.createElement('span');
    caption.textContent = pisiQuickTranslate(labelText);
    label.append(caption, control);
    return label;
}

function makePisiQuickInput(type, name, placeholder = '') {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    if (placeholder) input.placeholder = pisiQuickTranslate(placeholder);
    return input;
}

/** The task fields a Turkish date expression gives: `{ dueDate, dueTime, repeat, completionOffsetDays, reminderAt }`. */
function readPisiQuickAddDate(parsed) {
    const iso = String(parsed?.scheduledAt || parsed?.deadline || '');
    const dueDate = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
    const dueTime = dueDate && /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : null;
    const repeat = parsed?.repeat && parsed.repeat !== 'none' ? parsed.repeat : 'none';
    return {
        dueDate,
        dueTime,
        repeat,
        completionOffsetDays: repeat === 'after-completion' ? Number(parsed.completionOffsetDays) || 1 : null,
        reminderAt: parsed?.reminderAt && /T/.test(parsed.reminderAt) ? parsed.reminderAt : null
    };
}

function renderPisiDateParsePreview(container, expression) {
    const parsed = parsePisiTurkishDateExpression(expression);
    const fields = readPisiQuickAddDate(parsed);
    const parts = [];
    if (fields.dueDate) parts.push(`${pisiQuickTranslate('Gün')}: ${[fields.dueDate, fields.dueTime].filter(Boolean).join(' ')}`);
    if (parsed.repeat !== 'none') parts.push(`${pisiQuickTranslate('Tekrar')}: ${parsed.repeat}`);
    if (parsed.reminderAt) parts.push(`${pisiQuickTranslate('Hatırlatma')}: ${parsed.reminderAt}`);
    container.textContent = parts.join(' · ') || pisiQuickTranslate('Tarih ifadesi algılanmadı.');
    container.classList.toggle('empty', !parts.length);
    return parsed;
}

/** The place the form names: the last open note, today's diary or another note (`note:<id>:<path>`). */
function readPisiQuickAddTarget(value, lastNote) {
    if (value === 'today') return { diaryDate: window.getPisiTaskToday?.() };
    if (value === 'last' && lastNote) return lastNote.diaryDate ? { diaryDate: lastNote.diaryDate } : { noteId: lastNote.noteId, notePath: lastNote.path };
    const match = /^note:([^:]+):(.+)$/.exec(String(value || ''));
    if (match) return { noteId: match[1], notePath: match[2] };
    return { diaryDate: window.getPisiTaskToday?.() };
}

async function submitPisiQuickAdd(form, parsePreview, lastNote) {
    const data = new FormData(form);
    const parsed = renderPisiDateParsePreview(parsePreview, data.get('dateExpression'));
    const title = String(data.get('text') || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!title) throw new Error(pisiQuickTranslate('Görev metni boş olamaz.'));
    const date = readPisiQuickAddDate(parsed);
    const task = {
        title,
        priority: Number(data.get('priority')) || 3,
        dueDate: date.dueDate,
        dueTime: date.dueTime,
        repeat: date.repeat,
        completionOffsetDays: date.completionOffsetDays,
        reminderAt: date.reminderAt,
        durationMinutes: Number(data.get('durationMinutes')) || 0,
        actualMinutes: Number(data.get('actualMinutes')) || 0
    };
    const result = await window.createPisiTaskInTarget?.(task, readPisiQuickAddTarget(data.get('target'), lastNote));
    if (!result?.ok) throw new Error(result?.error || pisiQuickTranslate('Görev eklenemedi.'));
    form.reset();
    return result;
}

function buildPisiQuickAddForm(container, index, options = {}) {
    const form = document.createElement('form');
    form.className = 'pisi-quick-add-form';
    const text = makePisiQuickInput('text', 'text', 'Görev nedir?');
    text.required = true;
    const dateExpression = makePisiQuickInput('text', 'dateExpression', 'yarın 14:00, her pazartesi…');
    const parsePreview = document.createElement('div');
    parsePreview.className = 'pisi-date-parse-preview empty';
    renderPisiDateParsePreview(parsePreview, '');
    dateExpression.addEventListener('input', () => {
        renderPisiDateParsePreview(parsePreview, dateExpression.value);
    });

    const priority = document.createElement('select');
    priority.name = 'priority';
    for (let value = 5; value >= 1; value -= 1) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = `${pisiQuickTranslate('Öncelik')} ${value}`;
        option.selected = value === 3;
        priority.appendChild(option);
    }
    const lastNote = options.lastNote || null;
    const node = document.createElement('select');
    node.name = 'target';
    const addOption = (value, text) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        node.appendChild(option);
        return option;
    };
    if (lastNote) addOption('last', `${pisiQuickTranslate('Açık not')}: ${lastNote.title || lastNote.path.split(/[\\/]/).pop()}`);
    addOption('today', pisiQuickTranslate('Bugünün günlüğü'));
    for (const documentRecord of index?.documents?.values?.() || []) {
        const id = documentRecord.metadata?.id;
        if (!id || documentRecord.metadata?.diaryDate || (lastNote && id === lastNote.noteId)) continue;
        addOption(`note:${id}:${documentRecord.path}`, `${documentRecord.title} · ${documentRecord.relativePath}`);
    }
    node.value = lastNote ? 'last' : 'today';
    const duration = makePisiQuickInput('number', 'durationMinutes');
    duration.min = '0';
    duration.max = '1440';
    duration.step = '5';
    const actual = makePisiQuickInput('number', 'actualMinutes');
    actual.min = '0';
    actual.max = '100000';
    actual.step = '5';

    const grid = document.createElement('div');
    grid.className = 'pisi-quick-add-grid';
    grid.append(
        makePisiQuickField('Görev', text),
        makePisiQuickField('Türkçe tarih', dateExpression),
        makePisiQuickField('Öncelik', priority),
        makePisiQuickField('Hedef', node),
        makePisiQuickField('Tahmini süre (dk)', duration),
        makePisiQuickField('Gerçek süre (dk)', actual)
    );
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'pisi-primary-button pisi-quick-add-submit';
    submit.textContent = pisiQuickTranslate('Görevi ekle');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pisi-secondary-button pisi-quick-add-cancel';
    cancel.textContent = pisiQuickTranslate('Vazgeç');
    cancel.addEventListener('click', () => options.onCancel?.());
    const status = document.createElement('div');
    status.className = 'pisi-command-inline-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'pisi-quick-add-actions';
    actions.append(status, cancel, submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = pisiQuickTranslate('Kaydediliyor…');
        try {
            await submitPisiQuickAdd(form, parsePreview, lastNote);
            options.onSuccess?.();
        } catch (error) {
            status.textContent = error.message;
            submit.disabled = false;
        }
    });
    form.append(grid, parsePreview, actions);
    container.appendChild(form);
    queueMicrotask(() => text.focus());
    return form;
}

function closePisiQuickAddModal() {
    const state = pisiQuickCaptureState.modal;
    if (!state || state.overlay.hidden) return false;
    pisiQuickCaptureState.modalOpenSequence += 1;
    state.overlay.hidden = true;
    state.body.removeAttribute('aria-busy');
    const returnFocus = pisiQuickCaptureState.modalReturnFocus;
    pisiQuickCaptureState.modalReturnFocus = null;
    returnFocus?.focus?.({ preventScroll: true });
    return true;
}

function getPisiQuickAddFocusableElements(dialog) {
    return Array.from(
        dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    ).filter((element) => !element.hidden && element.offsetParent !== null);
}

function handlePisiQuickAddModalKeydown(event) {
    const state = pisiQuickCaptureState.modal;
    if (!state || state.overlay.hidden) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePisiQuickAddModal();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getPisiQuickAddFocusableElements(state.dialog);
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
    if (pisiQuickCaptureState.modal?.overlay?.isConnected) {
        return pisiQuickCaptureState.modal;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pisi-quick-add-overlay';
    overlay.className = 'pisi-quick-add-overlay';
    overlay.hidden = true;

    const dialog = document.createElement('section');
    dialog.className = 'pisi-quick-add-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pisi-quick-add-title');

    const header = document.createElement('header');
    header.className = 'pisi-quick-add-header';
    const heading = document.createElement('div');
    heading.className = 'pisi-quick-add-heading';
    const icon = document.createElement('span');
    icon.className = 'pisi-quick-add-heading-icon';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'pisi-quick-add-title';
    title.textContent = pisiQuickTranslate('Görev ekle');
    const description = document.createElement('p');
    description.textContent = pisiQuickTranslate('Son açık nota ya da bugünün günlüğüne hızlı görev ekler.');
    copy.append(title, description);
    heading.append(icon, copy);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-quick-add-close';
    close.textContent = '×';
    close.title = pisiQuickTranslate('Kapat');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', closePisiQuickAddModal);
    header.append(heading, close);

    const body = document.createElement('div');
    body.className = 'pisi-quick-add-body';
    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePisiQuickAddModal();
    });
    overlay.addEventListener('keydown', handlePisiQuickAddModalKeydown);
    document.body.appendChild(overlay);

    pisiQuickCaptureState.modal = { overlay, dialog, body, close };
    return pisiQuickCaptureState.modal;
}

async function openPisiQuickAddModal() {
    const state = ensurePisiQuickAddModal();
    if (!state.overlay.hidden) {
        state.dialog.querySelector('input[name="text"]')?.focus();
        return true;
    }
    const requestId = ++pisiQuickCaptureState.modalOpenSequence;
    pisiQuickCaptureState.modalReturnFocus = document.activeElement;
    // Read before the dialog takes the focus: the note the user was working in.
    const lastNote = window.getPisiLastFocusedNote?.() || null;
    state.overlay.hidden = false;
    state.body.setAttribute('aria-busy', 'true');
    state.body.replaceChildren();

    if (!window.currentProjectFolder) {
        const empty = document.createElement('div');
        empty.className = 'pisi-quick-add-empty';
        empty.textContent = pisiQuickTranslate('Görev eklemek için önce bir proje klasörü seçin.');
        state.body.replaceChildren(empty);
        state.body.removeAttribute('aria-busy');
        state.close.focus();
        return false;
    }

    const loading = document.createElement('div');
    loading.className = 'pisi-quick-add-loading';
    loading.textContent = pisiQuickTranslate('Yükleniyor…');
    state.body.appendChild(loading);

    try {
        const index = await ensurePisiSearchIndex();
        if (requestId !== pisiQuickCaptureState.modalOpenSequence || state.overlay.hidden) {
            return false;
        }
        state.body.replaceChildren();
        buildPisiQuickAddForm(state.body, index, {
            lastNote,
            onCancel: closePisiQuickAddModal,
            onSuccess: closePisiQuickAddModal
        });
        state.body.removeAttribute('aria-busy');
        return true;
    } catch (error) {
        if (requestId !== pisiQuickCaptureState.modalOpenSequence) return false;
        const failure = document.createElement('div');
        failure.className = 'pisi-quick-add-error';
        failure.textContent = error.message || pisiQuickTranslate('Görev eklenemedi.');
        state.body.replaceChildren(failure);
        state.body.removeAttribute('aria-busy');
        state.close.focus();
        return false;
    }
}

function initializePisiQuickCapture() {
    document.addEventListener('pisi:quick-add-requested', openPisiQuickAddModal);
    registerPisiCommand({
        id: 'pisi.quick-add',
        label: 'Görev ekle',
        description: 'Son açık nota ya da bugünün günlüğüne hızlı görev ekler.',
        category: 'Görevler',
        defaultShortcut: 'Mod+M',
        allowInInput: true,
        handler: openPisiQuickAddModal
    });
}

const moduleApi = {
    pisiQuickCaptureState,
    formatPisiTaskMinutes,
    openPisiQuickAddModal,
    closePisiQuickAddModal,
    initializePisiQuickCapture
};

registerModule('productivity.quickCapture', moduleApi);
initializePisiQuickCapture();

export { closePisiQuickAddModal, formatPisiTaskMinutes, openPisiQuickAddModal };
