// Settings: theme and language for now. Project info, version and the
// developer section arrive in M4 and M10.

import { h } from '../../ui/dom.mjs';

function settingRow({ id, label, value, onOpen }) {
    return h(
        'button',
        { type: 'button', class: 'pisi-setting', dataset: { setting: id }, onClick: onOpen },
        h('span', { class: 'pisi-setting-label' }, label),
        h('span', { class: 'pisi-setting-value' }, value)
    );
}

export function renderSettingsScreen({ t, themePreference, language, openOverlay }) {
    return h(
        'section',
        { class: 'pisi-screen', dataset: { screen: 'settings' } },
        settingRow({ id: 'theme', label: t('settings.theme'), value: t(`theme.${themePreference}`), onOpen: () => openOverlay('theme') }),
        settingRow({ id: 'language', label: t('settings.language'), value: t(`language.${language}`), onOpen: () => openOverlay('language') })
    );
}
