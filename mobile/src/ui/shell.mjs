// App chrome: top header, the active screen and the bottom tab bar.
// Icons and the final look arrive with the design tokens in M3; until then
// the controls are plain labelled buttons.

import { h } from './dom.mjs';

export function renderShell({ t, title, tabs, activeTab, inSubScreen, body, sheet, onSelectTab, onOpenSettings, onBack }) {
    const header = h(
        'header',
        { class: 'pisi-header' },
        inSubScreen ? h('button', { type: 'button', class: 'pisi-button', dataset: { action: 'back' }, onClick: onBack }, t('action.back')) : null,
        h('h1', { class: 'pisi-header-title' }, title),
        inSubScreen
            ? null
            : h(
                  'button',
                  { type: 'button', class: 'pisi-button', dataset: { action: 'settings' }, 'aria-label': t('action.openSettings'), onClick: onOpenSettings },
                  t('screen.settings')
              )
    );

    const nav = inSubScreen
        ? null
        : h(
              'nav',
              { class: 'pisi-tabs', 'aria-label': t('nav.label') },
              tabs.map((tab) =>
                  h(
                      'button',
                      {
                          type: 'button',
                          class: 'pisi-tab',
                          dataset: { tab: tab.id },
                          'aria-current': tab.id === activeTab ? 'page' : null,
                          onClick: () => onSelectTab(tab.id)
                      },
                      tab.label
                  )
              )
          );

    return h('div', { class: 'pisi-shell' }, header, h('main', { class: 'pisi-main' }, body), nav, sheet);
}
