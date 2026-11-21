import { registerModule } from '../core/module-registry.mjs';
import { sortPisiTasks } from '../../shared/task-views.mjs';
import { getPisiTodayIsoDate } from '../../shared/task-model.mjs';

// The right panel's task list, G2's interim form (docs/task-plan.md G2 step
// 12): open tasks in the priority order (overdue first, then days left and
// priority, shared/task-views.mjs), each with its day, a checkbox and "Aç".
// It reads the task store only and writes through task.*.v1. The full panel
// (filters, kanban, detail) comes in G4.

const pisiTaskPanelState = { showCompleted: false };

function pisiTaskPanelTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiTaskPanelDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function makePisiTaskPanelElement(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
}

function makePisiTaskPanelRow(task, today) {
    const row = makePisiTaskPanelElement('div', 'pisi-task-panel-row');
    row.dataset.pisiTaskId = task.id;
    const done = task.status === 'done';
    row.classList.toggle('pisi-task-done', done);
    if (!done && task.dueDate && task.dueDate < today) row.classList.add('pisi-task-overdue');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'pisi-task-panel-check';
    check.checked = done;
    check.setAttribute('aria-label', `${pisiTaskPanelTranslate(done ? 'Görevi yeniden aç' : 'Görevi tamamla')}: ${task.title || ''}`);
    check.addEventListener('change', async () => {
        check.disabled = true;
        const result = await window.togglePisiTaskCompletion?.(task.id, null);
        if (!result?.ok) check.checked = done;
        check.disabled = false;
    });
    row.appendChild(check);

    const body = makePisiTaskPanelElement('div', 'pisi-task-panel-body');
    body.appendChild(makePisiTaskPanelElement('div', 'pisi-task-panel-title', task.title || pisiTaskPanelTranslate('Başlıksız görev')));
    const meta = [formatPisiTaskPanelDay(task.dueDate), task.dueTime || '', `P${task.priority || 3}`].filter(Boolean).join(' · ');
    body.appendChild(makePisiTaskPanelElement('div', 'pisi-task-panel-meta', meta));
    row.appendChild(body);

    const open = makePisiTaskPanelElement('button', 'pisi-task-panel-open', pisiTaskPanelTranslate('Aç'));
    open.type = 'button';
    open.setAttribute('aria-label', `${pisiTaskPanelTranslate('Görevin yerini aç')}: ${task.title || ''}`);
    open.addEventListener('click', () => void window.openPisiTaskLocation?.(task.id));
    row.appendChild(open);
    return row;
}

function renderPisiTaskPanel() {
    const list = document.getElementById('pisi-missions-list');
    if (!list) return;
    const actions = document.getElementById('pisi-todo-panel-actions-host');
    if (actions && !actions.querySelector('.pisi-task-panel-toolbar')) {
        const toolbar = makePisiTaskPanelElement('div', 'pisi-task-panel-toolbar');
        const add = makePisiTaskPanelElement('button', 'pisi-task-panel-add', pisiTaskPanelTranslate('Görev ekle'));
        add.type = 'button';
        add.addEventListener('click', () => void window.openPisiQuickAddModal?.());
        const toggle = document.createElement('label');
        toggle.className = 'pisi-task-panel-toggle';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.addEventListener('change', () => {
            pisiTaskPanelState.showCompleted = box.checked;
            renderPisiTaskPanel();
        });
        toggle.append(box, document.createTextNode(` ${pisiTaskPanelTranslate('Tamamlananları göster')}`));
        toolbar.append(add, toggle);
        actions.replaceChildren(toolbar);
    }

    list.replaceChildren();
    if (!window.currentProjectFolder) {
        list.appendChild(makePisiTaskPanelElement('div', 'right-panel-empty', pisiTaskPanelTranslate('Görevleri görmek için bir proje aç.')));
        return;
    }
    if (window.isPisiTaskStoreReadOnly?.()) {
        list.appendChild(makePisiTaskPanelElement('div', 'right-panel-empty pisi-task-missing', pisiTaskPanelTranslate('Görevler okunamadı')));
    }
    const today = getPisiTodayIsoDate(new Date());
    const tasks = (window.getPisiTasks?.() || []).filter((task) => pisiTaskPanelState.showCompleted || task.status !== 'done');
    if (!tasks.length) {
        list.appendChild(makePisiTaskPanelElement('div', 'right-panel-empty', pisiTaskPanelTranslate('Açık görev yok.')));
        return;
    }
    for (const task of sortPisiTasks(tasks, { mode: 'workorder', today })) list.appendChild(makePisiTaskPanelRow(task, today));
}

document.addEventListener('pisi:task-store-updated', () => renderPisiTaskPanel());
document.addEventListener('pisi:language-changed', () => {
    document.querySelector('#pisi-todo-panel-actions-host .pisi-task-panel-toolbar')?.remove();
    renderPisiTaskPanel();
});

const moduleApi = {
    pisiTaskPanelState,
    renderPisiTaskPanel
};

registerModule('tasks.panel', moduleApi);

export { renderPisiTaskPanel };
