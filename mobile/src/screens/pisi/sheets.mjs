// The menu behind the Pisi tab's launcher button. (The task detail both tabs
// open is in screens/tasks/task-sheets.mjs; the date sheet in ui/date-picker.mjs.)

import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderSheet } from '../../ui/overlay.mjs';

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
