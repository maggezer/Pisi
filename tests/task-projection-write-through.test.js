'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { setImmediate } = require('node:timers');

function setup() {
    const listeners = new Map();
    const calls = [];
    const refreshes = [];
    const window = {
        currentProjectFolder: '/project',
        pisiTagsPanelState: { missionIndexComplete: true, missionIndex: [{ id: 'task_1' }] },
        buildPisiTasksFromProjection: (blocks) => blocks,
        pisiProject: {
            quickAddTask: async (project, payload) => {
                calls.push({ project, payload });
                return payload.op === 'sync-index' ? { ok: true } : { ok: false, error: 'Unknown operation' };
            }
        },
        refreshPisiFirstClassTaskStore: async (options) => refreshes.push(options)
    };
    const document = {
        addEventListener: (name, callback) => {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        }
    };
    const source = fs.readFileSync(path.join(__dirname, '../renderer/tags/pisi-source-of-truth.mjs'), 'utf8').replace(/\r\n/g, '\n');
    vm.runInNewContext(source.replace(/^import .*;\n/m, '').replace(/export \{\};/, ''), { window, document });
    const emit = (name, detail = {}) => listeners.get(name)?.forEach((callback) => callback({ detail }));
    return { window, calls, refreshes, emit };
}

test('startup and passive mission refresh never import or query task migration', async () => {
    const { window, calls, emit } = setup();
    emit('DOMContentLoaded');
    emit('pisi:mission-index-updated', { complete: true, reason: 'filesystem' });
    await new Promise(setImmediate);
    assert.equal(calls.length, 0);
    assert.equal(window.ensurePisiLegacyTaskMigration, undefined);
});

test('controlled status and completion changes write directly to the canonical task store', async () => {
    for (const reason of ['status-change', 'completion-change']) {
        const { calls, refreshes, emit } = setup();
        emit('pisi:mission-index-updated', { complete: true, reason });
        await new Promise(setImmediate);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].payload.op, 'sync-index');
        assert.equal(calls[0].payload.allowProjectionWrite, true);
        assert.equal(calls[0].payload.projectionReason, reason);
        assert.equal(calls[0].payload.tasks[0].id, 'task_1');
        assert.equal(calls[0].payload.tasks[0].embeddedTaskId, undefined);
        assert.equal(calls[0].payload.tasks[0].legacyMissionId, undefined);
        assert.equal(refreshes.length, 1);
        assert.equal(refreshes[0], undefined);
    }
});

test('incomplete mission index cannot prune canonical tasks', async () => {
    const { window, calls } = setup();
    window.pisiTagsPanelState.missionIndexComplete = false;
    const result = await window.syncControlledPisiTaskProjection();
    assert.equal(result.incomplete, true);
    assert.equal(calls.length, 0);
});

test('failed writes can retry and do not refresh canonical tasks', async () => {
    const { window, refreshes } = setup();
    window.pisiProject.quickAddTask = async () => ({ ok: false, error: 'Write failed' });
    assert.equal((await window.syncControlledPisiTaskProjection()).ok, false);
    assert.equal(refreshes.length, 0);
    window.pisiProject.quickAddTask = async () => ({ ok: true });
    assert.equal((await window.syncControlledPisiTaskProjection()).ok, true);
    assert.equal(refreshes.length, 1);
});

test('project switch while write is pending does not refresh tasks in the new project', async () => {
    const { window, refreshes } = setup();
    let finish;
    window.pisiProject.quickAddTask = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    const pending = window.syncControlledPisiTaskProjection();
    window.currentProjectFolder = '/other-project';
    finish({ ok: true });
    await pending;
    assert.equal(refreshes.length, 0);
});
