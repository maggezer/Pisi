// Behavior tests of the desktop task service (docs/task-plan.md G2): the real
// main-process stores run against a temporary project. They cover the task
// commands, which files each one reads and writes (GV5), the diary sections
// (§3.2.2, §3.2.3), the Trash (§3.3), the note save and atomicity (GV8).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { makePisiTaskBlockHtml, listPisiNoteTaskIds } from '../shared/task-blocks.mjs';
import { listPisiDiaryTaskIds, makePisiDiaryTaskSectionHtml, readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const taskService = modules['main.taskService'];
const trashStore = modules['main.trashStore'];
const atomicMutation = modules['main.atomicMutation'];

let clock = new Date(2026, 10, 21, 9, 0);
taskService.setPisiTaskServiceClock(() => clock);

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-service-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    globalThis.activeProjectFolder = project;
    clock = new Date(2026, 10, 21, 9, 0);
    const created = documentStore.createUniquePisiFile(project, '.node');
    assert.equal(created.ok, true, created.error);
    const note = { path: created.fullPath, id: documentStore.ensurePisiFileMetadata(created.fullPath).metadata.id };
    return { project, note };
}

const diaryPath = (project, day) => documentStore.getPisiDiaryNodePath(project, day);
const readNote = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const diaryIds = (project, day) =>
    fs.existsSync(diaryPath(project, day)) ? readPisiDiaryTaskSection(readNote(diaryPath(project, day)).content).taskIds : null;
const storedTasks = (project) => JSON.parse(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8')).tasks;
const storedTask = (project, id) => storedTasks(project).find((task) => task.id === id);

/** Counts .node reads and writes while `run` runs (GV5). */
function countNodeIo(run) {
    const counts = { reads: 0, writes: 0 };
    const patched = [];
    const patch = (name, kind) => {
        const original = fs[name];
        fs[name] = function countingPisiFs(target, ...rest) {
            if (/\.node$/i.test(String(target))) counts[kind] += 1;
            return original.call(this, target, ...rest);
        };
        patched.push([name, original]);
    };
    patch('readFileSync', 'reads');
    patch('writeFileSync', 'writes');
    patch('renameSync', 'writes');
    patch('openSync', 'writes');
    syncBuiltinESMExports();
    try {
        return { result: run(), counts };
    } finally {
        for (const [name, original] of patched) fs[name] = original;
        syncBuiltinESMExports();
    }
}

function create(project, task, target) {
    const result = taskService.createPisiTask(project, { task, target });
    assert.equal(result.ok, true, result.error);
    return result.task;
}

test('a task in a closed note: the record holds every field, the note only the block (GV1, GV2)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: '  Raporu   yaz ', priority: 4 }, { noteId: note.id, notePath: note.path });
    assert.equal(task.title, 'Raporu yaz');
    assert.equal(task.noteId, note.id);
    assert.equal(task.diaryDate, null);
    const content = readNote(note.path).content;
    assert.deepEqual(listPisiNoteTaskIds(content), [task.id]);
    const blockId = /data-pisi-block-id="([^"]+)"/.exec(content)[1];
    assert.ok(content.endsWith(makePisiTaskBlockHtml({ blockId, taskId: task.id })), 'the note holds the bare block');
    assert.ok(!content.includes('Raporu'), 'the title is not in the note');
    assert.equal(fs.existsSync(path.join(project, 'diary')), false, 'an undated task creates no diary');
});

test('a dated task creates the diary of its day with the section (S9, GB10)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'İleri tarihli', dueDate: '2027-03-15' }, { noteId: note.id, notePath: note.path });
    assert.deepEqual(diaryIds(project, '2027-03-15'), [task.id]);
    const diary = readNote(diaryPath(project, '2027-03-15'));
    assert.equal(readPisiDiaryTaskSection(diary.content).last, true);
    assert.ok(!diary.content.includes('Görevler'), 'the heading is drawn by the editor, not written');
    // The bytes are the shared rule's, which the phone runs too (GV15).
    const tasks = storedTasks(project);
    assert.ok(diary.content.endsWith(makePisiDiaryTaskSectionHtml('2027-03-15', listPisiDiaryTaskIds('2027-03-15', tasks))));
});

test('a task written in a diary lives there and is due that day (§1.4)', (t) => {
    const { project } = makeProject(t);
    const task = create(project, { title: 'Günlükte' }, { diaryDate: '2026-11-21' });
    assert.equal(task.diaryDate, '2026-11-21');
    assert.equal(task.dueDate, '2026-11-21');
    assert.deepEqual(diaryIds(project, '2026-11-21'), [task.id]);
    // The section lists tasks by creation time (then id).
    clock = new Date(2026, 10, 21, 9, 5);
    const undated = create(project, { title: 'Tarihsiz', dueDate: null }, { diaryDate: '2026-11-21' });
    assert.equal(undated.dueDate, null);
    assert.deepEqual(diaryIds(project, '2026-11-21'), [task.id, undated.id]);
});

test('a field change reads and writes no .node file (GV5, S1, S3)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Alan', dueDate: '2026-11-25' }, { noteId: note.id, notePath: note.path });
    const diaryBefore = fs.readFileSync(diaryPath(project, '2026-11-25'), 'utf8');
    for (const patch of [{ title: 'Yeni başlık' }, { priority: 5 }, { status: 'doing' }, { dueTime: '08:30' }, { reminderMode: 'day-before' }]) {
        const { result, counts } = countNodeIo(() => taskService.updatePisiTask(project, { taskId: task.id, patch }));
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(counts, { reads: 0, writes: 0 }, JSON.stringify(patch));
    }
    const { result, counts } = countNodeIo(() => taskService.completePisiTaskCommand(project, { taskId: task.id }));
    assert.equal(result.ok, true);
    // Completed early on 21-11: the task joins the 21-11 diary (it shows there done); nothing else.
    assert.equal(counts.reads > 0, true);
    assert.deepEqual(diaryIds(project, '2026-11-21'), [task.id]);
    assert.equal(fs.readFileSync(diaryPath(project, '2026-11-25'), 'utf8'), diaryBefore, 'the due day diary keeps its bytes');
    assert.equal(storedTask(project, task.id).status, 'done');
    assert.equal(storedTask(project, task.id).title, 'Yeni başlık');
});

test('a task completed on its due day writes no file but tasks.json (S1)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Bugün', dueDate: '2026-11-21' }, { noteId: note.id, notePath: note.path });
    const { result, counts } = countNodeIo(() => taskService.completePisiTaskCommand(project, { taskId: task.id }));
    assert.equal(result.ok, true);
    assert.deepEqual(counts, { reads: 0, writes: 0 });
    assert.equal(storedTask(project, task.id).completedOn, '2026-11-21');
});

test('moving the due day writes only the two diaries; the old diary stays (§3.3)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Taşınan', dueDate: '2026-11-22' }, { noteId: note.id, notePath: note.path });
    const other = create(project, { title: 'Başka gün', dueDate: '2026-11-30' }, { noteId: note.id, notePath: note.path });
    const untouched = fs.readFileSync(diaryPath(project, '2026-11-30'), 'utf8');
    const result = taskService.updatePisiTask(project, { taskId: task.id, patch: { dueDate: '2026-11-24' } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.writtenDiaries.sort(), ['2026-11-22', '2026-11-24']);
    assert.deepEqual(diaryIds(project, '2026-11-22'), []);
    assert.deepEqual(diaryIds(project, '2026-11-24'), [task.id]);
    assert.equal(fs.readFileSync(diaryPath(project, '2026-11-30'), 'utf8'), untouched);
    assert.deepEqual(diaryIds(project, '2026-11-30'), [other.id]);
});

test('a repeating task: the five steps of §3.2.3 (S2, S11, S18, S21)', (t) => {
    const { project } = makeProject(t);
    const task = create(project, { title: 'Spor', repeat: 'daily', dueDate: '2026-11-21' }, { diaryDate: '2026-11-21' });

    // 1–2. Done on 21-11: one completion, the task moves to 22-11; both diaries list it.
    const done = taskService.completePisiTaskCommand(project, { taskId: task.id });
    assert.equal(done.ok, true);
    let stored = storedTask(project, task.id);
    assert.equal(stored.dueDate, '2026-11-22');
    assert.equal(stored.status, 'todo');
    assert.deepEqual(
        stored.completions.map((entry) => [entry.date, entry.dueDate]),
        [['2026-11-21', '2026-11-21']]
    );
    assert.deepEqual(diaryIds(project, '2026-11-21'), [task.id]);
    assert.deepEqual(diaryIds(project, '2026-11-22'), [task.id]);

    // 3. Taken back: the task is due 21-11 again, 22-11 loses the row, its file stays.
    const back = taskService.reopenPisiTaskCommand(project, { taskId: task.id, completion: done.completion });
    assert.equal(back.ok, true);
    assert.equal(storedTask(project, task.id).dueDate, '2026-11-21');
    assert.deepEqual(diaryIds(project, '2026-11-22'), []);
    assert.equal(fs.existsSync(diaryPath(project, '2026-11-22')), true);

    // 4. Done on 21-11 and on 22-11: the earlier completion is locked.
    const first = taskService.completePisiTaskCommand(project, { taskId: task.id });
    clock = new Date(2026, 10, 22, 9, 0);
    taskService.completePisiTaskCommand(project, { taskId: task.id });
    const locked = taskService.reopenPisiTaskCommand(project, { taskId: task.id, completion: first.completion });
    assert.equal(locked.ok, false);
    assert.equal(locked.code, 'TASK_COMPLETION_LOCKED');

    // 5. 23-11 is missed; done on 25-11: completion today for the 23-11 occurrence, next due 26-11.
    clock = new Date(2026, 10, 25, 9, 0);
    const late = taskService.completePisiTaskCommand(project, { taskId: task.id });
    assert.equal(late.ok, true);
    stored = storedTask(project, task.id);
    assert.deepEqual(stored.completions.at(-1).date, '2026-11-25');
    assert.deepEqual(stored.completions.at(-1).dueDate, '2026-11-23');
    assert.equal(stored.dueDate, '2026-11-26');
    assert.deepEqual(diaryIds(project, '2026-11-25'), [task.id]);
    assert.deepEqual(diaryIds(project, '2026-11-23'), []);
    assert.deepEqual(diaryIds(project, '2026-11-26'), [task.id]);
});

test('a version 1 task without a place is completed and edited without a fake source (S4, GB4, GB5)', (t) => {
    const { project } = makeProject(t);
    const v1 = {
        id: 'task_mobile0001',
        title: 'Telefonda',
        status: 'todo',
        priority: 3,
        dueDate: '2026-11-21',
        todoTag: 'todo.3.21-11-2026',
        source: {},
        scheduledAt: null
    };
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    fs.writeFileSync(taskStore.getPisiTaskStorePath(project), JSON.stringify({ version: 1, updatedAt: null, extra: { kept: true }, tasks: [v1] }));
    assert.equal(taskService.updatePisiTask(project, { taskId: v1.id, patch: { title: 'Masaüstünde' } }).ok, true);
    assert.equal(taskService.completePisiTaskCommand(project, { taskId: v1.id }).ok, true);
    const file = JSON.parse(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'));
    assert.equal(file.version, 2);
    assert.deepEqual(file.extra, { kept: true }, 'unknown top-level keys stay (GV12)');
    const stored = file.tasks[0];
    assert.equal(stored.status, 'done');
    assert.equal(stored.title, 'Masaüstünde');
    assert.deepEqual(stored.source, {}, 'no source is written');
    assert.equal(stored.todoTag, 'todo.3.21-11-2026', 'old fields stay (GV12)');
    assert.equal(stored.noteId, null);
    assert.equal(stored.diaryDate, null);
});

test('an unreadable tasks.json is never written; tasks are read-only (GV11)', (t) => {
    const { project, note } = makeProject(t);
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    fs.writeFileSync(taskStore.getPisiTaskStorePath(project), '{ "tasks": [');
    const before = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    const listed = taskService.listPisiTasks(project);
    assert.equal(listed.readOnly, true);
    const refused = taskService.createPisiTask(project, { task: { title: 'x' }, target: { noteId: note.id, notePath: note.path } });
    assert.equal(refused.code, 'TASK_STORE_READ_ONLY');
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), before);
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), []);
});

test('a dependency that closes a loop is refused', (t) => {
    const { project } = makeProject(t);
    const a = create(project, { title: 'A' }, { diaryDate: '2026-11-21' });
    const b = create(project, { title: 'B', dependencies: [a.id] }, { diaryDate: '2026-11-21' });
    const refused = taskService.updatePisiTask(project, { taskId: a.id, patch: { dependencies: [b.id] } });
    assert.equal(refused.code, 'TASK_DEPENDENCY_CYCLE');
    assert.deepEqual(storedTask(project, a.id).dependencies, []);
});

test('a batch of field changes is one tasks.json write', (t) => {
    const { project } = makeProject(t);
    const a = create(project, { title: 'A' }, { diaryDate: '2026-11-21' });
    const b = create(project, { title: 'B' }, { diaryDate: '2026-11-21' });
    let writes = 0;
    const original = taskStore.writePisiTaskStore;
    const result = (() => {
        const counted = (...args) => {
            writes += 1;
            return original(...args);
        };
        Object.defineProperty(taskStore, 'writePisiTaskStore', { value: counted, configurable: true, writable: true });
        try {
            return taskService.batchUpdatePisiTasks(project, {
                updates: [
                    { taskId: a.id, patch: { manualOrder: 2 } },
                    { taskId: b.id, patch: { manualOrder: 1 } }
                ]
            });
        } finally {
            Object.defineProperty(taskStore, 'writePisiTaskStore', { value: original, configurable: true, writable: true });
        }
    })();
    assert.equal(result.ok, true);
    assert.equal(writes, 1);
    assert.equal(storedTask(project, b.id).manualOrder, 1);
});

test('deleting a task: Trash item, block and section rows go; restore brings them back (GV10)', (t) => {
    const { project, note } = makeProject(t);
    const keep = create(project, { title: 'Kalan' }, { noteId: note.id, notePath: note.path });
    const gone = create(project, { title: 'Silinen', dueDate: '2026-11-23' }, { noteId: note.id, notePath: note.path });
    const deleted = taskService.deletePisiTask(project, { taskId: gone.id, notePath: note.path });
    assert.equal(deleted.ok, true, deleted.error);
    assert.equal(storedTask(project, gone.id), undefined);
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), [keep.id]);
    assert.deepEqual(diaryIds(project, '2026-11-23'), []);
    const items = trashStore.listPisiTrashItems(project).items;
    assert.deepEqual(
        items.map((item) => [item.kind, item.label, item.taskCount]),
        [['task', 'Silinen', 1]]
    );

    const restored = trashStore.restorePisiTrashItem(project, deleted.trashId);
    assert.equal(restored.ok, true, restored.error);
    assert.equal(storedTask(project, gone.id).title, 'Silinen');
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), [keep.id, gone.id], 'the block is back where it was');
    assert.deepEqual(diaryIds(project, '2026-11-23'), [gone.id]);
    assert.deepEqual(trashStore.listPisiTrashItems(project).items, []);
});

test('moving a task from a note to a diary moves its block out of the note', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Taşı' }, { noteId: note.id, notePath: note.path });
    const moved = taskService.movePisiTask(project, { taskId: task.id, target: { diaryDate: '2026-11-26' }, fromNotePath: note.path });
    assert.equal(moved.ok, true, moved.error);
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), []);
    assert.equal(storedTask(project, task.id).diaryDate, '2026-11-26');
    assert.deepEqual(diaryIds(project, '2026-11-26'), [task.id]);
});

test('an open note or diary is not written: the change comes back to the editor (GV9, S7)', (t) => {
    const { project, note } = makeProject(t);
    const before = fs.readFileSync(note.path, 'utf8');
    const created = taskService.createPisiTask(project, {
        task: { title: 'Açık nota', dueDate: '2026-11-21' },
        target: { noteId: note.id, notePath: note.path },
        openPaths: [note.path, diaryPath(project, '2026-11-21')]
    });
    assert.equal(created.ok, true);
    assert.equal(fs.readFileSync(note.path, 'utf8'), before);
    assert.equal(fs.existsSync(diaryPath(project, '2026-11-21')), false);
    assert.equal(created.deferred.notes.length, 1);
    assert.equal(created.deferred.notes[0].op, 'insert');
    assert.equal(created.deferred.notes[0].taskId, created.task.id);
    assert.deepEqual(created.deferred.diaryDays, ['2026-11-21']);
});

test('saving a note without a task block sends that task to the Trash; undo brings it back (S6, GB7, GB8)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Blok', dueDate: '2026-11-24' }, { noteId: note.id, notePath: note.path });
    const withBlock = readNote(note.path).content;
    const drawn = withBlock.replace('contenteditable="false"></div>', 'contenteditable="false"><span>☐ Blok</span></div>');

    // The editor's drawing inside the block is not stored (GV2).
    const saved = taskService.savePisiNoteWithTasks(project, note.path, `<div>Metin</div>${drawn}`);
    assert.equal(saved.ok, true, saved.error);
    assert.ok(readNote(note.path).content.endsWith(withBlock), 'the block is stored bare');
    assert.ok(storedTask(project, task.id));

    const removed = taskService.savePisiNoteWithTasks(project, note.path, '<div>Metin</div>');
    assert.equal(removed.ok, true, removed.error);
    assert.deepEqual(removed.tasks.removed, [task.id]);
    assert.equal(storedTask(project, task.id), undefined);
    assert.deepEqual(diaryIds(project, '2026-11-24'), []);
    assert.equal(trashStore.listPisiTrashItems(project).items.length, 1);

    const undone = taskService.savePisiNoteWithTasks(project, note.path, `<div>Metin</div>${withBlock}`);
    assert.equal(undone.ok, true, undone.error);
    assert.deepEqual(undone.tasks.restored, [task.id]);
    assert.equal(storedTask(project, task.id).noteId, note.id);
    assert.deepEqual(diaryIds(project, '2026-11-24'), [task.id]);
    assert.deepEqual(trashStore.listPisiTrashItems(project).items, []);
});

test('a diary save keeps the task section the rule gives (GV15, pisi-error.md §4a)', (t) => {
    const { project } = makeProject(t);
    const task = create(project, { title: 'Günlük' }, { diaryDate: '2026-11-21' });
    const filePath = diaryPath(project, '2026-11-21');
    const saved = taskService.savePisiNoteWithTasks(project, filePath, '<div>Yazdığım</div><div class="pisi-diary-tasks">bozuk</div>');
    assert.equal(saved.ok, true, saved.error);
    const content = readNote(filePath).content;
    assert.ok(content.startsWith('<div>Yazdığım</div>'));
    assert.deepEqual(readPisiDiaryTaskSection(content).taskIds, [task.id]);
    assert.equal(readPisiDiaryTaskSection(content).count, 1);
});

test('a cut task pasted into a diary comes back from the Trash and lives in that diary (G3, §1.4)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Taşınan', dueDate: '2026-11-25' }, { noteId: note.id, notePath: note.path });
    const block = readNote(note.path).content;
    // Cut: the note is saved without the block; the task goes to the Trash.
    assert.equal(taskService.savePisiNoteWithTasks(project, note.path, '<div>Not</div>').ok, true);
    assert.equal(storedTask(project, task.id), undefined);
    // Paste into the diary of 21-11: the diary is saved with the block.
    create(project, { title: 'Günlüğün kendi görevi' }, { diaryDate: '2026-11-21' });
    const filePath = diaryPath(project, '2026-11-21');
    const before = readNote(filePath).content;
    const saved = taskService.savePisiNoteWithTasks(
        project,
        filePath,
        `<div>Yazdığım</div>${block}${before.slice(before.indexOf('<div class="pisi-editor-block pisi-diary-tasks"'))}`
    );
    assert.equal(saved.ok, true, saved.error);
    assert.deepEqual(saved.tasks.restored, [task.id]);
    const restored = storedTask(project, task.id);
    assert.equal(restored.diaryDate, '2026-11-21');
    assert.equal(restored.noteId, null);
    assert.equal(restored.dueDate, '2026-11-25', 'the due day stays');
    const content = readNote(filePath).content;
    assert.deepEqual(listPisiNoteTaskIds(content), [], 'the diary keeps no task block: the task is a row of its section');
    assert.ok(readPisiDiaryTaskSection(content).taskIds.includes(task.id));
    assert.deepEqual(diaryIds(project, '2026-11-25'), [task.id], 'the due day still lists it');
});

test('trashing a note takes its tasks along by place and restoring brings them back (S17)', (t) => {
    const { project, note } = makeProject(t);
    const task = create(project, { title: 'Notla gider', dueDate: '2026-11-27' }, { noteId: note.id, notePath: note.path });
    const diaryTask = create(project, { title: 'Günlükle gider' }, { diaryDate: '2026-11-28' });
    const trashedNote = trashStore.movePisiPathToTrash(project, note.path);
    assert.equal(trashedNote.ok, true, trashedNote.error);
    assert.equal(storedTask(project, task.id), undefined);
    assert.deepEqual(diaryIds(project, '2026-11-27'), []);
    const trashedDiary = trashStore.movePisiPathToTrash(project, diaryPath(project, '2026-11-28'));
    assert.equal(trashedDiary.ok, true, trashedDiary.error);
    assert.equal(storedTask(project, diaryTask.id), undefined);
    assert.equal(fs.existsSync(diaryPath(project, '2026-11-28')), false, 'a trashed diary is not created again');

    assert.equal(trashStore.restorePisiTrashItem(project, trashedNote.trashId).ok, true);
    assert.equal(trashStore.restorePisiTrashItem(project, trashedDiary.trashId).ok, true);
    assert.equal(storedTask(project, task.id).noteId, note.id);
    assert.deepEqual(diaryIds(project, '2026-11-27'), [task.id]);
    assert.deepEqual(diaryIds(project, '2026-11-28'), [diaryTask.id]);
});

test('a command broken half way leaves the project as it was before (GV8)', (t) => {
    const { project, note } = makeProject(t);
    create(project, { title: 'Önce' }, { noteId: note.id, notePath: note.path });
    const tasksBefore = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    const noteBefore = fs.readFileSync(note.path, 'utf8');
    taskService.setPisiTaskServiceFaultHook((point) => {
        if (point === 'diary-write') throw new Error('Test: komut yarıda kesildi.');
    });
    t.after(() => taskService.setPisiTaskServiceFaultHook(null));
    assert.throws(
        () =>
            atomicMutation.runPisiAtomicMutation(project, 'task.create.v1', () =>
                taskService.createPisiTask(project, { task: { title: 'Yarım', dueDate: '2026-12-01' }, target: { noteId: note.id, notePath: note.path } })
            ),
        /yarıda kesildi/
    );
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), tasksBefore);
    assert.equal(fs.readFileSync(note.path, 'utf8'), noteBefore);
    assert.equal(fs.existsSync(diaryPath(project, '2026-12-01')), false);
});

test('1.000 notes: completing a task reads no note (S8, GB9)', (t) => {
    const { project, note } = makeProject(t);
    for (let index = 0; index < 1000; index += 1) {
        fs.writeFileSync(
            path.join(project, `n${index}.node`),
            JSON.stringify({ pisi: { id: `node_n${index}`, type: 'node', title: `n${index}` }, content: '' })
        );
    }
    const tasks = [];
    for (let index = 0; index < 50; index += 1)
        tasks.push(create(project, { title: `G${index}`, dueDate: '2026-11-21' }, { noteId: note.id, notePath: note.path }));
    const started = performance.now();
    const { result, counts } = countNodeIo(() => taskService.completePisiTaskCommand(project, { taskId: tasks[25].id }));
    const elapsed = performance.now() - started;
    assert.equal(result.ok, true);
    assert.deepEqual(counts, { reads: 0, writes: 0 });
    assert.ok(elapsed < 1000, `${elapsed} ms`);
});
