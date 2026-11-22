// The tasks inside an open note (docs/task-plan.md §3.2, G8). The note holds
// only ids: a task block carries one task id, a diary's task section the ids
// of its day. Both are drawn from tasks.json through the task controller and
// change only tasks.json when the checkbox is tapped; the note's HTML is never
// touched for that (GV2, GV9).

import { h } from '../../ui/dom.mjs';
import { renderTaskRow } from '../../ui/task-row.mjs';
import { groupDayTasks } from '../pisi/day-model.mjs';
import { getTaskCheckLabel, getTaskRowMeta } from '../pisi/task-section.mjs';

function statusCard(t, key) {
    return h(
        'p',
        { class: 'pisi-note-task-missing', role: 'status', dataset: { taskState: key } },
        key === 'unreadable' ? t('note.tasksUnreadable') : t('note.taskMissing')
    );
}

/**
 * Fills `host` for a task block: the task's row, "Görev bulunamadı" when
 * tasks.json has no such task, or "Görevler okunamadı" when the file cannot
 * be read (GV11). The block itself stays in the note either way.
 */
export function drawTaskBlock(host, taskId, { t, locale, today, tasks, onOpen }) {
    const task = tasks.find(taskId);
    if (!task) {
        host.replaceChildren(statusCard(t, tasks.isReadOnly() ? 'unreadable' : 'missing'));
        return;
    }
    const done = task.status === 'done';
    host.replaceChildren(
        renderTaskRow({
            id: task.id,
            title: task.title,
            done,
            meta: getTaskRowMeta({ task, day: task.dueDate }, { t, locale, today, showDate: true }),
            checkLabel: getTaskCheckLabel(t, task, { done }),
            onToggle: (id) => void tasks.toggle(id),
            onOpen
        })
    );
}

/**
 * Fills `host` for the task section of the diary of `day`: the "Görevler"
 * heading and a row for each task of that day by the section rule, each with
 * its state on that day (§3.2.2; the overdue tasks above them on today's
 * diary). Rows are drawn from tasks.json, not from the ids in the file.
 */
export function drawDiarySection(host, day, { t, locale, today, tasks, onOpen }) {
    if (tasks.isReadOnly()) {
        host.replaceChildren(statusCard(t, 'unreadable'));
        return;
    }
    const groups = groupDayTasks(tasks.getTasks(), { selectedDate: day, today });
    const entries = [...groups.overdue.map((entry) => ({ ...entry, late: true })), ...groups.day, ...groups.done];
    const rows = entries.map((entry) => {
        const done = entry.state.state === 'done' || entry.task.status === 'done';
        const locked = Boolean(entry.state.locked);
        return h(
            'li',
            { class: 'pisi-task-item' },
            renderTaskRow({
                id: entry.task.id,
                title: entry.task.title,
                done,
                locked,
                late: Boolean(entry.late),
                meta: getTaskRowMeta(entry, { t, locale, today, showDate: Boolean(entry.late) || entry.day !== day }),
                checkLabel: getTaskCheckLabel(t, entry.task, { done, locked }),
                onToggle: (id) => void tasks.toggle(id, { day: entry.late ? null : day }),
                onOpen
            })
        );
    });
    host.replaceChildren(
        h('h3', { class: 'pisi-note-task-heading' }, t('pisi.tasks')),
        rows.length ? h('ul', { class: 'pisi-task-list' }, rows) : h('p', { class: 'pisi-note-task-missing' }, t('pisi.noTasks'))
    );
}
