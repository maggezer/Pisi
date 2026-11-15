// The task detail sheet. It is built once for a task and then updated in
// place, so a title being typed or an open time picker survives the redraws
// that follow every save. Choice fields (status, priority, date, repeat,
// reminder) are rows that open their own sheet; the time of day and the
// reminder instant are native inputs in the row. Nothing has a "save" button:
// a field is written when it changes, and only when it changes (rule V4).

import { getPisiTaskCalendarIsoDate } from '../../../../shared/task-views.mjs';
import { formatDayTitle } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderSheet } from '../../ui/overlay.mjs';
import { getTaskSourceTitle, getTaskTime } from '../pisi/day-model.mjs';
import { getEditableTaskFields, isNoteTask } from './task-edit.mjs';

const ROWS = Object.freeze(['status', 'priority', 'date', 'time', 'deadline', 'repeat', 'reminderMode', 'reminderAt', 'source']);
const INPUT_TYPES = Object.freeze({ time: 'time', reminderAt: 'datetime-local' });

/**
 * `onField(field)` opens the sheet of a choice field; `onTitle`, `onTime` and
 * `onReminderAt` receive what was typed or picked; `onOpenSource` opens the
 * note the task came from.
 */
export function createTaskDetail({ t, task: firstTask, onClose, onField, onTitle, onTime, onReminderAt, onOpenSource }) {
    const editable = new Set(getEditableTaskFields(firstTask));
    const fromNote = isNoteTask(firstTask);
    const isFocused = (control) => control.ownerDocument.activeElement === control;
    let task = firstTask;

    const title = editable.has('title')
        ? h('textarea', {
              class: 'pisi-task-detail-title pisi-task-detail-input',
              rows: 2,
              'aria-label': t('task.title'),
              enterkeyhint: 'done',
              autocapitalize: 'sentences',
              dataset: { taskField: 'title' }
          })
        : h('p', { class: 'pisi-task-detail-title', dataset: { taskField: 'title' } });
    if (editable.has('title')) {
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
    }

    function buildRow(field) {
        const label = h('span', { class: 'pisi-row-text' }, h('span', { class: 'pisi-row-title' }, t(`task.${field}`)));
        if (INPUT_TYPES[field] && editable.has(field)) {
            const input = h('input', { type: INPUT_TYPES[field], class: 'pisi-row-input', dataset: { taskInput: field } });
            input.addEventListener('change', () => (field === 'time' ? onTime(input.value) : onReminderAt(input.value)));
            return { element: h('label', { class: 'pisi-row pisi-row-field', dataset: { taskField: field } }, label, input), input };
        }
        const value = h('span', { class: 'pisi-row-value' });
        const action = field === 'source' ? onOpenSource : editable.has(field) ? () => onField(field) : null;
        const content = [label, value, action ? icon('chevron-right') : null];
        const element = action
            ? h(
                  'button',
                  {
                      type: 'button',
                      class: 'pisi-row pisi-row-action',
                      'aria-haspopup': field === 'source' ? null : 'dialog',
                      // The status row takes the focus when the sheet opens: the keyboard stays down until the title is tapped.
                      'data-autofocus': field === 'status' ? '' : null,
                      dataset: { taskField: field },
                      onClick: action
                  },
                  content
              )
            : h('div', { class: 'pisi-row', dataset: { taskField: field } }, content);
        return { element, value };
    }

    const rows = Object.fromEntries(ROWS.map((field) => [field, buildRow(field)]));
    const items = Object.fromEntries(ROWS.map((field) => [field, h('li', { class: 'pisi-list-item' }, rows[field].element)]));
    const note = h(
        'p',
        { class: 'pisi-task-detail-note', dataset: { taskNote: fromNote ? 'note-task' : 'reminder' } },
        t(fromNote ? 'task.noteTaskNote' : 'task.reminderNote')
    );
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
            const day = getPisiTaskCalendarIsoDate(task);
            const time = getTaskTime(task);
            const deadline = String(task.deadline || '').slice(0, 10);
            const repeat = task.repeat && task.repeat !== 'none' ? task.repeat : null;
            const reminderMode = task.reminderMode && task.reminderMode !== 'none' ? task.reminderMode : null;
            const reminderAt = String(task.reminderAt || '');
            const source = getTaskSourceTitle(task);

            if (editable.has('title')) {
                if (!isFocused(title)) title.value = task.title;
            } else {
                title.textContent = task.title;
            }
            show('status', t(`status.${task.status}`));
            show('priority', t(`priority.${task.priority}`));
            show('date', day ? formatDayTitle(day, locale, today) : t('task.noDate'));
            show('time', time);
            show('deadline', deadline ? formatDayTitle(deadline, locale, today) : null);
            show('repeat', t(`repeat.${repeat ?? 'none'}`));
            show('reminderMode', t(`reminder.${reminderMode ?? 'none'}`));
            show('reminderAt', rows.reminderAt.input ? reminderAt.slice(0, 16) : reminderAt.replace('T', ' '));
            show('source', source);

            // A time of day and a reminder counted from the due date need a day.
            if (rows.time.input) rows.time.input.disabled = !day;
            if (editable.has('reminderMode')) rows.reminderMode.element.disabled = !day;
            // Rows that cannot be changed are shown only when they say something.
            items.time.hidden = !rows.time.input && !time;
            items.deadline.hidden = !deadline || deadline === day;
            items.repeat.hidden = !editable.has('repeat') && !repeat;
            items.reminderMode.hidden = !editable.has('reminderMode') && !reminderMode;
            items.reminderAt.hidden = !rows.reminderAt.input && !reminderAt;
            items.source.hidden = !source;
        }
    };
}
