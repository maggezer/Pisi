// The task part of the Pisi tab: the groups of the selected day and the
// "add task" line. The groups are drawn again whenever the tasks change; the
// add line is built once, so what is being typed survives those redraws.

import { formatShortDay } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderTaskRow } from '../../ui/task-row.mjs';
import { getTaskSourceTitle, getTaskTime } from './day-model.mjs';

export function getTaskRowMeta({ task, day }, { t, locale, today, showDate = false }) {
    const time = getTaskTime(task);
    const source = getTaskSourceTitle(task);
    return [
        showDate && day ? { kind: 'date', text: formatShortDay(day, locale, today) } : null,
        time ? { kind: 'time', text: time } : null,
        { kind: 'priority', level: task.priority, text: t(`priority.${task.priority}`) },
        task.repeat && task.repeat !== 'none' ? { kind: 'repeat', text: t(`repeat.${task.repeat}`) } : null,
        source ? { kind: 'source', text: source } : null
    ].filter(Boolean);
}

/** The groups: "Gecikmiş" (today only), the day itself and the collapsed "Tamamlanan (n)". */
export function renderTaskGroups({ t, locale, groups, selectedDate, today, loaded, readOnly, completedOpen, onToggle, onOpen, onToggleCompleted }) {
    const row = (entry, options = {}) =>
        renderTaskRow({
            id: entry.task.id,
            title: entry.task.title,
            done: entry.task.status === 'done',
            late: Boolean(options.showDate),
            meta: getTaskRowMeta(entry, { t, locale, today, ...options }),
            checkLabel: entry.task.status === 'done' ? t('task.reopen', { title: entry.task.title }) : t('task.complete', { title: entry.task.title }),
            onToggle,
            onOpen
        });
    const list = (entries, options) =>
        h(
            'ul',
            { class: 'pisi-task-list' },
            entries.map((entry) => h('li', { class: 'pisi-task-item' }, row(entry, options)))
        );
    const group = (id, title, entries, options) =>
        h(
            'div',
            { class: `pisi-task-group pisi-task-group-${id}`, role: 'group', 'aria-label': title, dataset: { group: id } },
            h('h3', { class: 'pisi-task-group-title' }, title, h('span', { class: 'pisi-task-group-count' }, entries.length)),
            list(entries, options)
        );

    const parts = [];
    if (readOnly) parts.push(h('p', { class: 'pisi-home-notice', role: 'alert', dataset: { tasks: 'read-only' } }, t('pisi.tasksReadOnly')));
    if (groups.overdue.length) parts.push(group('overdue', t('pisi.overdue'), groups.overdue, { showDate: true }));
    if (groups.day.length) parts.push(group('day', t('pisi.thisDay'), groups.day));
    else if (loaded && !readOnly) {
        parts.push(h('p', { class: 'pisi-home-empty', dataset: { tasks: 'empty' } }, selectedDate === today ? t('pisi.noTasksToday') : t('pisi.noTasks')));
    }
    if (groups.done.length) {
        const title = t('pisi.completed', { count: groups.done.length });
        parts.push(
            h(
                'div',
                { class: 'pisi-task-group pisi-task-group-done', dataset: { group: 'done' } },
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'pisi-task-group-toggle',
                        'aria-expanded': completedOpen ? 'true' : 'false',
                        dataset: { action: 'toggle-completed' },
                        onClick: onToggleCompleted
                    },
                    icon('chevron-down'),
                    title
                ),
                completedOpen ? list(groups.done) : null
            )
        );
    }
    return h('div', { class: 'pisi-task-groups', 'aria-busy': loaded ? 'false' : 'true' }, parts);
}

/**
 * The "add task" line. `describe(text)` returns the chips to show for what
 * has been typed (the day and time the parser read, a repeat), or [].
 */
export function createTaskAddRow({ t, describe, onSubmit }) {
    const input = h('input', {
        type: 'text',
        id: 'pisi-task-add',
        class: 'pisi-task-add-input',
        placeholder: t('pisi.addTask'),
        'aria-label': t('pisi.addTask'),
        'aria-describedby': 'pisi-task-add-chips',
        autocomplete: 'off',
        autocapitalize: 'sentences',
        enterkeyhint: 'done',
        dataset: { action: 'add-task-input' }
    });
    const submit = h(
        'button',
        { type: 'submit', class: 'pisi-task-add-submit', 'aria-label': t('pisi.addTaskSubmit'), disabled: true, dataset: { action: 'add-task' } },
        icon('check')
    );
    const chips = h('p', { class: 'pisi-task-add-chips', id: 'pisi-task-add-chips', 'aria-live': 'polite', hidden: true });
    const form = h(
        'form',
        { class: 'pisi-task-add', novalidate: true },
        h('div', { class: 'pisi-task-add-line' }, h('span', { class: 'pisi-task-add-icon' }, icon('plus')), input, submit),
        chips
    );

    function refresh() {
        const items = input.value.trim() ? describe(input.value) : [];
        submit.disabled = !input.value.trim() || input.readOnly;
        chips.replaceChildren(
            ...items.map((item) => h('span', { class: 'pisi-parse-chip', dataset: { chip: item.kind } }, item.icon ? icon(item.icon) : null, item.text))
        );
        chips.hidden = !items.length;
    }

    input.addEventListener('input', refresh);
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || input.readOnly) return;
        input.value = '';
        refresh();
        onSubmit(text);
    });

    return {
        element: form,
        input,
        refresh,
        setReadOnly(readOnly) {
            input.readOnly = readOnly;
            refresh();
        }
    };
}
