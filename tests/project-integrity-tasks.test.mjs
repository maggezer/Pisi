// Project Integrity's task findings (docs/task-plan.md G2 step 5, GV14): a
// project the task service wrote has none; each broken case gives its code.
// Since G8 a version 1 task without a place is a finding (§3.1), and a diary
// section must be exactly the one the day rule gives (GV15).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { makePisiTaskBlockHtml, removePisiTaskBlock } from '../shared/task-blocks.mjs';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const originalLoad = Module._load;
Module._load = function pisiIntegrityElectronStub(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir(), isPackaged: false, on() {} }, utilityProcess: {}, BrowserWindow: class {} };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    require('../main/functions/project-integrity.js');
} finally {
    Module._load = originalLoad;
}
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const taskService = modules['main.taskService'];
const integrity = modules['main.projectIntegrity'];

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-integrity-tasks-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    globalThis.activeProjectFolder = project;
    const created = documentStore.createUniquePisiFile(project, '.node');
    const note = { path: created.fullPath, id: documentStore.ensurePisiFileMetadata(created.fullPath).metadata.id };
    return { project, note };
}

const taskCodes = (project) =>
    integrity
        .auditPisiProjectIntegrity(project)
        .issues.filter((issue) => issue.domain === 'tasks')
        .map((issue) => issue.code)
        .sort();

function writeNoteContent(filePath, content) {
    const info = documentStore.ensurePisiFileMetadata(filePath);
    globalThis.writePisiDocument(filePath, { ...info.data, content });
}

test('a diary whose section leaves out a task of its day, or lists one of another day, is a finding (G8)', (t) => {
    const { project } = makeProject(t);
    const first = taskService.createPisiTask(project, { task: { title: 'Günlükte' }, target: { diaryDate: '2026-11-21' } }).task;
    const diaryPath = documentStore.getPisiDiaryNodePath(project, '2026-11-21');
    const written = documentStore.ensurePisiFileMetadata(diaryPath).data.content;
    writeNoteContent(diaryPath, '<div>Günün notu</div>');
    assert.deepEqual(taskCodes(project), ['diary-task-section-mismatch']);
    // A section with an id of a task that is not on that day breaks the rule too.
    const other = taskService.createPisiTask(project, { task: { title: 'Başka gün' }, target: { diaryDate: '2026-11-22' } }).task;
    writeNoteContent(
        diaryPath,
        written.replace(`data-pisi-task-ref="${first.id}"></div>`, `data-pisi-task-ref="${first.id}"></div>\n    <div data-pisi-task-ref="${other.id}"></div>`)
    );
    assert.deepEqual(taskCodes(project), ['diary-task-section-mismatch']);
    writeNoteContent(diaryPath, written);
    assert.deepEqual(taskCodes(project), []);
});

test('a project the task service wrote has no task finding', (t) => {
    const { project, note } = makeProject(t);
    const created = taskService.createPisiTask(project, {
        task: { title: 'Notta', dueDate: '2026-11-25', repeat: 'daily' },
        target: { noteId: note.id, notePath: note.path }
    });
    taskService.createPisiTask(project, { task: { title: 'Günlükte' }, target: { diaryDate: '2026-11-21' } });
    taskService.completePisiTaskCommand(project, { taskId: created.task.id });
    assert.deepEqual(taskCodes(project), []);
});

test('orphan block, homeless task, missing note, double reference and broken section are reported', (t) => {
    const { project, note } = makeProject(t);
    const homeless = taskService.createPisiTask(project, { task: { title: 'Evsiz' }, target: { noteId: note.id, notePath: note.path } }).task;
    const doubled = taskService.createPisiTask(project, { task: { title: 'Çift' }, target: { noteId: note.id, notePath: note.path } }).task;
    const diaryTask = taskService.createPisiTask(project, { task: { title: 'Günlük' }, target: { diaryDate: '2026-11-21' } }).task;
    const other = documentStore.createUniquePisiFile(project, '.node');

    // The homeless task's block is taken out by hand; an unknown id goes in; the doubled task is in both notes.
    const content = removePisiTaskBlock(documentStore.ensurePisiFileMetadata(note.path).data.content, homeless.id);
    writeNoteContent(note.path, content + makePisiTaskBlockHtml({ blockId: 'blk_orphan0001', taskId: 'task_unknown0001' }));
    writeNoteContent(other.fullPath, makePisiTaskBlockHtml({ blockId: 'blk_double0001', taskId: doubled.id }));

    // A task whose note is gone, and a diary whose section lost its row.
    const state = taskStore.readPisiTaskStore(project);
    taskStore.writePisiTaskStore(project, state, [
        ...state.tasks,
        { ...state.tasks.find((task) => task.id === diaryTask.id), id: 'task_nonote0001', noteId: 'node_gone', diaryDate: null }
    ]);
    // A diary whose task section is not its last block.
    const diaryPath = documentStore.getPisiDiaryNodePath(project, '2026-11-21');
    writeNoteContent(diaryPath, `${documentStore.ensurePisiFileMetadata(diaryPath).data.content}<div>Bölümden sonra yazılmış</div>`);

    assert.deepEqual(taskCodes(project), [
        'diary-task-section-mismatch',
        'task-block-orphan',
        'task-duplicate-reference',
        'task-homeless',
        'task-note-missing'
    ]);
});

test('a dependency loop, an invalid field and a version 1 task without a place are reported', (t) => {
    const { project } = makeProject(t);
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    const base = { status: 'todo', priority: 3, dueDate: null, diaryDate: '2026-11-21', noteId: null };
    fs.writeFileSync(
        taskStore.getPisiTaskStorePath(project),
        JSON.stringify({
            version: 1,
            tasks: [
                { ...base, id: 'task_loop00001', dependencies: ['task_loop00002'] },
                { ...base, id: 'task_loop00002', dependencies: ['task_loop00001'] },
                { ...base, id: 'task_badfield1', priority: 9, dependencies: [] },
                { ...base, id: 'task_mobile001', title: 'Telefonda', diaryDate: null, source: {}, todoTag: 'todo.3.none', dependencies: [] }
            ]
        })
    );
    assert.deepEqual(taskCodes(project), ['task-dependency-cycle', 'task-field-invalid', 'task-place-missing']);
});

test('an unreadable tasks.json is a critical finding', (t) => {
    const { project } = makeProject(t);
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    fs.writeFileSync(taskStore.getPisiTaskStorePath(project), '{');
    assert.deepEqual(taskCodes(project), ['task-store-invalid']);
});
