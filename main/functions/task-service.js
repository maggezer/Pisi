import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { modules, registerMainModule } from '../module-registry.js';
import { formatPisiBlockId, isPisiTaskId } from '../../shared/ids.mjs';
import { completePisiTask, findPisiTaskDependencyCycle, isSamePisiTask, normalizePisiTask, readPisiTask, reopenPisiTask } from '../../shared/task-model.mjs';
import { diffPisiTaskMembership, insertPisiTaskBlock, listPisiTaskBlocks, makePisiTaskBlockHtml, removePisiTaskBlock } from '../../shared/task-blocks.mjs';
import { getPisiTaskDayChanges, listPisiDiaryTaskIds, replacePisiDiaryTaskSection } from '../../shared/task-diary.mjs';
import { normalizePisiDiaryIsoDate } from '../../shared/diary-rules.mjs';

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
 * Inserts or removes a task block in a note. An open note is left alone and
 * reported in `deferred.notes`; a closed one is written (with a history
 * snapshot, it is user content). Returns `{ ok, blockId?, afterBlockId? }`.
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
    // Inside a larger mutation (a batch, a note save) the event waits for it to end.
    if (modules['main.atomicMutation']?.getActivePisiAtomicMutation?.()) globalThis.setImmediate(send);
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
 * The editor's save of a note. Task blocks are stored in their bare form
 * (GV2) and a diary's task section is the one the rule gives (GV15). When the
 * save takes task blocks out of the note or brings ids back, the tasks follow
 * in the same atomic mutation: a task whose place is this note and whose block
 * is gone goes to the Trash (one item for the save); an id that is in the
 * Trash comes back and lives in this note. A live task of another note is left
 * alone (Integrity reports it). Sync never runs this (it writes notes itself).
 */
function savePisiNoteWithTasks(projectFolder, nodePath, content, options = {}) {
    const current = documentStore.ensurePisiFileMetadata(nodePath);
    if (!current.ok) return current;
    const before = String(current.data?.content || '');
    const next = canonicalizePisiTaskBlocks(String(content ?? ''));
    const diaryDate = getPisiNoteDiaryDate(projectFolder, nodePath, current.data);
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    const diff = state.readOnly ? null : diffPisiTaskMembership(before, next);
    const changesTasks = Boolean(diff && (diff.added.length || diff.removed.length));

    const normalizeSection = (html, tasks) => {
        if (!diaryDate || state.readOnly) return html;
        const ids = listPisiDiaryTaskIds(diaryDate, tasks.map(readPisiTask).filter(Boolean));
        return replacePisiDiaryTaskSection(html, diaryDate, ids) ?? html;
    };
    if (!changesTasks) return saveNoteContent(nodePath, normalizeSection(next, state.tasks));

    return modules['main.atomicMutation'].runPisiAtomicMutation(projectFolder, 'note.save-tasks', () => {
        const fresh = taskStore.readPisiTaskStore(projectFolder);
        const tasks = fresh.tasks.slice();
        const noteId = current.metadata?.id;
        const byId = new Map(tasks.map((task) => [task?.id, task]));
        const removedIds = diff.removed.filter((id) => byId.get(id)?.noteId === noteId);
        const comingBack = diff.added.filter((id) => !byId.has(id));

        const fromTrash = modules['main.trashStore'].takePisiTasksFromTrash(projectFolder, comingBack);
        const now = new Date();
        const restored = fromTrash.tasks.map((task) => {
            const placed = normalizePisiTask({ noteId }, task, { now, makeUuid: () => '' });
            return placed.ok ? placed.task : { ...task, noteId, diaryDate: null };
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

        const saved = saveNoteContent(nodePath, normalizeSection(next, nextTasks));
        if (!saved?.ok) return saved;
        const openPaths = [nodePath, ...(Array.isArray(options.openPaths) ? options.openPaths : [])];
        const rewritten = rewritePisiDiarySectionsForTaskChange(projectFolder, tasks, nextTasks, { openPaths });
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
    onPisiTasksChanged,
    emitPisiTasksChanged,
    getPisiNoteDiaryDate,
    listPisiTasks,
    createPisiTask,
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
    getOrCreatePisiDiaryWithTasks
};

registerMainModule('main.taskService', moduleApi);
