// The Tasks tab (docs/mobile-plan.md M6): quick add on top, the view chips
// under it and the list of the chosen view. Like the Pisi tab it is built
// once and updated in place, so the line being typed in the quick add
// survives the redraws around it. Which task is in which view is worked out
// in view-model.mjs; the tasks themselves come from the shared controller.

import { renderButton } from '../../ui/button.mjs';
import { renderChip, renderChipRow, syncChipRowFade } from '../../ui/chip.mjs';
import { formatShortDay, shiftIsoDate } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { renderEmptyState } from '../../ui/list.mjs';
import { renderChoiceSheet } from '../../ui/overlay.mjs';
import { createTaskAddRow } from '../../ui/task-add.mjs';
import { renderTaskRow } from '../../ui/task-row.mjs';
import { parseTaskDraft } from '../pisi/day-model.mjs';
import { getTaskRowMeta } from '../pisi/task-section.mjs';
import { PISI_TASK_PRIORITY_VALUES } from './task-edit.mjs';
import {
    PISI_DEFAULT_TASK_VIEW,
    PISI_TASK_PAGE_SIZE,
    PISI_TASK_VIEWS,
    buildTaskLists,
    getTaskView,
    getTaskViewCounts,
    getTaskViewGroups
} from './view-model.mjs';

export const PISI_OVERLAY_QUICK_PRIORITY = 'tasks-priority';
const DEFAULT_PRIORITY = 3;
const VIEW_ICONS = Object.freeze({ today: 'calendar', upcoming: 'calendar', overdue: 'clock', inbox: 'inbox', done: 'check' });

/**
 * `tasks` is the task controller; `snackbar` the app's snackbar controller.
 * The app owns navigation: `onOpenTask(id)` opens the detail sheet,
 * `onOpenOverlay` / `onCloseOverlay` the priority sheet of the quick add.
 */
export function createTasksScreen({ tasks, snackbar, now, onOpenTask, onOpenOverlay, onCloseOverlay }) {
    const element = h('section', { class: 'pisi-screen pisi-tasks', dataset: { screen: 'tasks' } });
    const state = { view: PISI_DEFAULT_TASK_VIEW, priority: DEFAULT_PRIORITY, limit: PISI_TASK_PAGE_SIZE };
    let context = null;
    let parts = null;
    let dirty = true;

    function describeDay(day) {
        const { t, locale, today } = context;
        if (day === today) return t('pisi.today');
        if (day === shiftIsoDate(today, 1)) return t('date.tomorrow');
        return formatShortDay(day, locale, today);
    }

    // The chips under the quick add: how the line was read, and the priority, which is picked and not typed.
    function describeDraft(text) {
        const { t } = context;
        const draft = parseTaskDraft(text, { now: now() });
        if (!draft) return [];
        const day = draft.day ? describeDay(draft.day) : null;
        return [
            day
                ? { kind: 'date', icon: 'calendar', text: draft.deadline ? t('pisi.chipDeadline', { date: day }) : day }
                : { kind: 'inbox', icon: 'inbox', text: t('tasks.view.inbox') },
            draft.time ? { kind: 'time', icon: 'clock', text: draft.time } : null,
            {
                kind: 'priority',
                text: t('tasks.chipPriority', { level: state.priority }),
                label: t('tasks.pickPriority', { level: state.priority, name: t(`priority.${state.priority}`) }),
                onClick: () => onOpenOverlay(PISI_OVERLAY_QUICK_PRIORITY)
            },
            draft.repeat !== 'none' ? { kind: 'repeat', icon: 'repeat', text: t(`repeat.${draft.repeat}`) } : null
        ].filter(Boolean);
    }

    async function addTask(text) {
        const draft = parseTaskDraft(text, { now: now() });
        if (!draft) return;
        const priority = state.priority;
        state.priority = DEFAULT_PRIORITY;
        const result = await tasks.add({ ...draft.payload, priority });
        if (!result?.ok || !context) return;
        // A task that went to another view is not in the list being looked at; the user is told where it is.
        const view = getTaskView(result.task, { today: context.today });
        if (view !== state.view) snackbar.show({ message: context.t('tasks.addedTo', { view: context.t(`tasks.view.${view}`) }) });
    }

    function selectView(view) {
        if (view === state.view) return;
        state.view = view;
        state.limit = PISI_TASK_PAGE_SIZE;
        draw();
        parts.chips[view].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        parts.chips[view].focus();
    }

    function build() {
        const { t } = context;
        const addRow = createTaskAddRow({ t, id: 'pisi-quick-add', describe: describeDraft, onSubmit: (text) => void addTask(text) });
        const chips = Object.fromEntries(
            PISI_TASK_VIEWS.map((view) => [view, renderChip({ label: t(`tasks.view.${view}`), count: 0, dataset: { view }, onClick: () => selectView(view) })])
        );
        const chipRow = renderChipRow({
            label: t('tasks.views'),
            chips: PISI_TASK_VIEWS.map((view) => chips[view])
        });
        const list = h('div', { class: 'pisi-tasks-list' });
        parts = { addRow, chips, chipRow, list };
        element.replaceChildren(h('div', { class: 'pisi-tasks-top' }, addRow.element, chipRow), list);
    }

    function renderRow(entry, view) {
        const { t, locale, today } = context;
        const { task } = entry;
        return renderTaskRow({
            id: task.id,
            title: task.title,
            done: task.status === 'done',
            late: view === 'overdue',
            meta: getTaskRowMeta(entry, { t, locale, today, showDate: view !== 'today' }),
            checkLabel: task.status === 'done' ? t('task.reopen', { title: task.title }) : t('task.complete', { title: task.title }),
            onToggle: (id) => void tasks.toggle(id),
            onOpen: onOpenTask
        });
    }

    function renderGroups(groups, grouped) {
        const { t } = context;
        let room = state.limit;
        const drawn = [];
        for (const group of groups) {
            if (room <= 0) break;
            const entries = group.entries.slice(0, room);
            room -= entries.length;
            const list = h(
                'ul',
                { class: 'pisi-task-list' },
                entries.map((entry) => h('li', { class: 'pisi-task-item' }, renderRow(entry, state.view)))
            );
            const title = grouped ? t(`tasks.group.${group.id}`) : null;
            drawn.push(
                grouped
                    ? h(
                          'div',
                          { class: `pisi-task-group pisi-task-group-${group.id}`, role: 'group', 'aria-label': title, dataset: { group: group.id } },
                          h('h2', { class: 'pisi-task-group-title' }, title, h('span', { class: 'pisi-task-group-count' }, group.entries.length)),
                          list
                      )
                    : h('div', { class: 'pisi-task-group', dataset: { group: group.id } }, list)
            );
        }
        const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
        if (total > state.limit) {
            drawn.push(
                renderButton({
                    label: t('tasks.showMore', { count: total - state.limit }),
                    variant: 'text',
                    block: true,
                    dataset: { action: 'show-more' },
                    onClick() {
                        state.limit += PISI_TASK_PAGE_SIZE;
                        draw();
                    }
                })
            );
        }
        return drawn;
    }

    function draw() {
        const { t, today } = context;
        dirty = false;
        const lists = buildTaskLists(tasks.getTasks(), { today });
        const counts = getTaskViewCounts(lists);
        for (const view of PISI_TASK_VIEWS) {
            parts.chips[view].setAttribute('aria-pressed', view === state.view ? 'true' : 'false');
            parts.chips[view].querySelector('.pisi-chip-count').textContent = String(counts[view]);
        }
        syncChipRowFade(parts.chipRow);

        const groups = getTaskViewGroups(lists, state.view);
        const content = [];
        if (tasks.isReadOnly()) content.push(h('p', { class: 'pisi-notice', role: 'alert', dataset: { tasks: 'read-only' } }, t('pisi.tasksReadOnly')));
        if (groups.length) content.push(...renderGroups(groups, state.view === 'upcoming'));
        else if (tasks.isLoaded() && !tasks.isReadOnly()) {
            content.push(h('div', { dataset: { tasks: 'empty' } }, renderEmptyState({ icon: VIEW_ICONS[state.view], title: t(`tasks.empty.${state.view}`) })));
        }
        parts.list.setAttribute('aria-busy', tasks.isLoaded() ? 'false' : 'true');
        parts.list.replaceChildren(...content);
        parts.addRow.setReadOnly(tasks.isReadOnly() || !tasks.isLoaded());
    }

    const stop = tasks.subscribe(() => {
        // Off screen nothing is drawn; the list is brought up to date when the tab is opened again.
        if (context && element.isConnected) draw();
        else dirty = true;
    });

    return {
        element,

        /** Draws the screen for `{ t, locale, today }`. Only what changed is touched. */
        update(next) {
            const rebuilt = !context || context.t !== next.t;
            const todayChanged = !context || context.today !== next.today;
            context = next;
            if (rebuilt) build();
            if (rebuilt || todayChanged || dirty) draw();
        },

        /** The screen is in the document again: the chip row needs its layout to know which edge fades. */
        attach() {
            if (parts) syncChipRowFade(parts.chipRow);
        },

        /** The sheet for one of this screen's overlay ids, or null when the id is not ours. */
        renderOverlay(id) {
            if (!context || id !== PISI_OVERLAY_QUICK_PRIORITY) return null;
            const { t } = context;
            return renderChoiceSheet({
                id: PISI_OVERLAY_QUICK_PRIORITY,
                title: t('task.priority'),
                options: PISI_TASK_PRIORITY_VALUES.map((value) => ({ value: String(value), label: t(`priority.${value}`) })),
                selected: String(state.priority),
                closeLabel: t('action.close'),
                onClose: onCloseOverlay,
                onSelect(value) {
                    state.priority = Number(value);
                    parts.addRow.refresh();
                    onCloseOverlay();
                }
            });
        },

        /** Selector of the control that opened an overlay of this screen; focus returns to it. */
        getOverlayOpener: (id) => (id === PISI_OVERLAY_QUICK_PRIORITY ? '[data-screen="tasks"] [data-chip="priority"]' : null),

        destroy: stop
    };
}
