import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
    getPisiEditorRestoreGeneration,
    isPisiEditorRestorePending,
    isPisiEditorWriteBlocked,
    restorePisiEditorDocument,
    runPisiEditorWrite
} from '../renderer/editor/pisi-editor-restore.mjs';
const require = createRequire(import.meta.url);
const { extractFunction } = require('./source-helper.js');
const root = path.resolve(import.meta.dirname, '..');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

function setup(t, { modal = false } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-restore-ui-'));
    const nodePath = path.join(directory, 'note.node');
    const write = (content) => fs.writeFileSync(nodePath, JSON.stringify({ pisi: { title: 'Note', id: 'node_restore' }, content }));
    const read = () => JSON.parse(fs.readFileSync(nodePath, 'utf8'));
    write('disk before restore');
    const editor = {
        innerHTML: 'unsaved text',
        textContent: 'unsaved text',
        inert: false,
        setAttribute() {},
        getAttribute: () => 'true',
        removeAttribute() {},
        before() {}
    };
    const title = { value: 'Note', inert: false };
    const modalEditor = { ...editor };
    const modalTitle = { ...title };
    const center = { path: nodePath, dirty: true, revision: 2, metadata: { title: 'Note' }, item: {}, assetRecoveryWarning: 'old missing asset' };
    const modalNode = { path: nodePath, dirty: true, revision: 1, metadata: {}, box: { querySelector: () => null } };
    let schedules = 0;
    const oldWindow = globalThis.window,
        oldDocument = globalThis.document;
    globalThis.window = {
        activeCenterNode: center,
        activeModalNode: modal ? modalNode : null,
        centerNodeSaveTimer: null,
        samePisiWorkspacePath: (a, b) => a === b,
        getCenterNodeEditorElements: () => ({ contentEditor: editor, titleInput: title }),
        setPisiEditorContent: (target, content) => {
            target.innerHTML = content;
            target.textContent = content;
        },
        dispatchPisiActiveNodeChanged: () => {},
        refreshPisiTagsPanelSoon: () => {},
        scheduleCenterNodeEditorSave: () => {
            schedules += 1;
        },
        pisiProject: {
            getPisiDocument: async () => {
                const data = read();
                return { ok: true, metadata: data.pisi, data };
            }
        }
    };
    globalThis.document = {
        getElementById: (id) => (id === 'node-modal-content' ? modalEditor : modalTitle),
        querySelector: () => null,
        createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} })
    };
    t.after(() => {
        clearTimeout(window.centerNodeSaveTimer);
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return { nodePath, editor, title, center, modalEditor, modalNode, read, write, schedules: () => schedules };
}

test('history restore replaces center and modal copies; next save preserves restored content', async (t) => {
    const h = setup(t, { modal: true });
    const result = await restorePisiEditorDocument(h.nodePath, async () => {
        h.write('restored version');
        return { ok: true };
    });
    assert.equal(result.ok, true);
    assert.equal(h.editor.innerHTML, 'restored version');
    assert.equal(h.modalEditor.innerHTML, 'restored version');
    assert.equal(h.center.dirty, false);
    assert.equal(h.modalNode.dirty, false);
    assert.equal(h.center.assetRecoveryWarning, '');
    assert.equal(h.editor.inert, false);
    await runPisiEditorWrite(() => h.write(h.editor.innerHTML));
    assert.equal(h.read().content, 'restored version');
});

test('restore waits for an in-flight write and cancels the debounce and queued writes', async (t) => {
    const h = setup(t);
    const started = deferred(),
        release = deferred();
    const oldWrite = runPisiEditorWrite(async () => {
        started.resolve();
        await release.promise;
        h.write('old in-flight content');
    });
    await started.promise;
    let timerFired = false;
    window.centerNodeSaveTimer = setTimeout(() => {
        timerFired = true;
    }, 5);
    let restoreStarted = false;
    const restoration = restorePisiEditorDocument(h.nodePath, async () => {
        restoreStarted = true;
        h.write('restored');
        return { ok: true };
    });
    assert.equal(isPisiEditorRestorePending(), true);
    assert.equal(h.editor.inert, true);
    assert.equal(await runPisiEditorWrite(() => h.write('forbidden')), false);
    assert.equal(restoreStarted, false);
    release.resolve();
    await oldWrite;
    assert.equal((await restoration).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(timerFired, false);
    assert.equal(h.read().content, 'restored');
    assert.equal(h.editor.innerHTML, 'restored');
});

test('a write queued but not started before restore cannot run afterward', async (t) => {
    const h = setup(t);
    let wrote = false;
    const queued = runPisiEditorWrite(() => {
        wrote = true;
    });
    const restoration = restorePisiEditorDocument(h.nodePath, async () => {
        h.write('restored');
        return { ok: true };
    });
    assert.equal(await queued, false);
    await restoration;
    assert.equal(wrote, false);
});

test('backup restore does not pre-save dirty DOM and rotate the selected backup', async (t) => {
    const h = setup(t);
    const backup = 'selected backup';
    const result = await restorePisiEditorDocument(h.nodePath, async () => {
        assert.equal(h.read().content, 'disk before restore');
        h.write(backup);
        return { ok: true, targetPath: h.nodePath };
    });
    assert.equal(result.ok, true);
    assert.equal(h.editor.innerHTML, backup);
    assert.equal(h.schedules(), 0);
});

test('failed restore retains unsaved edits and resumes their save schedule', async (t) => {
    const h = setup(t);
    h.center.assetRecoveryWarning = '';
    const result = await restorePisiEditorDocument(h.nodePath, async () => ({ ok: false, error: 'disk failure' }));
    assert.equal(result.ok, false);
    assert.equal(h.editor.innerHTML, 'unsaved text');
    assert.equal(h.center.dirty, true);
    assert.equal(h.editor.inert, false);
    assert.equal(h.schedules(), 1);
    assert.equal(isPisiEditorRestorePending(), false);
});

test('failed post-restore read blocks stale writes until a successful retry reloads the document', async (t) => {
    const h = setup(t);
    const getDocument = window.pisiProject.getPisiDocument;
    window.pisiProject.getPisiDocument = async () => ({ ok: false, error: 'read failure' });
    const result = await restorePisiEditorDocument(h.nodePath, async () => {
        h.write('restored');
        return { ok: true };
    });
    assert.equal(result.restored, true);
    assert.equal(result.ok, false);
    assert.equal(isPisiEditorWriteBlocked(), true);
    assert.equal(await runPisiEditorWrite(() => h.write(h.editor.innerHTML)), false);
    assert.equal(h.read().content, 'restored');
    window.pisiProject.getPisiDocument = getDocument;
    assert.equal((await restorePisiEditorDocument(h.nodePath, async () => ({ ok: true }))).ok, true);
    assert.equal(isPisiEditorWriteBlocked(), false);
});

test('duplicate restore is rejected and pre-restore navigation generations become obsolete', async (t) => {
    const h = setup(t);
    const release = deferred();
    const generation = getPisiEditorRestoreGeneration();
    const pending = restorePisiEditorDocument(h.nodePath, async () => {
        await release.promise;
        return { ok: true };
    });
    assert.notEqual(getPisiEditorRestoreGeneration(), generation);
    let secondRan = false;
    assert.equal(
        (
            await restorePisiEditorDocument(h.nodePath, async () => {
                secondRan = true;
                return { ok: true };
            })
        ).ok,
        false
    );
    assert.equal(secondRan, false);
    release.resolve();
    await pending;
});

test('actual center save queue drains before restore without a self-wait or stale write', async (t) => {
    const h = setup(t);
    const release = deferred(),
        started = deferred();
    h.center.assetRecoveryWarning = '';
    const context = {
        activeCenterNode: h.center,
        isPisiEditorRestorePending,
        getPisiNodeRecoveryWarning: () => '',
        isPisiEditorWriteBlocked,
        runPisiEditorWrite,
        performCurrentCenterNodeEditorSave: async () => {
            started.resolve();
            await release.promise;
            h.write('old save');
            return true;
        }
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(root, 'renderer/editor/pisi-node-editor.mjs'), 'utf8');
    vm.runInContext('let pisiCenterSaveTail = Promise.resolve(true);\n' + extractFunction(source, 'saveCurrentCenterNodeEditor'), context);
    const first = context.saveCurrentCenterNodeEditor();
    await started.promise;
    const queued = context.saveCurrentCenterNodeEditor();
    const restoring = restorePisiEditorDocument(h.nodePath, async () => {
        h.write('restored');
        return { ok: true };
    });
    release.resolve();
    await first;
    await queued;
    await restoring;
    assert.equal(h.read().content, 'restored');
});

test('both restore buttons use the coordinated editor reload instead of the no-argument filesystem hook', () => {
    const source = fs.readFileSync(path.join(root, 'renderer/portability/pisi-portability-panel.mjs'), 'utf8');
    assert.match(source, /restorePisiEditorDocument\(nodePath,/);
    assert.match(source, /restorePisiEditorDocument\(backup.targetPath,/);
    assert.doesNotMatch(source, /reloadPisiWorkspaceAfterExternalChange/);
});
