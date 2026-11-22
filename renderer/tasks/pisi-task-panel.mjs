import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_TODO_FILTER_OPTIONS,
    getPisiTaskBucket,
    getPisiTaskDependencyState,
    getPisiTaskManualOrderUpdates,
    movePisiTaskInOrder
} from '../../shared/task-views.mjs';
import { PISI_TODO_STATUS_OPTIONS, getPisiTodayIsoDate } from '../../shared/task-model.mjs';
import {
    PISI_TASK_PANEL_PAGE,
    PISI_TASK_PANEL_VIEWS,
    getPisiTaskCardSignature,
    getPisiTaskPanelModel,
    normalizePisiTaskPanelPrefs
} from './pisi-task-panel-core.mjs';
import {
    ensurePisiTaskPanelStyle,
    formatPisiTaskPanelDay,
    getPisiTaskPlaceLabel,
    loadPisiTaskPanelPrefs,
    createPisiTaskPanelButton,
    makePisiTaskPanelElement,
    makePisiTaskPanelSelect,
    pisiTaskPanelText as t,
    savePisiTaskPanelPrefs
} from './pisi-task-panel-dom.mjs';
import { renderPisiTaskAlternativeView } from './pisi-task-views.mjs';
import { appendPisiTaskTitleParts, getPisiTaskTitleReadingText, makePisiTaskTitleLinkButtons } from './pisi-task-title-links.mjs';
import { formatPisiTaskTags } from './pisi-task-view.mjs';

// The task panel (docs/task-plan.md G4.1). The right panel and the task
// workspace are one component (`surface`: 'side' or 'workspace'); the side
// panel always shows the list. The default view, "Öncelikli", lists the open
// tasks in the work order (shared/task-views.mjs). Everything is drawn from the
// task store; every change is one task.*.v1 command. When the store changes,
// only the cards whose drawn values changed are drawn again; the others are
// kept and moved into place. There is no MutationObserver.

const PISI_TASK_SORT_LABELS = Object.freeze({ workorder: 'Öncelikli', priority: 'Öncelik', date: 'Tarih', status: 'Durum', manual: 'Elle sıra' });
const PISI_TASK_VIEW_LABELS = Object.freeze({ list: 'Liste', kanban: 'Kanban', calendar: 'Takvim', timeline: 'Zaman çizelgesi', stats: 'İlerleme' });

const pisiTaskPanelState = { surfaces: new Map(), drag: null, lastRenderMs: 0 };

function getPisiTaskPanelToday() {
    return getPisiTodayIsoDate(new Date());
}

// ---- Surfaces ------------------------------------------------------------------------

/** Mounts (or returns) the panel in `host`: `toolbarHost` gets the controls, `host` the list. */
function mountPisiTaskPanel(host, { surface = 'side', toolbarHost = null } = {}) {
    if (!host) return null;
    const existing = pisiTaskPanelState.surfaces.get(surface);
    if (existing?.host === host) return existing;
    ensurePisiTaskPanelStyle();
    const state = {
        surface,
        host,
        toolbarHost: toolbarHost || host,
        prefs: loadPisiTaskPanelPrefs(surface),
        projectFolder: window.currentProjectFolder || null,
        page: PISI_TASK_PANEL_PAGE,
        cards: new Map(),
        toolbar: null,
        body: null,
        list: null,
        more: null,
        message: null,
        mode: null
    };
    pisiTaskPanelState.surfaces.set(surface, state);
    return state;
}

function setPisiTaskPanelPrefs(state, patch) {
    state.prefs = normalizePisiTaskPanelPrefs({ ...state.prefs, ...patch });
    state.page = PISI_TASK_PANEL_PAGE;
    savePisiTaskPanelPrefs(state.surface, state.prefs);
    renderPisiTaskSurface(state, { full: true });
}

function buildPisiTaskToolbar(state) {
    const toolbar = makePisiTaskPanelElement('div', 'pisi-task-toolbar');
    toolbar.dataset.pisiTaskToolbar = state.surface;
    const filters = makePisiTaskPanelElement('div', 'pisi-task-toolbar-row');
    const date = makePisiTaskPanelSelect(
        'pisi-task-filter',
        t('Tarih süzgeci'),
        PISI_TODO_FILTER_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
        state.prefs.dateFilter
    );
    date.dataset.pisiTaskFilter = 'date';
    date.addEventListener('change', () => setPisiTaskPanelPrefs(state, { dateFilter: date.value }));
    const status = makePisiTaskPanelSelect(
        'pisi-task-filter',
        t('Durum süzgeci'),
        [{ value: 'all', label: t('Tüm durumlar') }, ...PISI_TODO_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))],
        state.prefs.status
    );
    status.dataset.pisiTaskFilter = 'status';
    status.addEventListener('change', () => setPisiTaskPanelPrefs(state, { status: status.value }));
    const sort = makePisiTaskPanelSelect(
        'pisi-task-filter',
        t('Sıralama'),
        Object.entries(PISI_TASK_SORT_LABELS).map(([value, label]) => ({ value, label: t(label) })),
        state.prefs.sort
    );
    sort.dataset.pisiTaskFilter = 'sort';
    sort.addEventListener('change', () => setPisiTaskPanelPrefs(state, { sort: sort.value }));
    filters.append(date, status, sort);

    const actions = makePisiTaskPanelElement('div', 'pisi-task-toolbar-row');
    const completed = createPisiTaskPanelButton('pisi-task-toolbar-toggle', '', {
        onClick: () => setPisiTaskPanelPrefs(state, { showCompleted: !state.prefs.showCompleted })
    });
    completed.dataset.pisiTaskToggleCompleted = '1';
    const add = createPisiTaskPanelButton('pisi-task-toolbar-button pisi-task-toolbar-primary', t('Görev ekle'), {
        onClick: () => void window.openPisiQuickAddModal?.()
    });
    add.dataset.pisiTaskAdd = '1';
    add.setAttribute('aria-keyshortcuts', 'Control+M');
    actions.append(completed, add);
    if (state.surface === 'side') {
        const workspace = createPisiTaskPanelButton('pisi-task-toolbar-button', t('Çalışma alanı'), {
            label: t('Görev çalışma alanını aç'),
            onClick: () => void window.openPisiTaskWorkspace?.()
        });
        workspace.dataset.pisiTaskWorkspaceOpen = '1';
        actions.appendChild(workspace);
    } else {
        const views = makePisiTaskPanelElement('nav', 'pisi-task-view-switch');
        views.setAttribute('aria-label', t('Görev görünümleri'));
        for (const view of PISI_TASK_PANEL_VIEWS) {
            const button = createPisiTaskPanelButton('pisi-task-view-button', t(PISI_TASK_VIEW_LABELS[view]), {
                onClick: () => setPisiTaskPanelPrefs(state, { view })
            });
            button.dataset.pisiTaskViewButton = view;
            views.appendChild(button);
        }
        toolbar.appendChild(views);
    }
    toolbar.append(filters, actions);
    return toolbar;
}

function updatePisiTaskToolbar(state, model) {
    const toolbar = state.toolbar;
    const date = toolbar.querySelector('[data-pisi-task-filter="date"]');
    for (const option of date.options) {
        const label = PISI_TODO_FILTER_OPTIONS.find((item) => item.value === option.value)?.label || option.value;
        const text = `${t(label)} (${model.counts[option.value] ?? 0})`;
        if (option.textContent !== text) option.textContent = text;
    }
    date.value = model.prefs.dateFilter;
    toolbar.querySelector('[data-pisi-task-filter="status"]').value = model.prefs.status;
    toolbar.querySelector('[data-pisi-task-filter="sort"]').value = model.prefs.sort;
    const completed = toolbar.querySelector('[data-pisi-task-toggle-completed]');
    completed.textContent = `${t(model.prefs.showCompleted ? 'Tamamlananları gizle' : 'Tamamlananları göster')} (${model.completedCount})`;
    completed.setAttribute('aria-pressed', model.prefs.showCompleted ? 'true' : 'false');
    const readOnly = window.isPisiTaskStoreReadOnly?.() === true;
    toolbar.querySelector('[data-pisi-task-add]').disabled = readOnly;
    for (const button of toolbar.querySelectorAll('[data-pisi-task-view-button]')) {
        button.setAttribute('aria-pressed', button.dataset.pisiTaskViewButton === model.prefs.view ? 'true' : 'false');
    }
}

function ensurePisiTaskSurfaceFrame(state) {
    if (!state.toolbar?.isConnected) {
        state.toolbar = buildPisiTaskToolbar(state);
        if (state.toolbarHost === state.host) state.host.prepend(state.toolbar);
        else state.toolbarHost.replaceChildren(state.toolbar);
    }
    if (!state.body?.isConnected) {
        state.body = makePisiTaskPanelElement('div', 'pisi-task-panel-body');
        state.body.dataset.pisiTaskPanel = state.surface;
        if (state.toolbarHost === state.host) state.host.appendChild(state.body);
        else state.host.replaceChildren(state.body);
        state.list = null;
        state.cards = new Map();
        state.mode = null;
    }
}

function resetPisiTaskSurfaceBody(state, mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    state.body.replaceChildren();
    state.cards = new Map();
    state.list = null;
    state.more = null;
    state.message = null;
    if (mode !== 'list') return;
    state.message = makePisiTaskPanelElement('div', 'right-panel-empty pisi-task-panel-message');
    state.message.hidden = true;
    state.list = makePisiTaskPanelElement('div', 'pisi-task-list');
    state.list.setAttribute('role', 'list');
    state.list.setAttribute('aria-label', t('Görevler'));
    state.list.addEventListener('keydown', (event) => handlePisiTaskListKeydown(state, event));
    state.more = createPisiTaskPanelButton('pisi-task-more', '', {
        onClick: () => {
            state.page += PISI_TASK_PANEL_PAGE;
            renderPisiTaskSurface(state);
        }
    });
    state.more.hidden = true;
    state.body.append(state.message, state.list, state.more);
}

function showPisiTaskPanelOnly(state, text, className = '') {
    resetPisiTaskSurfaceBody(state, 'message');
    state.body.replaceChildren(makePisiTaskPanelElement('div', `right-panel-empty ${className}`.trim(), text));
}

/** Draws a surface. `full` draws every card again (language change). */
function renderPisiTaskSurface(state, { full = false } = {}) {
    if (!state?.host?.isConnected) return;
    const started = performance.now();
    if (state.projectFolder !== (window.currentProjectFolder || null)) {
        state.projectFolder = window.currentProjectFolder || null;
        state.prefs = loadPisiTaskPanelPrefs(state.surface);
        state.page = PISI_TASK_PANEL_PAGE;
        full = true;
    }
    if (full) {
        state.toolbar?.remove();
        state.toolbar = null;
        state.mode = null;
    }
    ensurePisiTaskSurfaceFrame(state);
    if (!window.currentProjectFolder) {
        state.toolbar.hidden = true;
        showPisiTaskPanelOnly(state, t('Görevleri görmek için bir proje aç.'));
        return;
    }
    state.toolbar.hidden = false;
    const today = getPisiTaskPanelToday();
    const tasks = window.getPisiTasks?.() || [];
    const model = getPisiTaskPanelModel(tasks, state.prefs, today);
    updatePisiTaskToolbar(state, model);
    const view = state.surface === 'side' ? 'list' : model.prefs.view;
    if (view !== 'list') {
        resetPisiTaskSurfaceBody(state, view);
        renderPisiTaskAlternativeView(state.body, view, {
            tasks,
            visible: model.visible,
            prefs: model.prefs,
            today,
            setPrefs: (patch) => setPisiTaskPanelPrefs(state, patch)
        });
    } else {
        resetPisiTaskSurfaceBody(state, 'list');
        renderPisiTaskList(state, model, tasks, today);
    }
    pisiTaskPanelState.lastRenderMs = performance.now() - started;
}

// ---- List ----------------------------------------------------------------------------

function renderPisiTaskList(state, model, tasks, today) {
    const problem = window.isPisiTaskStoreReadOnly?.() ? t('Görevler okunamadı') : '';
    const empty = !model.visible.length;
    const emptyText = !model.total
        ? t('Bu projede görev yok.')
        : model.prefs.dateFilter === 'all' && model.prefs.status === 'all'
          ? t('Açık görev yok.')
          : t('Bu süzgeçte görev yok.');
    state.message.textContent = problem || (empty ? emptyText : '');
    state.message.classList.toggle('pisi-task-missing', Boolean(problem));
    state.message.hidden = !problem && !empty;

    const shown = model.visible.slice(0, state.page);
    const dependencies = getPisiTaskDependencyState(tasks);
    const manual = model.prefs.sort === 'manual';
    const readOnly = Boolean(problem);
    const keep = new Set(shown.map((task) => task.id));
    for (const [id, entry] of state.cards) {
        if (!keep.has(id)) {
            entry.element.remove();
            state.cards.delete(id);
        }
    }
    let cursor = state.list.firstElementChild;
    for (const task of shown) {
        const blocked = dependencies.get(task.id)?.blocked === true;
        const signature = getPisiTaskCardSignature(task, { today, place: getPisiTaskPlaceLabel(task), blocked, manual: manual && !readOnly });
        let entry = state.cards.get(task.id);
        if (!entry || entry.signature !== signature) {
            const element = makePisiTaskCard(state, task, { today, blocked, manual: manual && !readOnly, readOnly });
            if (entry) {
                const focused = entry.element.contains(document.activeElement) ? document.activeElement.dataset.pisiTaskRole : null;
                if (cursor === entry.element) cursor = element;
                entry.element.replaceWith(element);
                if (focused) element.querySelector(`[data-pisi-task-role="${focused}"]`)?.focus({ preventScroll: true });
            }
            entry = { element, signature };
            state.cards.set(task.id, entry);
        }
        if (entry.element === cursor) cursor = cursor.nextElementSibling;
        else state.list.insertBefore(entry.element, cursor);
    }
    const rest = model.visible.length - shown.length;
    state.more.hidden = rest <= 0;
    if (rest > 0) state.more.textContent = `${t('Daha fazla göster')} (${rest})`;
}

function makePisiTaskCard(state, task, { today, blocked, manual, readOnly }) {
    const done = task.status === 'done';
    const title = getPisiTaskTitleReadingText(task.title) || t('Başlıksız görev');
    const card = makePisiTaskPanelElement('div', 'pisi-task-card');
    card.setAttribute('role', 'listitem');
    card.dataset.pisiTaskCard = task.id;
    card.dataset.status = task.status;
    card.dataset.priority = String(task.priority || 3);
    card.classList.toggle('pisi-task-done', done);
    const bucket = getPisiTaskBucket(task, today);
    if (!done && bucket === 'overdue') card.classList.add('pisi-task-overdue');

    if (manual) {
        const handle = createPisiTaskPanelButton('pisi-task-card-handle', '⋮⋮', { label: `${t('Sürükleyerek sırala')}: ${title}` });
        handle.dataset.pisiTaskRole = 'handle';
        handle.draggable = true;
        handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
        bindPisiTaskCardDrag(state, card, handle, task.id);
        card.appendChild(handle);
    }

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'pisi-task-card-check';
    check.dataset.pisiTaskRole = 'check';
    check.checked = done;
    check.disabled = readOnly;
    check.setAttribute('aria-label', `${t(done ? 'Görevi yeniden aç' : 'Görevi tamamla')}: ${title}`);
    check.addEventListener('change', () => void togglePisiTaskCard(card, task.id, check));
    card.appendChild(check);

    const body = makePisiTaskPanelElement('div', 'pisi-task-card-body');
    const name = createPisiTaskPanelButton('pisi-task-card-title', '', { onClick: () => void window.openPisiTaskDetail?.(task.id) });
    if (task.title) appendPisiTaskTitleParts(name, task.title);
    else name.textContent = title;
    name.dataset.pisiTaskRole = 'title';
    name.setAttribute('aria-label', `${title} · ${t('Ayrıntılar')}`);
    body.appendChild(name);
    const meta = makePisiTaskPanelElement('div', 'pisi-task-card-meta');
    if (task.dueDate) {
        const day = makePisiTaskPanelElement(
            'span',
            'pisi-task-card-day',
            [formatPisiTaskPanelDay(task.dueDate), task.dueTime || ''].filter(Boolean).join(' ')
        );
        if (!done && bucket === 'overdue') day.classList.add('late');
        meta.appendChild(day);
    } else meta.appendChild(makePisiTaskPanelElement('span', 'pisi-task-card-day pisi-task-card-undated', t('Tarihsiz')));
    const priority = makePisiTaskPanelElement('span', 'pisi-task-card-priority', `!${task.priority || 3}`);
    priority.title = `${t('Öncelik')} ${task.priority || 3}`;
    meta.appendChild(priority);
    if (task.repeat && task.repeat !== 'none') meta.appendChild(makePisiTaskPanelElement('span', 'pisi-task-card-repeat', '↻'));
    if (blocked) meta.appendChild(makePisiTaskPanelElement('span', 'pisi-task-card-blocked', t('Bağımlılık bekliyor')));
    if (task.tags?.length) meta.appendChild(makePisiTaskPanelElement('span', 'pisi-task-card-tags', formatPisiTaskTags(task.tags)));
    meta.append(...makePisiTaskTitleLinkButtons(task.title));
    body.appendChild(meta);
    body.appendChild(makePisiTaskPanelElement('div', 'pisi-task-card-place', getPisiTaskPlaceLabel(task)));
    card.appendChild(body);

    const side = makePisiTaskPanelElement('div', 'pisi-task-card-side');
    const status = makePisiTaskPanelSelect(
        'pisi-task-card-status',
        `${t('Görev durumu')}: ${title}`,
        done ? [{ value: 'done', label: t('Tamamlandı') }] : PISI_TODO_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
        task.status
    );
    status.dataset.pisiTaskRole = 'status';
    status.disabled = done || readOnly;
    status.addEventListener('change', async () => {
        status.disabled = true;
        const result = await window.runPisiTaskCommand?.('task.update.v1', { taskId: task.id, patch: { status: status.value } });
        if (!result?.ok && status.isConnected) {
            status.value = task.status;
            status.disabled = false;
        }
    });
    const open = createPisiTaskPanelButton('pisi-task-card-open', t('Aç'), {
        label: `${t('Görevin yerini aç')}: ${title}`,
        onClick: () => void window.openPisiTaskLocation?.(task.id)
    });
    open.dataset.pisiTaskRole = 'open';
    side.append(status, open);
    card.appendChild(side);
    return card;
}

/** Ticks or unticks a card: the box shows the change at once; a failure puts it back. */
async function togglePisiTaskCard(card, taskId, check) {
    const before = !check.checked;
    card.classList.add('pisi-task-card-pending');
    check.disabled = true;
    const result = await window.togglePisiTaskCompletion?.(taskId, null);
    if (!card.isConnected) return;
    card.classList.remove('pisi-task-card-pending');
    check.disabled = false;
    const task = window.getPisiTask?.(taskId);
    check.checked = result?.ok ? task?.status === 'done' : before;
}

function getPisiTaskCards(state) {
    return Array.from(state.list?.querySelectorAll(':scope > [data-pisi-task-card]') || []);
}

/** ↑/↓ move between cards (same control), Enter opens the detail, Space completes; Alt+↑/↓ reorders in "Elle sıra". */
function handlePisiTaskListKeydown(state, event) {
    const card = event.target?.closest?.('[data-pisi-task-card]');
    if (!card || event.target.tagName === 'SELECT') return;
    const role = event.target.dataset.pisiTaskRole || 'title';
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey) {
        if (state.prefs.sort !== 'manual') return;
        event.preventDefault();
        void movePisiTaskCardBy(state, card.dataset.pisiTaskCard, event.key === 'ArrowUp' ? -1 : 1);
        return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const cards = getPisiTaskCards(state);
        const next = cards[cards.indexOf(card) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!next) return;
        event.preventDefault();
        (next.querySelector(`[data-pisi-task-role="${role}"]`) || next.querySelector('[data-pisi-task-role="title"]'))?.focus();
        return;
    }
    if (event.key === ' ' && role === 'title') {
        event.preventDefault();
        card.querySelector('[data-pisi-task-role="check"]')?.click();
    }
}

// ---- Manual order --------------------------------------------------------------------

/** Writes a new manual order: one task.batch.v1 (in parts of 500 only when the whole list is numbered again). */
async function writePisiTaskManualOrder(ordered, movedId) {
    const updates = getPisiTaskManualOrderUpdates(ordered, movedId);
    for (let start = 0; start < updates.length; start += 500) {
        const result = await window.runPisiTaskCommand?.('task.batch.v1', { updates: updates.slice(start, start + 500) });
        if (!result?.ok) return result;
    }
    return { ok: true, written: updates.length };
}

function getPisiTaskManualList(state) {
    return getPisiTaskPanelModel(window.getPisiTasks?.() || [], state.prefs, getPisiTaskPanelToday()).visible;
}

async function movePisiTaskCardBy(state, taskId, by) {
    const ordered = movePisiTaskInOrder(getPisiTaskManualList(state), taskId, by);
    if (!ordered) return;
    await writePisiTaskManualOrder(ordered, taskId);
    state.cards.get(taskId)?.element.querySelector('[data-pisi-task-role="handle"]')?.focus();
}

function bindPisiTaskCardDrag(state, card, handle, taskId) {
    handle.addEventListener('dragstart', (event) => {
        pisiTaskPanelState.drag = { surface: state.surface, taskId };
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskId);
    });
    handle.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        pisiTaskPanelState.drag = null;
        state.list?.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (event) => {
        if (pisiTaskPanelState.drag?.surface !== state.surface) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (event) => {
        const drag = pisiTaskPanelState.drag;
        card.classList.remove('drag-over');
        if (drag?.surface !== state.surface || drag.taskId === taskId) return;
        event.preventDefault();
        const rect = card.getBoundingClientRect();
        void dropPisiTaskCard(state, drag.taskId, taskId, event.clientY < rect.top + rect.height / 2);
    });
}

/** Puts `draggedId` before (or after) `targetId` and writes the order. */
async function dropPisiTaskCard(state, draggedId, targetId, before) {
    const list = getPisiTaskManualList(state).filter((task) => task.id !== draggedId);
    const dragged = window.getPisiTask?.(draggedId);
    const at = list.findIndex((task) => task.id === targetId);
    if (!dragged || at < 0) return { ok: false };
    list.splice(before ? at : at + 1, 0, dragged);
    return writePisiTaskManualOrder(list, draggedId);
}

// ---- Side panel ----------------------------------------------------------------------

/** Draws the right panel's task list (the "missions" tab). */
function renderPisiTaskPanel() {
    const host = document.getElementById('pisi-missions-list');
    if (!host) return;
    const state = mountPisiTaskPanel(host, { surface: 'side', toolbarHost: document.getElementById('pisi-todo-panel-actions-host') });
    renderPisiTaskSurface(state);
}

function renderPisiTaskSurfaces({ full = false } = {}) {
    const side = document.getElementById('pisi-missions-list');
    if (side)
        renderPisiTaskSurface(mountPisiTaskPanel(side, { surface: 'side', toolbarHost: document.getElementById('pisi-todo-panel-actions-host') }), { full });
    for (const state of pisiTaskPanelState.surfaces.values()) if (state.surface !== 'side') renderPisiTaskSurface(state, { full });
}

function getPisiTaskPanelSurface(surface) {
    return pisiTaskPanelState.surfaces.get(surface) || null;
}

document.addEventListener('pisi:task-store-updated', () => renderPisiTaskSurfaces());
document.addEventListener('pisi:task-note-titles-updated', () => renderPisiTaskSurfaces());
document.addEventListener('pisi:language-changed', () => renderPisiTaskSurfaces({ full: true }));

const moduleApi = {
    pisiTaskPanelState,
    renderPisiTaskPanel,
    mountPisiTaskPanel,
    renderPisiTaskSurface,
    getPisiTaskPanelSurface,
    dropPisiTaskCard
};

registerModule('tasks.panel', moduleApi);

export { renderPisiTaskPanel, mountPisiTaskPanel, renderPisiTaskSurface };
