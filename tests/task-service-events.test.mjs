// The task event (`pisi:tasks-changed`, docs/task-plan.md §3.4) of a command
// that runs inside a larger atomic mutation goes only once that mutation is
// committed; a mutation that rolls back after the task write sends nothing,
// so the renderer's store never shows a change the project does not have
// (pisi-error.md §5h, G7: a rename rolled back after the titles were written).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadPisiMainStores } = require('./main-store-harness.cjs');
const modules = loadPisiMainStores();
const taskService = modules['main.taskService'];
const atomic = modules['main.atomicMutation'];

function makeProject(t) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-events-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    globalThis.activeProjectFolder = project;
    const task = taskService.createPisiTask(project, { task: { title: 'Başlık' }, target: { diaryDate: '2026-11-22' } }).task;
    const events = [];
    const stop = taskService.onPisiTasksChanged((event) => events.push(event));
    t.after(stop);
    return { project, task, events };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('a committed mutation sends the event after it ends', async (t) => {
    const { project, task, events } = makeProject(t);
    const result = atomic.runPisiAtomicMutation(project, 'test.commit', () => {
        const updated = taskService.updatePisiTask(project, { taskId: task.id, patch: { title: 'Yeni' } });
        assert.equal(events.length, 0, 'not inside the mutation');
        return updated;
    });
    assert.equal(result.ok, true);
    await nextTurn();
    assert.deepEqual(
        events.map((event) => event.changedIds),
        [[task.id]]
    );
});

test('a mutation that fails after the task write sends no event', async (t) => {
    const { project, task, events } = makeProject(t);
    const result = atomic.runPisiAtomicMutation(project, 'test.rollback', () => {
        taskService.updatePisiTask(project, { taskId: task.id, patch: { title: 'Yeni' } });
        return { ok: false, code: 'LATER_STEP_FAILED', error: 'sonraki adım yazılamadı' };
    });
    assert.equal(result.ok, false);
    assert.equal(result.atomic.rolledBack, true);
    await nextTurn();
    assert.deepEqual(events, []);
    assert.equal(taskService.listPisiTasks(project).tasks[0].title, 'Başlık');
});

test('a mutation that throws after the task write sends no event', async (t) => {
    const { project, task, events } = makeProject(t);
    assert.throws(() =>
        atomic.runPisiAtomicMutation(project, 'test.throw', () => {
            taskService.updatePisiTask(project, { taskId: task.id, patch: { title: 'Yeni' } });
            throw new Error('dosya hareketi sonrası hata');
        })
    );
    await nextTurn();
    assert.deepEqual(events, []);
});
