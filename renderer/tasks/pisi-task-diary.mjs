import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS } from '../../shared/task-blocks.mjs';
import { getPisiDiaryTaskSectionBlockId, getPisiTaskStateOnDay, listPisiDiaryTaskIds, listPisiOverdueTasks } from '../../shared/task-diary.mjs';
import {
    ensurePisiTaskChips,
    ensurePisiTaskTitleField,
    formatPisiTaskDay,
    formatPisiTaskTime,
    getPisiEditorOfTaskElement,
    getPisiTaskStoreProblem,
    getPisiTaskTitleText,
    makePisiTaskCheckbox,
    makePisiTaskView,
    pisiTaskViewTranslate,
    updatePisiTaskCheckbox
} from './pisi-task-view.mjs';
import { openPisiTaskPopover } from './pisi-task-popover.mjs';

// The task section of an open diary (docs/task-plan.md §3.2.2, G3.2). The file
// holds the ids only; the editor draws a "Görevler" heading, a row per task
// with its state on this day, the overdue open tasks above today's rows (never
// written) and an "add a task" field at the end. Every title is editable. A
// completion that is not the latest is locked (§3.2.3). A row whose task lives
// in another note is not deleted from the keyboard: its menu changes the date
// or takes it off this day (§1.4). Rows are reused when the section is drawn
// again, so the caret in a title stays.

function pisiTaskDiaryTranslate(value) {
    return pisiTaskViewTranslate(value);
}

function readPisiSectionIds(section) {
    if (section.dataset.pisiTaskIds !== undefined) return section.dataset.pisiTaskIds ? section.dataset.pisiTaskIds.split(',') : [];
    return Array.from(section.querySelectorAll('[data-pisi-task-ref]'))
        .map((row) => row.getAttribute('data-pisi-task-ref'))
        .filter(Boolean);
}

/** Screen order (not written): open first, then time and priority; the section's order otherwise. */
function sortPisiDiaryRows(entries) {
    return entries.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const timeA = a.task.dueTime || '99:99';
        const timeB = b.task.dueTime || '99:99';
        if (timeA !== timeB) return timeA < timeB ? -1 : 1;
        return (b.task.priority || 3) - (a.task.priority || 3);
    });
}

function isPisiDoneOnDay(state) {
    return state?.state === 'done' || (state?.state === 'dated' && state.status === 'done');
}

/** One row, reused from `previous` when there is one. `day` null: an overdue row (completed today). */
function drawPisiDiaryTaskRow(previous, task, day, { readOnly, overdue = false, diaryDay }) {
    const row = previous || makePisiTaskView('div', 'pisi-diary-task-row');
    row.dataset.pisiTaskRow = task.id;
    row.dataset.pisiDiaryDay = diaryDay;
    const state = day ? getPisiTaskStateOnDay(task, day) || { state: 'open', status: task.status } : { state: 'open', status: task.status };
    const done = isPisiDoneOnDay(state);
    const lockedDone = state.state === 'done' && state.locked;
    row.classList.toggle('pisi-task-done', done);
    row.classList.toggle('pisi-task-overdue', overdue);
    row.classList.toggle('pisi-task-elsewhere', Boolean(task.noteId));
    let box = row.querySelector(':scope > .pisi-task-check');
    if (!box) {
        box = makePisiTaskCheckbox();
        row.prepend(box);
    }
    updatePisiTaskCheckbox(box, task.id, done, { day, locked: lockedDone, disabled: readOnly });
    ensurePisiTaskTitleField(row, task.id, { text: getPisiTaskTitleText(task), readOnly: readOnly || lockedDone });
    let info = row.querySelector(':scope > .pisi-diary-task-info');
    if (!info) {
        info = makePisiTaskView('span', 'pisi-diary-task-info');
        row.appendChild(info);
    }
    let text = '';
    if (state.state === 'done' && state.at) text = formatPisiTaskTime(state.at);
    else if (overdue || (state.state === 'dated' && state.dueDate)) text = formatPisiTaskDay(task.dueDate);
    if (info.textContent !== text) info.textContent = text;
    info.hidden = !text;
    ensurePisiTaskChips(row, task, { kinds: ['priority', 'repeat'], readOnly: readOnly || lockedDone });
    let menu = row.querySelector(':scope > .pisi-diary-task-menu');
    if (!menu) {
        menu = makePisiTaskView('button', 'pisi-diary-task-menu', '…');
        menu.type = 'button';
        menu.setAttribute('tabindex', '-1');
        menu.setAttribute('aria-label', pisiTaskDiaryTranslate('Görev menüsü'));
    }
    menu.dataset.pisiTaskMenu = task.id;
    menu.disabled = readOnly;
    row.appendChild(menu);
    return { row, done };
}

function ensurePisiDiaryAddRow(section, day, readOnly) {
    let add = section.querySelector(':scope > .pisi-diary-task-add');
    if (!add) {
        add = makePisiTaskView('div', 'pisi-diary-task-add');
        add.appendChild(makePisiTaskView('span', 'pisi-diary-task-add-icon', '+'));
    }
    add.dataset.pisiDiaryDay = day;
    const field = ensurePisiTaskTitleField(add, null, {
        text: add.querySelector('[data-pisi-task-title]')?.textContent || '',
        readOnly,
        placeholder: 'Görev ekle'
    });
    field.dataset.pisiTaskAdd = day;
    add.hidden = readOnly;
    if (!add.parentNode) section.appendChild(add);
    return add;
}

/**
 * Brings the task section of an open diary to the rule (§3.2.2) and draws it:
 * one section, the last block, the day's tasks. The section element stays even
 * when the day has no task (for the heading and the add field); the saved copy
 * has no section then. Returns true when the section's ids changed (the diary
 * should be saved).
 */
function syncPisiDiaryTaskSectionIn(editor, day) {
    if (!editor || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
    const tasks = window.getPisiTasks?.() || [];
    const readOnly = Boolean(getPisiTaskStoreProblem());
    const sections = Array.from(editor.querySelectorAll(`:scope > .${PISI_DIARY_TASKS_CLASS}`));
    const before = sections.map((section) => readPisiSectionIds(section).join(',')).join('|');
    const ids = readOnly ? (sections[0] ? readPisiSectionIds(sections[0]) : []) : listPisiDiaryTaskIds(day, tasks);
    sections.slice(1).forEach((section) => section.remove());
    let section = sections[0] || null;
    if (!section) {
        section = document.createElement('div');
        section.className = `pisi-editor-block ${PISI_DIARY_TASKS_CLASS}`;
        section.dataset.pisiBlockId = getPisiDiaryTaskSectionBlockId(day);
        section.dataset.pisiBlockType = 'diary-tasks';
    }
    if (editor.lastElementChild !== section) editor.appendChild(section);
    section.setAttribute('contenteditable', 'false');
    section.dataset.pisiTaskIds = ids.join(',');
    section.dataset.pisiDiaryDate = day;

    const existing = new Map();
    section
        .querySelectorAll('[data-pisi-task-row]')
        .forEach((row) => existing.set(`${row.closest('.pisi-diary-overdue') ? 'o' : 'r'}:${row.dataset.pisiTaskRow}`, row));
    for (const child of Array.from(section.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE || !child.hasAttribute('data-pisi-task-view')) child.remove();
    }
    let heading = section.querySelector(':scope > .pisi-diary-tasks-heading');
    if (!heading) heading = makePisiTaskView('div', 'pisi-diary-tasks-heading');
    const headingText = pisiTaskDiaryTranslate('Görevler');
    if (heading.textContent !== headingText) heading.textContent = headingText;
    let problem = section.querySelector(':scope > .pisi-task-missing');
    if (readOnly) {
        if (!problem) problem = makePisiTaskView('div', 'pisi-task-missing');
        problem.textContent = pisiTaskDiaryTranslate('Görevler okunamadı');
    } else {
        problem?.remove();
        problem = null;
    }

    // Today's diary: the open tasks due before today, above the rows (never written).
    let overdueGroup = section.querySelector(':scope > .pisi-diary-overdue');
    const today = window.getPisiTaskToday?.();
    const overdue = !readOnly && day === today ? listPisiOverdueTasks(tasks, today) : [];
    if (overdue.length) {
        if (!overdueGroup) {
            overdueGroup = makePisiTaskView('div', 'pisi-diary-overdue');
            overdueGroup.appendChild(makePisiTaskView('div', 'pisi-diary-overdue-heading'));
        }
        overdueGroup.firstElementChild.textContent = pisiTaskDiaryTranslate('Gecikenler');
        const kept = new Set();
        const wanted = [overdueGroup.firstElementChild];
        for (const task of overdue) {
            const { row } = drawPisiDiaryTaskRow(existing.get(`o:${task.id}`), task, null, { readOnly, overdue: true, diaryDay: day });
            wanted.push(row);
            kept.add(row);
        }
        for (const row of Array.from(overdueGroup.querySelectorAll('[data-pisi-task-row]'))) if (!kept.has(row)) row.remove();
        placePisiInOrder(overdueGroup, wanted);
    } else {
        overdueGroup?.remove();
        overdueGroup = null;
    }

    const byId = new Map(tasks.map((task) => [task.id, task]));
    const entries = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((task) => ({ task, ...drawPisiDiaryTaskRow(existing.get(`r:${task.id}`), task, day, { readOnly, diaryDay: day }) }));
    const rows = new Set(entries.map((entry) => entry.row));
    for (const row of Array.from(section.querySelectorAll(':scope > [data-pisi-task-row]'))) if (!rows.has(row)) row.remove();
    // Rows being created stay after the rows until their task arrives.
    const pending = Array.from(section.querySelectorAll(':scope > .pisi-diary-task-pending'));
    const add = ensurePisiDiaryAddRow(section, day, readOnly);
    placePisiInOrder(section, [heading, problem, overdueGroup, ...sortPisiDiaryRows(entries).map((entry) => entry.row), ...pending, add].filter(Boolean));
    return before !== ids.join(',');
}

/** Puts `wanted` as the children of `parent` in that order, moving only what is out of place (a moved element loses the focus). */
function placePisiInOrder(parent, wanted) {
    wanted.forEach((element, index) => {
        if (parent.children[index] !== element) parent.insertBefore(element, parent.children[index] || null);
    });
}

/** A row for a diary task that is being created; it is replaced by the real row when the task arrives. */
function makePisiPendingDiaryRow(section, title = '', { after = null } = {}) {
    const row = makePisiTaskView('div', 'pisi-diary-task-row pisi-diary-task-pending');
    const box = makePisiTaskCheckbox();
    updatePisiTaskCheckbox(box, '', false, { disabled: true });
    row.appendChild(box);
    const field = ensurePisiTaskTitleField(row, null, { text: title });
    field.textContent = title;
    const add = section.querySelector(':scope > .pisi-diary-task-add');
    if (after && after.parentNode === section) after.after(row);
    else section.insertBefore(row, add);
    return row;
}

// ---- Row menu -------------------------------------------------------------------------

function openPisiDiaryRowMenu(button) {
    const task = window.getPisiTask?.(button.dataset.pisiTaskMenu);
    const row = button.closest('[data-pisi-task-row]');
    const day = row?.dataset.pisiDiaryDay;
    const editor = getPisiEditorOfTaskElement(button);
    if (!task || !day) return;
    const items = [];
    if (task.noteId) items.push({ label: pisiTaskDiaryTranslate('Notu aç'), run: () => void window.openPisiTaskLocation?.(task.id) });
    items.push({
        label: pisiTaskDiaryTranslate('Tarihi değiştir'),
        run: () =>
            openPisiTaskPopover(button, {
                kind: 'date',
                task,
                onPatch: (patch) => void window.updatePisiTaskFromEditor?.(editor, task.id, patch)
            })
    });
    if (task.diaryDate !== day && task.dueDate === day && task.status !== 'done') {
        items.push({
            label: pisiTaskDiaryTranslate('Bu günden kaldır'),
            run: () => void window.updatePisiTaskFromEditor?.(editor, task.id, { dueDate: null, dueTime: null })
        });
    }
    if (task.diaryDate === day)
        items.push({ label: pisiTaskDiaryTranslate('Görevi sil'), danger: true, run: () => void window.deletePisiTaskFromEditor?.(editor, task.id) });
    openPisiTaskPopover(button, { kind: 'menu', items });
}

document.addEventListener(
    'click',
    (event) => {
        const button = event.target?.closest?.('[data-pisi-task-menu]');
        if (!button || button.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        openPisiDiaryRowMenu(button);
    },
    true
);
document.addEventListener(
    'mousedown',
    (event) => {
        if (event.target?.closest?.('[data-pisi-task-menu]')) event.preventDefault();
    },
    true
);

const moduleApi = {
    syncPisiDiaryTaskSectionIn,
    makePisiPendingDiaryRow
};

registerModule('tasks.diary', moduleApi);

export { syncPisiDiaryTaskSectionIn, makePisiPendingDiaryRow };
