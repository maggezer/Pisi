// The task detail sheet. It is built once for a task and then updated in
// place, so a title being typed or an open time picker survives the redraws
// that follow every save. Choice fields (status, priority, date, repeat,
// reminder) are rows that open their own sheet; the time of day and the
// reminder instant are native inputs in the row. Nothing has a "save" button:
// a field is written when it changes, and only when it changes (rule V4).

import { normalizePisiTaskDay } from '../../../../shared/task-model.mjs';
import { formatDayTitle } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderSheet } from '../../ui/overlay.mjs';
import { getTaskTime } from '../pisi/day-model.mjs';

const ROWS = Object.freeze(['status', 'priority', 'date', 'time', 'repeat', 'reminderMode', 'reminderAt', 'place']);
const INPUT_TYPES = Object.freeze({ time: 'time', reminderAt: 'datetime-local' });

/**
 * `onField(field)` opens the sheet of a choice field; `onTitle`, `onTime` and
 * `onReminderAt` receive what was typed or picked; `onOpenPlace` opens where
 * the task lives (its note, or its diary day on the Pisi tab);
 * `describePlace(task)` names that place.
 */
export function createTaskDetail({ t, task: firstTask, onClose, onField, onTitle, onTime, onReminderAt, onOpenPlace, describePlace }) {
    const isFocused = (control) => control.ownerDocument.activeElement === control;
    let task = firstTask;

    const title = h('textarea', {
        class: 'pisi-task-detail-title pisi-task-detail-input',
        rows: 2,
        'aria-label': t('task.title'),
        enterkeyhint: 'done',
        autocapitalize: 'sentences',
        dataset: { taskField: 'title' }
    });
    // Enter finishes the title; a title has no line breaks.
    title.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        title.blur();
    });
    title.addEventListener('change', () => {
        if (!title.value.trim()) title.value = task.title;
        onTitle(title.value);
    });

    function buildRow(field) {
        const label = h('span', { class: 'pisi-row-text' }, h('span', { class: 'pisi-row-title' }, t(`task.${field}`)));
        if (INPUT_TYPES[field]) {
            const input = h('input', { type: INPUT_TYPES[field], class: 'pisi-row-input', dataset: { taskInput: field } });
            input.addEventListener('change', () => (field === 'time' ? onTime(input.value) : onReminderAt(input.value)));
            return { element: h('label', { class: 'pisi-row pisi-row-field', dataset: { taskField: field } }, label, input), input };
        }
        const value = h('span', { class: 'pisi-row-value' });
        const element = h(
            'button',
            {
                type: 'button',
                class: 'pisi-row pisi-row-action',
                'aria-haspopup': field === 'place' ? null : 'dialog',
                // The status row takes the focus when the sheet opens: the keyboard stays down until the title is tapped.
                'data-autofocus': field === 'status' ? '' : null,
                dataset: { taskField: field },
                onClick: field === 'place' ? onOpenPlace : () => onField(field)
            },
            label,
            value,
            icon('chevron-right')
        );
        return { element, value };
    }

    const rows = Object.fromEntries(ROWS.map((field) => [field, buildRow(field)]));
    const items = Object.fromEntries(ROWS.map((field) => [field, h('li', { class: 'pisi-list-item' }, rows[field].element)]));
    const note = h('p', { class: 'pisi-task-detail-note', dataset: { taskNote: 'reminder' } }, t('task.reminderNote'));
    const element = renderSheet({
        id: 'task',
        title: t('task.detail'),
        closeLabel: t('action.close'),
        onClose,
        children: [
            title,
            h(
                'ul',
                { class: 'pisi-list', 'aria-label': t('task.detail') },
                ROWS.map((field) => items[field])
            ),
            note
        ]
    });
    function show(field, text) {
        const row = rows[field];
        if (row.input) {
            if (!isFocused(row.input)) row.input.value = text ?? '';
        } else {
            row.value.textContent = text ?? '';
        }
    }

    return {
        element,
        taskId: firstTask.id,

        /** Shows `task` as it is now. A field being typed in is left alone. */
        update({ task: next, locale, today }) {
            task = next;
            const day = normalizePisiTaskDay(task.dueDate);
            const time = getTaskTime(task);
            const reminderAt = String(task.reminderAt || '');
            const place = describePlace(task);

            if (!isFocused(title)) title.value = task.title;
            show('status', t(`status.${task.status}`));
            show('priority', t(`priority.${task.priority}`));
            show('date', day ? formatDayTitle(day, locale, today) : t('task.noDate'));
            show('time', time);
            show('repeat', t(`repeat.${task.repeat && task.repeat !== 'none' ? task.repeat : 'none'}`));
            show('reminderMode', t(`reminder.${task.reminderMode && task.reminderMode !== 'none' ? task.reminderMode : 'none'}`));
            show('reminderAt', reminderAt.slice(0, 16));
            show('place', place);

            // A time of day and a reminder counted from the due date need a day.
            rows.time.input.disabled = !day;
            rows.reminderMode.element.disabled = !day;
            items.place.hidden = !place;
        }
    };
}
