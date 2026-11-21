import { getPisiTaskDependencyState, getPisiTaskProgress } from '../../shared/task-views.mjs';
import {
    PISI_TASK_CALENDAR_DAY_LIMIT,
    PISI_TASK_KANBAN_PAGE,
    PISI_TASK_KANBAN_STATUSES,
    PISI_TASK_PANEL_PAGE,
    PISI_TASK_TIMELINE_SPAN,
    getPisiTaskMonthCells,
    getPisiTaskMonthOf,
    getPisiTaskTimelineRows,
    groupPisiTasksForKanban,
    shiftPisiTaskMonth
} from './pisi-task-panel-core.mjs';
import {
    formatPisiTaskPanelDay,
    getPisiTaskStatusLabel,
    createPisiTaskPanelButton,
    makePisiTaskPanelElement,
    pisiTaskPanelText as t
} from './pisi-task-panel-dom.mjs';

// The task workspace's other views (docs/task-plan.md G4.2): the kanban (a
// card dropped on another column, or moved with Alt+←/→, changes its status
// with task.update.v1), the month calendar and the timeline by the task's day
// (`dueDate`), and the progress counts, completed repeats included. They read
// the task store only. Each view is drawn again as a whole when the store
// changes; a view lists a bounded number of tasks at once.

const pisiTaskViewsState = { drag: null, expandedDays: new Set() };

function openPisiTaskDetailFor(taskId) {
    void window.openPisiTaskDetail?.(taskId);
}

function makePisiTaskViewTaskButton(task, className, { blocked = false } = {}) {
    const title = task.title || t('Başlıksız görev');
    const button = createPisiTaskPanelButton(className, title, { onClick: () => openPisiTaskDetailFor(task.id) });
    button.dataset.pisiTaskViewTask = task.id;
    button.dataset.status = task.status;
    button.dataset.priority = String(task.priority || 3);
    button.setAttribute('aria-label', `${title} · ${t('Ayrıntılar')}`);
    if (blocked) button.classList.add('dependency-blocked');
    return button;
}

function appendPisiTaskUndatedTray(root, undated) {
    if (!undated.length) return;
    const tray = makePisiTaskPanelElement('div', 'pisi-task-undated-tray');
    tray.appendChild(makePisiTaskPanelElement('strong', '', `${t('Tarihsiz')} (${undated.length})`));
    for (const task of undated.slice(0, PISI_TASK_PANEL_PAGE)) tray.appendChild(makePisiTaskViewTaskButton(task, 'pisi-task-undated-task'));
    if (undated.length > PISI_TASK_PANEL_PAGE)
        tray.appendChild(makePisiTaskPanelElement('span', 'pisi-task-view-rest', `+${undated.length - PISI_TASK_PANEL_PAGE}`));
    root.appendChild(tray);
}

// ---- Kanban --------------------------------------------------------------------------

async function setPisiTaskKanbanStatus(taskId, status) {
    const task = window.getPisiTask?.(taskId);
    if (!task || task.status === status || task.status === 'done') return null;
    return window.runPisiTaskCommand?.('task.update.v1', { taskId, patch: { status } });
}

function renderPisiTaskKanban(body, { visible, tasks, today }) {
    const board = makePisiTaskPanelElement('div', 'pisi-task-kanban');
    const columns = groupPisiTasksForKanban(visible, today);
    const dependencies = getPisiTaskDependencyState(tasks);
    PISI_TASK_KANBAN_STATUSES.forEach((status, index) => {
        const column = makePisiTaskPanelElement('section', 'pisi-task-kanban-column');
        column.dataset.pisiTaskColumn = status;
        const header = makePisiTaskPanelElement('header', 'pisi-task-kanban-header');
        header.append(makePisiTaskPanelElement('span', '', getPisiTaskStatusLabel(status)), makePisiTaskPanelElement('b', '', String(columns[status].length)));
        column.setAttribute('aria-label', getPisiTaskStatusLabel(status));
        const cards = makePisiTaskPanelElement('div', 'pisi-task-kanban-cards');
        for (const task of columns[status].slice(0, PISI_TASK_KANBAN_PAGE)) {
            const card = makePisiTaskViewTaskButton(task, 'pisi-task-kanban-card', { blocked: dependencies.get(task.id)?.blocked === true });
            card.appendChild(makePisiTaskPanelElement('small', '', formatPisiTaskPanelDay(task.dueDate) || t('Tarihsiz')));
            card.draggable = true;
            card.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
            card.addEventListener('dragstart', (event) => {
                pisiTaskViewsState.drag = task.id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', task.id);
            });
            card.addEventListener('dragend', () => (pisiTaskViewsState.drag = null));
            card.addEventListener('keydown', (event) => {
                if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                const next = PISI_TASK_KANBAN_STATUSES[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                if (!next) return;
                event.preventDefault();
                void setPisiTaskKanbanStatus(task.id, next).then(() => {
                    document.querySelector(`[data-pisi-task-column="${next}"] [data-pisi-task-view-task="${CSS.escape(task.id)}"]`)?.focus();
                });
            });
            cards.appendChild(card);
        }
        const rest = columns[status].length - PISI_TASK_KANBAN_PAGE;
        if (rest > 0) cards.appendChild(makePisiTaskPanelElement('span', 'pisi-task-view-rest', `+${rest}`));
        column.addEventListener('dragover', (event) => {
            if (!pisiTaskViewsState.drag) return;
            event.preventDefault();
            column.classList.add('drag-over');
        });
        column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
        column.addEventListener('drop', (event) => {
            event.preventDefault();
            column.classList.remove('drag-over');
            const taskId = pisiTaskViewsState.drag || event.dataTransfer.getData('text/plain');
            pisiTaskViewsState.drag = null;
            if (taskId) void setPisiTaskKanbanStatus(taskId, status);
        });
        column.append(header, cards);
        board.appendChild(column);
    });
    body.replaceChildren(board);
}

// ---- Calendar ------------------------------------------------------------------------

function getPisiTaskViewLocale() {
    return /^en/i.test(document.documentElement.lang || '') ? 'en-US' : 'tr-TR';
}

function renderPisiTaskCalendar(body, { visible, prefs, today, setPrefs }) {
    const month = prefs.month || getPisiTaskMonthOf(today);
    const root = makePisiTaskPanelElement('div', 'pisi-task-calendar');
    const nav = makePisiTaskPanelElement('div', 'pisi-task-calendar-nav');
    const title = makePisiTaskPanelElement(
        'strong',
        'pisi-task-calendar-title',
        new Date(`${month}-01T00:00:00`).toLocaleDateString(getPisiTaskViewLocale(), { month: 'long', year: 'numeric' })
    );
    nav.append(
        createPisiTaskPanelButton('pisi-task-calendar-step', '‹', { label: t('Önceki ay'), onClick: () => setPrefs({ month: shiftPisiTaskMonth(month, -1) }) }),
        createPisiTaskPanelButton('pisi-task-calendar-today', t('Bugün'), { onClick: () => setPrefs({ month: null }) }),
        title,
        createPisiTaskPanelButton('pisi-task-calendar-step', '›', { label: t('Sonraki ay'), onClick: () => setPrefs({ month: shiftPisiTaskMonth(month, 1) }) })
    );
    root.appendChild(nav);
    const grid = makePisiTaskPanelElement('div', 'pisi-task-calendar-grid');
    for (const label of ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'])
        grid.appendChild(makePisiTaskPanelElement('div', 'pisi-task-calendar-weekday', t(label)));
    const { cells, undated } = getPisiTaskMonthCells(month, visible, today);
    for (const cell of cells) {
        const day = makePisiTaskPanelElement('div', 'pisi-task-calendar-day');
        day.dataset.pisiTaskDay = cell.day;
        day.classList.toggle('outside', !cell.inMonth);
        day.classList.toggle('today', cell.today);
        const number = createPisiTaskPanelButton('pisi-task-calendar-day-number', String(Number(cell.day.slice(8))), {
            label: `${t('Günlüğü aç')}: ${formatPisiTaskPanelDay(cell.day)}`,
            onClick: () => void window.openPisiDiaryForDate?.(cell.day)
        });
        day.appendChild(number);
        const expanded = pisiTaskViewsState.expandedDays.has(cell.day);
        const limit = expanded ? cell.tasks.length : PISI_TASK_CALENDAR_DAY_LIMIT;
        for (const task of cell.tasks.slice(0, limit)) day.appendChild(makePisiTaskViewTaskButton(task, 'pisi-task-calendar-task'));
        if (cell.tasks.length > PISI_TASK_CALENDAR_DAY_LIMIT) {
            day.appendChild(
                createPisiTaskPanelButton('pisi-task-calendar-more', expanded ? t('Daha az') : `+${cell.tasks.length - PISI_TASK_CALENDAR_DAY_LIMIT}`, {
                    onClick: () => {
                        if (expanded) pisiTaskViewsState.expandedDays.delete(cell.day);
                        else pisiTaskViewsState.expandedDays.add(cell.day);
                        setPrefs({});
                    }
                })
            );
        }
        grid.appendChild(day);
    }
    root.appendChild(grid);
    appendPisiTaskUndatedTray(root, undated);
    body.replaceChildren(root);
}

// ---- Timeline ------------------------------------------------------------------------

function renderPisiTaskTimeline(body, { visible, tasks, today }) {
    const root = makePisiTaskPanelElement('div', 'pisi-task-timeline');
    const header = makePisiTaskPanelElement('header', 'pisi-task-timeline-header');
    header.append(makePisiTaskPanelElement('strong', '', t('Önümüzdeki 30 gün')), makePisiTaskPanelElement('span', '', formatPisiTaskPanelDay(today)));
    root.appendChild(header);
    const dependencies = getPisiTaskDependencyState(tasks);
    const { rows, undated } = getPisiTaskTimelineRows(visible, today, PISI_TASK_TIMELINE_SPAN);
    for (const row of rows.slice(0, PISI_TASK_PANEL_PAGE)) {
        const line = makePisiTaskPanelElement('div', 'pisi-task-timeline-row');
        line.classList.toggle('overdue', row.overdue && row.task.status !== 'done');
        line.classList.toggle('later', row.later);
        const label = makePisiTaskViewTaskButton(row.task, 'pisi-task-timeline-label', { blocked: dependencies.get(row.task.id)?.blocked === true });
        const track = makePisiTaskPanelElement('div', 'pisi-task-timeline-track');
        const marker = makePisiTaskPanelElement('span', 'pisi-task-timeline-marker');
        marker.style.left = `${row.position}%`;
        marker.setAttribute('aria-hidden', 'true');
        track.appendChild(marker);
        line.append(label, track, makePisiTaskPanelElement('time', '', formatPisiTaskPanelDay(row.day)));
        root.appendChild(line);
    }
    if (rows.length > PISI_TASK_PANEL_PAGE) root.appendChild(makePisiTaskPanelElement('span', 'pisi-task-view-rest', `+${rows.length - PISI_TASK_PANEL_PAGE}`));
    if (!rows.length && !undated.length) root.appendChild(makePisiTaskPanelElement('div', 'right-panel-empty', t('Bu süzgeçte görev yok.')));
    appendPisiTaskUndatedTray(root, undated);
    body.replaceChildren(root);
}

// ---- Progress ------------------------------------------------------------------------

function makePisiTaskStatCard(label, value, detail = '') {
    const card = makePisiTaskPanelElement('div', 'pisi-task-stat-card');
    card.dataset.pisiTaskStat = label;
    card.append(makePisiTaskPanelElement('strong', '', String(value)), makePisiTaskPanelElement('span', '', t(label)));
    if (detail) card.appendChild(makePisiTaskPanelElement('small', '', detail));
    return card;
}

function appendPisiTaskProgressRow(container, label, value, total) {
    const row = makePisiTaskPanelElement('div', 'pisi-task-progress-row');
    const header = makePisiTaskPanelElement('div', 'pisi-task-progress-label');
    header.append(makePisiTaskPanelElement('span', '', label), makePisiTaskPanelElement('b', '', String(value)));
    const track = makePisiTaskPanelElement('div', 'pisi-task-progress-track');
    const bar = makePisiTaskPanelElement('span');
    bar.style.width = `${total ? Math.round((value / total) * 100) : 0}%`;
    track.appendChild(bar);
    row.append(header, track);
    container.appendChild(row);
}

function renderPisiTaskStats(body, { tasks, today }) {
    const progress = getPisiTaskProgress(tasks, today);
    const root = makePisiTaskPanelElement('div', 'pisi-task-stats');
    const cards = makePisiTaskPanelElement('div', 'pisi-task-stat-cards');
    cards.append(
        makePisiTaskStatCard('Toplam görev', progress.total),
        makePisiTaskStatCard('Açık görev', progress.open),
        makePisiTaskStatCard('Tamamlanan görev', progress.completed, `%${progress.rate}`),
        makePisiTaskStatCard('Tamamlanan tekrarlar', progress.completedOccurrences),
        makePisiTaskStatCard('Bağımlılıktan bekleyen', progress.blocked),
        makePisiTaskStatCard('Geciken', progress.overdue)
    );
    root.appendChild(cards);
    const completion = makePisiTaskPanelElement('section', 'pisi-task-completion');
    const heading = makePisiTaskPanelElement('header');
    heading.append(makePisiTaskPanelElement('strong', '', t('Genel ilerleme')), makePisiTaskPanelElement('b', '', `%${progress.rate}`));
    const track = makePisiTaskPanelElement('div', 'pisi-task-progress-track');
    const bar = makePisiTaskPanelElement('span');
    bar.style.width = `${progress.rate}%`;
    track.appendChild(bar);
    completion.append(heading, track);
    root.appendChild(completion);
    const distributions = makePisiTaskPanelElement('div', 'pisi-task-stat-distributions');
    const statuses = makePisiTaskPanelElement('section');
    statuses.appendChild(makePisiTaskPanelElement('strong', '', t('Durum dağılımı')));
    for (const status of PISI_TASK_KANBAN_STATUSES)
        appendPisiTaskProgressRow(statuses, getPisiTaskStatusLabel(status), progress.byStatus[status], Math.max(1, progress.open));
    const priorities = makePisiTaskPanelElement('section');
    priorities.appendChild(makePisiTaskPanelElement('strong', '', t('Öncelik dağılımı')));
    for (let priority = 5; priority >= 1; priority -= 1) {
        appendPisiTaskProgressRow(priorities, `${t('Öncelik')} ${priority}`, progress.byPriority[priority], Math.max(1, progress.open));
    }
    distributions.append(statuses, priorities);
    root.appendChild(distributions);
    body.replaceChildren(root);
}

const PISI_TASK_VIEW_RENDERERS = Object.freeze({
    kanban: renderPisiTaskKanban,
    calendar: renderPisiTaskCalendar,
    timeline: renderPisiTaskTimeline,
    stats: renderPisiTaskStats
});

/** Draws a workspace view other than the list into `body`. */
export function renderPisiTaskAlternativeView(body, view, context) {
    const render = PISI_TASK_VIEW_RENDERERS[view];
    if (render) render(body, context);
}
