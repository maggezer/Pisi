import { registerModule } from '../core/module-registry.mjs';
import { makePisiTaskBlockHtml } from '../../shared/task-blocks.mjs';
import { getPisiTaskStateOnDay } from '../../shared/task-diary.mjs';
import { getPisiTaskLatestCompletion, getPisiTodayIsoDate } from '../../shared/task-model.mjs';

// Task commands from the renderer (docs/task-plan.md §3.4, GV9). Every change
// goes to the main-process task service (task.*.v1). The open note and the
// open note window are named in `openPaths`: the service does not write them
// and hands the change back (`deferred`); it is made here, in the editor, and
// saved through the editor's own save path.

const pisiTaskActionState = { lastNote: null };

function pisiTaskTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiTaskPath(value) {
    const text = String(value || '').replace(/[\\/]+/g, '/');
    return window.pisiEnvironment?.platform === 'linux' ? text : text.toLowerCase();
}

function samePisiTaskPath(left, right) {
    return Boolean(left) && Boolean(right) && normalizePisiTaskPath(left) === normalizePisiTaskPath(right);
}

/** The open documents: the center note and the note window, as `{ path, editor, node }`. */
function getPisiOpenTaskDocuments() {
    const documents = [];
    const center = window.activeCenterNode;
    const centerEditor = window.getCenterNodeEditorElements?.()?.contentEditor || document.getElementById('center-node-editor-content');
    if (center?.path && centerEditor) documents.push({ path: center.path, editor: centerEditor, node: center, kind: 'center' });
    const modal = window.activeModalNode;
    const modalEditor = document.getElementById('node-modal-content');
    if (modal?.path && modalEditor) documents.push({ path: modal.path, editor: modalEditor, node: modal, kind: 'modal' });
    return documents;
}

function getPisiOpenDocumentPaths() {
    return getPisiOpenTaskDocuments().map((item) => item.path);
}

function findPisiOpenTaskDocument(filePath) {
    return getPisiOpenTaskDocuments().find((item) => samePisiTaskPath(item.path, filePath)) || null;
}

function getPisiNoteDiaryDate(node) {
    const date = node?.metadata?.diaryDate || node?.item?.metadata?.diaryDate || null;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null;
}

/** The open note the user worked in last (center editor or note window), for Quick Add (§1.4). */
function getPisiLastFocusedNote() {
    const last = pisiTaskActionState.lastNote;
    const open = getPisiOpenTaskDocuments();
    const match = last ? open.find((item) => samePisiTaskPath(item.path, last.path)) : null;
    const chosen = match || open.find((item) => item.kind === 'modal') || open[0] || null;
    if (!chosen) return null;
    const metadata = chosen.node?.metadata || chosen.node?.item?.metadata || {};
    return {
        path: chosen.path,
        noteId: metadata.id || null,
        title: metadata.title || chosen.node?.item?.displayName || '',
        diaryDate: getPisiNoteDiaryDate(chosen.node),
        editor: chosen.editor
    };
}

function trackPisiFocusedNote(event) {
    const editor = event.target?.closest?.('#center-node-editor-content, #node-modal-content');
    if (!editor) return;
    const document = getPisiOpenTaskDocuments().find((item) => item.editor === editor);
    if (document) pisiTaskActionState.lastNote = { path: document.path };
}

/** The path of the note with this id: an open note first, then the search index's documents. */
async function resolvePisiNotePath(noteId) {
    if (!noteId) return null;
    for (const item of getPisiOpenTaskDocuments()) {
        if ((item.node?.metadata?.id || item.node?.item?.metadata?.id) === noteId) return item.path;
    }
    const index = await window.ensurePisiSearchIndex?.();
    if (index?.documents instanceof Map) {
        for (const record of index.documents.values()) {
            if (record?.metadata?.id === noteId) return record.path;
        }
    }
    return null;
}

// ---- Deferred changes of open documents (GV9) -------------------------------------

function notifyPisiEditorOfTaskChange(editor) {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertPisiTaskBlockIntoEditor(editor, change) {
    if (editor.querySelector(`.pisi-task-block[data-pisi-task-id="${CSS.escape(change.taskId)}"]`)) return false;
    const template = document.createElement('template');
    template.innerHTML = makePisiTaskBlockHtml({ blockId: change.blockId, taskId: change.taskId });
    const block = template.content.firstElementChild;
    const anchor = change.afterBlockId ? editor.querySelector(`:scope > [data-pisi-block-id="${CSS.escape(change.afterBlockId)}"]`) : null;
    const section = editor.querySelector(':scope > .pisi-diary-tasks');
    if (anchor) anchor.after(block);
    else if (section) section.before(block);
    else editor.appendChild(block);
    window.renderPisiTaskBlocksIn?.(editor);
    return true;
}

function removePisiTaskBlockFromEditor(editor, change) {
    const blocks = editor.querySelectorAll(`.pisi-task-block[data-pisi-task-id="${CSS.escape(change.taskId)}"]`);
    blocks.forEach((block) => block.remove());
    return blocks.length > 0;
}

/** Makes in the open editors what the service left to them, then lets the editor save. */
function applyPisiTaskDeferred(deferred) {
    if (!deferred) return;
    const touched = new Set();
    for (const change of Array.isArray(deferred.notes) ? deferred.notes : []) {
        const open = findPisiOpenTaskDocument(change.notePath);
        if (!open) continue;
        const changed = change.op === 'insert' ? insertPisiTaskBlockIntoEditor(open.editor, change) : removePisiTaskBlockFromEditor(open.editor, change);
        if (changed) touched.add(open.editor);
    }
    for (const day of Array.isArray(deferred.diaryDays) ? deferred.diaryDays : []) {
        for (const open of getPisiOpenTaskDocuments()) {
            if (getPisiNoteDiaryDate(open.node) !== day) continue;
            if (window.syncPisiDiaryTaskSectionIn?.(open.editor, day)) touched.add(open.editor);
        }
    }
    for (const editor of touched) notifyPisiEditorOfTaskChange(editor);
}

// ---- Commands ----------------------------------------------------------------------

/** Runs a task command for the open project; reports a failure to the user. */
async function runPisiTaskCommand(name, payload = {}, { quiet = false } = {}) {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return { ok: false, code: 'NO_PROJECT', error: pisiTaskTranslate('Açık proje yok.') };
    let result;
    try {
        result = await window.pisiDomain.command(name, { ...payload, projectFolder, openPaths: getPisiOpenDocumentPaths() });
    } catch (error) {
        result = { ok: false, error: error?.message || String(error) };
    }
    if (!result?.ok) {
        if (!quiet) window.pisiNotifyError?.(describePisiTaskError(result));
        return result || { ok: false };
    }
    applyPisiTaskDeferred(result.deferred);
    return result;
}

function describePisiTaskError(result) {
    const messages = {
        TASK_STORE_READ_ONLY: 'Görevler okunamadı; görev deposu salt okunur.',
        TASK_COMPLETION_LOCKED: 'Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı.',
        TASK_DEPENDENCY_CYCLE: 'Bu bağımlılık bir döngü oluşturur.',
        TASK_NOT_FOUND: 'Görev bulunamadı.',
        TASK_NOTE_MISSING: 'Görevin notu bulunamadı.'
    };
    const text = messages[result?.code] || result?.error || 'Görev değişikliği kaydedilemedi.';
    return pisiTaskTranslate(text);
}

/**
 * Ticks or unticks a task as it shows on `day` (the diary's day, or today):
 * an open task is completed; a task shown done that day is taken back, which
 * for a repeating task is only the latest completion (§3.2.3).
 */
async function togglePisiTaskCompletion(taskId, day = null) {
    const task = window.getPisiTask?.(taskId);
    if (!task) return { ok: false, code: 'TASK_NOT_FOUND' };
    const onDay = day ? getPisiTaskStateOnDay(task, day) : null;
    const shownDone = onDay ? onDay.state === 'done' || (onDay.state === 'dated' && onDay.status === 'done') : task.status === 'done';
    if (!shownDone) return runPisiTaskCommand('task.complete.v1', { taskId });
    if (task.repeat !== 'none') {
        const entry = onDay?.state === 'done' ? (Array.isArray(task.completions) ? task.completions : []).find((item) => item.at === onDay.at) : null;
        const completion = entry || getPisiTaskLatestCompletion(task);
        if (!completion) return { ok: true, changed: false };
        return runPisiTaskCommand('task.reopen.v1', { taskId, completion });
    }
    return runPisiTaskCommand('task.reopen.v1', { taskId });
}

/**
 * Creates a task in `target` (`{ noteId, notePath }` or `{ diaryDate }`). For
 * an open note the block goes into the editor, after the block with the caret
 * when it is in that note.
 */
async function createPisiTaskInTarget(task, target) {
    const open = target?.notePath ? findPisiOpenTaskDocument(target.notePath) : null;
    const caretBlock = open ? window.getSelection?.()?.anchorNode?.parentElement?.closest?.('.pisi-editor-block') : null;
    const afterBlockId = caretBlock && caretBlock.parentElement === open?.editor ? caretBlock.dataset.pisiBlockId || null : null;
    return runPisiTaskCommand('task.create.v1', { task, target: { ...target, afterBlockId: target?.afterBlockId || afterBlockId } });
}

/** Opens the place of a task: its note (the block is shown) or its day's diary. */
async function openPisiTaskLocation(taskId) {
    const task = window.getPisiTask?.(taskId);
    if (!task) return false;
    if (task.diaryDate || (!task.noteId && task.dueDate)) {
        await window.openPisiDiaryForDate?.(task.diaryDate || task.dueDate);
        return true;
    }
    const notePath = await resolvePisiNotePath(task.noteId);
    if (!notePath) {
        window.pisiNotifyError?.(pisiTaskTranslate('Görevin notu bulunamadı.'));
        return false;
    }
    const fileName = notePath.split(/[\\/]/).pop();
    const opened = await window.openPisiFileTab?.({ name: fileName, fileName, fullPath: notePath, type: 'file', isFile: true, isDirectory: false });
    if (!opened) return false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const block = findPisiOpenTaskDocument(notePath)?.editor?.querySelector(`.pisi-task-block[data-pisi-task-id="${CSS.escape(task.id)}"]`);
        if (block) {
            block.scrollIntoView({ block: 'center' });
            block.classList.add('pisi-task-block-flash');
            setTimeout(() => block.classList.remove('pisi-task-block-flash'), 1600);
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
}

function getPisiTaskToday() {
    return getPisiTodayIsoDate(new Date());
}

document.addEventListener('focusin', trackPisiFocusedNote, true);

const moduleApi = {
    getPisiOpenDocumentPaths,
    getPisiLastFocusedNote,
    resolvePisiNotePath,
    applyPisiTaskDeferred,
    runPisiTaskCommand,
    togglePisiTaskCompletion,
    createPisiTaskInTarget,
    openPisiTaskLocation,
    getPisiTaskToday
};

registerModule('tasks.actions', moduleApi);

export { getPisiOpenDocumentPaths, runPisiTaskCommand, togglePisiTaskCompletion, createPisiTaskInTarget, openPisiTaskLocation };
