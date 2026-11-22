// Behavior tests of task tags and note links in task titles on the desktop
// (docs/task-plan.md G6): the real main-process stores and the domain
// dispatcher run against a temporary project. A tag change writes tasks.json
// only (GV5); a note rename rewrites the notes' links and the task titles'
// [[…]] text in one atomic mutation (GV8).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
await import('../main/functions/domain-command-query.js');
await import('../main/functions/wiki-link-domain.js');
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const taskService = modules['main.taskService'];
const domain = modules['main.domainCommandQuery'];

taskService.setPisiTaskServiceClock(() => new Date(2026, 10, 22, 9, 0));

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-links-'));
    t.after(() => {
        taskService.setPisiTaskServiceFaultHook(null);
        fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    globalThis.activeProjectFolder = project;
    return project;
}

function makeNote(project, title, content = '') {
    const created = documentStore.createUniquePisiFile(project, '.node');
    assert.equal(created.ok, true, created.error);
    const renamed = documentStore.renamePisiFile(created.fullPath, title);
    assert.equal(renamed.ok, true, renamed.error);
    const data = JSON.parse(fs.readFileSync(renamed.fullPath, 'utf8'));
    fs.writeFileSync(renamed.fullPath, JSON.stringify({ ...data, content }), 'utf8');
    return { path: renamed.fullPath, id: data.pisi.id };
}

const storedTasks = (project) => JSON.parse(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8')).tasks;
const storedTask = (project, id) => storedTasks(project).find((task) => task.id === id);
const readContent = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')).content;

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

function createTask(project, task, target) {
    const result = taskService.createPisiTask(project, { task, target });
    assert.equal(result.ok, true, result.error);
    return result.task;
}

test('tags: created and changed through the task commands, tasks.json only (GV1, GV5)', (t) => {
    const project = makeProject(t);
    const note = makeNote(project, 'Plan');
    const task = createTask(project, { title: 'Rapor', tags: ['#proje', 'Proje', 'acil'] }, { noteId: note.id, notePath: note.path });
    assert.deepEqual(task.tags, ['proje', 'acil'], 'tags are stored without # and without case duplicates');
    assert.deepEqual(storedTask(project, task.id).tags, ['proje', 'acil']);

    const { result, counts } = countNodeIo(() => taskService.updatePisiTask(project, { taskId: task.id, patch: { tags: ['acil', 'iş.ön'] } }));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(counts, { reads: 0, writes: 0 }, 'a tag change reads and writes no note');
    assert.deepEqual(storedTask(project, task.id).tags, ['acil', 'iş.ön']);

    const invalid = taskService.updatePisiTask(project, { taskId: task.id, patch: { tags: ['iki kelime'] } });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'TASK_INVALID');
    const tooMany = taskService.updatePisiTask(project, { taskId: task.id, patch: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } });
    assert.equal(tooMany.ok, false);
    assert.deepEqual(tooMany.errors, [{ field: 'tags', code: 'too-many' }]);
    assert.deepEqual(storedTask(project, task.id).tags, ['acil', 'iş.ön'], 'a refused change leaves the record');
});

test('rename: notes and task titles follow the new title in the same command; impact counts both', async (t) => {
    const project = makeProject(t);
    const target = makeNote(project, 'Hedef');
    const source = makeNote(project, 'Kaynak', '<div>Bak: [[Hedef]]</div>');
    const linked = createTask(project, { title: 'Oku [[hedef]] ve [[Hedef#blk_a1]]' }, { diaryDate: '2026-11-22' });
    const other = createTask(project, { title: 'Başka [[Kaynak]]' }, { diaryDate: '2026-11-22' });

    const impact = await domain.executePisiDomainQuery('links.rename-impact.v1', { nodePath: target.path, newTitle: 'Yeni Hedef' });
    assert.equal(impact.ok, true, impact.error);
    assert.deepEqual([impact.notes, impact.tasks], [1, 1]);

    const events = [];
    const stop = taskService.onPisiTasksChanged((event) => events.push(event));
    t.after(stop);
    const renamed = await domain.executePisiDomainCommand('project.item.rename.v1', { oldPath: target.path, newBaseName: 'Yeni Hedef' });
    assert.equal(renamed.ok, true, renamed.error);
    assert.equal(renamed.wikiLinks.tasks, 1);
    assert.deepEqual(renamed.wikiLinks.taskIds, [linked.id]);
    assert.equal(readContent(source.path), '<div>Bak: [[Yeni Hedef]]</div>');
    assert.equal(storedTask(project, linked.id).title, 'Oku [[Yeni Hedef]] ve [[Yeni Hedef#blk_a1]]');
    assert.equal(storedTask(project, other.id).title, 'Başka [[Kaynak]]', 'a title without the link stays');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
        events.map((event) => event.changedIds),
        [[linked.id]],
        'the renderer hears of the changed title'
    );
});

test('rename: a failure while writing the titles rolls the notes, the file and tasks.json back (GV8)', async (t) => {
    const project = makeProject(t);
    const target = makeNote(project, 'Hedef');
    const source = makeNote(project, 'Kaynak', '<div>[[Hedef]]</div>');
    const linked = createTask(project, { title: '[[Hedef]] hazırla' }, { diaryDate: '2026-11-22' });
    const tasksBefore = fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8');
    taskService.setPisiTaskServiceFaultHook((point) => {
        if (point === 'after-title-links-write') throw new Error('simulated crash');
    });
    const renamed = await domain.executePisiDomainCommand('project.item.rename.v1', { oldPath: target.path, newBaseName: 'Yeni' });
    taskService.setPisiTaskServiceFaultHook(null);
    assert.equal(renamed.ok, false);
    assert.equal(renamed.code, 'WIKI_LINK_REWRITE_FAILED');
    assert.equal(fs.existsSync(target.path), true, 'the note keeps its old file');
    assert.equal(readContent(source.path), '<div>[[Hedef]]</div>');
    assert.equal(fs.readFileSync(taskStore.getPisiTaskStorePath(project), 'utf8'), tasksBefore);
    assert.equal(storedTask(project, linked.id).title, '[[Hedef]] hazırla');
});

test('rename: with another note of the old title the [[…]] text is left alone, as in notes', async (t) => {
    const project = makeProject(t);
    const target = makeNote(project, 'Hedef');
    fs.mkdirSync(path.join(project, 'alt'));
    const twin = documentStore.createUniquePisiFile(path.join(project, 'alt'), '.node');
    assert.equal(documentStore.renamePisiFile(twin.fullPath, 'Hedef').ok, true);
    const linked = createTask(project, { title: '[[Hedef]] hazırla' }, { diaryDate: '2026-11-22' });

    const impact = await domain.executePisiDomainQuery('links.rename-impact.v1', { nodePath: target.path, newTitle: 'Yeni' });
    assert.equal(impact.tasks, 0);
    const renamed = await domain.executePisiDomainCommand('project.item.rename.v1', { oldPath: target.path, newBaseName: 'Yeni' });
    assert.equal(renamed.ok, true, renamed.error);
    assert.equal(storedTask(project, linked.id).title, '[[Hedef]] hazırla');
});

test('rename: a title the new name would push past 500 characters is not cut', (t) => {
    const project = makeProject(t);
    const long = `${'a'.repeat(490)} [[X]]`;
    const task = createTask(project, { title: long }, { diaryDate: '2026-11-22' });
    const result = taskService.renamePisiTaskTitleLinks(project, { oldTitle: 'X', newTitle: 'Çok daha uzun bir başlık' });
    assert.deepEqual([result.ok, result.tasks], [true, 0]);
    assert.equal(storedTask(project, task.id).title, long);
});
