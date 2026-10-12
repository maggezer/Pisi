import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as navigation from '../renderer/editor/pisi-editor-navigation.mjs';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');
const source = (file) => fs.readFileSync(new URL('../renderer/' + file, import.meta.url), 'utf8');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const nodeResult = (title) => ({ ok: true, metadata: { title }, data: { content: title } });
function setup() {
    navigation.beginPisiWorkspaceNavigation();
    const reads = new Map();
    const elements = {
        wrapper: { hidden: true },
        titleInput: { value: '' },
        contentEditor: { textContent: '', innerHTML: '' },
        placeholder: { style: {} },
        mapCanvas: { style: {} }
    };
    const dom = { style: {}, classList: { add() {}, remove() {} }, appendChild() {} };
    const c = {
        ...navigation,
        activeCenterNode: null,
        activeModalNode: null,
        activeMapPath: null,
        activeMapNodes: [],
        activeMapEdges: [],
        centerNodeSaveTimer: null,
        window: {
            pisiProject: {
                getPisiDocument: (path) => {
                    const d = deferred();
                    reads.set(path, d);
                    return d.promise;
                },
                listMapNodes: (path) => {
                    const d = deferred();
                    reads.set(path, d);
                    return d.promise;
                }
            }
        },
        document: { getElementById: () => dom, dispatchEvent() {} },
        CustomEvent: class {},
        isPisiEditorRestorePending: () => false,
        getPisiEditorRestoreGeneration: () => 0,
        isPisiEditorWriteBlocked: () => false,
        runPisiEditorWrite: (fn) => Promise.resolve().then(fn),
        bindCenterNodeEditorControls() {},
        getCenterNodeEditorElements: () => elements,
        samePisiWorkspacePath: (a, b) => a === b,
        isMapFileName: (name) => name.endsWith('.map'),
        clearMapWorkspace: () => {
            c.activeMapPath = null;
        },
        clearCenterNodeEditor: () => {
            c.activeCenterNode = null;
        },
        getPisiEditorAssetRecoveryWarning: () => null,
        ensurePisiEditorWritable() {},
        setPisiEditorContent: (editor, content) => {
            editor.textContent = content;
        },
        getPisiEditorContent: (editor) => editor.textContent,
        clearPisiEditorCaret() {},
        dispatchPisiActiveNodeChanged() {},
        closePisiTagMenu() {},
        refreshPisiTagsPanelSoon() {},
        saveCurrentMapLayout: async () => true,
        saveCurrentCenterNodeEditor: async () => true,
        applyMapCamera() {},
        setupMapCanvasPan() {},
        bindMapZoomEvents() {},
        bindMapZoomControls() {},
        bindMapCreationEvents() {},
        drawMapConnections() {},
        suppressNextFileSystemRefresh() {},
        clearTimeout() {},
        console,
        alert: (message) => {
            throw new Error(message);
        }
    };
    vm.createContext(c);
    function install(file, names) {
        vm.runInContext(
            names.map((name) => (source(file).includes('async function ' + name + '(') ? 'async ' : '') + extractFunction(source(file), name)).join('\n'),
            c
        );
    }
    install('editor/pisi-node-editor.mjs', ['openCenterNodeEditor', 'openNodeModalFromBox', 'performCurrentCenterNodeEditorSave']);
    install('map/pisi-map-workspace.mjs', ['openMapInWorkspace']);
    return { c, reads, elements, install };
}
const item = (path) => ({ fullPath: path, name: path });
test('node reads completing in reverse order preserve the last requested node', async () => {
    const { c, reads, elements } = setup();
    const first = c.openCenterNodeEditor(item('a.node'));
    const second = c.openCenterNodeEditor(item('b.node'));
    reads.get('b.node').resolve(nodeResult('B'));
    await second;
    reads.get('a.node').resolve(nodeResult('A'));
    assert.equal(await first, false);
    assert.equal(c.activeCenterNode.path, 'b.node');
    assert.equal(elements.contentEditor.textContent, 'B');
});
for (const firstKind of ['node', 'map'])
    test(firstKind + ' cannot overwrite a later cross-type workspace request', async () => {
        const { c, reads } = setup();
        const open = (kind) => (kind === 'node' ? c.openCenterNodeEditor(item('a.node')) : c.openMapInWorkspace(item('b.map')));
        const lastKind = firstKind === 'node' ? 'map' : 'node';
        const first = open(firstKind),
            last = open(lastKind);
        const finish = (kind) =>
            reads.get(kind === 'node' ? 'a.node' : 'b.map').resolve(kind === 'node' ? nodeResult('A') : { ok: true, nodes: [], edges: [] });
        finish(lastKind);
        await last;
        finish(firstKind);
        assert.equal(await first, false);
        assert.equal(lastKind === 'node' ? c.activeCenterNode.path : c.activeMapPath, lastKind === 'node' ? 'a.node' : 'b.map');
    });
test('clearing the workspace invalidates an outstanding document read', async () => {
    const { c, reads, install } = setup();
    install('editor/pisi-node-editor.mjs', ['clearCenterNodeEditor']);
    const pending = c.openCenterNodeEditor(item('a.node'));
    c.clearCenterNodeEditor();
    reads.get('a.node').resolve(nodeResult('A'));
    assert.equal(await pending, false);
    assert.equal(c.activeCenterNode, null);
});
test('closing a modal invalidates a pending modal read', async () => {
    const { c, reads, install } = setup();
    install('editor/pisi-node-editor.mjs', ['closeNodeModalWithoutSaving']);
    const pending = c.openNodeModalFromBox({ dataset: { nodePath: 'a.node' } });
    c.closeNodeModalWithoutSaving();
    reads.get('a.node').resolve(nodeResult('A'));
    assert.equal(await pending, false);
    assert.equal(c.activeModalNode, null);
});
test('an old save completion cannot change another document metadata or dirty flag', async () => {
    const { c, elements } = setup();
    const saving = deferred();
    const a = { path: 'a.node', metadata: { title: 'A' }, revision: 0, dirty: true };
    c.activeCenterNode = a;
    elements.titleInput.value = 'A';
    elements.contentEditor.textContent = 'A content';
    c.window.pisiProject.saveNodeContent = () => saving.promise;
    const pending = c.performCurrentCenterNodeEditorSave(a);
    const b = { path: 'b.node', metadata: { title: 'B' }, revision: 0, dirty: true };
    c.activeCenterNode = b;
    saving.resolve({ ok: true, metadata: { title: 'A saved' } });
    assert.equal(await pending, true);
    assert.equal(b.metadata.title, 'B');
    assert.equal(b.dirty, true);
    assert.equal(a.metadata.title, 'A saved');
});
test('a queued save for a replaced editor never reads the new editor DOM', async () => {
    const { c } = setup();
    const a = { path: 'a.node' };
    c.activeCenterNode = { path: 'b.node' };
    assert.equal(await c.performCurrentCenterNodeEditorSave(a), false);
});
test('obsolete tab activation failure cannot roll back the latest selected tab', async () => {
    const { c, install } = setup();
    const a = deferred(),
        b = deferred();
    const state = { activeTabPath: null, openTabs: ['a.node', 'b.node'].map((path) => ({ path, type: 'node', item: item(path) })) };
    c.getPisiOpenTabsState = () => state;
    c.pisiSameTabPath = (x, y) => x === y;
    c.renderPisiOpenTabs = () => {};
    c.selectPisiTreeFileByPath = () => {};
    c.openCenterNodeEditor = (i) => (i.fullPath === 'a.node' ? a.promise : b.promise);
    install('shell/pisi-tabs.mjs', ['activatePisiOpenTab']);
    const first = c.activatePisiOpenTab('a.node'),
        last = c.activatePisiOpenTab('b.node');
    b.resolve(true);
    await last;
    a.resolve(false);
    assert.equal(await first, false);
    assert.equal(state.activeTabPath, 'b.node');
});

test('typing while the next document loads preserves the current editor', async () => {
    const { c, reads, elements } = setup();
    const node = { path: 'a.node', revision: 0, dirty: false };
    c.activeCenterNode = node;
    const pending = c.openCenterNodeEditor(item('b.node'));
    await new Promise((resolve) => setImmediate(resolve));
    node.revision += 1;
    node.dirty = true;
    elements.contentEditor.textContent = 'new unsaved typing';
    reads.get('b.node').resolve(nodeResult('B'));
    assert.equal(await pending, false);
    assert.equal(c.activeCenterNode, node);
    assert.equal(elements.contentEditor.textContent, 'new unsaved typing');
});

test('a superseded request stops after its pending save instead of starting a read', async () => {
    const { c, reads } = setup();
    const save = deferred();
    c.activeCenterNode = { path: 'a.node' };
    c.saveCurrentCenterNodeEditor = () => save.promise;
    const pending = c.openCenterNodeEditor(item('b.node'));
    navigation.beginPisiWorkspaceNavigation();
    save.resolve(true);
    assert.equal(await pending, false);
    assert.equal(reads.size, 0);
});
