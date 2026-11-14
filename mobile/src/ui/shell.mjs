// App chrome: top header, the active screen and the labelled bottom navigation.

import { renderIconButton } from './button.mjs';
import { h } from './dom.mjs';
import { icon } from './icons.mjs';

/** Top header: an optional leading control, the title and optional trailing controls. */
export function renderHeader({ title, leading = null, trailing = null }) {
    return h('header', { class: 'pisi-header' }, leading, h('h1', { class: 'pisi-header-title' }, title), trailing);
}

/** Bottom navigation: every item has an icon and a visible label; the active one is marked with aria-current. */
export function renderBottomNav({ label, items, active, onSelect }) {
    return h(
        'nav',
        { class: 'pisi-tabs', 'aria-label': label },
        items.map((item) =>
            h(
                'button',
                {
                    type: 'button',
                    class: 'pisi-tab',
                    dataset: { tab: item.id },
                    'aria-current': item.id === active ? 'page' : null,
                    onClick: () => onSelect(item.id)
                },
                h('span', { class: 'pisi-tab-icon' }, icon(item.icon)),
                h('span', { class: 'pisi-tab-label' }, item.label)
            )
        )
    );
}

export function renderShell({ t, title, tabs, activeTab, inSubScreen, body, sheet = null, snackbar = null, fab = null, onSelectTab, onOpenSettings, onBack }) {
    const header = renderHeader({
        title,
        leading: inSubScreen ? renderIconButton({ icon: 'back', label: t('action.back'), dataset: { action: 'back' }, onClick: onBack }) : null,
        trailing: inSubScreen
            ? null
            : renderIconButton({ icon: 'settings', label: t('action.openSettings'), dataset: { action: 'settings' }, onClick: onOpenSettings })
    });
    const nav = inSubScreen ? null : renderBottomNav({ label: t('nav.label'), items: tabs, active: activeTab, onSelect: onSelectTab });
    const floating = fab || snackbar ? h('div', { class: 'pisi-floating' }, fab, snackbar) : null;
    return h('div', { class: 'pisi-shell' }, header, h('div', { class: 'pisi-body' }, h('main', { class: 'pisi-main' }, body), floating), nav, sheet);
}
