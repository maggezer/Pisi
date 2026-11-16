// Settings (docs/mobile-plan.md M10): theme and language, what is in the
// project and whether every file could be read, the app version, a note that
// moving the project between devices comes later, and, in debug builds, the
// developer section. There is no sync set-up here (G13): transfer has its own plan.

import { h } from '../../ui/dom.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';

/** The version line: `0.1.0`, or `0.1.0 (42)` when the build carries the APK's version code; a dash when unknown. */
export function formatAppVersion(version) {
    const name = String(version?.name ?? '').trim();
    const code = String(version?.build ?? '').trim();
    if (!name) return '—';
    return code ? `${name} (${code})` : name;
}

function renderProjectSection({ t, project }) {
    const counted = Boolean(project.counts);
    const count = (id) => renderListRow({ title: t(`project.${id}`), value: counted ? String(project.counts[id]) : '…', dataset: { project: id } });
    // The project folder has no name of its own on disk; the first project is shown under this name.
    const name = renderListRow({ title: t('project.name'), value: t('project.defaultName'), dataset: { project: 'name' } });
    const unreadable = project.readOnlyFiles.length;
    const integrity = renderListRow({
        title: t('project.integrity'),
        value: !counted ? '…' : unreadable ? t('project.readOnlyCount', { count: unreadable }) : t('project.healthy'),
        dataset: { project: 'integrity', state: !counted ? 'checking' : unreadable ? 'read-only' : 'healthy' }
    });
    const sections = [
        h('h2', { class: 'pisi-section-title' }, t('settings.project')),
        renderList({ label: t('settings.project'), rows: [name, count('tasks'), count('notes'), count('diary'), count('maps'), integrity] })
    ];
    if (unreadable) {
        sections.push(
            h('p', { class: 'pisi-notice', role: 'alert', dataset: { project: 'read-only' } }, t('project.readOnlyNotice', { count: unreadable })),
            renderList({
                label: t('project.readOnlyFiles'),
                rows: project.readOnlyFiles.map((key) => renderListRow({ title: key, meta: t('project.readOnly') }))
            })
        );
    }
    return sections;
}

function renderAboutSection({ t, version }) {
    return [
        h('h2', { class: 'pisi-section-title' }, t('settings.about')),
        renderList({
            label: t('settings.about'),
            rows: [
                renderListRow({ title: t('settings.version'), value: formatAppVersion(version), dataset: { about: 'version' } }),
                renderListRow({
                    title: t('settings.transfer'),
                    meta: t('settings.transferNote'),
                    value: t('settings.transferSoon'),
                    dataset: { about: 'transfer' }
                })
            ]
        })
    ];
}

function renderDeveloperSection({ t, onLoadSample, onLoadSampleMap }) {
    const rows = [
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
    ].filter(Boolean);
    return [h('h2', { class: 'pisi-section-title' }, t('settings.developer')), renderList({ label: t('settings.developer'), rows })];
}

export function renderSettingsScreen({
    t,
    themePreference,
    language,
    openOverlay,
    version = null,
    project = null,
    developer = false,
    onLoadSample = null,
    onLoadSampleMap = null
}) {
    const row = (id, value) => renderListRow({ title: t(`settings.${id}`), value, chevron: true, dataset: { setting: id }, onClick: () => openOverlay(id) });
    const sections = [
        renderList({ label: t('screen.settings'), rows: [row('theme', t(`theme.${themePreference}`)), row('language', t(`language.${language}`))] })
    ];
    if (project) sections.push(...renderProjectSection({ t, project }));
    sections.push(...renderAboutSection({ t, version }));
    if (developer && project) sections.push(...renderDeveloperSection({ t, onLoadSample, onLoadSampleMap }));
    return h('section', { class: 'pisi-screen', dataset: { screen: 'settings' } }, sections);
}
