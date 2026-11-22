import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS, PISI_TASK_BLOCK_CLASS } from '../../shared/task-blocks.mjs';
import { cleanPisiTaskTitle, normalizePisiTaskTitleDraft, splitPisiTaskTitle } from './pisi-task-edit-core.mjs';
import {
    dispatchPisiTaskChangeInput,
    PISI_TASK_TITLE_SELECTOR,
    focusPisiTaskTitleField,
    getPisiNoteOfEditor,
    getPisiEditorOfTaskElement,
    getPisiTaskStoreProblem,
    getPisiTaskTitleCaret,
    pisiTaskTitleDrafts,
    pisiTaskViewTranslate
} from './pisi-task-view.mjs';

// Making and editing tasks in the note editor (docs/task-plan.md G3.3–G3.5).
// - A task is made from the slash command, `[ ]` / `[]`, the block type menu,
//   the toolbar or Enter in a task: task.create.v1 first, then the block (§3.3).
//   The block is drawn at once with its title field ("pending") so that what
//   the user types is never lost; it is saved when its task has an id. In a
//   diary the task goes into the day's task section (§1.4).
// - The title is one line of plain text. It is written with task.update.v1 a
//   moment after typing and at once when the field loses focus, never during
//   an IME composition. The note file never changes for a title (GV5).
// - Keys at the edge of a title follow docs/editor-keyboard-rules.md.

const PISI_TASK_TITLE_DELAY_MS = 400;
const pisiTaskWorkState = {
    timers: new Map(),
    composing: new WeakSet(),
    // Tasks this session deleted from an editor, with their Trash item (undo brings them back).
    trashIds: new Map(),
    // Tasks this session made from an editor (undo of the making deletes a diary task).
    created: new Set()
};

function pisiTaskWorkTranslate(value) {
    return pisiTaskViewTranslate(value);
}

const getTaskBlock = (element) => element?.closest?.(`.${PISI_TASK_BLOCK_CLASS}`) || null;
const getDiaryRow = (element) => element?.closest?.('.pisi-diary-task-row, .pisi-diary-task-add') || null;

function makePisiParagraph(html = '<br>') {
    const block = document.createElement('div');
    block.className = 'pisi-editor-block';
    block.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    block.dataset.pisiBlockType = 'paragraph';
    block.innerHTML = html;
    return block;
}

function notifyPisiEditorTaskChange(editor) {
    dispatchPisiTaskChangeInput(editor);
}

// ---- Titles -----------------------------------------------------------------------------

async function commitPisiTaskTitle(taskId) {
    clearTimeout(pisiTaskWorkState.timers.get(taskId));
    pisiTaskWorkState.timers.delete(taskId);
    if (!pisiTaskTitleDrafts.has(taskId)) return true;
    const draft = pisiTaskTitleDrafts.get(taskId);
    const task = window.getPisiTask?.(taskId);
    const focused = document.activeElement?.matches?.(`[data-pisi-task-title="${CSS.escape(taskId)}"]`);
    if (!task) {
        pisiTaskTitleDrafts.delete(taskId);
        return false;
    }
    const title = cleanPisiTaskTitle(draft);
    if (task.title !== title) {
        const result = await window.runPisiTaskCommand?.('task.update.v1', { taskId, patch: { title } });
        if (!result?.ok) {
            pisiTaskTitleDrafts.delete(taskId);
            window.refreshPisiOpenTaskDrawings?.();
            return false;
        }
    }
    const stillFocused = document.activeElement?.matches?.(`[data-pisi-task-title="${CSS.escape(taskId)}"]`);
    if (pisiTaskTitleDrafts.get(taskId) === draft && !(focused && stillFocused)) pisiTaskTitleDrafts.delete(taskId);
    return true;
}

function schedulePisiTaskTitleCommit(taskId, delay = PISI_TASK_TITLE_DELAY_MS) {
    clearTimeout(pisiTaskWorkState.timers.get(taskId));
    pisiTaskWorkState.timers.set(
        taskId,
        setTimeout(() => void commitPisiTaskTitle(taskId), delay)
    );
}

/** Writes every title still waiting (before a save, a sync turn or closing a note). */
async function flushPisiTaskTitles() {
    const ids = [...pisiTaskTitleDrafts.keys()];
    for (const id of ids) await commitPisiTaskTitle(id);
    return true;
}

/** A title field changed: the draft follows it; one line only; history records the step. */
function handlePisiTaskTitleInput(event) {
    const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
    if (!field) return;
    event.stopPropagation();
    const text = field.textContent || '';
    const normalized = normalizePisiTaskTitleDraft(text);
    if (normalized !== text) {
        field.textContent = normalized;
        focusPisiTaskTitleField(field);
    }
    const composing = event.isComposing || pisiTaskWorkState.composing.has(field);
    // "[[" opens the note link menu in the title too (G6); the chosen note goes in as [[Başlık]] text.
    if (!composing) queueMicrotask(() => void window.routePisiTaskTitleWikiInput?.(field));
    const taskId = field.dataset.pisiTaskTitle;
    if (!taskId) return;
    const editor = getPisiEditorOfTaskElement(field);
    if (editor && !pisiTaskTitleDrafts.has(taskId)) window.rebasePisiEditorHistory?.(editor);
    pisiTaskTitleDrafts.set(taskId, normalized);
    if (editor) window.recordPisiEditorHistory?.(editor, 'typing');
    if (!composing) schedulePisiTaskTitleCommit(taskId);
}

/** While the [[ menu of this title is open, the arrows, Enter, Tab and Escape belong to it. */
function handlePisiTaskTitleMenuKey(event, field) {
    const menu = window.pisiTagMenuState;
    if (!menu?.active || menu.mode !== 'wiki-link' || menu.editor !== field) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') window.movePisiTagSelection?.(event.key === 'ArrowDown' ? 1 : -1);
    else if (event.key === 'Enter' || event.key === 'Tab') {
        const item = menu.items[menu.selectedIndex];
        if (item) window.applyPisiTagMenuItem?.(field, item);
    } else if (event.key === 'Escape') window.closePisiTagMenu?.();
    else return false;
    return true;
}

function handlePisiTaskTitlePaste(event) {
    const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
    if (!field) return;
    event.preventDefault();
    event.stopPropagation();
    if (field.getAttribute('contenteditable') === 'false') return;
    const text = normalizePisiTaskTitleDraft(event.clipboardData?.getData('text/plain') || '');
    if (text) document.execCommand('insertText', false, text);
}

// ---- Commands from the editor -------------------------------------------------------------

/** A field change of a task from the editor (chips, menus): one history step. */
async function updatePisiTaskFromEditor(editor, taskId, patch) {
    if (editor) window.rebasePisiEditorHistory?.(editor);
    const result = await window.runPisiTaskCommand?.('task.update.v1', { taskId, patch });
    if (editor && result?.ok) window.recordPisiEditorHistory?.(editor);
    return result;
}

/** Sends a task to the Trash from the editor (a diary row); undo brings it back. */
async function deletePisiTaskFromEditor(editor, taskId) {
    if (editor) window.rebasePisiEditorHistory?.(editor);
    pisiTaskTitleDrafts.delete(taskId);
    const result = await window.runPisiTaskCommand?.('task.delete.v1', { taskId });
    if (result?.ok && result.trashId) pisiTaskWorkState.trashIds.set(taskId, result.trashId);
    if (editor && result?.ok) window.recordPisiEditorHistory?.(editor);
    return result;
}

/**
 * Find and replace changed task titles in `fields` (G3.8): one task.batch.v1
 * write and one history step with the text change.
 */
async function replacePisiTaskTitlesFromEditor(editor, fields) {
    const updates = [];
    for (const field of fields) {
        const taskId = field?.dataset?.pisiTaskTitle;
        if (!taskId || !window.getPisiTask?.(taskId)) continue;
        clearTimeout(pisiTaskWorkState.timers.get(taskId));
        const draft = normalizePisiTaskTitleDraft(field.textContent || '');
        pisiTaskTitleDrafts.set(taskId, draft);
        updates.push({ taskId, patch: { title: cleanPisiTaskTitle(draft) } });
    }
    if (!updates.length) return null;
    if (editor) window.recordPisiEditorHistory?.(editor);
    const result = await window.runPisiTaskCommand?.('task.batch.v1', { updates });
    for (const { taskId, patch } of updates) {
        if (!result?.ok || window.getPisiTask?.(taskId)?.title === patch.title) pisiTaskTitleDrafts.delete(taskId);
    }
    if (!result?.ok) window.refreshPisiOpenTaskDrawings?.();
    return result;
}

function getPisiTaskTrashId(taskId) {
    return pisiTaskWorkState.trashIds.get(taskId) || null;
}

function rememberPisiTaskTrashId(taskId, trashId) {
    if (taskId && trashId) pisiTaskWorkState.trashIds.set(taskId, trashId);
}

function forgetPisiTaskTrashId(taskId) {
    pisiTaskWorkState.trashIds.delete(taskId);
}

function wasPisiTaskCreatedInEditor(taskId) {
    return pisiTaskWorkState.created.has(taskId);
}

// ---- Making tasks -----------------------------------------------------------------------------

/** After a task arrived: the text typed while it was being made is its title. */
function adoptPisiPendingTitle(taskId, sent, typed) {
    if (normalizePisiTaskTitleDraft(typed) === normalizePisiTaskTitleDraft(sent)) return;
    pisiTaskTitleDrafts.set(taskId, normalizePisiTaskTitleDraft(typed));
    schedulePisiTaskTitleCommit(taskId, 0);
}

async function finishPisiCreatedTask(editor, result, { complete }) {
    pisiTaskWorkState.created.add(result.task.id);
    if (complete) await window.runPisiTaskCommand?.('task.complete.v1', { taskId: result.task.id });
}

async function createPisiNoteTask(editor, note, { anchor, replace, title, fields, caret, focus, complete }) {
    if (!note.noteId) {
        window.pisiNotifyError?.(pisiTaskWorkTranslate('Görevin notu bulunamadı.'));
        return null;
    }
    const block = window.makePisiPendingTaskBlock(title);
    if (replace?.parentNode) replace.replaceWith(block);
    else if (anchor?.parentNode) anchor.after(block);
    else {
        const section = editor.querySelector(`:scope > .${PISI_DIARY_TASKS_CLASS}`);
        if (section) section.before(block);
        else editor.appendChild(block);
    }
    const field = block.querySelector(PISI_TASK_TITLE_SELECTOR);
    if (focus) focusPisiTaskTitleField(field, caret);
    const sent = cleanPisiTaskTitle(title);
    const result = await window.runPisiTaskCommand?.(
        'task.create.v1',
        { task: { ...fields, title: sent }, target: { noteId: note.noteId, notePath: note.path, blockId: block.dataset.pisiBlockId } },
        {
            beforeDeferred: (created) => {
                if (created?.task?.id && block.isConnected) window.settlePisiPendingTaskBlock(block, { taskId: created.task.id, blockId: created.blockId });
            }
        }
    );
    if (!result?.ok || !result.task?.id) {
        if (block.isConnected) {
            const paragraph = makePisiParagraph();
            paragraph.textContent = field?.textContent || title || '';
            if (!paragraph.textContent) paragraph.innerHTML = '<br>';
            block.replaceWith(paragraph);
            notifyPisiEditorTaskChange(editor);
        }
        return null;
    }
    if (!block.isConnected) return result.task;
    adoptPisiPendingTitle(result.task.id, sent, field?.textContent || '');
    await finishPisiCreatedTask(editor, result, { complete });
    notifyPisiEditorTaskChange(editor);
    await window.flushPisiPendingSaves?.();
    return result.task;
}

async function createPisiDiaryTask(editor, note, { anchorRow, replace, title, fields, caret, focus, complete }) {
    const day = note.diaryDate;
    window.syncPisiDiaryTaskSectionIn?.(editor, day);
    const section = editor.querySelector(`:scope > .${PISI_DIARY_TASKS_CLASS}`);
    if (!section) return null;
    if (replace?.parentNode) {
        const others = Array.from(editor.children).filter((child) => child !== replace && child !== section && child.matches('.pisi-editor-block'));
        if (others.length) replace.remove();
        else replace.innerHTML = '<br>';
        notifyPisiEditorTaskChange(editor);
    }
    const row = window.makePisiPendingDiaryRow(section, title, { after: anchorRow?.closest?.('.pisi-diary-overdue') ? null : anchorRow });
    const field = row.querySelector(PISI_TASK_TITLE_SELECTOR);
    if (focus) focusPisiTaskTitleField(field, caret);
    const sent = cleanPisiTaskTitle(title);
    const result = await window.runPisiTaskCommand?.('task.create.v1', { task: { ...fields, title: sent }, target: { diaryDate: day } });
    const typed = field?.textContent || '';
    const hadFocus = document.activeElement === field || (focus && !getPisiEditorOfTaskElement(document.activeElement));
    const typedCaret = hadFocus ? getPisiTaskTitleCaret(field)?.start : null;
    row.remove();
    if (!result?.ok || !result.task?.id) return null;
    adoptPisiPendingTitle(result.task.id, sent, typed);
    await finishPisiCreatedTask(editor, result, { complete });
    window.syncPisiDiaryTaskSectionIn?.(editor, day);
    if (hadFocus || focus) {
        const next = section.querySelector(`:scope > [data-pisi-task-row="${CSS.escape(result.task.id)}"] ${PISI_TASK_TITLE_SELECTOR}`);
        focusPisiTaskTitleField(next, typedCaret ?? caret);
    }
    notifyPisiEditorTaskChange(editor);
    await window.flushPisiPendingSaves?.();
    return result.task;
}

/**
 * Makes a task in an open editor. In a note the block goes after `anchor`
 * (or in place of `replace`, or at the end); in a diary the task goes into the
 * day's section. `fields` are extra task fields; `complete` completes it.
 * Resolves to the new task, or null.
 */
async function createPisiTaskInEditor(
    editor,
    { anchor = null, anchorRow = null, replace = null, title = '', fields = {}, caret = null, focus = true, complete = false } = {}
) {
    const note = getPisiNoteOfEditor(editor);
    if (!note) return null;
    if (getPisiTaskStoreProblem()) {
        window.pisiNotifyError?.(pisiTaskWorkTranslate('Görevler okunamadı; görev deposu salt okunur.'));
        return null;
    }
    window.rebasePisiEditorHistory?.(editor);
    const options = { anchor, anchorRow, replace, title: normalizePisiTaskTitleDraft(title), fields, caret, focus, complete };
    return note.diaryDate ? createPisiDiaryTask(editor, note, options) : createPisiNoteTask(editor, note, options);
}

const PISI_TASK_SOURCE_TYPES = /^(?:paragraph|heading[1-5]|quote|bullet|number)$/;

/** Turns a text block into a task whose title is the block's text (§G3.3). Returns the promise of the task. */
function convertPisiBlockToTask(block, { title = null } = {}) {
    const editor = block?.closest?.('#center-node-editor-content, #node-modal-content');
    if (!editor || block.parentElement !== editor) return Promise.resolve(null);
    if (block.matches(`.${PISI_TASK_BLOCK_CLASS}`) || block.matches(`.${PISI_DIARY_TASKS_CLASS}`)) return Promise.resolve(null);
    if (!PISI_TASK_SOURCE_TYPES.test(block.dataset.pisiBlockType || 'paragraph')) return Promise.resolve(null);
    const text = title ?? cleanPisiTaskTitle(block.textContent || '');
    return createPisiTaskInEditor(editor, { replace: block, title: text, caret: text.length });
}

// ---- Keys in a title (docs/editor-keyboard-rules.md) ----------------------------------------

function getPisiTaskTitleFields(section) {
    return Array.from(section.querySelectorAll(`${PISI_TASK_TITLE_SELECTOR}`)).filter((field) => !field.closest('[hidden]'));
}

function placePisiCaretInBlock(block, atEnd) {
    if (!block) return false;
    if (block.matches(`.${PISI_TASK_BLOCK_CLASS}`)) {
        const field = block.querySelector(PISI_TASK_TITLE_SELECTOR);
        return field ? focusPisiTaskTitleField(field, atEnd ? null : 0) : false;
    }
    if (block.matches(`.${PISI_DIARY_TASKS_CLASS}`)) {
        const fields = getPisiTaskTitleFields(block);
        const field = atEnd ? fields.at(-1) : fields[0];
        return field ? focusPisiTaskTitleField(field, atEnd ? null : 0) : false;
    }
    if (block.getAttribute('contenteditable') === 'false') return false;
    const editor = block.closest('.pisi-rich-editor') || block.parentElement;
    editor?.focus?.({ preventScroll: true });
    if (atEnd) window.placeCaretAtEnd?.(block);
    else window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), block);
    window.selectPisiBlock?.(editor, block);
    return true;
}

/** Moves the caret out of a title field to the previous or next place. */
function movePisiOutOfTaskTitle(field, direction) {
    const section = field.closest(`.${PISI_DIARY_TASKS_CLASS}`);
    if (section) {
        const fields = getPisiTaskTitleFields(section);
        const index = fields.indexOf(field);
        const next = fields[index + direction];
        if (next) return focusPisiTaskTitleField(next, direction < 0 ? null : 0);
        if (direction < 0) return placePisiCaretInBlock(section.previousElementSibling, true);
        return false;
    }
    const block = getTaskBlock(field);
    const sibling = direction < 0 ? block?.previousElementSibling : block?.nextElementSibling;
    return placePisiCaretInBlock(sibling, direction < 0);
}

/** An empty task block becomes an empty paragraph (its task goes to the Trash with the save). */
function turnPisiTaskBlockIntoParagraph(editor, block) {
    window.rebasePisiEditorHistory?.(editor);
    const taskId = block.dataset.pisiTaskId;
    if (taskId) {
        clearTimeout(pisiTaskWorkState.timers.get(taskId));
        pisiTaskTitleDrafts.delete(taskId);
    }
    const paragraph = makePisiParagraph();
    block.replaceWith(paragraph);
    placePisiCaretInBlock(paragraph, false);
    notifyPisiEditorTaskChange(editor);
    return paragraph;
}

function handlePisiNoteTaskKey(event, editor, field, block, caret) {
    const empty = !(field.textContent || '').trim();
    const pending = Boolean(block.dataset.pisiTaskPending);
    if (event.key === 'Enter') {
        if (pending) return true;
        if (empty) {
            turnPisiTaskBlockIntoParagraph(editor, block);
            return true;
        }
        const { before, after } = splitPisiTaskTitle(field.textContent || '', caret?.start ?? field.textContent.length);
        if (after) {
            field.textContent = before;
            field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
        }
        void createPisiTaskInEditor(editor, { anchor: block, title: after.trimStart(), caret: 0 });
        return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
        if (empty && !pending) {
            turnPisiTaskBlockIntoParagraph(editor, block);
            return true;
        }
        if (!caret?.collapsed) return false;
        if (event.key === 'Backspace' && caret.start === 0) {
            movePisiOutOfTaskTitle(field, -1);
            return true;
        }
        if (event.key === 'Delete' && caret.start === caret.length) return true;
    }
    return false;
}

function handlePisiDiaryTaskKey(event, editor, field, row, caret) {
    const day = row.dataset.pisiDiaryDay || getPisiNoteOfEditor(editor)?.diaryDate;
    const taskId = field.dataset.pisiTaskTitle;
    const task = taskId ? window.getPisiTask?.(taskId) : null;
    const empty = !(field.textContent || '').trim();
    const isAdd = row.matches('.pisi-diary-task-add');
    if (event.key === 'Enter') {
        if (isAdd) {
            if (empty) return true;
            const title = field.textContent;
            field.textContent = '';
            void createPisiTaskInEditor(editor, { title, focus: false }).then(() => {
                // Back to the add field for the next task, unless the user went elsewhere meanwhile.
                const active = document.activeElement;
                if (!active || active === document.body || active === field || !field.isConnected) focusPisiTaskTitleField(field);
            });
            return true;
        }
        if (!task) return true;
        if (empty) {
            if (task.diaryDate === day) void deletePisiTaskFromEditor(editor, task.id).then(() => movePisiAfterRowRemoval(editor));
            return true;
        }
        const { before, after } = splitPisiTaskTitle(field.textContent || '', caret?.start ?? field.textContent.length);
        if (after) {
            field.textContent = before;
            field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
        }
        void createPisiTaskInEditor(editor, { anchorRow: row, title: after.trimStart(), caret: 0 });
        return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
        if (empty) {
            if (task && task.diaryDate === day) {
                void deletePisiTaskFromEditor(editor, task.id).then(() => movePisiAfterRowRemoval(editor));
                return true;
            }
            if (event.key === 'Backspace' && !isAdd) movePisiOutOfTaskTitle(field, -1);
            else if (isAdd && event.key === 'Backspace') movePisiOutOfTaskTitle(field, -1);
            return true;
        }
        if (!caret?.collapsed) return false;
        if (event.key === 'Backspace' && caret.start === 0) {
            movePisiOutOfTaskTitle(field, -1);
            return true;
        }
        if (event.key === 'Delete' && caret.start === caret.length) return true;
    }
    return false;
}

function movePisiAfterRowRemoval(editor) {
    const section = editor?.querySelector(`:scope > .${PISI_DIARY_TASKS_CLASS}`);
    const field = section?.querySelector('[data-pisi-task-add]');
    if (field) focusPisiTaskTitleField(field);
}

function handlePisiTaskTitleKeydown(event) {
    const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
    if (!field || event.isComposing || event.keyCode === 229) return;
    const editor = getPisiEditorOfTaskElement(field);
    if (!editor) return;
    const key = String(event.key || '');
    const mod = event.ctrlKey || event.metaKey;
    const done = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    if (!mod && !event.altKey && !event.shiftKey && handlePisiTaskTitleMenuKey(event, field)) {
        done();
        return;
    }
    if (mod && !event.altKey && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
        done();
        window.stepPisiEditorHistory?.(editor, key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1);
        return;
    }
    if (mod || event.altKey) return;
    if (key === 'Escape') {
        done();
        field.blur();
        return;
    }
    if (key === 'Enter' && event.shiftKey) {
        done();
        return;
    }
    if (field.getAttribute('contenteditable') === 'false' && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    const caret = getPisiTaskTitleCaret(field);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        done();
        movePisiOutOfTaskTitle(field, key === 'ArrowUp' ? -1 : 1);
        return;
    }
    if (key === 'ArrowLeft' && caret?.collapsed && caret.start === 0) {
        done();
        movePisiOutOfTaskTitle(field, -1);
        return;
    }
    if (key === 'ArrowRight' && caret?.collapsed && caret.start === caret.length) {
        done();
        movePisiOutOfTaskTitle(field, 1);
        return;
    }
    if (!['Enter', 'Backspace', 'Delete'].includes(key)) return;
    const row = getDiaryRow(field);
    const block = row ? null : getTaskBlock(field);
    const handled = row ? handlePisiDiaryTaskKey(event, editor, field, row, caret) : block ? handlePisiNoteTaskKey(event, editor, field, block, caret) : false;
    if (handled) done();
}

/** Keys of a text block next to a task block: never a text join with the task (§G3.5). */
function handlePisiTaskBoundaryKey(editor, event, block, range) {
    if (!['Backspace', 'Delete'].includes(event.key) || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !range?.collapsed) return false;
    const neighbour = event.key === 'Backspace' ? block.previousElementSibling : block.nextElementSibling;
    if (!neighbour?.matches?.(`.${PISI_TASK_BLOCK_CLASS}, .${PISI_DIARY_TASKS_CLASS}`)) return false;
    const side = document.createRange();
    side.selectNodeContents(block);
    if (event.key === 'Backspace') side.setEnd(range.startContainer, range.startOffset);
    else side.setStart(range.startContainer, range.startOffset);
    const fragment = side.cloneContents();
    if (fragment.textContent.replace(/​/g, '') || fragment.querySelector('br + *, img, table, canvas')) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const emptyBlock = !(block.textContent || '').replace(/[\s ​]/g, '') && !block.querySelector('img, table, canvas, hr');
    if (event.key === 'Backspace' && emptyBlock && neighbour.matches(`.${PISI_TASK_BLOCK_CLASS}`)) {
        const focusTarget = neighbour;
        block.remove();
        placePisiCaretInBlock(focusTarget, true);
        notifyPisiEditorTaskChange(editor);
        return true;
    }
    if (event.key === 'Backspace') placePisiCaretInBlock(neighbour, true);
    return true;
}

function initializePisiTaskWork() {
    document.addEventListener('input', handlePisiTaskTitleInput, true);
    document.addEventListener('keydown', handlePisiTaskTitleKeydown, true);
    document.addEventListener('paste', handlePisiTaskTitlePaste, true);
    document.addEventListener(
        'compositionstart',
        (event) => {
            const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
            if (field) pisiTaskWorkState.composing.add(field);
        },
        true
    );
    document.addEventListener(
        'compositionend',
        (event) => {
            const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
            if (!field) return;
            pisiTaskWorkState.composing.delete(field);
            if (field.dataset.pisiTaskTitle) schedulePisiTaskTitleCommit(field.dataset.pisiTaskTitle);
        },
        true
    );
    document.addEventListener(
        'focusout',
        (event) => {
            const field = event.target?.closest?.(PISI_TASK_TITLE_SELECTOR);
            if (field?.dataset.pisiTaskTitle && !pisiTaskWorkState.composing.has(field)) void commitPisiTaskTitle(field.dataset.pisiTaskTitle);
        },
        true
    );
    document.addEventListener('pisi:project-loaded', () => {
        pisiTaskWorkState.trashIds.clear();
        pisiTaskWorkState.created.clear();
        pisiTaskTitleDrafts.clear();
    });
}

initializePisiTaskWork();

const moduleApi = {
    commitPisiTaskTitle,
    flushPisiTaskTitles,
    updatePisiTaskFromEditor,
    deletePisiTaskFromEditor,
    replacePisiTaskTitlesFromEditor,
    getPisiTaskTrashId,
    rememberPisiTaskTrashId,
    forgetPisiTaskTrashId,
    wasPisiTaskCreatedInEditor,
    createPisiTaskInEditor,
    convertPisiBlockToTask,
    handlePisiTaskBoundaryKey
};

registerModule('tasks.editing', moduleApi);

export { createPisiTaskInEditor, convertPisiBlockToTask, flushPisiTaskTitles };
