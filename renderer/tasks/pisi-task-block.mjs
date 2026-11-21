import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS, PISI_TASK_BLOCK_CLASS } from '../../shared/task-blocks.mjs';
import { getPisiTaskStateOnDay, listPisiDiaryTaskIds, listPisiOverdueTasks, makePisiDiaryTaskSectionHtml } from '../../shared/task-diary.mjs';
import { getPisiTodayIsoDate } from '../../shared/task-model.mjs';

// The editor's drawing of a task block (§3.2.1) and of a diary's task section
// (§3.2.2), G2's interim form: a checkbox and the title. Both come from the
// task store; the file holds only ids. The drawing is temporary like a file
// block's: cleanPisiTaskDrawingsForSave takes it out of the copy the editor
// saves (GV2). Editing the title and the chips come in G3.

const VIEW = 'data-pisi-task-view';

function pisiTaskBlockTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiTaskDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function formatPisiTaskTime(iso) {
    const date = new Date(String(iso || ''));
    return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function makePisiTaskView(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.setAttribute(VIEW, '1');
    if (text) element.textContent = text;
    return element;
}

function makePisiTaskCheckbox(taskId, checked, { day = null, locked = false } = {}) {
    const box = makePisiTaskView('span', 'pisi-task-check');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', checked ? 'true' : 'false');
    box.setAttribute('tabindex', locked ? '-1' : '0');
    box.setAttribute('aria-label', pisiTaskBlockTranslate(checked ? 'Görevi yeniden aç' : 'Görevi tamamla'));
    if (locked) {
        box.setAttribute('aria-disabled', 'true');
        box.title = pisiTaskBlockTranslate('Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı.');
    }
    box.dataset.pisiTaskCheck = taskId;
    if (day) box.dataset.pisiTaskDay = day;
    box.textContent = checked ? '☑' : '☐';
    return box;
}

function getPisiTaskStoreProblem() {
    if (window.isPisiTaskStoreReadOnly?.()) return pisiTaskBlockTranslate('Görevler okunamadı');
    return null;
}

/** Draws one task block from its record. */
function drawPisiTaskBlock(block) {
    const taskId = block.dataset.pisiTaskId;
    const task = window.getPisiTask?.(taskId);
    block.replaceChildren();
    block.setAttribute('contenteditable', 'false');
    const problem = getPisiTaskStoreProblem();
    if (problem || !task) {
        block.classList.add('pisi-task-block-missing');
        block.appendChild(makePisiTaskView('span', 'pisi-task-missing', problem || pisiTaskBlockTranslate('Görev bulunamadı')));
        return;
    }
    block.classList.remove('pisi-task-block-missing');
    block.classList.toggle('pisi-task-done', task.status === 'done');
    block.appendChild(makePisiTaskCheckbox(task.id, task.status === 'done'));
    block.appendChild(makePisiTaskView('span', 'pisi-task-title', task.title || pisiTaskBlockTranslate('Başlıksız görev')));
    if (task.dueDate) {
        const chip = [formatPisiTaskDay(task.dueDate), task.dueTime || ''].filter(Boolean).join(' ');
        block.appendChild(makePisiTaskView('span', 'pisi-task-chip', chip));
    }
}

function makePisiDiaryTaskRow(task, day) {
    const state = getPisiTaskStateOnDay(task, day) || { state: 'open', status: task.status };
    const done = state.state === 'done' || (state.state === 'dated' && state.status === 'done');
    const row = makePisiTaskView('div', 'pisi-diary-task-row');
    row.dataset.pisiTaskRow = task.id;
    row.classList.toggle('pisi-task-done', done);
    row.appendChild(makePisiTaskCheckbox(task.id, done, { day, locked: state.state === 'done' && state.locked }));
    row.appendChild(makePisiTaskView('span', 'pisi-task-title', task.title || pisiTaskBlockTranslate('Başlıksız görev')));
    if (state.state === 'done' && state.at) row.appendChild(makePisiTaskView('span', 'pisi-task-chip', formatPisiTaskTime(state.at)));
    else if (state.state === 'dated' && state.dueDate) row.appendChild(makePisiTaskView('span', 'pisi-task-chip', formatPisiTaskDay(state.dueDate)));
    else if (task.dueTime) row.appendChild(makePisiTaskView('span', 'pisi-task-chip', task.dueTime));
    return { row, done };
}

/** Screen order (not written): open first, then time and priority. */
function sortPisiDiaryRows(entries) {
    return entries.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const timeA = a.task.dueTime || '99:99';
        const timeB = b.task.dueTime || '99:99';
        if (timeA !== timeB) return timeA < timeB ? -1 : 1;
        return (b.task.priority || 3) - (a.task.priority || 3);
    });
}

/**
 * Brings the task section of an open diary to the rule (§3.2.2): one section,
 * the last block, the day's tasks; none when the day has none. Today's diary
 * also shows the overdue open tasks (never written). Returns true when the
 * section's ids changed (the diary should be saved).
 */
function syncPisiDiaryTaskSectionIn(editor, day) {
    if (!editor || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
    const tasks = window.getPisiTasks?.() || [];
    const readOnly = Boolean(getPisiTaskStoreProblem());
    const sections = Array.from(editor.querySelectorAll(`:scope > .${PISI_DIARY_TASKS_CLASS}`));
    const before = sections.map((section) => section.dataset.pisiTaskIds || readPisiSectionRefs(section).join(',')).join('|');
    const ids = readOnly ? (sections[0] ? readPisiSectionRefs(sections[0]) : []) : listPisiDiaryTaskIds(day, tasks);
    const today = getPisiTodayIsoDate(new Date());
    const overdue = !readOnly && day === today ? listPisiOverdueTasks(tasks, today) : [];
    sections.slice(1).forEach((section) => section.remove());
    let section = sections[0] || null;
    if (!ids.length && !overdue.length && !readOnly) {
        section?.remove();
        return before !== '';
    }
    if (!section) {
        section = document.createElement('div');
        section.className = `pisi-editor-block ${PISI_DIARY_TASKS_CLASS}`;
        section.dataset.pisiBlockId = `blk_diary-tasks-${day}`;
        section.dataset.pisiBlockType = 'diary-tasks';
    }
    editor.appendChild(section);
    section.setAttribute('contenteditable', 'false');
    section.dataset.pisiTaskIds = ids.join(',');
    section.dataset.pisiDiaryDate = day;
    if (!ids.length) section.dataset.pisiTaskViewOnly = '1';
    else delete section.dataset.pisiTaskViewOnly;
    section.replaceChildren();
    section.appendChild(makePisiTaskView('div', 'pisi-diary-tasks-heading', pisiTaskBlockTranslate('Görevler')));
    if (readOnly) section.appendChild(makePisiTaskView('div', 'pisi-task-missing', pisiTaskBlockTranslate('Görevler okunamadı')));
    if (overdue.length) {
        const group = makePisiTaskView('div', 'pisi-diary-overdue');
        group.appendChild(makePisiTaskView('div', 'pisi-diary-overdue-heading', pisiTaskBlockTranslate('Gecikenler')));
        for (const task of overdue) {
            const row = makePisiTaskView('div', 'pisi-diary-task-row pisi-diary-overdue-row');
            row.appendChild(makePisiTaskCheckbox(task.id, false));
            row.appendChild(makePisiTaskView('span', 'pisi-task-title', task.title || pisiTaskBlockTranslate('Başlıksız görev')));
            row.appendChild(makePisiTaskView('span', 'pisi-task-chip', formatPisiTaskDay(task.dueDate)));
            group.appendChild(row);
        }
        section.appendChild(group);
    }
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const entries = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((task) => ({ task, ...makePisiDiaryTaskRow(task, day) }));
    for (const entry of sortPisiDiaryRows(entries)) section.appendChild(entry.row);
    return before !== ids.join(',');
}

function readPisiSectionRefs(section) {
    if (section.dataset.pisiTaskIds !== undefined) return section.dataset.pisiTaskIds ? section.dataset.pisiTaskIds.split(',') : [];
    return Array.from(section.querySelectorAll('[data-pisi-task-ref]'))
        .map((row) => row.getAttribute('data-pisi-task-ref'))
        .filter(Boolean);
}

/** The diary day of an open editor, from the open note's metadata. */
function getPisiEditorDiaryDate(editor) {
    const centerEditor = document.getElementById('center-node-editor-content');
    const node = editor === centerEditor ? window.activeCenterNode : editor?.id === 'node-modal-content' ? window.activeModalNode : null;
    const date = node?.metadata?.diaryDate || node?.item?.metadata?.diaryDate || null;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null;
}

/** Draws every task block and the diary section of an editor. */
function renderPisiTaskBlocksIn(editor) {
    if (!editor) return;
    editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`).forEach(drawPisiTaskBlock);
    const day = getPisiEditorDiaryDate(editor);
    if (day) syncPisiDiaryTaskSectionIn(editor, day);
}

/**
 * The saved form (GV2): task blocks empty, the diary section as its ids. Runs
 * on the copy getPisiEditorContent saves; the main process brings the section
 * to the rule again when the diary is saved.
 */
function cleanPisiTaskDrawingsForSave(root) {
    if (!root) return;
    root.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}`).forEach((block) => {
        block.replaceChildren();
        block.classList.remove('pisi-task-done', 'pisi-task-block-missing', 'pisi-block-active', 'pisi-task-block-flash');
        if (!block.getAttribute('class')?.includes('pisi-editor-block')) block.classList.add('pisi-editor-block');
    });
    root.querySelectorAll(`.${PISI_DIARY_TASKS_CLASS}`).forEach((section) => {
        if (section.dataset.pisiTaskViewOnly === '1') {
            section.remove();
            return;
        }
        const day = section.dataset.pisiDiaryDate || /blk_diary-tasks-(\d{4}-\d{2}-\d{2})/.exec(section.dataset.pisiBlockId || '')?.[1];
        const html = day ? makePisiDiaryTaskSectionHtml(day, readPisiSectionRefs(section)) : '';
        if (!html) {
            section.remove();
            return;
        }
        const template = document.createElement('template');
        template.innerHTML = html;
        section.replaceWith(template.content.firstElementChild);
    });
}

function refreshPisiOpenTaskDrawings() {
    for (const id of ['center-node-editor-content', 'node-modal-content']) {
        const editor = document.getElementById(id);
        if (editor?.isConnected) renderPisiTaskBlocksIn(editor);
    }
}

function handlePisiTaskCheckClick(event) {
    const box = event.target?.closest?.('[data-pisi-task-check]');
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    if (box.getAttribute('aria-disabled') === 'true') {
        window.pisiNotifyWarning?.(pisiTaskBlockTranslate('Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı.'));
        return;
    }
    void window.togglePisiTaskCompletion?.(box.dataset.pisiTaskCheck, box.dataset.pisiTaskDay || null);
}

function handlePisiTaskCheckKeydown(event) {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.isComposing) return;
    const box = event.target?.closest?.('[data-pisi-task-check]');
    if (!box || document.activeElement !== box) return;
    handlePisiTaskCheckClick(event);
}

function ensurePisiTaskBlockStyle() {
    if (document.querySelector('link[data-pisi-task-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/tasks/pisi-tasks.css';
    link.dataset.pisiTaskStyle = '1';
    document.head.appendChild(link);
}

function initializePisiTaskBlocks() {
    ensurePisiTaskBlockStyle();
    document.addEventListener('click', handlePisiTaskCheckClick, true);
    document.addEventListener('keydown', handlePisiTaskCheckKeydown, true);
    document.addEventListener('pisi:task-store-updated', (event) => {
        refreshPisiOpenTaskDrawings();
        // A sync turn left open diaries to the editor: the section is drawn again and saved.
        for (const day of event.detail?.deferredDiaryDays || []) void window.applyPisiTaskDeferred?.({ notes: [], diaryDays: [day] });
    });
    document.addEventListener('pisi:active-node-changed', () => queueMicrotask(refreshPisiOpenTaskDrawings));
}

initializePisiTaskBlocks();

const moduleApi = {
    renderPisiTaskBlocksIn,
    syncPisiDiaryTaskSectionIn,
    cleanPisiTaskDrawingsForSave,
    refreshPisiOpenTaskDrawings
};

registerModule('tasks.block', moduleApi);

export { renderPisiTaskBlocksIn, syncPisiDiaryTaskSectionIn, cleanPisiTaskDrawingsForSave };
