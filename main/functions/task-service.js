import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { modules, registerMainModule } from '../module-registry.js';
import { formatPisiBlockId, isPisiTaskId } from '../../shared/ids.mjs';
import {
    PISI_TASK_TITLE_MAX_LENGTH,
    completePisiTask,
    findPisiTaskDependencyCycle,
    isSamePisiTask,
    normalizePisiTask,
    readPisiTask,
    reopenPisiTask
} from '../../shared/task-model.mjs';
import { diffPisiTaskMembership, insertPisiTaskBlock, listPisiTaskBlocks, makePisiTaskBlockHtml, removePisiTaskBlock } from '../../shared/task-blocks.mjs';
import { getPisiTaskDayChanges, listPisiDiaryTaskIds, replacePisiDiaryTaskSection } from '../../shared/task-diary.mjs';
import { normalizePisiDiaryIsoDate } from '../../shared/diary-rules.mjs';
import { hasPisiWikiTextLinkTo, rewritePisiWikiTextForRename } from '../../shared/wiki-link-core.mjs';

// The task service (docs/task-plan.md §3.4, G2): the only writer of tasks on
// the desktop (GV4). Every command re-reads tasks.json, changes only its own
// records and writes the notes and diaries the change needs in the same
// atomic mutation (GV8, task-domain.js runs it):
// - a field change writes tasks.json only, never a .node file (GV5);
// - a change of a task's days writes the task section of exactly those days'
//   diaries (shared/task-diary.mjs) and creates a diary a task joins;
// - a note or diary that is open in the editor is not written (GV9): it comes
//   back in `deferred` and the renderer changes it and saves it itself.

const taskStore = modules['main.taskStore'];
const documentStore = modules['main.documentStore'];

const PISI_TASK_CREATE_FIELDS = Object.freeze([
    'id',
    'title',
    'tags',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'dependencies',
    'manualOrder',
    'durationMinutes',
    'actualMinutes'
]);
const PISI_TASK_UPDATE_FIELDS = Object.freeze(PISI_TASK_CREATE_FIELDS.filter((field) => field !== 'id').concat(['completions']));
const PISI_TASK_BATCH_LIMIT = 500;

let pisiTaskServiceClock = () => new Date();
let pisiTaskServiceFaultHook = null;

/** Tests and the E2E run the service on a fixed clock; null puts the real one back. */
function setPisiTaskServiceClock(clock) {
    pisiTaskServiceClock = typeof clock === 'function' ? clock : () => new Date();
}

/** Tests: a function called at named points of a command; it may throw to break the command half way. */
function setPisiTaskServiceFaultHook(hook) {
    pisiTaskServiceFaultHook = typeof hook === 'function' ? hook : null;
}

function reachPisiTaskServicePoint(name) {
    pisiTaskServiceFaultHook?.(name);
}

/** @returns {any} */
function makePisiTaskServiceError(code, message, extra = {}) {
    return { ok: false, code, error: message, ...extra };
}

function comparePisiTaskPath(value) {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function makePisiOpenPathSet(openPaths) {
    return new Set((Array.isArray(openPaths) ? openPaths : []).filter((item) => typeof item === 'string' && item).map(comparePisiTaskPath));
}

function isPisiPathInsideProject(projectFolder, targetPath) {
    const relative = path.relative(path.resolve(projectFolder), path.resolve(targetPath));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pickPisiTaskFields(source, fields) {
    const picked = {};
    if (!source || typeof source !== 'object') return picked;
    for (const field of fields) if (source[field] !== undefined) picked[field] = source[field];
    return picked;
}

function formatPisiTaskValidationError(result) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    return makePisiTaskServiceError(
        'TASK_INVALID',
        `Görev alanı geçersiz: ${errors.map((error) => `${error.field} (${error.code})`).join(', ') || 'bilinmeyen'}`,
        { errors }
    );
}

function readPisiWritableTaskState(projectFolder) {
    const state = taskStore.readPisiTaskStoreState(projectFolder, { fresh: true });
    if (state.readOnly) {
        return { error: makePisiTaskServiceError('TASK_STORE_READ_ONLY', state.error || 'Görev deposu salt okunur.') };
    }
    return { state };
}

function findPisiTaskIndex(tasks, taskId) {
    return tasks.findIndex((task) => task && task.id === taskId);
}

function checkPisiTaskDependencies(tasks, task) {
    const cycle = findPisiTaskDependencyCycle(tasks, task.id, task.dependencies);
    if (cycle) return makePisiTaskServiceError('TASK_DEPENDENCY_CYCLE', 'Bu bağımlılık bir döngü oluşturur.', { cycle });
    const known = new Set(tasks.map((item) => item?.id));
    const missing = (task.dependencies || []).filter((id) => !known.has(id));
    if (missing.length) return makePisiTaskServiceError('TASK_DEPENDENCY_MISSING', 'Bağımlı olunan görev bulunamadı.', { missing });
    return null;
}

// ---- Notes and diaries -----------------------------------------------------------

function isPisiDiaryNotePath(projectFolder, filePath, date) {
    const day = normalizePisiDiaryIsoDate(date);
    return Boolean(day) && comparePisiTaskPath(documentStore.getPisiDiaryNodePath(projectFolder, day)) === comparePisiTaskPath(filePath);
}

/** The diary day of a note (its `pisi.diaryDate`, when the note is that day's diary file), else null. */
function getPisiNoteDiaryDate(projectFolder, filePath, data) {
    const day = normalizePisiDiaryIsoDate(data?.pisi?.diaryDate);
    return day && isPisiDiaryNotePath(projectFolder, filePath, day) ? day : null;
}

/**
 * A closed note the command may change: the file at `notePath` whose `pisi.id` is `noteId`.
 * @returns {any}
 */
function readPisiTaskNote(projectFolder, notePath, noteId) {
    if (!notePath) return makePisiTaskServiceError('TASK_NOTE_PATH_REQUIRED', 'Görevin notunun yolu verilmedi.');
    const resolved = path.resolve(String(notePath));
    if (!isPisiPathInsideProject(projectFolder, resolved) || path.extname(resolved).toLowerCase() !== '.node') {
        return makePisiTaskServiceError('TASK_NOTE_PATH_INVALID', 'Görevin notu proje içinde bir not değil.');
    }
    if (!fs.existsSync(resolved)) return makePisiTaskServiceError('TASK_NOTE_MISSING', 'Görevin notu bulunamadı.');
    const info = documentStore.ensurePisiFileMetadata(resolved);
    if (!info.ok) return makePisiTaskServiceError('TASK_NOTE_UNREADABLE', info.error || 'Görevin notu okunamadı.');
    if (noteId && info.metadata?.id !== noteId) return makePisiTaskServiceError('TASK_NOTE_ID_MISMATCH', 'Not yolu görevin notuna ait değil.');
    return { ok: true, notePath: resolved, info };
}

function writePisiTaskNoteContent(notePath, content, reason) {
    const saver = globalThis.saveNodeContentWithHistory || globalThis.saveNodeContent;
    const saved = saver(notePath, content, { reason });
    if (!saved?.ok) throw new Error(saved?.error || 'Not yazılamadı.');
    return saved;
}

/**
 * Inserts, removes or retags (`newTaskId`) a task block in a note. An open
 * note is left alone and reported in `deferred.notes`; a closed one is written
 * (with a history snapshot, it is user content). Returns
 * `{ ok, blockId?, afterBlockId? }`.
 * @returns {any}
 */
function applyPisiTaskNoteChange(projectFolder, change, context) {
    const { notePath, noteId } = change;
    if (notePath && context.openPaths.has(comparePisiTaskPath(notePath))) {
        context.deferred.notes.push({ ...change, notePath: path.resolve(notePath) });
        return { ok: true, deferred: true, blockId: change.blockId || null };
    }
    const note = readPisiTaskNote(projectFolder, notePath, noteId);
    if (!note.ok) return note;
    const content = String(note.info.data?.content || '');
    const blocks = listPisiTaskBlocks(content);
    if (!blocks) return makePisiTaskServiceError('TASK_NOTE_UNREADABLE', 'Not içeriği izlenemiyor.');
    if (change.op === 'insert') {
        const existing = blocks.find((block) => block.taskId === change.taskId);
        if (existing) return { ok: true, blockId: existing.blockId };
        const next = insertPisiTaskBlock(content, { blockId: change.blockId, taskId: change.taskId }, { afterBlockId: change.afterBlockId || null });
        if (next === null) return makePisiTaskServiceError('TASK_NOTE_UNREADABLE', 'Not içeriği izlenemiyor.');
        writePisiTaskNoteContent(note.notePath, next, 'task-block');
        context.writtenNotes.push(note.notePath);
        return { ok: true, blockId: change.blockId };
    }
    const index = blocks.findIndex((block) => block.taskId === change.taskId);
    if (change.op === 'retag') {
        // The block stays where it is and names another task (an Integrity repair of a double reference).
        if (index < 0) return { ok: true, retagged: false };
        const block = blocks[index];
        const next = content.slice(0, block.start) + makePisiTaskBlockHtml({ blockId: block.blockId, taskId: change.newTaskId }) + content.slice(block.end);
        writePisiTaskNoteContent(note.notePath, next, 'task-block');
        context.writtenNotes.push(note.notePath);
        return { ok: true, retagged: true, blockId: block.blockId };
    }
    if (index < 0) return { ok: true, removed: false };
    const afterBlockId = findPisiBlockIdBefore(content, blocks[index].start);
    const next = removePisiTaskBlock(content, change.taskId);
    if (next === null) return makePisiTaskServiceError('TASK_NOTE_UNREADABLE', 'Not içeriği izlenemiyor.');
    writePisiTaskNoteContent(note.notePath, next, 'task-block');
    context.writtenNotes.push(note.notePath);
    return { ok: true, removed: true, blockId: blocks[index].blockId, afterBlockId };
}

/** The id of the last top-level block that ends before `offset` (where a removed block goes back to). */
function findPisiBlockIdBefore(content, offset) {
    const before = String(content || '').slice(0, offset);
    const matches = [...before.matchAll(/data-pisi-block-id="([^"]+)"/g)];
    return matches.length ? matches.at(-1)[1] : null;
}

/**
 * Writes the task section of each day in `days` from `tasks` (GV15). A day's
 * diary that does not exist is created only for the days in `create` (a task
 * joined that day); a deleted diary is not brought back otherwise (§3.3). A
 * diary that already has the right section is not written (V4).
 */
function writePisiDiarySections(projectFolder, tasks, days, context, { create = [] } = {}) {
    const createDays = new Set(create);
    for (const day of Array.from(new Set(days)).sort()) {
        const ids = listPisiDiaryTaskIds(day, tasks);
        const diaryPath = documentStore.getPisiDiaryNodePath(projectFolder, day);
        if (context.openPaths.has(comparePisiTaskPath(diaryPath))) {
            if (!context.deferred.diaryDays.includes(day)) context.deferred.diaryDays.push(day);
            continue;
        }
        if (!fs.existsSync(diaryPath)) {
            if (!ids.length || !createDays.has(day)) continue;
            const created = documentStore.getOrCreateDiaryNode(projectFolder, day);
            if (!created.ok) throw new Error(created.error || 'Günlük oluşturulamadı.');
            context.createdDiaries.push(day);
        }
        const info = documentStore.ensurePisiFileMetadata(diaryPath);
        if (!info.ok) {
            context.warnings.push(`${day}: ${info.error || 'günlük okunamadı'}`);
            continue;
        }
        const content = String(info.data?.content || '');
        const next = replacePisiDiaryTaskSection(content, day, ids);
        if (next === null) {
            context.warnings.push(`${day}: günlük içeriği izlenemiyor; görev bölümü yazılmadı.`);
            continue;
        }
        if (next === content) continue;
        reachPisiTaskServicePoint('diary-write');
        info.data.content = next;
        info.data.pisi.updatedAt = pisiTaskServiceClock().toISOString();
        globalThis.writePisiDocument(diaryPath, info.data);
        context.writtenDiaries.push(day);
    }
}

/** The days the changed tasks join and leave, and the diaries of those days. */
function writePisiDiarySectionsForChanges(projectFolder, tasks, pairs, context) {
    const days = new Set();
    const create = new Set();
    for (const { before, after } of pairs) {
        const change = getPisiTaskDayChanges(before ? readPisiTask(before) : null, after ? readPisiTask(after) : null);
        for (const day of change.days) days.add(day);
        for (const day of change.added) create.add(day);
    }
    if (days.size) writePisiDiarySections(projectFolder, tasks.map(readPisiTask).filter(Boolean), [...days], context, { create: [...create] });
    return [...days].sort();
}

/** The service's clock (tests and the E2E fix it). */
function getPisiTaskServiceNow() {
    return pisiTaskServiceClock();
}

function makePisiTaskCommandContext(payload = {}) {
    return {
        openPaths: makePisiOpenPathSet(payload.openPaths),
        deferred: { notes: [], diaryDays: [] },
        writtenNotes: [],
        writtenDiaries: [],
        createdDiaries: [],
        warnings: []
    };
}

// ---- Events ----------------------------------------------------------------------

const pisiTaskChangeListeners = new Set();

function onPisiTasksChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    pisiTaskChangeListeners.add(listener);
    return () => pisiTaskChangeListeners.delete(listener);
}

/**
 * Tells the renderer which tasks changed (`pisi:tasks-changed`, §3.4). The
 * changed records go along, so the renderer store does not list again.
 */
function emitPisiTasksChanged(projectFolder, { changed = [], removedIds = [], source = 'local', version = 2, deferredDiaryDays = [] } = {}) {
    const tasks = changed.map(readPisiTask).filter(Boolean);
    const removed = Array.from(new Set(removedIds.filter(isPisiTaskId)));
    if (!tasks.length && !removed.length && !deferredDiaryDays.length) return;
    const payload = {
        projectFolder: path.resolve(projectFolder),
        version,
        changedIds: tasks.map((task) => task.id),
        removedIds: removed,
        source,
        tasks,
        // Days whose open diary the renderer must bring up to date (a sync turn does not write open diaries).
        deferredDiaryDays
    };
    const send = () => {
        const window = globalThis.mainWindow;
        if (window && !window.isDestroyed?.()) window.webContents.send('pisi:tasks-changed', payload);
        for (const listener of pisiTaskChangeListeners) {
            try {
                listener(payload);
            } catch (error) {
                console.warn('[PISI] Görev olayı dinleyicisi başarısız:', error?.message || error);
            }
        }
    };
    // Inside a mutation (a command, a batch, a note save, a rename) the event waits until it is
    // committed and goes after the command's answer; a mutation that rolls back sends nothing.
    const atomic = modules['main.atomicMutation'];
    if (atomic?.getActivePisiAtomicMutation?.()) atomic.onPisiAtomicMutationCommit(() => globalThis.setImmediate(send));
    else send();
}

function finishPisiTaskCommand(projectFolder, context, result, { changed = [], removedIds = [] } = {}) {
    emitPisiTasksChanged(projectFolder, { changed, removedIds });
    return {
        ok: true,
        ...result,
        deferred: context.deferred,
        writtenDiaries: context.writtenDiaries,
        createdDiaries: context.createdDiaries,
        writtenNotes: context.writtenNotes,
        warnings: context.warnings
    };
}

// ---- Queries ---------------------------------------------------------------------

function listPisiTasks(projectFolder) {
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    return {
        ok: true,
        version: state.version,
        readOnly: state.readOnly === true,
        error: state.readOnly ? state.error : undefined,
        tasks: state.tasks.map(readPisiTask).filter(Boolean)
    };
}

// ---- Commands --------------------------------------------------------------------

/** The place a request names: `{ noteId, notePath, afterBlockId, blockId }` or `{ diaryDate }`. */
function readPisiTaskTarget(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.diaryDate !== undefined && target.diaryDate !== null) {
        const day = normalizePisiDiaryIsoDate(target.diaryDate);
        return day ? { kind: 'diary', diaryDate: day } : null;
    }
    if (typeof target.noteId === 'string' && target.noteId) {
        return {
            kind: 'note',
            noteId: target.noteId,
            notePath: typeof target.notePath === 'string' ? target.notePath : null,
            afterBlockId: typeof target.afterBlockId === 'string' ? target.afterBlockId : null,
            blockId: typeof target.blockId === 'string' ? target.blockId : null
        };
    }
    return null;
}

function createPisiTask(projectFolder, payload = {}) {
    const target = readPisiTaskTarget(payload.target);
    if (!target) return makePisiTaskServiceError('TASK_TARGET_REQUIRED', 'Görevin yeri (not ya da günlük) verilmedi.');
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const fields = pickPisiTaskFields(payload.task, PISI_TASK_CREATE_FIELDS);
    if (fields.id !== undefined && findPisiTaskIndex(tasks, fields.id) >= 0) return makePisiTaskServiceError('TASK_ID_EXISTS', 'Bu görev kimliği zaten var.');
    if (target.kind === 'diary') {
        fields.diaryDate = target.diaryDate;
        // A task written in a diary is due that day unless the request says otherwise (§1.4).
        if (fields.dueDate === undefined) fields.dueDate = target.diaryDate;
    } else {
        fields.noteId = target.noteId;
    }
    if (fields.title === undefined) fields.title = '';
    const now = pisiTaskServiceClock();
    const normalized = normalizePisiTask(fields, null, { now, makeUuid: () => crypto.randomUUID() });
    if (!normalized.ok) return formatPisiTaskValidationError(normalized);
    const task = normalized.task;
    const dependencyError = checkPisiTaskDependencies(tasks, task);
    if (dependencyError) return dependencyError;

    const context = makePisiTaskCommandContext(payload);
    let blockId = null;
    if (target.kind === 'note') {
        blockId = target.blockId || formatPisiBlockId(crypto.randomUUID());
        makePisiTaskBlockHtml({ blockId, taskId: task.id });
    }
    tasks.push(task);
    taskStore.writePisiTaskStore(projectFolder, read.state, tasks, { now });
    reachPisiTaskServicePoint('after-store-write');
    if (target.kind === 'note') {
        const noteResult = applyPisiTaskNoteChange(
            projectFolder,
            { op: 'insert', taskId: task.id, blockId, noteId: target.noteId, notePath: target.notePath, afterBlockId: target.afterBlockId },
            context
        );
        if (!noteResult.ok) throw Object.assign(new Error(noteResult.error), { code: noteResult.code });
        blockId = noteResult.blockId || blockId;
    }
    writePisiDiarySectionsForChanges(projectFolder, tasks, [{ before: null, after: task }], context);
    return finishPisiTaskCommand(projectFolder, context, { task: readPisiTask(task), blockId, created: true }, { changed: [task] });
}

/**
 * New tasks of notes that the caller writes in the same mutation, their
 * blocks already in those notes (docs/task-plan.md G5: a Markdown import, the
 * map's note copy): `[{ id, noteId, task }]`, `task` the fields of a new task.
 * One tasks.json write; the diary sections of their days are written and a
 * diary a task joins is created (GV5, GV15).
 */
function addPisiNoteTasks(projectFolder, entries = [], payload = {}) {
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const known = new Set(tasks.map((task) => task?.id));
    const now = pisiTaskServiceClock();
    const added = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !isPisiTaskId(entry.id) || known.has(entry.id)) return makePisiTaskServiceError('TASK_ID_EXISTS', 'Bu görev kimliği zaten var.');
        /** @type {any} */
        const fields = { ...pickPisiTaskFields(entry.task || {}, PISI_TASK_CREATE_FIELDS), id: entry.id, noteId: entry.noteId };
        if (fields.title === undefined) fields.title = '';
        const normalized = normalizePisiTask(fields, null, { now, makeUuid: () => crypto.randomUUID() });
        if (!normalized.ok) return formatPisiTaskValidationError(normalized);
        known.add(normalized.task.id);
        added.push(normalized.task);
    }
    if (!added.length) return { ok: true, tasks: [] };
    const nextTasks = [...tasks, ...added];
    taskStore.writePisiTaskStore(projectFolder, read.state, nextTasks, { now });
    const context = makePisiTaskCommandContext(payload);
    writePisiDiarySectionsForChanges(
        projectFolder,
        nextTasks,
        added.map((task) => ({ before: null, after: task })),
        context
    );
    return finishPisiTaskCommand(projectFolder, context, { tasks: added.map(readPisiTask) }, { changed: added });
}

/** One field change of a stored task; `{ ok, before, after, changed }` or an error. */
function preparePisiTaskUpdate(tasks, taskId, patch, now) {
    const index = findPisiTaskIndex(tasks, taskId);
    if (index < 0) return makePisiTaskServiceError('TASK_NOT_FOUND', 'Görev bulunamadı.');
    const fields = pickPisiTaskFields(patch, PISI_TASK_UPDATE_FIELDS);
    const before = tasks[index];
    const normalized = normalizePisiTask(fields, before, { now, makeUuid: () => crypto.randomUUID() });
    if (!normalized.ok) return formatPisiTaskValidationError(normalized);
    const after = normalized.task;
    if (fields.dependencies !== undefined) {
        const dependencyError = checkPisiTaskDependencies(tasks, after);
        if (dependencyError) return dependencyError;
    }
    return { ok: true, index, before, after, changed: !isSamePisiTask(readPisiTask(before), after) };
}

function updatePisiTask(projectFolder, payload = {}) {
    return batchUpdatePisiTasks(projectFolder, { ...payload, updates: [{ taskId: payload.taskId, patch: payload.patch }] }, { single: true });
}

function batchUpdatePisiTasks(projectFolder, payload = {}, { single = false } = {}) {
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    if (!updates.length || updates.length > PISI_TASK_BATCH_LIMIT) {
        return makePisiTaskServiceError('TASK_BATCH_INVALID', `Toplu görev değişikliği 1 ile ${PISI_TASK_BATCH_LIMIT} kayıt içermeli.`);
    }
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const now = pisiTaskServiceClock();
    const pairs = [];
    for (const [position, update] of updates.entries()) {
        const prepared = preparePisiTaskUpdate(tasks, String(update?.taskId || ''), update?.patch || {}, now);
        if (!prepared.ok) return single ? prepared : { ...prepared, failedIndex: position };
        if (!prepared.changed) continue;
        tasks[prepared.index] = prepared.after;
        pairs.push({ before: prepared.before, after: prepared.after });
    }
    const context = makePisiTaskCommandContext(payload);
    if (!pairs.length) {
        const unchanged = updates.map((update) => readPisiTask(tasks[findPisiTaskIndex(tasks, update.taskId)]));
        return { ok: true, changed: false, task: single ? unchanged[0] : undefined, tasks: single ? undefined : unchanged, deferred: context.deferred };
    }
    taskStore.writePisiTaskStore(projectFolder, read.state, tasks, { now });
    reachPisiTaskServicePoint('after-store-write');
    writePisiDiarySectionsForChanges(projectFolder, tasks, pairs, context);
    const changed = pairs.map((pair) => pair.after);
    return finishPisiTaskCommand(
        projectFolder,
        context,
        single ? { changed: true, task: readPisiTask(changed[0]) } : { changed: true, tasks: changed.map(readPisiTask) },
        { changed }
    );
}

// ---- Note links in titles (G6) -----------------------------------------------------

/** How many task titles link to a note called `title` (the rename impact); reads tasks.json only. */
function countPisiTaskTitleLinks(projectFolder, title) {
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    return state.tasks.map(readPisiTask).filter((task) => task && hasPisiWikiTextLinkTo(task.title, title)).length;
}

/**
 * A note called `oldTitle` was renamed to `newTitle`: every task title with
 * [[oldTitle]] follows it, in one tasks.json write. It runs inside the
 * rename's atomic mutation (wiki-link-domain.js), so the notes and the titles
 * change together or not at all. A title the new name would make longer than
 * the title limit stays as it is. Field change only: no .node file (GV5).
 */
function renamePisiTaskTitleLinks(projectFolder, { oldTitle, newTitle }) {
    const state = taskStore.readPisiTaskStoreState(projectFolder, { fresh: true });
    if (state.readOnly) {
        return state.tasks.some((task) => hasPisiWikiTextLinkTo(readPisiTask(task)?.title, oldTitle))
            ? makePisiTaskServiceError('TASK_STORE_READ_ONLY', state.error || 'Görev deposu salt okunur.')
            : { ok: true, tasks: 0, links: 0, taskIds: [] };
    }
    const tasks = state.tasks.slice();
    const now = pisiTaskServiceClock();
    const changed = [];
    let links = 0;
    for (const [index, record] of tasks.entries()) {
        const task = readPisiTask(record);
        if (!task) continue;
        const rewritten = rewritePisiWikiTextForRename(task.title, { oldTitle, newTitle });
        if (!rewritten.changed || rewritten.text.length > PISI_TASK_TITLE_MAX_LENGTH) continue;
        const normalized = normalizePisiTask({ title: rewritten.text }, record, { now, makeUuid: () => crypto.randomUUID() });
        if (!normalized.ok) continue;
        tasks[index] = normalized.task;
        changed.push(normalized.task);
        links += rewritten.count;
    }
    if (!changed.length) return { ok: true, tasks: 0, links: 0, taskIds: [] };
    taskStore.writePisiTaskStore(projectFolder, state, tasks, { now });
    reachPisiTaskServicePoint('after-title-links-write');
    emitPisiTasksChanged(projectFolder, { changed });
    return { ok: true, tasks: changed.length, links, taskIds: changed.map((task) => task.id) };
}

function completePisiTaskCommand(projectFolder, payload = {}) {
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const index = findPisiTaskIndex(tasks, String(payload.taskId || ''));
    if (index < 0) return makePisiTaskServiceError('TASK_NOT_FOUND', 'Görev bulunamadı.');
    const now = pisiTaskServiceClock();
    const before = tasks[index];
    const result = completePisiTask(before, { now });
    if (!result.ok) return makePisiTaskServiceError('TASK_COMPLETE_FAILED', `Görev tamamlanamadı: ${result.error}`);
    const context = makePisiTaskCommandContext(payload);
    if (!result.changed) return { ok: true, changed: false, task: readPisiTask(before), completion: null, deferred: context.deferred };
    tasks[index] = result.task;
    taskStore.writePisiTaskStore(projectFolder, read.state, tasks, { now });
    reachPisiTaskServicePoint('after-store-write');
    writePisiDiarySectionsForChanges(projectFolder, tasks, [{ before, after: result.task }], context);
    return finishPisiTaskCommand(
        projectFolder,
        context,
        { changed: true, task: readPisiTask(result.task), completion: result.completion },
        { changed: [result.task] }
    );
}

function reopenPisiTaskCommand(projectFolder, payload = {}) {
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const index = findPisiTaskIndex(tasks, String(payload.taskId || ''));
    if (index < 0) return makePisiTaskServiceError('TASK_NOT_FOUND', 'Görev bulunamadı.');
    const now = pisiTaskServiceClock();
    const before = tasks[index];
    const result = reopenPisiTask(before, payload.completion || null, { now });
    if (!result.ok) {
        return result.error === 'locked'
            ? makePisiTaskServiceError('TASK_COMPLETION_LOCKED', 'Daha sonra bir tamamlama var; bu tamamlama geri alınamaz.')
            : makePisiTaskServiceError('TASK_REOPEN_FAILED', `Görev geri açılamadı: ${result.error}`);
    }
    const context = makePisiTaskCommandContext(payload);
    if (!result.changed) return { ok: true, changed: false, task: readPisiTask(before), deferred: context.deferred };
    tasks[index] = result.task;
    taskStore.writePisiTaskStore(projectFolder, read.state, tasks, { now });
    reachPisiTaskServicePoint('after-store-write');
    writePisiDiarySectionsForChanges(projectFolder, tasks, [{ before, after: result.task }], context);
    return finishPisiTaskCommand(projectFolder, context, { changed: true, task: readPisiTask(result.task) }, { changed: [result.task] });
}

function movePisiTask(projectFolder, payload = {}) {
    const target = readPisiTaskTarget(payload.target);
    if (!target) return makePisiTaskServiceError('TASK_TARGET_REQUIRED', 'Görevin yeni yeri verilmedi.');
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const index = findPisiTaskIndex(tasks, String(payload.taskId || ''));
    if (index < 0) return makePisiTaskServiceError('TASK_NOT_FOUND', 'Görev bulunamadı.');
    const before = tasks[index];
    const current = readPisiTask(before);
    const now = pisiTaskServiceClock();
    const place = target.kind === 'diary' ? { diaryDate: target.diaryDate, noteId: null } : { noteId: target.noteId, diaryDate: null };
    if (current.noteId === (place.noteId ?? null) && current.diaryDate === (place.diaryDate ?? null)) {
        return { ok: true, changed: false, task: current, deferred: makePisiTaskCommandContext(payload).deferred };
    }
    const normalized = normalizePisiTask(place, before, { now, makeUuid: () => crypto.randomUUID() });
    if (!normalized.ok) return formatPisiTaskValidationError(normalized);
    const after = normalized.task;
    const context = makePisiTaskCommandContext(payload);
    tasks[index] = after;
    taskStore.writePisiTaskStore(projectFolder, read.state, tasks, { now });
    reachPisiTaskServicePoint('after-store-write');

    let blockId = null;
    if (current.noteId) {
        const removed = applyPisiTaskNoteChange(
            projectFolder,
            { op: 'remove', taskId: current.id, noteId: current.noteId, notePath: payload.fromNotePath || null },
            context
        );
        // The old note may be gone or its path unknown; the block is then left for Integrity (orphan).
        if (removed.ok) blockId = removed.blockId || null;
        else if (removed.code !== 'TASK_NOTE_PATH_REQUIRED' && removed.code !== 'TASK_NOTE_MISSING') {
            throw Object.assign(new Error(removed.error), { code: removed.code });
        } else context.warnings.push(removed.error);
    }
    if (target.kind === 'note') {
        const inserted = applyPisiTaskNoteChange(
            projectFolder,
            {
                op: 'insert',
                taskId: current.id,
                blockId: target.blockId || blockId || formatPisiBlockId(crypto.randomUUID()),
                noteId: target.noteId,
                notePath: target.notePath,
                afterBlockId: target.afterBlockId
            },
            context
        );
        if (!inserted.ok) throw Object.assign(new Error(inserted.error), { code: inserted.code });
        blockId = inserted.blockId;
    }
    writePisiDiarySectionsForChanges(projectFolder, tasks, [{ before, after }], context);
    return finishPisiTaskCommand(projectFolder, context, { changed: true, task: readPisiTask(after), blockId }, { changed: [after] });
}

/**
 * Takes tasks out of the store (into the Trash, GV10): their dependencies on
 * other tasks are kept in the Trash item, and every diary section they were in
 * is written again. `noteChanges` names the closed-note blocks to remove.
 * Returns `{ tasks, dependencyRefs, remaining }`.
 */
function takePisiTasksOut(tasks, ids) {
    const idSet = new Set(ids);
    const removed = tasks.filter((task) => idSet.has(task?.id));
    const dependencyRefs = [];
    const remaining = tasks
        .filter((task) => !idSet.has(task?.id))
        .map((task) => {
            const dependencies = Array.isArray(task?.dependencies) ? task.dependencies : [];
            const dropped = dependencies.filter((id) => idSet.has(id));
            if (!dropped.length) return task;
            dependencyRefs.push({ taskId: task.id, dependencies: dropped });
            return { ...task, dependencies: dependencies.filter((id) => !idSet.has(id)) };
        });
    return { removed, remaining, dependencyRefs };
}

function deletePisiTask(projectFolder, payload = {}) {
    const read = readPisiWritableTaskState(projectFolder);
    if (read.error) return read.error;
    const tasks = read.state.tasks.slice();
    const taskId = String(payload.taskId || '');
    const index = findPisiTaskIndex(tasks, taskId);
    if (index < 0) return makePisiTaskServiceError('TASK_NOT_FOUND', 'Görev bulunamadı.');
    const current = readPisiTask(tasks[index]);
    const context = makePisiTaskCommandContext(payload);
    const now = pisiTaskServiceClock();

    const taskBlocks = [];
    if (current.noteId) {
        const removed = applyPisiTaskNoteChange(projectFolder, { op: 'remove', taskId, noteId: current.noteId, notePath: payload.notePath || null }, context);
        if (removed.ok) {
            taskBlocks.push({
                taskId,
                noteId: current.noteId,
                notePath: payload.notePath ? path.relative(path.resolve(projectFolder), path.resolve(payload.notePath)).split(path.sep).join('/') : null,
                // An open note removes the block itself; the renderer names where it was.
                blockId: removed.deferred ? payload.blockId || null : removed.blockId || null,
                afterBlockId: removed.deferred ? payload.afterBlockId || null : removed.afterBlockId || null
            });
        } else if (removed.code !== 'TASK_NOTE_PATH_REQUIRED' && removed.code !== 'TASK_NOTE_MISSING') {
            return removed;
        } else context.warnings.push(removed.error);
    }
    const out = takePisiTasksOut(tasks, [taskId]);
    const trash = modules['main.trashStore'].createPisiTaskTrashItem(projectFolder, {
        tasks: out.removed,
        taskDependencyRefs: out.dependencyRefs,
        taskBlocks,
        label: current.title || taskId
    });
    if (!trash.ok) throw Object.assign(new Error(trash.error), { code: trash.code });
    taskStore.writePisiTaskStore(projectFolder, read.state, out.remaining, { now });
    reachPisiTaskServicePoint('after-store-write');
    writePisiDiarySectionsForChanges(projectFolder, out.remaining, [{ before: current, after: null }], context);
    const changed = out.remaining.filter((task) => out.dependencyRefs.some((ref) => ref.taskId === task.id));
    return finishPisiTaskCommand(projectFolder, context, { deleted: true, trashId: trash.trashId, taskId }, { changed, removedIds: [taskId] });
}

// ---- Called by other stores ------------------------------------------------------

/**
 * After tasks came back (Trash restore, a note save that brought a trashed id
 * back) or left (a note or diary went to the Trash): writes the diary sections
 * of the days involved. `before`/`after` are the store's records.
 */
function rewritePisiDiarySectionsForTaskChange(projectFolder, beforeTasks, afterTasks, payload = {}) {
    const beforeById = new Map((beforeTasks || []).filter(Boolean).map((task) => [task.id, task]));
    const afterById = new Map((afterTasks || []).filter(Boolean).map((task) => [task.id, task]));
    const pairs = [];
    for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
        const before = beforeById.get(id) || null;
        const after = afterById.get(id) || null;
        if (before && after && isSamePisiTask(readPisiTask(before) || before, readPisiTask(after) || after)) continue;
        pairs.push({ before, after });
    }
    const context = makePisiTaskCommandContext(payload);
    const days = pairs.length ? writePisiDiarySectionsForChanges(projectFolder, [...afterById.values()], pairs, context) : [];
    return { ok: true, days, context };
}

/**
 * Re-inserts the blocks of restored note tasks into their closed notes (the
 * place the block was taken from). An open note comes back in `deferred`.
 */
function restorePisiTaskBlocks(projectFolder, taskBlocks, context) {
    for (const block of Array.isArray(taskBlocks) ? taskBlocks : []) {
        if (!block?.notePath || !isPisiTaskId(block.taskId)) continue;
        const notePath = path.resolve(projectFolder, String(block.notePath).split('/').join(path.sep));
        const result = applyPisiTaskNoteChange(
            projectFolder,
            {
                op: 'insert',
                taskId: block.taskId,
                blockId: block.blockId || formatPisiBlockId(crypto.randomUUID()),
                noteId: block.noteId,
                notePath,
                afterBlockId: block.afterBlockId || null
            },
            context
        );
        if (!result.ok) context.warnings.push(`${block.notePath}: ${result.error}`);
    }
}

/** The task blocks of a saved note in the stored form (§3.2.1): the editor's drawing inside is dropped (GV2). */
function canonicalizePisiTaskBlocks(content) {
    const html = String(content ?? '');
    const blocks = listPisiTaskBlocks(html);
    if (!blocks || !blocks.length) return html;
    let result = html;
    for (const block of [...blocks].reverse()) {
        const blockId = block.blockId && /^blk_/.test(block.blockId) ? block.blockId : formatPisiBlockId(crypto.randomUUID());
        result = result.slice(0, block.start) + makePisiTaskBlockHtml({ blockId, taskId: block.taskId }) + result.slice(block.end);
    }
    return result;
}

// ---- Note save (§3.3) ------------------------------------------------------------

function saveNoteContent(nodePath, content) {
    const saver = globalThis.saveNodeContentWithHistory || globalThis.saveNodeContent;
    return saver(nodePath, content, { reason: 'editor-save' });
}

/**
 * Writes a note whose task blocks may have changed and lets the tasks follow
 * in the same atomic mutation (§3.3). Task blocks are stored in their bare
 * form (GV2) and a diary's task section is the one the rule gives (GV15).
 * When the new content takes task blocks out of the note or brings ids back,
 * a task whose place is this note and whose block is gone goes to the Trash
 * (one item); an id that is in the Trash comes back and lives in this note. A
 * live task of another note is left alone (Integrity reports it), unless
 * `dropForeign` is set (a history restore): then its block is not brought
 * back, so no task gets a second block (GV7). `write(content)` writes the note.
 *
 * @param {string} projectFolder
 * @param {string} nodePath
 * @param {any} current
 * @param {string} content
 * @param {{ write: (html: string) => any, openPaths?: string[], dropForeign?: boolean }} options
 * @returns {any}
 */
function writePisiNoteWithTasks(projectFolder, nodePath, current, content, { write, openPaths = [], dropForeign = false }) {
    const before = String(current.data?.content || '');
    let next = canonicalizePisiTaskBlocks(String(content ?? ''));
    const diaryDate = getPisiNoteDiaryDate(projectFolder, nodePath, current.data);
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    const noteId = current.metadata?.id;
    if (dropForeign && !state.readOnly) {
        const byId = new Map(state.tasks.map((task) => [task?.id, task]));
        const added = diffPisiTaskMembership(before, next)?.added || [];
        for (const id of added) {
            const task = byId.get(id);
            if (task && (diaryDate || task.noteId !== noteId)) next = removePisiTaskBlock(next, id) ?? next;
        }
    }
    const diff = state.readOnly ? null : diffPisiTaskMembership(before, next);
    const changesTasks = Boolean(diff && (diff.added.length || diff.removed.length));

    const normalizeSection = (html, tasks) => {
        if (!diaryDate || state.readOnly) return html;
        const ids = listPisiDiaryTaskIds(diaryDate, tasks.map(readPisiTask).filter(Boolean));
        return replacePisiDiaryTaskSection(html, diaryDate, ids) ?? html;
    };
    if (!changesTasks) return write(normalizeSection(next, state.tasks));

    return modules['main.atomicMutation'].runPisiAtomicMutation(projectFolder, 'note.save-tasks', () => {
        const fresh = taskStore.readPisiTaskStore(projectFolder);
        const tasks = fresh.tasks.slice();
        const byId = new Map(tasks.map((task) => [task?.id, task]));
        const removedIds = diff.removed.filter((id) => byId.get(id)?.noteId === noteId);
        const comingBack = diff.added.filter((id) => !byId.has(id));

        const fromTrash = modules['main.trashStore'].takePisiTasksFromTrash(projectFolder, comingBack);
        const now = new Date();
        // A task that comes back into a diary lives in that day's diary: its block becomes a row of the section (§1.4).
        const place = diaryDate ? { diaryDate, noteId: null } : { noteId, diaryDate: null };
        const restored = fromTrash.tasks.map((task) => {
            const placed = normalizePisiTask(place, task, { now, makeUuid: () => '' });
            return placed.ok ? placed.task : { ...task, ...place };
        });
        const out = takePisiTasksOut(tasks, removedIds);
        let nextTasks = [...out.remaining, ...restored];
        if (fromTrash.dependencyRefs.length) {
            const refs = new Map(fromTrash.dependencyRefs.map((ref) => [ref.taskId, ref.dependencies]));
            nextTasks = nextTasks.map((task) =>
                refs.has(task.id) ? { ...task, dependencies: Array.from(new Set([...(task.dependencies || []), ...refs.get(task.id)])) } : task
            );
        }

        let trashId = null;
        if (out.removed.length) {
            const oldBlocks = listPisiTaskBlocks(before) || [];
            const relative = nodePath
                .slice(projectFolder.length)
                .replace(/^[\\/]+/, '')
                .split(/[\\/]+/)
                .join('/');
            const taskBlocks = out.removed.map((task) => {
                const block = oldBlocks.find((item) => item.taskId === task.id);
                const previous = block ? [...before.slice(0, block.start).matchAll(/data-pisi-block-id="([^"]+)"/g)].at(-1) : null;
                return { taskId: task.id, noteId, notePath: relative, blockId: block?.blockId || null, afterBlockId: previous ? previous[1] : null };
            });
            const label = out.removed.length === 1 ? readPisiTask(out.removed[0])?.title || out.removed[0].id : `${out.removed.length}`;
            const trash = modules['main.trashStore'].createPisiTaskTrashItem(projectFolder, {
                tasks: out.removed,
                taskDependencyRefs: out.dependencyRefs,
                taskBlocks,
                label
            });
            if (!trash.ok) return trash;
            trashId = trash.trashId;
        }
        if (out.removed.length || restored.length || fromTrash.dependencyRefs.length) taskStore.writePisiTaskStore(projectFolder, fresh, nextTasks, { now });

        let written = next;
        if (diaryDate) for (const task of restored) written = removePisiTaskBlock(written, task.id) ?? written;
        const saved = write(normalizeSection(written, nextTasks));
        if (!saved?.ok) return saved;
        const rewritten = rewritePisiDiarySectionsForTaskChange(projectFolder, tasks, nextTasks, { openPaths: [nodePath, ...openPaths] });
        const touched = new Set([
            ...restored.map((task) => task.id),
            ...out.dependencyRefs.map((ref) => ref.taskId),
            ...fromTrash.dependencyRefs.map((ref) => ref.taskId)
        ]);
        emitPisiTasksChanged(projectFolder, {
            changed: nextTasks.filter((task) => touched.has(task.id)),
            removedIds: out.removed.map((task) => task.id)
        });
        return {
            ...saved,
            tasks: { removed: out.removed.map((task) => task.id), restored: restored.map((task) => task.id), trashId },
            deferred: rewritten.context.deferred
        };
    });
}

/**
 * The editor's save of a note (§3.3): the tasks follow the blocks the save
 * takes out and brings back (writePisiNoteWithTasks). Sync never runs this (it
 * writes notes itself).
 */
function savePisiNoteWithTasks(projectFolder, nodePath, content, options = {}) {
    const current = documentStore.ensurePisiFileMetadata(nodePath);
    if (!current.ok) return current;
    return writePisiNoteWithTasks(projectFolder, nodePath, current, content, {
        write: (html) => saveNoteContent(nodePath, html),
        openPaths: Array.isArray(options.openPaths) ? options.openPaths : []
    });
}

/**
 * A note's history restore (§3.3, G5): the restored document is written with
 * its tasks following the restored blocks. A block whose task is live and
 * lives in this note stays; a block whose task is in the Trash brings it
 * back; a block whose task is nowhere stays and shows "Görev bulunamadı"; a
 * block of a task that lives elsewhere is not brought back; tasks whose
 * blocks the restore takes out go to the Trash. A diary's task section is not
 * restored but made from the rule.
 */
function writePisiRestoredNote(projectFolder, nodePath, data, options = {}) {
    const current = documentStore.ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
    if (!current.ok) return current;
    return writePisiNoteWithTasks(projectFolder, nodePath, current, data?.content || '', {
        write: (html) => {
            globalThis.writePisiDocument(nodePath, { ...data, content: html });
            return { ok: true };
        },
        openPaths: Array.isArray(options.openPaths) ? options.openPaths : [],
        dropForeign: true
    });
}

/**
 * A diary opened (and so created) from the calendar gets the task section of
 * its day at once: the section belongs to the diary from its first byte (GV15).
 */
function getOrCreatePisiDiaryWithTasks(projectFolder, isoDate) {
    const day = String(isoDate || '');
    const diaryPath = /^\d{4}-\d{2}-\d{2}$/.test(day) ? documentStore.getPisiDiaryNodePath(projectFolder, day) : null;
    const existed = diaryPath ? fs.existsSync(diaryPath) : true;
    const created = documentStore.getOrCreateDiaryNode(projectFolder, isoDate);
    if (!created.ok || existed) return created;
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    if (state.readOnly) return created;
    const context = makePisiTaskCommandContext({});
    writePisiDiarySections(projectFolder, state.tasks.map(readPisiTask).filter(Boolean), [day], context, { create: [day] });
    return context.writtenDiaries.length ? documentStore.getOrCreateDiaryNode(projectFolder, isoDate) : created;
}

const moduleApi = {
    setPisiTaskServiceClock,
    setPisiTaskServiceFaultHook,
    getPisiTaskServiceNow,
    readPisiWritableTaskState,
    applyPisiTaskNoteChange,
    writePisiDiarySectionsForChanges,
    onPisiTasksChanged,
    emitPisiTasksChanged,
    getPisiNoteDiaryDate,
    listPisiTasks,
    createPisiTask,
    addPisiNoteTasks,
    updatePisiTask,
    batchUpdatePisiTasks,
    completePisiTaskCommand,
    reopenPisiTaskCommand,
    movePisiTask,
    deletePisiTask,
    takePisiTasksOut,
    rewritePisiDiarySectionsForTaskChange,
    writePisiDiarySections,
    restorePisiTaskBlocks,
    canonicalizePisiTaskBlocks,
    makePisiTaskCommandContext,
    savePisiNoteWithTasks,
    writePisiRestoredNote,
    getOrCreatePisiDiaryWithTasks,
    countPisiTaskTitleLinks,
    renamePisiTaskTitleLinks
};

registerMainModule('main.taskService', moduleApi);
