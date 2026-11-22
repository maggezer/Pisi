import { registerModule } from '../core/module-registry.mjs';
import { PISI_TODO_PRIORITY_OPTIONS, PISI_TODO_REPEAT_OPTIONS, PISI_TODO_STATUS_OPTIONS, findPisiTaskDependencyCycle } from '../../shared/task-model.mjs';
import { getPisiTaskPlaceValue, readPisiTaskDetailPatch, readPisiTaskDetailPlace } from './pisi-task-panel-core.mjs';
import {
    ensurePisiTaskPanelStyle,
    findPisiTaskNotePath,
    formatPisiTaskPanelDay,
    getPisiTaskPlaceLabel,
    getPisiTaskStatusLabel,
    listPisiTaskNoteChoices,
    loadPisiTaskNoteTitles,
    createPisiTaskPanelButton,
    makePisiTaskPanelElement,
    makePisiTaskPanelSelect,
    pisiTaskPanelText as t
} from './pisi-task-panel-dom.mjs';
import { PISI_TASK_REMINDER_MODE_LABELS } from './pisi-task-view.mjs';

// The task detail window (docs/task-plan.md G4.3): every field of a task, its
// dependencies (a loop is refused before it is sent, with the rule the task
// service checks again), its place (task.move.v1), the "Tamamlanan günler"
// list of a repeating task and deleting the task. "Kaydet" sends one
// task.update.v1 with the changed fields, then task.move.v1 when the place
// changed. Nothing is written while the window is being edited.

const pisiTaskDetailState = { overlay: null, taskId: null, returnFocus: null, dependencies: [], completions: [] };

function makePisiTaskDetailField(labelText, control, name) {
    const label = makePisiTaskPanelElement('label', 'pisi-task-detail-field');
    label.dataset.field = name;
    label.append(makePisiTaskPanelElement('span', 'pisi-task-detail-label', t(labelText)), control);
    return label;
}

function makePisiTaskDetailInput(type, name, value) {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = value ?? '';
    return input;
}

function closePisiTaskDetail() {
    const overlay = pisiTaskDetailState.overlay;
    if (!overlay) return false;
    pisiTaskDetailState.overlay = null;
    pisiTaskDetailState.taskId = null;
    overlay.remove();
    const focus = pisiTaskDetailState.returnFocus;
    pisiTaskDetailState.returnFocus = null;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    return true;
}

function renderPisiTaskDependencyChips(container, task) {
    container.replaceChildren();
    if (!pisiTaskDetailState.dependencies.length) container.appendChild(makePisiTaskPanelElement('span', 'pisi-task-detail-hint', t('Bağımlılık yok')));
    for (const id of pisiTaskDetailState.dependencies) {
        const dependency = window.getPisiTask?.(id);
        const chip = makePisiTaskPanelElement('span', 'pisi-task-detail-chip');
        chip.dataset.pisiTaskDependency = id;
        const title = dependency ? `${dependency.status === 'done' ? '✓ ' : ''}${dependency.title || t('Başlıksız görev')}` : t('Görev bulunamadı');
        chip.appendChild(makePisiTaskPanelElement('span', '', title));
        chip.appendChild(
            createPisiTaskPanelButton('pisi-task-detail-chip-remove', '×', {
                label: `${t('Bağımlılığı kaldır')}: ${title}`,
                onClick: () => {
                    pisiTaskDetailState.dependencies = pisiTaskDetailState.dependencies.filter((item) => item !== id);
                    renderPisiTaskDependencyChips(container, task);
                }
            })
        );
        container.appendChild(chip);
    }
}

function buildPisiTaskDependencySection(task, status) {
    const section = makePisiTaskPanelElement('div', 'pisi-task-detail-field pisi-task-detail-wide');
    section.dataset.field = 'dependencies';
    section.appendChild(makePisiTaskPanelElement('span', 'pisi-task-detail-label', t('Bağımlılıklar')));
    const chips = makePisiTaskPanelElement('div', 'pisi-task-detail-chips');
    renderPisiTaskDependencyChips(chips, task);
    const candidates = (window.getPisiTasks?.() || [])
        .filter((candidate) => candidate.id !== task.id)
        .sort((a, b) => String(a.title).localeCompare(String(b.title), 'tr'))
        .map((candidate) => ({ value: candidate.id, label: `${candidate.status === 'done' ? '✓ ' : ''}${candidate.title || t('Başlıksız görev')}` }));
    const add = makePisiTaskPanelSelect('pisi-task-detail-dependency', t('Bağımlılık ekle'), [{ value: '', label: t('Bağımlılık ekle…') }, ...candidates], '');
    add.name = 'dependency';
    add.addEventListener('change', () => {
        const id = add.value;
        add.value = '';
        if (!id || pisiTaskDetailState.dependencies.includes(id)) return;
        const next = [...pisiTaskDetailState.dependencies, id];
        if (findPisiTaskDependencyCycle(window.getPisiTasks?.() || [], task.id, next)) {
            status.textContent = t('Bu bağımlılık bir döngü oluşturur.');
            status.dataset.kind = 'error';
            return;
        }
        status.textContent = '';
        pisiTaskDetailState.dependencies = next;
        renderPisiTaskDependencyChips(chips, task);
    });
    section.append(chips, add);
    return section;
}

function renderPisiTaskCompletionList(list, task) {
    list.replaceChildren();
    const entries = [...pisiTaskDetailState.completions].sort((a, b) => (a.at < b.at ? 1 : -1));
    if (!entries.length) list.appendChild(makePisiTaskPanelElement('li', 'pisi-task-detail-hint', t('Henüz tamamlanan gün yok.')));
    for (const entry of entries) {
        const item = makePisiTaskPanelElement('li', 'pisi-task-detail-completion');
        item.dataset.pisiTaskCompletion = entry.at;
        const text = `${formatPisiTaskPanelDay(entry.date)}${entry.dueDate && entry.dueDate !== entry.date ? ` (${t('tekrarın günü')} ${formatPisiTaskPanelDay(entry.dueDate)})` : ''}`;
        item.appendChild(makePisiTaskPanelElement('span', '', text));
        item.appendChild(
            createPisiTaskPanelButton('pisi-task-detail-completion-remove', t('Sil'), {
                label: `${t('Tamamlanan günü sil')}: ${formatPisiTaskPanelDay(entry.date)}`,
                onClick: () => {
                    pisiTaskDetailState.completions = pisiTaskDetailState.completions.filter((other) => other !== entry);
                    renderPisiTaskCompletionList(list, task);
                }
            })
        );
        list.appendChild(item);
    }
}

function buildPisiTaskPlaceSelect(task) {
    const options = [];
    const own = getPisiTaskPlaceValue(task);
    // A task without a place (a version 1 record, §3.1) keeps having none unless one is chosen.
    options.push({ value: own, label: getPisiTaskPlaceLabel(task) });
    const today = window.getPisiTaskToday?.();
    const addDiary = (day, label) => {
        if (day && !options.some((option) => option.value === `diary:${day}`))
            options.push({ value: `diary:${day}`, label: `${t(label)} · ${formatPisiTaskPanelDay(day)}` });
    };
    addDiary(today, 'Bugünün günlüğü');
    addDiary(task.dueDate, 'Bitiş gününün günlüğü');
    for (const note of listPisiTaskNoteChoices()) {
        if (note.id === task.noteId) continue;
        options.push({ value: `note:${note.id}`, label: note.relativePath ? `${note.title} · ${note.relativePath}` : note.title });
    }
    const select = makePisiTaskPanelSelect('pisi-task-detail-place', t('Yer'), options, own);
    select.name = 'place';
    return select;
}

function readPisiTaskDetailValues(form) {
    const data = new FormData(form);
    return {
        title: data.get('title'),
        status: data.get('status'),
        priority: data.get('priority'),
        dueDate: data.get('dueDate') || null,
        dueTime: data.get('dueTime') || null,
        repeat: data.get('repeat'),
        completionOffsetDays: data.get('completionOffsetDays'),
        reminderMode: data.get('reminderMode'),
        reminderAt: data.get('reminderAt') || null,
        dependencies: pisiTaskDetailState.dependencies,
        durationMinutes: data.get('durationMinutes'),
        actualMinutes: data.get('actualMinutes'),
        completions: pisiTaskDetailState.completions
    };
}

async function savePisiTaskDetail(form, task, status) {
    const values = readPisiTaskDetailValues(form);
    if (findPisiTaskDependencyCycle(window.getPisiTasks?.() || [], task.id, values.dependencies)) {
        status.textContent = t('Bu bağımlılık bir döngü oluşturur.');
        return false;
    }
    const read = readPisiTaskDetailPatch(task, values);
    if (read.error) return false;
    const placeValue = form.querySelector('[name="place"]')?.value || '';
    const note = /^note:(.+)$/.exec(placeValue);
    const notePath = note ? findPisiTaskNotePath(note[1]) : null;
    const target = readPisiTaskDetailPlace(task, placeValue, notePath);
    if (read.changed) {
        const result = await window.runPisiTaskCommand?.('task.update.v1', { taskId: task.id, patch: read.patch }, { quiet: true });
        if (!result?.ok) {
            status.textContent =
                result?.code === 'TASK_DEPENDENCY_CYCLE' ? t('Bu bağımlılık bir döngü oluşturur.') : result?.error || t('Görev değişikliği kaydedilemedi.');
            return false;
        }
    }
    if (target) {
        const fromNotePath = task.noteId ? (await window.resolvePisiNotePath?.(task.noteId)) || findPisiTaskNotePath(task.noteId) : null;
        const result = await window.runPisiTaskCommand?.('task.move.v1', { taskId: task.id, target, fromNotePath }, { quiet: true });
        if (!result?.ok) {
            status.textContent = result?.error || t('Görev taşınamadı.');
            return false;
        }
    }
    return true;
}

function buildPisiTaskDetailForm(task) {
    const readOnly = window.isPisiTaskStoreReadOnly?.() === true;
    const form = makePisiTaskPanelElement('form', 'pisi-task-detail-form');
    const status = makePisiTaskPanelElement('div', 'pisi-task-detail-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const title = makePisiTaskDetailInput('text', 'title', task.title);
    title.maxLength = 500;
    const done = task.status === 'done';
    const state = makePisiTaskPanelSelect(
        'pisi-task-detail-select',
        t('Durum'),
        done
            ? [{ value: 'done', label: getPisiTaskStatusLabel('done') }]
            : PISI_TODO_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
        task.status
    );
    state.name = 'status';
    state.disabled = done;
    const priority = makePisiTaskPanelSelect(
        'pisi-task-detail-select',
        t('Öncelik'),
        [...PISI_TODO_PRIORITY_OPTIONS].reverse().map((option) => ({ value: option.value, label: `${option.value} · ${t(option.label)}` })),
        task.priority || 3
    );
    priority.name = 'priority';
    const dueDate = makePisiTaskDetailInput('date', 'dueDate', task.dueDate);
    const dueTime = makePisiTaskDetailInput('time', 'dueTime', task.dueTime);
    const repeat = makePisiTaskPanelSelect(
        'pisi-task-detail-select',
        t('Tekrar'),
        PISI_TODO_REPEAT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
        task.repeat || 'none'
    );
    repeat.name = 'repeat';
    const offset = makePisiTaskDetailInput('number', 'completionOffsetDays', task.completionOffsetDays || 1);
    offset.min = '1';
    offset.max = '3650';
    const offsetField = makePisiTaskDetailField('Tamamlandıktan sonra (gün)', offset, 'completionOffsetDays');
    const syncOffset = () => (offsetField.hidden = repeat.value !== 'after-completion');
    repeat.addEventListener('change', syncOffset);
    syncOffset();
    const reminderMode = makePisiTaskPanelSelect(
        'pisi-task-detail-select',
        t('Hatırlatma'),
        Object.entries(PISI_TASK_REMINDER_MODE_LABELS).map(([value, label]) => ({ value, label: t(label) })),
        task.reminderMode || 'none'
    );
    reminderMode.name = 'reminderMode';
    const reminderAt = makePisiTaskDetailInput('datetime-local', 'reminderAt', task.reminderAt || '');
    const duration = makePisiTaskDetailInput('number', 'durationMinutes', task.durationMinutes || 0);
    duration.min = '0';
    duration.max = '1440';
    duration.step = '5';
    const actual = makePisiTaskDetailInput('number', 'actualMinutes', task.actualMinutes || 0);
    actual.min = '0';
    actual.max = '100000';
    actual.step = '5';

    const grid = makePisiTaskPanelElement('div', 'pisi-task-detail-grid');
    const titleField = makePisiTaskDetailField('Başlık', title, 'title');
    titleField.classList.add('pisi-task-detail-wide');
    grid.append(
        titleField,
        makePisiTaskDetailField('Durum', state, 'status'),
        makePisiTaskDetailField('Öncelik', priority, 'priority'),
        makePisiTaskDetailField('Tarih', dueDate, 'dueDate'),
        makePisiTaskDetailField('Saat', dueTime, 'dueTime'),
        makePisiTaskDetailField('Tekrar', repeat, 'repeat'),
        offsetField,
        makePisiTaskDetailField('Hatırlatma', reminderMode, 'reminderMode'),
        makePisiTaskDetailField('Belirli bir an', reminderAt, 'reminderAt'),
        makePisiTaskDetailField('Tahmini süre (dk)', duration, 'durationMinutes'),
        makePisiTaskDetailField('Gerçek süre (dk)', actual, 'actualMinutes'),
        buildPisiTaskDependencySection(task, status)
    );
    const placeField = makePisiTaskDetailField('Yer', buildPisiTaskPlaceSelect(task), 'place');
    placeField.classList.add('pisi-task-detail-wide');
    grid.appendChild(placeField);

    if (task.repeat !== 'none' || pisiTaskDetailState.completions.length) {
        const completions = makePisiTaskPanelElement('div', 'pisi-task-detail-field pisi-task-detail-wide');
        completions.dataset.field = 'completions';
        completions.appendChild(makePisiTaskPanelElement('span', 'pisi-task-detail-label', t('Tamamlanan günler')));
        const list = makePisiTaskPanelElement('ul', 'pisi-task-detail-completions');
        renderPisiTaskCompletionList(list, task);
        completions.appendChild(list);
        completions.appendChild(makePisiTaskPanelElement('span', 'pisi-task-detail-hint', t('Bir günü silmek görevin tarihini değiştirmez.')));
        grid.appendChild(completions);
    }

    const actions = makePisiTaskPanelElement('div', 'pisi-task-detail-actions');
    const remove = createPisiTaskPanelButton('pisi-secondary-button pisi-task-detail-delete', t('Görevi sil'), {
        onClick: async () => {
            const sure = await window.pisiConfirm?.(t('Görev çöp kutusuna taşınsın mı?'), { title: t('Görevi sil'), confirmText: t('Sil'), danger: true });
            if (!sure) return;
            const result = await window.runPisiTaskCommand?.('task.delete.v1', { taskId: task.id }, { quiet: true });
            if (result?.ok) closePisiTaskDetail();
            else status.textContent = result?.error || t('Görev silinemedi.');
        }
    });
    const cancel = createPisiTaskPanelButton('pisi-secondary-button', t('Vazgeç'), { onClick: closePisiTaskDetail });
    const save = makePisiTaskPanelElement('button', 'pisi-primary-button pisi-task-detail-save', t('Kaydet'));
    save.type = 'submit';
    actions.append(remove, status, cancel, save);
    form.append(grid, actions);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        status.textContent = t('Kaydediliyor…');
        const ok = await savePisiTaskDetail(form, task, status);
        if (ok) closePisiTaskDetail();
        else save.disabled = false;
    });
    if (readOnly) {
        for (const control of form.querySelectorAll('input, select, button')) control.disabled = control !== cancel;
        status.textContent = t('Görevler okunamadı; görev deposu salt okunur.');
    }
    return form;
}

function trapPisiTaskDetailFocus(event, dialog) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePisiTaskDetail();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')).filter(
        (element) => element.offsetParent !== null
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

/** Opens the detail window of a task. */
async function openPisiTaskDetail(taskId) {
    const task = window.getPisiTask?.(taskId);
    if (!task) {
        window.pisiNotifyError?.(t('Görev bulunamadı.'));
        return false;
    }
    ensurePisiTaskPanelStyle();
    const returnFocus = pisiTaskDetailState.overlay ? pisiTaskDetailState.returnFocus : document.activeElement;
    closePisiTaskDetail();
    await loadPisiTaskNoteTitles();
    pisiTaskDetailState.returnFocus = returnFocus;
    pisiTaskDetailState.taskId = task.id;
    pisiTaskDetailState.dependencies = Array.isArray(task.dependencies) ? [...task.dependencies] : [];
    pisiTaskDetailState.completions = Array.isArray(task.completions) ? [...task.completions] : [];

    const overlay = makePisiTaskPanelElement('div', 'pisi-quick-add-overlay pisi-task-detail-overlay');
    const dialog = makePisiTaskPanelElement('section', 'pisi-quick-add-dialog pisi-task-detail-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pisi-task-detail-title');
    dialog.dataset.pisiTaskDetail = task.id;
    const header = makePisiTaskPanelElement('header', 'pisi-quick-add-header');
    const heading = makePisiTaskPanelElement('h2', '', t('Görev ayrıntısı'));
    heading.id = 'pisi-task-detail-title';
    header.append(heading, createPisiTaskPanelButton('pisi-quick-add-close', '×', { label: t('Kapat'), onClick: closePisiTaskDetail }));
    const body = makePisiTaskPanelElement('div', 'pisi-quick-add-body');
    body.appendChild(buildPisiTaskDetailForm(task));
    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiTaskDetail();
    });
    overlay.addEventListener('keydown', (event) => trapPisiTaskDetailFocus(event, dialog));
    document.body.appendChild(overlay);
    pisiTaskDetailState.overlay = overlay;
    dialog.querySelector('input[name="title"]')?.focus();
    return true;
}

// A task deleted elsewhere closes its window.
document.addEventListener('pisi:task-store-updated', (event) => {
    const id = pisiTaskDetailState.taskId;
    if (id && (event.detail?.removedIds || []).includes(id)) closePisiTaskDetail();
});

const moduleApi = { pisiTaskDetailState, openPisiTaskDetail, closePisiTaskDetail };

registerModule('tasks.detail', moduleApi);

export { openPisiTaskDetail, closePisiTaskDetail };
