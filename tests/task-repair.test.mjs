// The repairs of Project Integrity's task findings (docs/task-plan.md G7,
// main/functions/task-repair.js): each broken project is repaired through
// integrity's repair entry with the repair's id, and the audit then has no
// task finding left (GV14). An open note is not written: its change comes back
// in `deferred` (GV9). A repair broken half way leaves the project as before
// (GV8).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { listPisiTaskBlocks, makePisiTaskBlockHtml, removePisiTaskBlock } from '../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const originalLoad = Module._load;
Module._load = function pisiTaskRepairElectronStub(request, parent, isMain) {
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
const atomic = modules['main.atomicMutation'];

const NOW = new Date('2026-11-22T09:00:00.000Z');
taskService.setPisiTaskServiceClock(() => NOW);
const TODAY = '2026-11-22';

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-repair-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    globalThis.activeProjectFolder = project;
    return { project, note: makeNote(project), other: makeNote(project) };
}

function makeNote(project) {
    const created = documentStore.createUniquePisiFile(project, '.node');
    return { path: created.fullPath, id: documentStore.ensurePisiFileMetadata(created.fullPath).metadata.id };
}

const contentOf = (filePath) => String(documentStore.ensurePisiFileMetadata(filePath).data.content || '');
const tasksOf = (project) => taskStore.readPisiTaskStore(project).tasks;
const taskFindings = (project) => integrity.auditPisiProjectIntegrity(project).issues.filter((issue) => issue.domain === 'tasks');

function writeNoteContent(filePath, content) {
    const info = documentStore.ensurePisiFileMetadata(filePath);
    globalThis.writePisiDocument(filePath, { ...info.data, content });
}

function createNoteTask(project, note, title, extra = {}) {
    return taskService.createPisiTask(project, { task: { title, ...extra }, target: { noteId: note.id, notePath: note.path } }).task;
}

/** The repair of the one finding with `code`, run inside an atomic mutation as integrity.repair.v1 runs it. */
function repairFinding(project, code, { openPaths = [] } = {}) {
    const findings = taskFindings(project).filter((issue) => issue.code === code);
    assert.equal(findings.length, 1, `${code}: tek bulgu`);
    const repair = findings[0].repair;
    assert.equal(repair?.safety, 'review', `${code}: onarım 'review'`);
    const result = atomic.runPisiAtomicMutation(project, 'integrity.repair.v1', () =>
        integrity.repairPisiProjectIntegrity(project, [repair.id], { openPaths })
    );
    assert.equal(result.ok, true, result.error);
    assert.equal(result.applied, 1);
    return { repair, result };
}

test('a task repair runs only when named; "safe repairs" never run it', (t) => {
    const { project, note } = makeProject(t);
    writeNoteContent(note.path, makePisiTaskBlockHtml({ blockId: 'blk_orphan0001', taskId: 'task_unknown0001' }));
    const result = integrity.repairPisiProjectIntegrity(project);
    assert.equal(result.applied, 0);
    assert.match(contentOf(note.path), /task_unknown0001/);
});

test('an orphan block whose task is nowhere is taken out of the note', (t) => {
    const { project, note } = makeProject(t);
    const kept = createNoteTask(project, note, 'Kalan');
    writeNoteContent(note.path, contentOf(note.path) + makePisiTaskBlockHtml({ blockId: 'blk_orphan0001', taskId: 'task_unknown0001' }));
    const { repair } = repairFinding(project, 'task-block-orphan');
    assert.equal(repair.action, 'task-remove-orphan-block');
    assert.deepEqual(
        listPisiTaskBlocks(contentOf(note.path)).map((block) => block.taskId),
        [kept.id]
    );
    assert.deepEqual(taskFindings(project), []);
});

test('an orphan block whose task is in the Trash brings the task back into that note', (t) => {
    const { project, note, other } = makeProject(t);
    const task = createNoteTask(project, note, 'Geri gelen', { dueDate: '2026-11-30' });
    const deleted = taskService.deletePisiTask(project, { taskId: task.id, notePath: note.path });
    assert.equal(deleted.ok, true);
    // The block shows up again in another note, by a path that skipped the note save (e.g. an outside edit).
    writeNoteContent(other.path, makePisiTaskBlockHtml({ blockId: 'blk_back0001', taskId: task.id }));
    const { repair } = repairFinding(project, 'task-block-orphan');
    assert.equal(repair.action, 'task-restore-orphan');
    const restored = tasksOf(project).find((item) => item.id === task.id);
    assert.equal(restored.noteId, other.id);
    assert.equal(restored.title, 'Geri gelen');
    // The task is due on the 30th again: that day's diary section names it.
    const section = readPisiDiaryTaskSection(contentOf(documentStore.getPisiDiaryNodePath(project, '2026-11-30')));
    assert.deepEqual(section.taskIds, [task.id]);
    assert.deepEqual(taskFindings(project), []);
});

test('a homeless task gets its block at the end of its note', (t) => {
    const { project, note } = makeProject(t);
    const first = createNoteTask(project, note, 'Birinci');
    const homeless = createNoteTask(project, note, 'Evsiz');
    writeNoteContent(
        note.path,
        `${removePisiTaskBlock(contentOf(note.path), homeless.id)}<div class="pisi-editor-block" data-pisi-block-id="blk_last0001">Son</div>`
    );
    repairFinding(project, 'task-homeless');
    assert.deepEqual(
        listPisiTaskBlocks(contentOf(note.path)).map((block) => block.taskId),
        [first.id, homeless.id]
    );
    assert.ok(contentOf(note.path).endsWith('</div>'));
    assert.deepEqual(taskFindings(project), []);
});

test('a homeless task of an open note comes back in deferred; the note is not written (GV9)', (t) => {
    const { project, note } = makeProject(t);
    const homeless = createNoteTask(project, note, 'Evsiz');
    writeNoteContent(note.path, removePisiTaskBlock(contentOf(note.path), homeless.id));
    const before = fs.readFileSync(note.path, 'utf8');
    const { result } = repairFinding(project, 'task-homeless', { openPaths: [note.path] });
    assert.equal(fs.readFileSync(note.path, 'utf8'), before);
    assert.equal(result.deferred.notes.length, 1);
    assert.equal(result.deferred.notes[0].op, 'insert');
    assert.equal(result.deferred.notes[0].taskId, homeless.id);
});

test('a task whose only block is in another note moves there; no second block is offered', (t) => {
    const { project, note, other } = makeProject(t);
    const task = createNoteTask(project, note, 'Taşınan');
    writeNoteContent(note.path, removePisiTaskBlock(contentOf(note.path), task.id));
    writeNoteContent(other.path, makePisiTaskBlockHtml({ blockId: 'blk_moved0001', taskId: task.id }));
    const homeless = taskFindings(project).find((issue) => issue.code === 'task-homeless');
    assert.equal(homeless.repair, null);
    repairFinding(project, 'task-block-misplaced');
    assert.equal(tasksOf(project).find((item) => item.id === task.id).noteId, other.id);
    assert.deepEqual(taskFindings(project), []);
});

test('a task whose note is gone lives in today’s diary, which is created', (t) => {
    const { project, note } = makeProject(t);
    const task = createNoteTask(project, note, 'Notsuz');
    fs.rmSync(note.path);
    repairFinding(project, 'task-note-missing');
    const record = tasksOf(project).find((item) => item.id === task.id);
    assert.equal(record.noteId, null);
    assert.equal(record.diaryDate, TODAY);
    const diaryPath = documentStore.getPisiDiaryNodePath(project, TODAY);
    assert.deepEqual(readPisiDiaryTaskSection(contentOf(diaryPath)).taskIds, [task.id]);
    assert.deepEqual(taskFindings(project), []);
});

test('a double reference keeps the block of the task’s note and makes the other one a copy', (t) => {
    const { project, note, other } = makeProject(t);
    const task = createNoteTask(project, note, 'Çift', { priority: 5, tags: ['iş'] });
    writeNoteContent(
        other.path,
        `<div class="pisi-editor-block" data-pisi-block-id="blk_first0001">Önce</div>${makePisiTaskBlockHtml({ blockId: 'blk_double0001', taskId: task.id })}`
    );
    repairFinding(project, 'task-duplicate-reference');
    const copyBlock = listPisiTaskBlocks(contentOf(other.path));
    assert.equal(copyBlock.length, 1);
    assert.equal(copyBlock[0].blockId, 'blk_double0001', 'blok yerinde kalır');
    assert.notEqual(copyBlock[0].taskId, task.id);
    const copy = tasksOf(project).find((item) => item.id === copyBlock[0].taskId);
    assert.equal(copy.noteId, other.id);
    assert.equal(copy.title, 'Çift');
    assert.equal(copy.priority, 5);
    assert.deepEqual(copy.tags, ['iş']);
    assert.deepEqual(
        listPisiTaskBlocks(contentOf(note.path)).map((block) => block.taskId),
        [task.id]
    );
    assert.deepEqual(taskFindings(project), []);
});

test('a dependency loop loses the dependency that closes it; a missing dependency goes', (t) => {
    const { project, note } = makeProject(t);
    const a = createNoteTask(project, note, 'A');
    const b = createNoteTask(project, note, 'B');
    const state = taskStore.readPisiTaskStore(project);
    taskStore.writePisiTaskStore(
        project,
        state,
        state.tasks.map((task) =>
            task.id === a.id ? { ...task, dependencies: [b.id] } : task.id === b.id ? { ...task, dependencies: [a.id, 'task_missing0001'] } : task
        )
    );
    const before = fs.readFileSync(note.path, 'utf8');
    repairFinding(project, 'task-dependency-missing');
    repairFinding(project, 'task-dependency-cycle');
    const deps = Object.fromEntries(tasksOf(project).map((task) => [task.id, task.dependencies]));
    assert.equal(deps[a.id].length + deps[b.id].length, 1, 'döngüden tek bağımlılık kalkar');
    assert.equal(fs.readFileSync(note.path, 'utf8'), before, 'alan onarımı not yazmaz (GV5)');
    assert.deepEqual(taskFindings(project), []);
});

test('a diary section that breaks the rule is made again from tasks.json', (t) => {
    const { project } = makeProject(t);
    const task = taskService.createPisiTask(project, { task: { title: 'Günlükte' }, target: { diaryDate: '2026-11-21' } }).task;
    const diaryPath = documentStore.getPisiDiaryNodePath(project, '2026-11-21');
    const written = `${contentOf(diaryPath)}<div class="pisi-editor-block" data-pisi-block-id="blk_after0001">Bölümden sonra</div>`;
    writeNoteContent(
        diaryPath,
        written.replace(`data-pisi-task-ref="${task.id}"`, `data-pisi-task-ref="${task.id}"></div><div data-pisi-task-ref="task_ghost00001"`)
    );
    repairFinding(project, 'diary-task-section-mismatch');
    const section = readPisiDiaryTaskSection(contentOf(diaryPath));
    assert.equal(section.count, 1);
    assert.equal(section.last, true);
    assert.deepEqual(section.taskIds, [task.id]);
    assert.match(contentOf(diaryPath), /Bölümden sonra/, 'öbür bloklar kalır');
    assert.deepEqual(taskFindings(project), []);
});

test('a repair broken half way leaves tasks.json and the notes as they were (GV8)', (t) => {
    const { project, note, other } = makeProject(t);
    const task = createNoteTask(project, note, 'Çift');
    writeNoteContent(other.path, makePisiTaskBlockHtml({ blockId: 'blk_double0001', taskId: task.id }));
    const storeBefore = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    const otherBefore = fs.readFileSync(other.path, 'utf8');
    const repair = taskFindings(project).find((issue) => issue.code === 'task-duplicate-reference').repair;
    const originalWrite = globalThis.saveNodeContentWithHistory;
    globalThis.saveNodeContentWithHistory = () => {
        throw new Error('enjekte edilen hata');
    };
    try {
        assert.throws(() => atomic.runPisiAtomicMutation(project, 'integrity.repair.v1', () => integrity.repairPisiProjectIntegrity(project, [repair.id])));
    } finally {
        globalThis.saveNodeContentWithHistory = originalWrite;
    }
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), storeBefore);
    assert.equal(fs.readFileSync(other.path, 'utf8'), otherBefore);
});
