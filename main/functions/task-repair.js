import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { modules, registerMainModule } from '../module-registry.js';
import { getPisiLocalDay, makePisiTaskCopyFields, normalizePisiTask, readPisiTask } from '../../shared/task-model.mjs';
import { normalizePisiDiaryIsoDate } from '../../shared/diary-rules.mjs';
import { formatPisiBlockId } from '../../shared/ids.mjs';

// The repairs of Project Integrity's task findings (docs/task-plan.md G7).
// They write tasks the way the task service does (GV4): one fresh read of
// tasks.json, only the records involved, the notes and diaries the change
// needs, all inside the repair's atomic mutation (integrity.repair.v1, GV8),
// and a `pisi:tasks-changed` event. A note or diary open in the editor is not
// written (GV9): the change comes back in `deferred` and the editor makes it.
// Every repair checks again that its finding still holds; one that no longer
// does changes nothing.

const PISI_TASK_REPAIR_ACTIONS = Object.freeze([
    'task-restore-orphan',
    'task-remove-orphan-block',
    'task-append-block',
    'task-move-to-block',
    'task-place-in-today-diary',
    'task-split-duplicate',
    'task-remove-dependency',
    'task-rebuild-diary-section'
]);

const taskService = () => modules['main.taskService'];
const taskStore = () => modules['main.taskStore'];

/** @returns {any} */
function repairError(code, message) {
    return { ok: false, code, error: message };
}

function absoluteNotePath(projectFolder, storedPath) {
    if (typeof storedPath !== 'string' || !storedPath) return null;
    const target = path.resolve(projectFolder, ...storedPath.split('/').filter(Boolean));
    const relative = path.relative(path.resolve(projectFolder), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return target;
}

function readWritable(projectFolder) {
    const read = taskService().readPisiWritableTaskState(projectFolder);
    return read.error ? { error: read.error } : { state: read.state, tasks: read.state.tasks.slice() };
}

function findIndex(tasks, taskId) {
    return tasks.findIndex((task) => task?.id === taskId);
}

function unchanged(context) {
    return { ok: true, changed: false, deferred: context.deferred, warnings: context.warnings };
}

function noteChange(projectFolder, change, context) {
    const result = taskService().applyPisiTaskNoteChange(projectFolder, change, context);
    if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
    return result;
}

function finish(projectFolder, context, { changed = [], removedIds = [] } = {}) {
    taskService().emitPisiTasksChanged(projectFolder, { changed, removedIds });
    return {
        ok: true,
        changed: true,
        deferred: context.deferred,
        writtenNotes: context.writtenNotes,
        writtenDiaries: context.writtenDiaries,
        createdDiaries: context.createdDiaries,
        warnings: context.warnings
    };
}

/** A new place for a stored record (`{ noteId }` or `{ diaryDate }`); the rest of the record stays. */
function placeTask(record, place, now) {
    const normalized = normalizePisiTask(place, record, { now, makeUuid: () => crypto.randomUUID() });
    if (!normalized.ok) throw Object.assign(new Error('Görevin yeri yazılamadı.'), { code: 'TASK_INVALID' });
    return normalized.task;
}

/** Orphan block whose id is in the Trash: the task comes back and lives in the note of the block. */
function restoreOrphan(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    if (findIndex(read.tasks, payload.taskId) >= 0) return unchanged(context);
    const taken = modules['main.trashStore'].takePisiTasksFromTrash(projectFolder, [payload.taskId]);
    const record = taken.tasks.find((task) => task?.id === payload.taskId);
    if (!record) return repairError('TASK_NOT_IN_TRASH', 'Görev çöp kutusunda bulunamadı.');
    const now = taskService().getPisiTaskServiceNow();
    const place = payload.diaryDate ? { diaryDate: payload.diaryDate, noteId: null } : { noteId: payload.noteId, diaryDate: null };
    const restored = placeTask(record, place, now);
    let tasks = [...read.tasks, restored];
    const refs = new Map(taken.dependencyRefs.map((ref) => [ref.taskId, ref.dependencies]));
    tasks = tasks.map((task) =>
        refs.has(task.id) ? { ...task, dependencies: Array.from(new Set([...(task.dependencies || []), ...refs.get(task.id)])) } : task
    );
    taskStore().writePisiTaskStore(projectFolder, read.state, tasks, { now });
    if (payload.diaryDate) {
        // A diary keeps its tasks in its section, not as blocks (§1.4).
        noteChange(
            projectFolder,
            { op: 'remove', taskId: restored.id, notePath: absoluteNotePath(projectFolder, payload.notePath), noteId: payload.noteId },
            context
        );
    }
    taskService().writePisiDiarySectionsForChanges(projectFolder, tasks, [{ before: null, after: restored }], context);
    const changed = tasks.filter((task) => task.id === restored.id || refs.has(task.id));
    return finish(projectFolder, context, { changed });
}

/** Orphan block whose task is nowhere: the block goes. */
function removeOrphanBlock(projectFolder, payload, context) {
    const state = taskStore().readPisiTaskStoreState(projectFolder, { fresh: true });
    if (state.readOnly) return repairError('TASK_STORE_READ_ONLY', state.error || 'Görev deposu salt okunur.');
    if (findIndex(state.tasks, payload.taskId) >= 0) return unchanged(context);
    const result = noteChange(
        projectFolder,
        { op: 'remove', taskId: payload.taskId, notePath: absoluteNotePath(projectFolder, payload.notePath), noteId: payload.noteId },
        context
    );
    return result.removed || result.deferred ? finish(projectFolder, context) : unchanged(context);
}

/** Homeless task: its block goes to the end of its note. */
function appendBlock(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    const task = readPisiTask(read.tasks[findIndex(read.tasks, payload.taskId)]);
    if (!task || task.noteId !== payload.noteId) return unchanged(context);
    const result = noteChange(
        projectFolder,
        {
            op: 'insert',
            taskId: task.id,
            blockId: formatPisiBlockId(crypto.randomUUID()),
            noteId: task.noteId,
            notePath: absoluteNotePath(projectFolder, payload.notePath),
            afterBlockId: null
        },
        context
    );
    return result.ok ? finish(projectFolder, context, { changed: [task] }) : unchanged(context);
}

/** A task's only block is in another note: that note (or that diary) becomes its place. */
function moveToBlock(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    const index = findIndex(read.tasks, payload.taskId);
    if (index < 0) return unchanged(context);
    const before = read.tasks[index];
    const diaryDate = normalizePisiDiaryIsoDate(payload.diaryDate);
    const place = diaryDate ? { diaryDate, noteId: null } : { noteId: payload.noteId, diaryDate: null };
    const current = readPisiTask(before);
    if (current.noteId === place.noteId && current.diaryDate === place.diaryDate) return unchanged(context);
    const now = taskService().getPisiTaskServiceNow();
    const after = placeTask(before, place, now);
    read.tasks[index] = after;
    taskStore().writePisiTaskStore(projectFolder, read.state, read.tasks, { now });
    if (diaryDate) {
        noteChange(
            projectFolder,
            { op: 'remove', taskId: after.id, notePath: absoluteNotePath(projectFolder, payload.notePath), noteId: payload.noteId },
            context
        );
    }
    taskService().writePisiDiarySectionsForChanges(projectFolder, read.tasks, [{ before, after }], context);
    return finish(projectFolder, context, { changed: [after] });
}

/** The note of the task is gone: the task lives in today's diary (created if needed). */
function placeInTodayDiary(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    const index = findIndex(read.tasks, payload.taskId);
    if (index < 0) return unchanged(context);
    const before = read.tasks[index];
    if (readPisiTask(before)?.noteId !== payload.noteId) return unchanged(context);
    const now = taskService().getPisiTaskServiceNow();
    const after = placeTask(before, { diaryDate: getPisiLocalDay(now), noteId: null }, now);
    read.tasks[index] = after;
    taskStore().writePisiTaskStore(projectFolder, read.state, read.tasks, { now });
    taskService().writePisiDiarySectionsForChanges(projectFolder, read.tasks, [{ before, after }], context);
    return finish(projectFolder, context, { changed: [after] });
}

/**
 * The block of a task is in several notes: the note that is the task's place
 * keeps it (when none is, the first one); the block in each other note becomes
 * a new task, a copy, that lives in that note (GV7).
 */
function splitDuplicate(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    const task = readPisiTask(read.tasks[findIndex(read.tasks, payload.taskId)]);
    const notes = Array.isArray(payload.notes) ? payload.notes.filter((note) => note?.notePath && note?.noteId) : [];
    if (!task || notes.length < 2) return unchanged(context);
    const keep = notes.find((note) => note.noteId === task.noteId) || notes[0];
    const now = taskService().getPisiTaskServiceNow();
    const copies = [];
    for (const note of notes) {
        if (note === keep) continue;
        // In a diary the copy lives in the day's section, not in a block (§1.4).
        const place = note.diaryDate ? { diaryDate: note.diaryDate } : { noteId: note.noteId };
        const normalized = normalizePisiTask({ ...makePisiTaskCopyFields(task), ...place }, null, { now, makeUuid: () => crypto.randomUUID() });
        if (!normalized.ok) return repairError('TASK_INVALID', 'Görevin kopyası oluşturulamadı.');
        copies.push({ task: normalized.task, note });
    }
    const tasks = [...read.tasks, ...copies.map((copy) => copy.task)];
    taskStore().writePisiTaskStore(projectFolder, read.state, tasks, { now });
    for (const copy of copies) {
        noteChange(
            projectFolder,
            {
                op: copy.note.diaryDate ? 'remove' : 'retag',
                taskId: task.id,
                newTaskId: copy.task.id,
                notePath: absoluteNotePath(projectFolder, copy.note.notePath),
                noteId: copy.note.noteId
            },
            context
        );
    }
    taskService().writePisiDiarySectionsForChanges(
        projectFolder,
        tasks,
        copies.map((copy) => ({ before: null, after: copy.task })),
        context
    );
    return finish(projectFolder, context, { changed: copies.map((copy) => copy.task) });
}

/** One dependency out of a task (a loop, or a task that is not there). Field change only (GV5). */
function removeDependency(projectFolder, payload, context) {
    const read = readWritable(projectFolder);
    if (read.error) return read.error;
    const index = findIndex(read.tasks, payload.taskId);
    if (index < 0) return unchanged(context);
    const before = read.tasks[index];
    const dependencies = Array.isArray(before.dependencies) ? before.dependencies : [];
    if (!dependencies.includes(payload.dependencyId)) return unchanged(context);
    const now = taskService().getPisiTaskServiceNow();
    // Only this dependency goes; the record is written as it is otherwise (GV12).
    const after = { ...before, dependencies: dependencies.filter((id) => id !== payload.dependencyId), updatedAt: now.toISOString() };
    read.tasks[index] = after;
    taskStore().writePisiTaskStore(projectFolder, read.state, read.tasks, { now });
    return finish(projectFolder, context, { changed: [after] });
}

/** A diary's task section that does not fit the rule is made again from tasks.json (GV15). */
function rebuildDiarySection(projectFolder, payload, context) {
    const day = normalizePisiDiaryIsoDate(payload.diaryDate);
    if (!day) return repairError('TASK_REPAIR_INVALID', 'Günlüğün günü geçersiz.');
    const state = taskStore().readPisiTaskStoreState(projectFolder, { fresh: true });
    if (state.readOnly) return repairError('TASK_STORE_READ_ONLY', state.error || 'Görev deposu salt okunur.');
    const tasks = state.tasks.map(readPisiTask).filter(Boolean);
    // writePisiDiarySections writes only a section that differs (V4) and leaves an open diary to the editor.
    taskService().writePisiDiarySections(projectFolder, tasks, [day], context, { create: [] });
    if (!context.writtenDiaries.length && !context.deferred.diaryDays.length) return unchanged(context);
    return finish(projectFolder, context);
}

const PISI_TASK_REPAIRS = Object.freeze({
    'task-restore-orphan': restoreOrphan,
    'task-remove-orphan-block': removeOrphanBlock,
    'task-append-block': appendBlock,
    'task-move-to-block': moveToBlock,
    'task-place-in-today-diary': placeInTodayDiary,
    'task-split-duplicate': splitDuplicate,
    'task-remove-dependency': removeDependency,
    'task-rebuild-diary-section': rebuildDiarySection
});

function isPisiTaskRepairAction(action) {
    return Object.hasOwn(PISI_TASK_REPAIRS, String(action || ''));
}

/**
 * Runs one task repair. `openPaths` names the documents open in the editor;
 * their changes come back in `deferred` (GV9). Called inside the atomic
 * mutation of integrity.repair.v1.
 */
function applyPisiTaskRepair(projectFolder, repair, { openPaths = [] } = {}) {
    const run = PISI_TASK_REPAIRS[repair?.action];
    if (!run) return repairError('INTEGRITY_REPAIR_NOT_SAFE', `Görev onarımı bilinmiyor: ${repair?.action}`);
    const context = taskService().makePisiTaskCommandContext({ openPaths });
    return run(path.resolve(projectFolder), repair.payload || {}, context);
}

const moduleApi = {
    PISI_TASK_REPAIR_ACTIONS,
    isPisiTaskRepairAction,
    applyPisiTaskRepair
};

registerMainModule('main.taskRepair', moduleApi);

export { PISI_TASK_REPAIR_ACTIONS, isPisiTaskRepairAction, applyPisiTaskRepair };
