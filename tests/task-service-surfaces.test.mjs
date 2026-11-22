// The task service under the other surfaces (docs/task-plan.md G5): a note's
// history restore lets its tasks follow the restored blocks (§3.3), and the
// tasks of a Markdown import or a map note copy go in with one tasks.json write.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { listPisiNoteTaskIds } from '../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const taskService = modules['main.taskService'];
const trashStore = modules['main.trashStore'];

taskService.setPisiTaskServiceClock(() => new Date(2026, 10, 22, 9, 0));

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-surfaces-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    globalThis.activeProjectFolder = project;
    const makeNote = () => {
        const created = documentStore.createUniquePisiFile(project, '.node');
        assert.equal(created.ok, true, created.error);
        return { path: created.fullPath, id: documentStore.ensurePisiFileMetadata(created.fullPath).metadata.id };
    };
    return { project, note: makeNote(), makeNote };
}

const readNote = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const storedTasks = (project) => JSON.parse(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8')).tasks;
const storedTask = (project, id) => storedTasks(project).find((task) => task.id === id);
const create = (project, task, target) => {
    const result = taskService.createPisiTask(project, { task, target });
    assert.equal(result.ok, true, result.error);
    return result.task;
};
const restore = (project, note, content) => taskService.writePisiRestoredNote(project, note.path, { ...readNote(note.path), content });

test('geçmişten geri yüklemede: notta yaşayan görevin bloğu kalır, çöp kutusundaki görev geri gelir, geri yüklemenin çıkardığı görev çöp kutusuna gider', (t) => {
    const { project, note } = makeProject(t);
    const kept = create(project, { title: 'Kalan' }, { noteId: note.id, notePath: note.path });
    const trashed = create(project, { title: 'Silinen', dueDate: '2026-11-24' }, { noteId: note.id, notePath: note.path });
    const oldVersion = readNote(note.path).content;
    // The block of "Silinen" is deleted in the editor: the task goes to the Trash.
    const withoutTrashed = oldVersion.replace(new RegExp(`<div[^>]*data-pisi-task-id="${trashed.id}"[^>]*></div>`), '');
    assert.equal(taskService.savePisiNoteWithTasks(project, note.path, withoutTrashed).ok, true);
    assert.equal(storedTask(project, trashed.id), undefined);
    const later = create(project, { title: 'Sonradan' }, { noteId: note.id, notePath: note.path });

    // Restoring the version before the delete: "Silinen" comes back, "Sonradan" (not in that version) goes to the Trash.
    const result = restore(project, note, oldVersion);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.tasks.restored, [trashed.id]);
    assert.deepEqual(result.tasks.removed, [later.id]);
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), [kept.id, trashed.id]);
    assert.equal(storedTask(project, trashed.id).noteId, note.id);
    assert.equal(storedTask(project, later.id), undefined);
    assert.deepEqual(readPisiDiaryTaskSection(readNote(documentStore.getPisiDiaryNodePath(project, '2026-11-24')).content).taskIds, [trashed.id]);
    assert.equal(trashStore.listPisiTrashItems(project).items.length, 1);
});

test('başka bir notta yaşayan görevin bloğu geri gelmez; hiçbir yerde olmayan görevin bloğu kalır ("Görev bulunamadı")', (t) => {
    const { project, note, makeNote } = makeProject(t);
    const other = makeNote();
    const task = create(project, { title: 'Taşınan' }, { noteId: note.id, notePath: note.path });
    const oldVersion = readNote(note.path).content;
    assert.equal(taskService.movePisiTask(project, { taskId: task.id, target: { noteId: other.id, notePath: other.path }, fromNotePath: note.path }).ok, true);
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), []);

    const result = restore(
        project,
        note,
        oldVersion +
            '<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_lost" data-pisi-block-type="task" data-pisi-task-id="task_00000000-0000-4000-9000-00000000dead" contenteditable="false"></div>'
    );
    assert.equal(result.ok, true, result.error);
    // The moved task keeps one block, in its own note (GV7); the unknown id stays as a block.
    assert.deepEqual(listPisiNoteTaskIds(readNote(note.path).content), ['task_00000000-0000-4000-9000-00000000dead']);
    assert.deepEqual(listPisiNoteTaskIds(readNote(other.path).content), [task.id]);
    assert.equal(storedTask(project, task.id).noteId, other.id);
});

test('geri yüklenen günlüğün görev bölümü eski sürümden değil, kuraldan gelir', (t) => {
    const { project } = makeProject(t);
    const task = create(project, { title: 'Günde' }, { diaryDate: '2026-11-22' });
    const diaryPath = documentStore.getPisiDiaryNodePath(project, '2026-11-22');
    const diary = { path: diaryPath, id: readNote(diaryPath).pisi.id };
    const result = restore(project, diary, '<p>Eski günlük</p>');
    assert.equal(result.ok, true, result.error);
    const content = readNote(diaryPath).content;
    assert.ok(content.startsWith('<p>Eski günlük</p>'));
    assert.deepEqual(readPisiDiaryTaskSection(content).taskIds, [task.id]);
    assert.ok(storedTask(project, task.id));
});

test('içe aktarma ve not kopyası görevleri tek yazmayla eklenir; tarihli kopya gününün günlüğüne girer', (t) => {
    const { project, note } = makeProject(t);
    const ids = ['task_00000000-0000-4000-9000-000000000001', 'task_00000000-0000-4000-9000-000000000002'];
    const result = taskService.addPisiNoteTasks(project, [
        { id: ids[0], noteId: note.id, task: { title: 'İçe aktarılan' } },
        { id: ids[1], noteId: note.id, task: { title: 'Kopya', dueDate: '2026-11-30', status: 'todo', noteId: 'node_yok', diaryDate: '2026-01-01' } }
    ]);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(
        result.tasks.map((task) => [task.id, task.noteId, task.diaryDate]),
        [
            [ids[0], note.id, null],
            [ids[1], note.id, null]
        ]
    );
    assert.deepEqual(readPisiDiaryTaskSection(readNote(documentStore.getPisiDiaryNodePath(project, '2026-11-30')).content).taskIds, [ids[1]]);
    // An id that is already there is refused and nothing is written.
    const before = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    assert.equal(taskService.addPisiNoteTasks(project, [{ id: ids[0], noteId: note.id, task: {} }]).code, 'TASK_ID_EXISTS');
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), before);
});
