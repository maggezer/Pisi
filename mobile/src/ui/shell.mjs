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

/**
 * The app chrome around a screen: header, the screen and the bottom
 * navigation. The layer above the screen (sheet, snackbar, floating button)
 * is set with `setLayer`; a sheet that is the same element as before is left
 * where it is, so a field being typed in keeps its focus.
 */
export function createShell({ t, title, tabs, activeTab, inSubScreen, body, onSelectTab, onOpenSettings, onBack }) {
    const header = renderHeader({
        title,
        leading: inSubScreen ? renderIconButton({ icon: 'back', label: t('action.back'), dataset: { action: 'back' }, onClick: onBack }) : null,
        trailing: inSubScreen
            ? null
            : renderIconButton({ icon: 'settings', label: t('action.openSettings'), dataset: { action: 'settings' }, onClick: onOpenSettings })
    });
    const nav = inSubScreen ? null : renderBottomNav({ label: t('nav.label'), items: tabs, active: activeTab, onSelect: onSelectTab });
    const layer = createLayer();
    const element = h('div', { class: 'pisi-shell' }, header, h('div', { class: 'pisi-body' }, h('main', { class: 'pisi-main' }, body), layer.element), nav);
    return { element, setLayer: layer.set };
}

/** A shell drawn once, with its layer: for screens that are drawn again from scratch on every change. */
export function renderShell({ sheet = null, snackbar = null, fab = null, ...chrome }) {
    const shell = createShell(chrome);
    shell.setLayer({ sheet, snackbar, fab });
    return shell.element;
}

// What floats above a screen. The floating group and the sheet are separate children, replaced separately.
function createLayer() {
    const element = h('div', { class: 'pisi-layer' });
    let floating = null;
    let currentSheet = null;
    return {
        element,
        set({ sheet = null, snackbar = null, fab = null }) {
            floating?.remove();
            floating = fab || snackbar ? h('div', { class: 'pisi-floating' }, fab, snackbar) : null;
            if (floating) element.prepend(floating);
            if (sheet === currentSheet) return;
            currentSheet?.remove();
            currentSheet = sheet;
            if (sheet) element.append(sheet);
        }
    };
}

/**
 * Chrome of the Pisi tab: no header and no bottom navigation, the screen
 * fills the window. The screen element stays in place between redraws; only
 * the layer above it (sheet, snackbar) is replaced with `setLayer`.
 */
export function renderHomeShell({ body }) {
    const layer = createLayer();
    const element = h(
        'div',
        { class: 'pisi-shell pisi-shell-home' },
        h('div', { class: 'pisi-body' }, h('main', { class: 'pisi-main pisi-main-home' }, body), layer.element)
    );
    return { element, setLayer: layer.set };
}
