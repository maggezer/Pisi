// Settings: theme and language, a short project summary and, in debug builds,
// the developer section. Version and the transfer note arrive in M10.

import { h } from '../../ui/dom.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';

export function renderSettingsScreen({
    t,
    themePreference,
    language,
    openOverlay,
    project = null,
    developer = false,
    onLoadSample = null,
    onLoadSampleMap = null
}) {
    const row = (id, value) => renderListRow({ title: t(`settings.${id}`), value, chevron: true, dataset: { setting: id }, onClick: () => openOverlay(id) });
    const heading = (key) => h('h2', { class: 'pisi-section-title' }, t(key));
    const sections = [
        renderList({ label: t('screen.settings'), rows: [row('theme', t(`theme.${themePreference}`)), row('language', t(`language.${language}`))] })
    ];

    if (project) {
        const count = (id) => renderListRow({ title: t(`project.${id}`), value: project.counts ? String(project.counts[id]) : '…', dataset: { project: id } });
        // The project folder has no name of its own on disk; the first project is shown under this name.
        const name = renderListRow({ title: t('project.name'), value: t('project.defaultName'), dataset: { project: 'name' } });
        sections.push(heading('settings.project'), renderList({ label: t('settings.project'), rows: [name, count('tasks'), count('notes'), count('maps')] }));
        if (project.readOnlyFiles.length) {
            sections.push(
                h(
                    'p',
                    { class: 'pisi-notice', role: 'alert', dataset: { project: 'read-only' } },
                    t('project.readOnlyNotice', { count: project.readOnlyFiles.length })
                ),
                renderList({
                    label: t('project.readOnlyFiles'),
                    rows: project.readOnlyFiles.map((key) => renderListRow({ title: key, meta: t('project.readOnly') }))
                })
            );
        }
    }

    if (developer && project) {
        sections.push(
            heading('settings.developer'),
            renderList({
                label: t('settings.developer'),
                rows: [
                    onLoadSample
                        ? renderListRow({
                              title: t('developer.loadSample'),
                              meta: t('developer.loadSampleNote'),
                              dataset: { developer: 'load-sample' },
                              onClick: onLoadSample
                          })
                        : null,
                    onLoadSampleMap
                        ? renderListRow({
                              title: t('developer.loadSampleMap'),
                              meta: t('developer.loadSampleMapNote'),
                              dataset: { developer: 'load-sample-map' },
                              onClick: onLoadSampleMap
                          })
                        : null
                ].filter(Boolean)
            })
        );
    }

    return h('section', { class: 'pisi-screen', dataset: { screen: 'settings' } }, sections);
}
