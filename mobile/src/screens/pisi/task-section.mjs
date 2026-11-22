// The task part of the Pisi tab: the groups of the selected day (its diary
// section and, today, the overdue tasks). They are drawn again whenever the
// tasks change; the "add task" line under them (ui/task-add.mjs) is built
// once, so what is being typed survives.

import { formatShortDay } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderTaskRow } from '../../ui/task-row.mjs';
import { getTaskTime } from './day-model.mjs';

/**
 * The meta line of a task row. `showDate`: the task's own day is shown (an
 * overdue task, a task living in a diary of another day). `placeTitle`: the
 * note the task lives in, when the row is not in that note.
 */
export function getTaskRowMeta({ task, day }, { t, locale, today, showDate = false, placeTitle = null }) {
    const time = getTaskTime(task);
    return [
        showDate && day ? { kind: 'date', text: formatShortDay(day, locale, today) } : null,
        time ? { kind: 'time', text: time } : null,
        { kind: 'priority', level: task.priority, text: t(`priority.${task.priority}`) },
        task.repeat && task.repeat !== 'none' ? { kind: 'repeat', text: t(`repeat.${task.repeat}`) } : null,
        placeTitle ? { kind: 'source', text: placeTitle } : null
    ].filter(Boolean);
}

/** The checkbox name of a row: what it does, or why it is locked. */
export function getTaskCheckLabel(t, task, { done, locked = false }) {
    if (locked) return t('task.completionLocked', { title: task.title });
    return done ? t('task.reopen', { title: task.title }) : t('task.complete', { title: task.title });
}

/**
 * The groups: "Gecikmiş" (today only), the day itself and the collapsed
 * "Tamamlanan (n)". `getPlaceTitle(task)` names the note a task lives in.
 */
export function renderTaskGroups({
    t,
    locale,
    groups,
    selectedDate,
    today,
    loaded,
    readOnly,
    completedOpen,
    getPlaceTitle = () => null,
    onToggle,
    onOpen,
    onToggleCompleted
}) {
    const row = (entry, options = {}) => {
        const done = entry.state.state === 'done' || entry.task.status === 'done';
        const locked = Boolean(entry.state.locked);
        return renderTaskRow({
            id: entry.task.id,
            title: entry.task.title,
            done,
            locked,
            late: Boolean(options.late),
            meta: getTaskRowMeta(entry, {
                t,
                locale,
                today,
                showDate: Boolean(options.late) || (entry.day ?? null) !== selectedDate,
                placeTitle: getPlaceTitle(entry.task)
            }),
            checkLabel: getTaskCheckLabel(t, entry.task, { done, locked }),
            onToggle: (id) => onToggle(id, options.late ? null : selectedDate),
            onOpen
        });
    };
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
    if (groups.overdue.length) parts.push(group('overdue', t('pisi.overdue'), groups.overdue, { late: true }));
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
