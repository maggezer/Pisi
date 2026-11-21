import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS, PISI_TASK_BLOCK_CLASS, makePisiTaskBlockHtml } from '../../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml } from '../../shared/task-diary.mjs';
import {
    dispatchPisiTaskChangeInput,
    ensurePisiTaskChips,
    ensurePisiTaskTitleField,
    getPisiNoteOfEditor,
    getPisiEditorOfTaskElement,
    getPisiTaskStoreProblem,
    getPisiTaskTitleText,
    makePisiTaskCheckbox,
    makePisiTaskView,
    pisiTaskTitleDrafts,
    pisiTaskViewTranslate,
    updatePisiTaskCheckbox
} from './pisi-task-view.mjs';
import { openPisiTaskPopover } from './pisi-task-popover.mjs';

// The editor's task block (docs/task-plan.md §3.2.1, G3): a checkbox, the
// title field and the chips, drawn from the task store. The file holds only
// the ids; cleanPisiTaskDrawingsForSave takes the drawing out of the copy the
// editor saves (GV2). A store change redraws only the blocks of the changed
// tasks, in place, so the caret in a title stays where it is (§3.5). A block
// that is being created (`data-pisi-task-pending`) has a title field but no id
// yet and is never saved. The diary's section is drawn by pisi-task-diary.mjs.

const PENDING = 'pisiTaskPending';

function pisiTaskBlockTranslate(value) {
    return pisiTaskViewTranslate(value);
}

function isPisiPendingTaskBlock(block) {
    return Boolean(block?.dataset?.[PENDING]);
}

/** Draws one task block from its record, reusing what is already drawn. */
function drawPisiTaskBlock(block) {
    if (!block?.isConnected && !block?.parentNode) return;
    block.setAttribute('contenteditable', 'false');
    if (isPisiPendingTaskBlock(block)) {
        if (!block.querySelector(':scope > .pisi-task-check')) block.prepend(makePisiTaskCheckbox());
        updatePisiTaskCheckbox(block.querySelector(':scope > .pisi-task-check'), '', false, { disabled: true });
        ensurePisiTaskTitleField(block, null, { text: block.querySelector(':scope > .pisi-task-title')?.textContent || '' });
        return;
    }
    const taskId = block.dataset.pisiTaskId;
    const task = window.getPisiTask?.(taskId);
    const problem = getPisiTaskStoreProblem();
    if (problem || !task) {
        block.classList.add('pisi-task-block-missing');
        block.classList.remove('pisi-task-done');
        block.replaceChildren(makePisiTaskView('span', 'pisi-task-missing', problem || pisiTaskBlockTranslate('Görev bulunamadı')));
        return;
    }
    if (block.classList.contains('pisi-task-block-missing')) {
        block.classList.remove('pisi-task-block-missing');
        block.replaceChildren();
    }
    for (const child of Array.from(block.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE || !child.hasAttribute('data-pisi-task-view')) child.remove();
    }
    const done = task.status === 'done';
    block.classList.toggle('pisi-task-done', done);
    let box = block.querySelector(':scope > .pisi-task-check');
    if (!box) {
        box = makePisiTaskCheckbox();
        block.prepend(box);
    }
    updatePisiTaskCheckbox(box, task.id, done);
    ensurePisiTaskTitleField(block, task.id, { text: getPisiTaskTitleText(task) });
    ensurePisiTaskChips(block, task);
}

/** A block for a task that is being created: drawn at once, saved only when the task has its id. */
function makePisiPendingTaskBlock(title = '') {
    const block = document.createElement('div');
    block.className = `pisi-editor-block ${PISI_TASK_BLOCK_CLASS} pisi-task-pending`;
    block.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    block.dataset.pisiBlockType = 'task';
    block.dataset[PENDING] = '1';
    block.setAttribute('contenteditable', 'false');
    const field = ensurePisiTaskTitleField(block, null, { text: title });
    field.textContent = title;
    drawPisiTaskBlock(block);
    return block;
}

/** Gives a pending block the id of its new task and draws it. */
function settlePisiPendingTaskBlock(block, { taskId, blockId }) {
    if (!block) return null;
    delete block.dataset[PENDING];
    block.classList.remove('pisi-task-pending');
    block.dataset.pisiTaskId = taskId;
    if (blockId) block.dataset.pisiBlockId = blockId;
    drawPisiTaskBlock(block);
    return block;
}

// ---- Tasks of this note that have no block (§3.3) -----------------------------------

function getPisiTaskHomelessIds(editor) {
    const note = getPisiNoteOfEditor(editor);
    if (!note?.noteId || note.diaryDate || getPisiTaskStoreProblem()) return [];
    const present = new Set(Array.from(editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`)).map((block) => block.dataset.pisiTaskId));
    return (window.getPisiTasks?.() || []).filter((task) => task.noteId === note.noteId && !present.has(task.id)).map((task) => task.id);
}

/**
 * The notice above the editor: "N tasks of this note are not in it" with
 * "Add at the end". `allowShow` is false for store updates while editing: the
 * notice then only shrinks (a block that is being saved is not reported).
 */
function updatePisiTaskHomelessNotice(editor, { allowShow = false } = {}) {
    const host = editor?.parentElement;
    if (!host) return;
    let notice = host.querySelector(':scope > .pisi-task-homeless');
    const ids = getPisiTaskHomelessIds(editor);
    const shown = notice ? (notice.dataset.pisiTaskIds || '').split(',').filter(Boolean) : [];
    const list = allowShow ? ids : shown.filter((id) => ids.includes(id));
    if (!list.length) {
        notice?.remove();
        return;
    }
    if (!notice) {
        notice = document.createElement('div');
        notice.className = 'pisi-task-homeless';
        notice.setAttribute('role', 'status');
        host.insertBefore(notice, editor);
    }
    notice.dataset.pisiTaskIds = list.join(',');
    notice.dataset.pisiTaskHost = editor.id;
    const text = document.createElement('span');
    text.textContent = pisiTaskBlockTranslate('Bu nota ait {count} görev notta görünmüyor.').replace('{count}', String(list.length));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-task-homeless-add';
    button.textContent = pisiTaskBlockTranslate('Sona ekle');
    notice.replaceChildren(text, button);
}

async function appendPisiHomelessTasks(editor) {
    const host = editor?.parentElement;
    const notice = host?.querySelector(':scope > .pisi-task-homeless');
    const ids = (notice?.dataset.pisiTaskIds || '').split(',').filter(Boolean);
    notice?.remove();
    const present = new Set(Array.from(editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`)).map((block) => block.dataset.pisiTaskId));
    let added = 0;
    for (const taskId of ids) {
        if (present.has(taskId) || !window.getPisiTask?.(taskId)) continue;
        const template = document.createElement('template');
        template.innerHTML = makePisiTaskBlockHtml({ blockId: window.makePisiBlockId?.() || `blk_${Date.now().toString(36)}${added}`, taskId });
        const block = template.content.firstElementChild;
        const section = editor.querySelector(`:scope > .${PISI_DIARY_TASKS_CLASS}`);
        if (section) section.before(block);
        else editor.appendChild(block);
        drawPisiTaskBlock(block);
        added += 1;
    }
    if (!added) return;
    dispatchPisiTaskChangeInput(editor);
    await window.flushPisiPendingSaves?.();
}

// ---- Drawing, cleaning, updates -------------------------------------------------------

/** Draws every task block and the diary section of an editor. */
function renderPisiTaskBlocksIn(editor) {
    if (!editor) return;
    editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}`).forEach((block) => {
        if (block.dataset.pisiTaskId || isPisiPendingTaskBlock(block)) drawPisiTaskBlock(block);
    });
    const day = getPisiNoteOfEditor(editor)?.diaryDate;
    if (day) window.syncPisiDiaryTaskSectionIn?.(editor, day);
    updatePisiTaskHomelessNotice(editor);
}

function readPisiSectionRefs(section) {
    if (section.dataset.pisiTaskIds !== undefined) return section.dataset.pisiTaskIds ? section.dataset.pisiTaskIds.split(',') : [];
    return Array.from(section.querySelectorAll('[data-pisi-task-ref]'))
        .map((row) => row.getAttribute('data-pisi-task-ref'))
        .filter(Boolean);
}

/**
 * The saved form (GV2): task blocks empty, blocks being created left out, the
 * diary section as its ids. Runs on the copy getPisiEditorContent saves; the
 * main process brings the section to the rule again when the diary is saved.
 */
function cleanPisiTaskDrawingsForSave(root) {
    if (!root) return;
    root.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}`).forEach((block) => {
        if (isPisiPendingTaskBlock(block) || !block.dataset.pisiTaskId) {
            block.remove();
            return;
        }
        block.replaceChildren();
        block.classList.remove('pisi-task-done', 'pisi-task-block-missing', 'pisi-block-active', 'pisi-task-block-flash', 'pisi-task-pending');
        if (!block.classList.contains('pisi-editor-block')) block.classList.add('pisi-editor-block');
        for (const attribute of Array.from(block.attributes)) {
            if (!['class', 'data-pisi-block-id', 'data-pisi-block-type', 'data-pisi-task-id', 'contenteditable'].includes(attribute.name))
                block.removeAttribute(attribute.name);
        }
    });
    root.querySelectorAll(`.${PISI_DIARY_TASKS_CLASS}`).forEach((section) => {
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

function getPisiOpenEditorsWithTasks() {
    return ['center-node-editor-content', 'node-modal-content'].map((id) => document.getElementById(id)).filter((editor) => editor?.isConnected);
}

function refreshPisiOpenTaskDrawings() {
    for (const editor of getPisiOpenEditorsWithTasks()) renderPisiTaskBlocksIn(editor);
}

/** A store change: only the blocks of the changed tasks are drawn again (§3.5). */
function applyPisiTaskStoreUpdate(detail = {}) {
    const ids = new Set([...(detail.changedIds || []), ...(detail.removedIds || [])]);
    for (const id of detail.removedIds || []) pisiTaskTitleDrafts.delete(id);
    for (const editor of getPisiOpenEditorsWithTasks()) {
        if (detail.reset) {
            renderPisiTaskBlocksIn(editor);
            updatePisiTaskHomelessNotice(editor, { allowShow: true });
            continue;
        }
        editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`).forEach((block) => {
            if (ids.has(block.dataset.pisiTaskId)) drawPisiTaskBlock(block);
        });
        const day = getPisiNoteOfEditor(editor)?.diaryDate;
        if (day) window.syncPisiDiaryTaskSectionIn?.(editor, day);
        updatePisiTaskHomelessNotice(editor);
    }
}

// ---- Checkbox and chips ---------------------------------------------------------------

async function handlePisiTaskCheckActivate(box) {
    if (box.getAttribute('aria-disabled') === 'true') {
        if (box.dataset.pisiTaskLocked === 'true')
            window.pisiNotifyWarning?.(pisiTaskBlockTranslate('Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı.'));
        return;
    }
    const editor = getPisiEditorOfTaskElement(box);
    if (editor) window.rebasePisiEditorHistory?.(editor);
    const result = await window.togglePisiTaskCompletion?.(box.dataset.pisiTaskCheck, box.dataset.pisiTaskDay || null);
    if (editor && result?.ok) window.recordPisiEditorHistory?.(editor);
}

function handlePisiTaskChipActivate(chip) {
    const task = window.getPisiTask?.(chip.dataset.pisiTaskChipFor);
    if (!task || chip.disabled) return;
    const editor = getPisiEditorOfTaskElement(chip);
    openPisiTaskPopover(chip, {
        kind: chip.dataset.pisiTaskChip,
        task,
        onPatch: (patch) => void window.updatePisiTaskFromEditor?.(editor, task.id, patch),
        onClose: ({ restoreFocus }) => {
            if (!restoreFocus) return;
            const field = chip.closest('[data-pisi-task-row], .pisi-task-block')?.querySelector('[data-pisi-task-title]');
            field?.focus?.({ preventScroll: true });
        }
    });
}

function handlePisiTaskBlockClick(event) {
    const box = event.target?.closest?.('[data-pisi-task-check]');
    if (box) {
        event.preventDefault();
        event.stopPropagation();
        void handlePisiTaskCheckActivate(box);
        return;
    }
    const chip = event.target?.closest?.('[data-pisi-task-chip]');
    if (chip) {
        event.preventDefault();
        event.stopPropagation();
        handlePisiTaskChipActivate(chip);
        return;
    }
    const add = event.target?.closest?.('.pisi-task-homeless-add');
    if (add) {
        const editor = document.getElementById(add.closest('.pisi-task-homeless')?.dataset.pisiTaskHost || '');
        void appendPisiHomelessTasks(editor);
    }
}

function handlePisiTaskCheckKeydown(event) {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.isComposing) return;
    const box = event.target?.closest?.('[data-pisi-task-check]');
    if (!box || document.activeElement !== box) return;
    event.preventDefault();
    event.stopPropagation();
    void handlePisiTaskCheckActivate(box);
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
    document.addEventListener('click', handlePisiTaskBlockClick, true);
    document.addEventListener('keydown', handlePisiTaskCheckKeydown, true);
    // A checkbox or chip click must not move the caret into the block.
    document.addEventListener(
        'mousedown',
        (event) => {
            if (event.target?.closest?.('[data-pisi-task-check], [data-pisi-task-chip]')) event.preventDefault();
        },
        true
    );
    document.addEventListener('pisi:task-store-updated', (event) => {
        applyPisiTaskStoreUpdate(event.detail || {});
        // A sync turn left open diaries to the editor: the section is drawn again and saved.
        for (const day of event.detail?.deferredDiaryDays || []) void window.applyPisiTaskDeferred?.({ notes: [], diaryDays: [day] });
    });
    document.addEventListener('pisi:active-node-changed', () =>
        queueMicrotask(() => {
            for (const editor of getPisiOpenEditorsWithTasks()) {
                renderPisiTaskBlocksIn(editor);
                updatePisiTaskHomelessNotice(editor, { allowShow: true });
            }
        })
    );
}

initializePisiTaskBlocks();

const moduleApi = {
    drawPisiTaskBlock,
    makePisiPendingTaskBlock,
    settlePisiPendingTaskBlock,
    renderPisiTaskBlocksIn,
    cleanPisiTaskDrawingsForSave,
    refreshPisiOpenTaskDrawings,
    updatePisiTaskHomelessNotice
};

registerModule('tasks.block', moduleApi);

export { drawPisiTaskBlock, makePisiPendingTaskBlock, settlePisiPendingTaskBlock, renderPisiTaskBlocksIn, cleanPisiTaskDrawingsForSave };
