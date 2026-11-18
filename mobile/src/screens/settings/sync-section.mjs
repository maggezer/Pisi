// Settings → Sync (docs/sync-plan.md S5 step 4): pairing when the phone is not
// bound; otherwise the project it is bound to, the state of the last turn,
// "Sync now", the conflict log and "Remove this device". The status comes from
// sync/sync-service.mjs; this file only draws it.

import { h } from '../../ui/dom.mjs';
import { formatByteSize } from '../../ui/byte-size.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';

/** "17 Kas 10:42" in the app's language; an em dash when unknown. */
export function formatSyncTime(iso, locale) {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** The words for a status: the state, and for an error its code. */
export function describeSyncState(t, status) {
    if (status.running) return t('sync.state.running');
    if (status.state === 'error') return t('sync.state.errorCode', { code: status.code || 'INTERNAL' });
    return t(`sync.state.${status.state}`);
}

/** "Downloading: 120 / 2,000 files" with the bytes under it, while a large turn runs (S6). */
function renderProgressRow({ t, locale, progress }) {
    const { files, bytes } = progress;
    const percent = files.total ? Math.round((files.done / files.total) * 100) : 0;
    const bar = h('span', { class: 'pisi-sync-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) });
    bar.style.setProperty('--pisi-progress', `${percent}%`);
    return renderListRow({
        title: t(`sync.progress.${progress.phase}`, { done: files.done, total: files.total }),
        meta: bytes.total ? t('sync.progress.bytes', { done: formatByteSize(bytes.done, locale), total: formatByteSize(bytes.total, locale) }) : null,
        trailing: bar,
        dataset: { sync: 'progress', phase: progress.phase }
    });
}

const deferredCount = (status) => (status.issues || []).filter((issue) => issue.code === 'DEFERRED_DIRTY').length;

export function renderSyncSection({ t, locale, status, onPair, onSyncNow, onOpenConflicts, onUnpair }) {
    const title = h('h2', { class: 'pisi-section-title' }, t('settings.sync'));
    if (status.state === 'unpaired' || status.state === 'unreadable') {
        const notice =
            status.state === 'unreadable'
                ? h('p', { class: 'pisi-notice', role: 'alert', dataset: { sync: 'unreadable' } }, t('sync.unreadable'))
                : status.code === 'DEVICE_REVOKED'
                  ? h('p', { class: 'pisi-notice', role: 'status', dataset: { sync: 'revoked' } }, t('sync.revokedNotice'))
                  : null;
        const rows = [
            status.state === 'unreadable'
                ? renderListRow({ title: t('sync.unpair'), dataset: { sync: 'unpair' }, onClick: onUnpair })
                : renderListRow({ title: t('sync.pair'), meta: t('sync.pairNote'), chevron: true, dataset: { sync: 'pair' }, onClick: onPair })
        ];
        return [title, notice, renderList({ label: t('settings.sync'), rows })].filter(Boolean);
    }

    const waiting = deferredCount(status);
    const rows = [
        renderListRow({ title: t('sync.space'), value: status.spaceName || t('project.defaultName'), dataset: { sync: 'space' } }),
        renderListRow({
            title: t('sync.status'),
            value: describeSyncState(t, status),
            meta: waiting ? t('sync.pending', { count: waiting }) : null,
            dataset: { sync: 'status', state: status.running ? 'running' : status.state }
        }),
        status.running && status.progress ? renderProgressRow({ t, locale, progress: status.progress }) : null,
        renderListRow({
            title: t('sync.lastRun'),
            value: status.lastRun ? formatSyncTime(status.lastRun.at, locale) : t('sync.never'),
            dataset: { sync: 'last-run' }
        }),
        status.state === 'stopped'
            ? null
            : renderListRow({ title: t('sync.syncNow'), dataset: { sync: 'sync-now' }, onClick: status.running ? null : onSyncNow }),
        renderListRow({
            title: t('sync.conflicts'),
            value: String(status.conflicts.length),
            chevron: true,
            dataset: { sync: 'conflicts', setting: 'sync-conflicts' },
            onClick: onOpenConflicts
        }),
        renderListRow({ title: t('sync.unpair'), dataset: { sync: 'unpair', setting: 'sync-unpair' }, onClick: onUnpair })
    ].filter(Boolean);
    const notice = status.state === 'stopped' ? h('p', { class: 'pisi-notice', role: 'alert', dataset: { sync: 'stopped' } }, t('sync.stoppedNotice')) : null;
    return [title, notice, renderList({ label: t('settings.sync'), rows })].filter(Boolean);
}

/** The rows of the conflict log sheet, newest first. */
export function renderConflictRows({ t, locale, conflicts }) {
    if (!conflicts.length) return [h('p', { class: 'pisi-sheet-note', dataset: { sync: 'no-conflicts' } }, t('sync.conflictsEmpty'))];
    return [
        renderList({
            label: t('sync.conflicts'),
            rows: conflicts.map((conflict) =>
                renderListRow({
                    title: conflict.kind === 'copy' && conflict.copyPath ? conflict.copyPath : conflict.path,
                    meta: `${conflict.kind === 'copy' ? t('sync.conflictCopyRow', { path: conflict.path }) : t('sync.conflictFieldRow', { path: conflict.path, field: conflict.field ?? '' })} · ${formatSyncTime(conflict.at, locale)}`,
                    dataset: { conflict: conflict.kind }
                })
            )
        })
    ];
}
