// The sheets of a task, opened from either tab: the detail sheet and, above
// it, the sheet of the field being changed. The router keeps them as overlay
// ids (`task:<id>` and `task-field:<field>`), so the back button closes the
// field sheet first and then the detail.

import { normalizePisiTaskDay } from '../../../../shared/task-model.mjs';
import { renderButton } from '../../ui/button.mjs';
import { renderDatePicker } from '../../ui/date-picker.mjs';
import { formatDayTitle, shiftMonth } from '../../ui/dates.mjs';
import { renderChoiceSheet } from '../../ui/overlay.mjs';
import { createTaskDetail } from './task-detail.mjs';
import {
    PISI_TASK_PRIORITY_VALUES,
    PISI_TASK_REMINDER_MODES,
    PISI_TASK_REPEAT_VALUES,
    PISI_TASK_STATUS_VALUES,
    getTaskChoicePatch,
    getTaskDatePatch,
    getTaskReminderPatch,
    getTaskTimePatch,
    getTaskTitlePatch
} from './task-edit.mjs';

const TASK_PREFIX = 'task:';
const FIELD_PREFIX = 'task-field:';
const CHOICES = Object.freeze({
    status: { values: PISI_TASK_STATUS_VALUES, label: 'status' },
    priority: { values: PISI_TASK_PRIORITY_VALUES, label: 'priority' },
    repeat: { values: PISI_TASK_REPEAT_VALUES, label: 'repeat' },
    reminderMode: { values: PISI_TASK_REMINDER_MODES, label: 'reminder' }
});

export const getTaskOverlay = (taskId) => `${TASK_PREFIX}${taskId}`;

/**
 * `tasks` is the task controller; `getContext()` returns `{ t, locale, today }`.
 * The app owns navigation: `onOpenOverlay` / `onCloseOverlay` for the sheets,
 * `onOpenNote({ path, title })` for the note a task lives in and
 * `onOpenDay(isoDate)` for the diary day it lives in (the Pisi tab).
 */
export function createTaskSheets({ tasks, getContext, onOpenOverlay, onCloseOverlay, onOpenNote, onOpenDay }) {
    let detail = null;
    let detailT = null;
    let pickerMonth = null;

    const openTaskId = (overlays) => overlays.findLast((overlay) => overlay.startsWith(TASK_PREFIX))?.slice(TASK_PREFIX.length) ?? null;
    const change = (task, patch) => (patch ? tasks.update(task.id, patch) : null);

    /** "Günlük · 14 Kasım" or the note's title; null while the note is not known yet. */
    function describePlace(task) {
        const { t, locale, today } = getContext();
        const place = tasks.getPlace(task);
        if (place?.kind === 'diary') return t('task.placeDiary', { date: formatDayTitle(place.date, locale, today) });
        return place?.title ?? null;
    }

    function openPlace(task) {
        const place = tasks.getPlace(task);
        if (place?.kind === 'diary') onOpenDay(place.date);
        else if (place?.key) onOpenNote({ path: place.key, title: place.title });
    }

    function renderDetail(task) {
        const { t, locale, today } = getContext();
        if (!detail || detail.taskId !== task.id || detailT !== t) {
            const current = () => tasks.find(task.id) ?? task;
            detailT = t;
            detail = createTaskDetail({
                t,
                task,
                onClose: onCloseOverlay,
                onField(field) {
                    pickerMonth = null;
                    onOpenOverlay(`${FIELD_PREFIX}${field}`);
                },
                onTitle: (text) => void change(current(), getTaskTitlePatch(current(), text)),
                onTime: (value) => void change(current(), getTaskTimePatch(current(), value)),
                onReminderAt: (value) => void change(current(), getTaskReminderPatch(current(), value)),
                onOpenPlace: () => openPlace(current()),
                describePlace
            });
        }
        detail.update({ task, locale, today });
        return detail.element;
    }

    function renderField(field, task, redraw) {
        const { t, locale, today } = getContext();
        const id = `task-${field}`;
        if (field === 'date') {
            const day = normalizePisiTaskDay(task.dueDate);
            const month = pickerMonth ?? (day ?? today).slice(0, 7);
            const pick = (isoDate) => {
                onCloseOverlay();
                void change(task, getTaskDatePatch(task, isoDate));
            };
            return renderDatePicker({
                id,
                title: t('task.date'),
                month,
                selected: day,
                today,
                locale,
                labels: {
                    close: t('action.close'),
                    previousMonth: t('date.previousMonth'),
                    nextMonth: t('date.nextMonth'),
                    today: t('pisi.today'),
                    goToday: t('pisi.today')
                },
                actions: day
                    ? renderButton({ label: t('task.removeDate'), variant: 'text', dataset: { action: 'remove-date' }, onClick: () => pick(null) })
                    : null,
                onClose: onCloseOverlay,
                onMonth(delta) {
                    pickerMonth = shiftMonth(month, delta);
                    redraw();
                },
                onSelect: pick
            });
        }
        const choice = CHOICES[field];
        if (!choice) return null;
        return renderChoiceSheet({
            id,
            title: t(`task.${field}`),
            options: choice.values.map((value) => ({ value: String(value), label: t(`${choice.label}.${value}`) })),
            selected: String(field === 'reminderMode' ? task.reminderMode || 'none' : field === 'repeat' ? task.repeat || 'none' : task[field]),
            closeLabel: t('action.close'),
            onClose: onCloseOverlay,
            onSelect(value) {
                onCloseOverlay();
                if (field === 'status') void tasks.setStatus(task.id, value);
                else void change(task, getTaskChoicePatch(task, field, value));
            }
        });
    }

    return {
        open: (taskId) => onOpenOverlay(getTaskOverlay(taskId)),

        /** The sheet for the top overlay `id`, or null when it is not a task sheet. `redraw` draws the layer again. */
        renderOverlay(id, overlays, redraw) {
            const taskId = openTaskId(overlays);
            if (!taskId) detail = null;
            const task = taskId ? tasks.find(taskId) : null;
            if (!task || !id) return null;
            if (id.startsWith(TASK_PREFIX)) return renderDetail(task);
            if (id.startsWith(FIELD_PREFIX)) return renderField(id.slice(FIELD_PREFIX.length), task, redraw);
            return null;
        },

        /** Selector of the control that opened a task sheet; focus returns to it. */
        getOverlayOpener(id) {
            if (String(id).startsWith(TASK_PREFIX)) return `[data-task-open="${id.slice(TASK_PREFIX.length)}"]`;
            if (String(id).startsWith(FIELD_PREFIX)) return `[data-task-field="${id.slice(FIELD_PREFIX.length)}"]`;
            return null;
        }
    };
}
