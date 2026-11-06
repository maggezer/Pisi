import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');
const source = fs.readFileSync(new URL('../renderer/editor/pisi-node-editor.mjs', import.meta.url), 'utf8');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
function setup() {
    const center = { path: 'note.node', metadata: { title: 'Note' }, dirty: true, revision: 1, item: {} };
    const centerEditor = { innerHTML: 'center before' },
        modalEditor = { innerHTML: 'modal latest' };
    const centerTitle = { value: 'Note' },
        modalTitle = { value: 'Note' };
    const elements = { contentEditor: centerEditor, titleInput: centerTitle };
    const writes = [],
        disk = new Map();
    const c = {
        activeCenterNode: center,
        activeModalNode: null,
        activeMapPath: null,
        centerNodeSaveTimer: null,
        mapSaveTimer: null,
        mapCameraSaveTimer: null,
        window: {
            pisiProject: {
                saveNodeContent: async (path, content) => {
                    writes.push({ path, content });
                    disk.set(path, content);
                    return { ok: true, metadata: { title: 'Note' } };
                }
            }
        },
        document: {
            getElementById: (id) => (id === 'node-modal-content' ? modalEditor : id === 'node-modal-title' ? modalTitle : { classList: { remove() {} } })
        },
        getCenterNodeEditorElements: () => elements,
        getPisiEditorContent: (e) => e.innerHTML,
        setPisiEditorContent: (e, content) => {
            e.innerHTML = content;
        },
        samePisiWorkspacePath: (a, b) => a === b,
        isPisiEditorRestorePending: () => false,
        isPisiEditorWriteBlocked: () => false,
        getPisiNodeRecoveryWarning: () => '',
        protectPisiEditorRecovery: () => '',
        runPisiEditorWrite: (fn) => Promise.resolve().then(fn),
        dispatchPisiActiveNodeChanged() {},
        suppressNextFileSystemRefresh() {},
        refreshPisiTagsPanelSoon() {},
        closePisiTagMenu() {},
        animateMapBox() {},
        beginPisiModalNavigation() {},
        updateTreeItemAfterRename() {},
        updateOpenMapNodeAfterRename() {},
        updatePisiOpenTabAfterRename() {},
        clearTimeout,
        console,
        alert: (message) => {
            throw new Error(message);
        }
    };
    // The renderer rename path; link review is covered by the wiki link tests.
    c.renamePisiItemWithLinkReview = (oldPath, title) => c.window.pisiProject.renamePisiFile(oldPath, title);
    vm.createContext(c);
    const names = [
        'saveCurrentCenterNodeEditor',
        'performCurrentCenterNodeEditorSave',
        'closeNodeModalAndSave',
        'performNodeModalCloseAndSave',
        'flushPisiPendingSaves'
    ];
    vm.runInContext(
        'let pisiCenterSaveTail = Promise.resolve(true);\n' +
            names.map((n) => (source.includes('async function ' + n + '(') ? 'async ' : '') + extractFunction(source, n)).join('\n'),
        c
    );
    const openModal = () => {
        c.activeCenterNode.dirty = false;
        c.activeModalNode = { path: center.path, metadata: { title: 'Note' }, revision: 1, dirty: true, box: { dataset: {}, querySelector: () => null } };
        return c.activeModalNode;
    };
    return { c, center, centerEditor, modalEditor, centerTitle, modalTitle, writes, disk, openModal };
}
test('typing during a save cannot report the editor fully saved to navigation or close', async () => {
    const h = setup(),
        started = deferred(),
        release = deferred();
    h.c.window.pisiProject.saveNodeContent = async () => {
        started.resolve();
        await release.promise;
        return { ok: true, metadata: { title: 'Note' } };
    };
    const pending = h.c.saveCurrentCenterNodeEditor();
    await started.promise;
    h.center.revision++;
    h.centerEditor.innerHTML = 'new unsaved typing';
    release.resolve();
    assert.equal(await pending, false);
    assert.equal(h.center.dirty, true);
    assert.equal(h.centerEditor.innerHTML, 'new unsaved typing');
});
test('queued saves capture the latest revision without overlapping disk writes', async () => {
    const h = setup(),
        started = deferred(),
        release = deferred();
    const contents = [];
    h.c.window.pisiProject.saveNodeContent = async (_path, content) => {
        contents.push(content);
        if (contents.length === 1) {
            started.resolve();
            await release.promise;
        }
        return { ok: true, metadata: { title: 'Note' } };
    };
    const first = h.c.saveCurrentCenterNodeEditor();
    await started.promise;
    h.center.revision++;
    h.centerEditor.innerHTML = 'latest';
    const second = h.c.saveCurrentCenterNodeEditor();
    assert.deepEqual(contents, ['center before']);
    release.resolve();
    await first;
    assert.equal(await second, true);
    assert.deepEqual(contents, ['center before', 'latest']);
    assert.equal(h.center.dirty, false);
});
test('center autosave cannot overwrite the same note while its modal owns editing', async () => {
    const h = setup();
    h.openModal();
    await h.c.saveCurrentCenterNodeEditor();
    assert.equal(h.writes.length, 0);
});
test('modal save refreshes the center copy before application flush can save it again', async () => {
    const h = setup();
    h.openModal();
    assert.equal(await h.c.flushPisiPendingSaves(), true);
    assert.equal(h.disk.get('note.node'), 'modal latest');
    assert.equal(h.centerEditor.innerHTML, 'modal latest');
    assert.equal(h.c.activeModalNode, null);
});

test('failed modal content save after rename cannot recreate the old path through center autosave', async () => {
    const h = setup();
    h.openModal();
    h.modalTitle.value = 'Renamed';
    h.c.window.pisiProject.renamePisiFile = async () => ({ ok: true, fullPath: 'renamed.node', fileName: 'renamed.node', metadata: { title: 'Renamed' } });
    h.c.window.pisiProject.saveNodeContent = async (path) => {
        h.writes.push(path);
        return { ok: false, error: 'write failed' };
    };
    h.c.alert = () => {};
    assert.equal(await h.c.closeNodeModalAndSave(), false);
    assert.equal(h.center.path, 'renamed.node');
    assert.equal(h.c.activeModalNode.path, 'renamed.node');
    await h.c.saveCurrentCenterNodeEditor();
    assert.deepEqual(h.writes, ['renamed.node']);
});
