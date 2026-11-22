// The project generator's version 2 tasks (scripts/generate-project-fixture.mjs
// `taskModel: 2`, docs/task-plan.md G7): records in the shared normal form,
// task blocks in their notes, the diary of every task day with the section
// the rule gives, and no Project Integrity finding (GV14, GV15).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { generatePisiProjectFixture } from '../scripts/generate-project-fixture.mjs';
import { isSamePisiTask, readPisiTask } from '../shared/task-model.mjs';
import { listPisiTaskBlocks } from '../shared/task-blocks.mjs';
import { listPisiDiaryTaskIds, readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const originalLoad = Module._load;
Module._load = function pisiFixtureElectronStub(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir(), isPackaged: false, on() {} }, utilityProcess: {}, BrowserWindow: class {} };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    require('../main/functions/project-integrity.js');
} finally {
    Module._load = originalLoad;
}
const integrity = modules['main.projectIntegrity'];

test('sürüm 2 görevli proje: bloklar notlarda, bölümler günlüklerde; Integrity temiz', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-fixture-v2-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const result = await generatePisiProjectFixture(root, {
        notes: 40,
        perMap: 20,
        tasks: 300,
        diaryDays: 3,
        today: '2026-11-14',
        taskModel: 2,
        heavyNoteTasks: 25
    });
    assert.equal(result.taskModel, 2);
    assert.equal(result.tasks, 325);

    const store = JSON.parse(fs.readFileSync(path.join(root, '.pisi', 'tasks.json'), 'utf8'));
    assert.equal(store.version, 2);
    for (const task of store.tasks) assert.ok(isSamePisiTask(readPisiTask(task), task), `normal biçim: ${task.id}`);
    assert.ok(
        store.tasks.every((task) => Boolean(task.noteId) !== Boolean(task.diaryDate)),
        'her görevin tek yeri var'
    );
    assert.ok(store.tasks.some((task) => task.repeat === 'daily' && task.completions.length === 3));

    // Every note task has its block in its note; the first note holds the extra tasks.
    const blocksByNote = new Map();
    for (const notePath of result.notePaths) {
        const data = JSON.parse(fs.readFileSync(notePath, 'utf8'));
        blocksByNote.set(
            data.pisi.id,
            listPisiTaskBlocks(data.content).map((block) => block.taskId)
        );
    }
    for (const task of store.tasks.filter((item) => item.noteId)) assert.ok(blocksByNote.get(task.noteId).includes(task.id), task.id);
    const firstNoteId = JSON.parse(fs.readFileSync(result.notePaths[0], 'utf8')).pisi.id;
    assert.ok(blocksByNote.get(firstNoteId).length >= 25);

    // Each diary's section is the one the rule gives for its day.
    const diaryFiles = fs.readdirSync(path.join(root, 'diary')).filter((name) => name.endsWith('.node'));
    assert.equal(diaryFiles.length, result.diaries);
    for (const name of diaryFiles) {
        const day = name.replace('.node', '');
        const section = readPisiDiaryTaskSection(JSON.parse(fs.readFileSync(path.join(root, 'diary', name), 'utf8')).content);
        assert.deepEqual(section.taskIds, listPisiDiaryTaskIds(day, store.tasks), day);
    }

    const report = integrity.auditPisiProjectIntegrity(root);
    assert.deepEqual(
        report.issues.filter((issue) => issue.domain === 'tasks').map((issue) => `${issue.code} ${issue.entityId || issue.path}`),
        []
    );
});
