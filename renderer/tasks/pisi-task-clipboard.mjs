import { registerModule } from '../core/module-registry.mjs';
import { PISI_DIARY_TASKS_CLASS, PISI_TASK_BLOCK_CLASS } from '../../shared/task-blocks.mjs';
import {
    PISI_TASK_CLIPBOARD_TYPE,
    cleanPisiTaskTitle,
    decidePisiPastedTask,
    formatPisiTaskPlainLine,
    makePisiTaskClipboardPayload,
    makePisiTaskCopyFields,
    readPisiTaskClipboardPayload
} from './pisi-task-edit-core.mjs';
import {
    PISI_TASK_TITLE_SELECTOR,
    dispatchPisiTaskChangeInput,
    getPisiNoteOfEditor,
    getPisiEditorOfTaskElement,
    getPisiTaskTitleText
} from './pisi-task-view.mjs';

// Copy, cut, paste and duplicate of task blocks (docs/task-plan.md §3.3, G3.7;
// docs/editor-paste-rules.md). The clipboard carries the task records
// (`application/x-pisi-tasks`) next to the HTML (bare task blocks) and the
// plain text (`- [ ] Title`). Cutting saves the note at once, so the task is in
// the Trash when it is pasted: the paste keeps its id and the note save brings
// it back, in its new place (a move). Any other pasted task block is a copy
// with a new id; one with no record anywhere is not pasted. In a diary the
// tasks go into the day's section instead of blocks.

function samePisiTaskProject(left, right) {
    const normalize = (value) =>
        String(value || '')
            .replace(/[\\/]+/g, '/')
            .replace(/\/+$/, '');
    const a = normalize(left);
    const b = normalize(right);
    return window.pisiEnvironment?.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}

function getPisiSelectionRangeIn(editor) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
}

/** The task blocks a range touches, in document order. */
function listPisiTaskBlocksInRange(editor, range) {
    return Array.from(editor.querySelectorAll(`:scope > .${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id]`)).filter((block) => range.intersectsNode(block));
}

function makePisiPlainTextOf(fragment) {
    const lines = [];
    for (const child of Array.from(fragment.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && child.matches?.(`.${PISI_TASK_BLOCK_CLASS}`)) {
            const task = window.getPisiTask?.(child.dataset.pisiTaskId);
            if (task) lines.push(formatPisiTaskPlainLine({ ...task, title: getPisiTaskTitleText(task) }));
            continue;
        }
        const text = String(child.textContent || '').replace(/​/g, '');
        if (child.nodeType === Node.TEXT_NODE && !text.trim()) continue;
        lines.push(text);
    }
    return lines.join('\n');
}

/** Copy or cut of a selection that has task blocks: the records go with it. */
function handlePisiTaskClipboardCopy(event) {
    if (!event.clipboardData || event.defaultPrevented) return;
    const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
    if (target?.closest?.(PISI_TASK_TITLE_SELECTOR)) return;
    const editor = getPisiEditorOfTaskElement(target) || getPisiEditorOfTaskElement(window.getSelection?.()?.anchorNode?.parentElement);
    if (!editor) return;
    const range = getPisiSelectionRangeIn(editor);
    if (!range || range.collapsed) return;
    const blocks = listPisiTaskBlocksInRange(editor, range);
    if (!blocks.length) return;
    const wrapper = document.createElement('div');
    // Whole task blocks: a selection that starts or ends inside one takes all of it.
    const whole = document.createRange();
    whole.setStart(range.startContainer, range.startOffset);
    whole.setEnd(range.endContainer, range.endOffset);
    const first = blocks[0];
    const last = blocks.at(-1);
    if (first.contains(range.startContainer)) whole.setStartBefore(first);
    if (last.contains(range.endContainer)) whole.setEndAfter(last);
    wrapper.appendChild(whole.cloneContents());
    wrapper.querySelectorAll(`.${PISI_DIARY_TASKS_CLASS}`).forEach((section) => section.remove());
    window.cleanPisiTaskDrawingsForSave?.(wrapper);
    const tasks = blocks
        .map((block) => window.getPisiTask?.(block.dataset.pisiTaskId))
        .filter(Boolean)
        .map((task) => ({ ...task, title: cleanPisiTaskTitle(getPisiTaskTitleText(task)) }));
    event.clipboardData.setData('text/html', wrapper.innerHTML);
    event.clipboardData.setData('text/plain', makePisiPlainTextOf(wrapper));
    event.clipboardData.setData(
        PISI_TASK_CLIPBOARD_TYPE,
        makePisiTaskClipboardPayload({ projectFolder: window.currentProjectFolder, tasks, cut: event.type === 'cut' })
    );
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'cut') return;
    whole.deleteContents();
    if (!editor.querySelector(':scope > .pisi-editor-block:not(.pisi-diary-tasks)')) {
        const paragraph = document.createElement('div');
        paragraph.className = 'pisi-editor-block';
        paragraph.dataset.pisiBlockType = 'paragraph';
        paragraph.innerHTML = '<br>';
        editor.prepend(paragraph);
    }
    const selection = window.getSelection?.();
    whole.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(whole);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteByCut' }));
    // The note is saved at once: the cut tasks are in the Trash before they can be pasted.
    void window.flushPisiPendingSaves?.();
}

// ---- Pasted task blocks -----------------------------------------------------------------------

async function makePisiCopiedTask(editor, block, fields, { complete = false } = {}) {
    const note = getPisiNoteOfEditor(editor);
    const title = fields.title || '';
    if (note?.diaryDate) {
        block.remove();
        return window.createPisiTaskInEditor?.(editor, { title, fields: { ...fields, title: undefined }, focus: false, complete });
    }
    return window.createPisiTaskInEditor?.(editor, { replace: block, title, fields: { ...fields, title: undefined }, focus: false, complete });
}

/**
 * Settles task blocks that just came into an editor (paste, duplicate,
 * Markdown source): keeps, copies or drops each (§3.3). `clipboard` is the
 * `application/x-pisi-tasks` text, or null.
 */
async function settlePisiPastedTasks(editor, blocks, clipboard = null) {
    if (!editor || !Array.isArray(blocks) || !blocks.length) return;
    const payload = readPisiTaskClipboardPayload(clipboard);
    const note = getPisiNoteOfEditor(editor);
    let changed = false;
    const keptInDiary = [];
    for (const block of blocks) {
        if (!block?.isConnected || !block.matches?.(`.${PISI_TASK_BLOCK_CLASS}`)) continue;
        const hint = block.dataset.pisiTaskTitleHint;
        delete block.dataset.pisiTaskTitleHint;
        if (block.dataset.pisiTaskNewTitle !== undefined) {
            const title = block.dataset.pisiTaskNewTitle;
            const done = block.dataset.pisiTaskNewDone === 'true';
            await makePisiCopiedTask(editor, block, { title }, { complete: done });
            changed = true;
            continue;
        }
        if (block.dataset.pisiTaskCopyOf) {
            const source = window.getPisiTask?.(block.dataset.pisiTaskCopyOf);
            if (source) await makePisiCopiedTask(editor, block, makePisiTaskCopyFields({ ...source, title: getPisiTaskTitleText(source) }));
            else block.remove();
            changed = true;
            continue;
        }
        const taskId = block.dataset.pisiTaskId;
        if (!taskId) continue;
        const liveTask = window.getPisiTask?.(taskId) || null;
        // Already this note's own (Markdown source, undo): nothing to settle but a changed title.
        if (!payload && liveTask && liveTask.noteId && liveTask.noteId === note?.noteId) {
            const others = Array.from(editor.querySelectorAll(`.${PISI_TASK_BLOCK_CLASS}[data-pisi-task-id="${CSS.escape(taskId)}"]`)).filter(
                (item) => item !== block
            );
            if (!others.length) {
                if (typeof hint === 'string' && cleanPisiTaskTitle(hint) !== liveTask.title) {
                    await window.runPisiTaskCommand?.('task.update.v1', { taskId, patch: { title: cleanPisiTaskTitle(hint) } });
                }
                window.drawPisiTaskBlock?.(block);
                continue;
            }
        }
        const decision = decidePisiPastedTask({ taskId, payload, projectFolder: window.currentProjectFolder, liveTask, sameProject: samePisiTaskProject });
        if (decision === 'keep') {
            // The note save brings the task back from the Trash; in a diary it joins the day's section (task-service.js).
            window.drawPisiTaskBlock?.(block);
            if (note?.diaryDate) keptInDiary.push(block);
            changed = true;
            continue;
        }
        if (decision === 'drop') {
            block.remove();
            changed = true;
            continue;
        }
        const record = liveTask || payload?.tasks?.get(taskId);
        await makePisiCopiedTask(editor, block, makePisiTaskCopyFields(record));
        changed = true;
    }
    if (changed) {
        dispatchPisiTaskChangeInput(editor);
        await window.flushPisiPendingSaves?.();
    }
    if (keptInDiary.length) {
        // The saved diary has no such block any more: its task is a row of the section now.
        keptInDiary.forEach((block) => block.remove());
        if (note?.diaryDate) window.syncPisiDiaryTaskSectionIn?.(editor, note.diaryDate);
        dispatchPisiTaskChangeInput(editor);
    }
}

document.addEventListener('copy', handlePisiTaskClipboardCopy, true);
document.addEventListener('cut', handlePisiTaskClipboardCopy, true);

const moduleApi = {
    settlePisiPastedTasks
};

registerModule('tasks.clipboard', moduleApi);

export { settlePisiPastedTasks };
