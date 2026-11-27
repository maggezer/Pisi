// The Reminders part of Settings (app/reminders.mjs): reminders on or off,
// the time of a reminder set relative to the due day, and what Android
// allows: the notification permission and exact alarms. Also the two sheets
// its rows open.

import { h } from '../../ui/dom.mjs';
import { renderList, renderListRow } from '../../ui/list.mjs';
import { renderChoiceSheet } from '../../ui/overlay.mjs';

export const PISI_REMINDER_TIME_CHOICES = Object.freeze(['07:00', '08:00', '09:00', '10:00', '12:00', '18:00', '20:00', '21:00']);
export const PISI_REMINDER_OVERLAYS = Object.freeze(['reminders-enabled', 'reminders-time']);

function formatNext(time, locale) {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(time));
}

/**
 * `status` is the scheduler's `getStatus()`; `openOverlay(id)` opens one of
 * the sheets; `onRequestPermission` and `onOpenExactAlarms` ask Android.
 */
export function renderRemindersSection({ t, locale, status, openOverlay, onRequestPermission, onOpenExactAlarms }) {
    const rows = [
        renderListRow({
            title: t('reminders.enabled'),
            value: t(status.enabled ? 'reminders.on' : 'reminders.off'),
            chevron: true,
            dataset: { setting: 'reminders-enabled' },
            onClick: () => openOverlay('reminders-enabled')
        }),
        renderListRow({
            title: t('reminders.defaultTime'),
            meta: t('reminders.defaultTimeNote'),
            value: status.defaultTime,
            chevron: true,
            dataset: { setting: 'reminders-time' },
            onClick: () => openOverlay('reminders-time')
        })
    ];
    if (status.available && status.enabled) {
        const permission = status.permission;
        rows.push(
            renderListRow({
                title: t('reminders.permission'),
                meta: permission === 'denied' ? t('reminders.permissionDeniedNote') : permission === 'prompt' ? t('reminders.permissionPromptNote') : null,
                value: permission ? t(`reminders.permission.${permission}`) : '…',
                dataset: { reminders: 'permission', state: permission ?? 'checking' },
                onClick: permission && permission !== 'granted' ? onRequestPermission : null
            })
        );
        if (permission === 'granted' && status.exact === 'denied') {
            rows.push(
                renderListRow({
                    title: t('reminders.exact'),
                    meta: t('reminders.exactNote'),
                    value: t('reminders.off'),
                    chevron: true,
                    dataset: { reminders: 'exact' },
                    onClick: onOpenExactAlarms
                })
            );
        }
        if (permission === 'granted') {
            rows.push(
                renderListRow({
                    title: t('reminders.scheduled'),
                    meta: status.next ? t('reminders.next', { time: formatNext(status.next, locale) }) : null,
                    value: String(status.count),
                    dataset: { reminders: 'scheduled' }
                })
            );
        }
    }
    return [h('h2', { class: 'pisi-section-title' }, t('settings.reminders')), renderList({ label: t('settings.reminders'), rows })];
}

/** The sheet of a Reminders row, or null for another overlay. */
export function renderRemindersSheet({ overlay, t, status, onClose, onSetEnabled, onSetTime }) {
    if (overlay === 'reminders-enabled') {
        return renderChoiceSheet({
            id: 'reminders-enabled',
            title: t('reminders.enabled'),
            options: [
                { value: 'on', label: t('reminders.on') },
                { value: 'off', label: t('reminders.off') }
            ],
            selected: status.enabled ? 'on' : 'off',
            closeLabel: t('action.close'),
            onClose,
            onSelect: (value) => onSetEnabled(value === 'on')
        });
    }
    if (overlay === 'reminders-time') {
        const times = PISI_REMINDER_TIME_CHOICES.includes(status.defaultTime)
            ? PISI_REMINDER_TIME_CHOICES
            : [...PISI_REMINDER_TIME_CHOICES, status.defaultTime].sort();
        return renderChoiceSheet({
            id: 'reminders-time',
            title: t('reminders.defaultTime'),
            options: times.map((value) => ({ value, label: value })),
            selected: status.defaultTime,
            closeLabel: t('action.close'),
            onClose,
            onSelect: onSetTime
        });
    }
    return null;
}
