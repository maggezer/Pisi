// Settings: theme and language for now. Project info, version and the
// developer section arrive in M4 and M10.

import { h } from '../../ui/dom.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';

export function renderSettingsScreen({ t, themePreference, language, openOverlay }) {
    const row = (id, value) => renderListRow({ title: t(`settings.${id}`), value, chevron: true, dataset: { setting: id }, onClick: () => openOverlay(id) });
    return h(
        'section',
        { class: 'pisi-screen', dataset: { screen: 'settings' } },
        renderList({ label: t('screen.settings'), rows: [row('theme', t(`theme.${themePreference}`)), row('language', t(`language.${language}`))] })
    );
}
