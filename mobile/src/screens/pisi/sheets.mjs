// The sheets the Pisi tab opens: the menu behind the launcher button and the
// read-only task detail. (The editable detail arrives with the Tasks tab, M6.)

import { formatDayTitle } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';
import { renderSheet } from '../../ui/overlay.mjs';
import { getPisiTaskCalendarIsoDate } from '../../../../shared/task-views.mjs';
import { getTaskSourceTitle, getTaskTime } from './day-model.mjs';

export const PISI_MENU_ITEMS = Object.freeze(['tasks', 'notes', 'calendar', 'maps', 'settings']);

/** Every other screen, one tap away: an icon and its name. */
export function renderMenuSheet({ t, onSelect, onClose }) {
    return renderSheet({
        id: 'pisi-menu',
        title: t('pisi.menu'),
        closeLabel: t('action.close'),
        onClose,
        children: h(
            'nav',
            { class: 'pisi-menu', 'aria-label': t('pisi.menu') },
            PISI_MENU_ITEMS.map((id, index) =>
                h(
                    'button',
                    { type: 'button', class: 'pisi-menu-item', 'data-autofocus': index === 0 ? '' : null, dataset: { menu: id }, onClick: () => onSelect(id) },
                    h('span', { class: 'pisi-menu-icon' }, icon(id)),
                    h('span', { class: 'pisi-menu-label' }, id === 'settings' ? t('screen.settings') : t(`tab.${id}`))
                )
            )
        )
    });
}

export function renderTaskDetailSheet({ t, locale, today, task, onClose }) {
    const day = getPisiTaskCalendarIsoDate(task);
    const deadline = String(task.deadline || '').slice(0, 10);
    const row = (id, value) => (value ? renderListRow({ title: t(`task.${id}`), value, dataset: { taskField: id } }) : null);
    return renderSheet({
        id: 'pisi-task',
        title: t('task.detail'),
        closeLabel: t('action.close'),
        onClose,
        children: [
            h('p', { class: 'pisi-task-detail-title', tabindex: '-1', 'data-autofocus': '' }, task.title),
            renderList({
                label: t('task.detail'),
                rows: [
                    row('status', t(`status.${task.status}`)),
                    row('priority', t(`priority.${task.priority}`)),
                    row('date', day ? formatDayTitle(day, locale, today) : t('task.noDate')),
                    row('time', getTaskTime(task)),
                    row('deadline', deadline && deadline !== day ? formatDayTitle(deadline, locale, today) : null),
                    row('repeat', task.repeat && task.repeat !== 'none' ? t(`repeat.${task.repeat}`) : null),
                    row('source', getTaskSourceTitle(task))
                ].filter(Boolean)
            }),
            h('p', { class: 'pisi-task-detail-note' }, t('task.readOnlyNote'))
        ]
    });
}
