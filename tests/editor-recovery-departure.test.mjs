import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as recovery from '../renderer/editor/pisi-editor-recovery-policy.mjs';
import { isPisiEditorWriteBlocked, runPisiEditorWrite } from '../renderer/editor/pisi-editor-restore.mjs';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');
const source = fs.readFileSync(new URL('../renderer/editor/pisi-node-editor.mjs', import.meta.url), 'utf8');
function element() {
    return {
        inert: false,
        readOnly: false,
        attributes: new Map([['contenteditable', 'true']]),
        children: [],
        setAttribute(k, v) {
            this.attributes.set(k, v);
        },
        getAttribute(k) {
            return this.attributes.get(k);
        },
        removeAttribute(k) {
            this.attributes.delete(k);
        },
        before(n) {
            this.notice = n;
        },
        append(...nodes) {
            this.children.push(...nodes);
        },
        remove() {
            this.removed = true;
        },
        addEventListener(type, fn) {
            this[type] = fn;
        },
        classList: { add() {}, remove() {} },
        value: 'Note',
        innerHTML: 'content'
    };
}
function setup(t) {
    const editor = element(),
        title = element(),
        toolbar = element();
    editor.id = 'test-editor';
    const node = { path: 'note.node', dirty: false, revision: 0, metadata: { title: 'Note' }, assetRecoveryWarning: 'missing asset' };
    let writes = 0,
        renames = 0,
        confirms = 0,
        answer = false;
    const oldWindow = globalThis.window,
        oldDocument = globalThis.document;
    globalThis.document = { querySelector: () => toolbar, createElement: element, getElementById: (id) => (id.includes('title') ? title : editor) };
    globalThis.window = {
        activeCenterNode: node,
        activeModalNode: null,
        pisiConfirm: async () => {
            confirms++;
            return answer;
        },
        pisiProject: {
            saveNodeContent: async () => {
                writes++;
                return { ok: true };
            },
            renamePisiFile: async () => {
                renames++;
                return { ok: true };
            }
        }
    };
    const c = {
        ...recovery,
        samePisiWorkspacePath: (a, b) => a === b,
        activeCenterNode: node,
        activeModalNode: null,
        window,
        document,
        isPisiEditorRestorePending: () => false,
        isPisiEditorWriteBlocked: () => false,
        runPisiEditorWrite: (fn) => Promise.resolve().then(fn),
        getCenterNodeEditorElements: () => ({ contentEditor: editor, titleInput: title }),
        getPisiEditorContent: () => editor.innerHTML,
        centerNodeSaveTimer: null,
        mapSaveTimer: null,
        mapCameraSaveTimer: null,
        activeMapPath: null,
        clearTimeout,
        beginPisiModalNavigation() {},
        dispatchPisiActiveNodeChanged() {},
        closePisiTagMenu() {}
    };
    vm.createContext(c);
    const names = [
        'saveCurrentCenterNodeEditor',
        'performCurrentCenterNodeEditorSave',
        'closeNodeModalAndSave',
        'performNodeModalCloseAndSave',
        'closeNodeModalWithoutSaving',
        'flushPisiPendingSaves'
    ];
    vm.runInContext(
        'let pisiCenterSaveTail = Promise.resolve(true);\n' +
            names.map((n) => (source.includes('async function ' + n + '(') ? 'async ' : '') + extractFunction(source, n)).join('\n'),
        c
    );
    t.after(() => {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    });
    return {
        c,
        node,
        editor,
        title,
        toolbar,
        counts: () => ({ writes, renames, confirms }),
        answer: (value) => {
            answer = value;
        }
    };
}
test('read-only recovery blocks nested widgets and toolbar but leaves recovery action outside editor', (t) => {
    const h = setup(t);
    recovery.applyPisiEditorRecoveryState(h.node, h.editor, h.title);
    assert.equal(h.editor.inert, true);
    assert.equal(h.title.readOnly, true);
    assert.equal(h.toolbar.inert, true);
    assert.equal(h.editor.getAttribute('aria-readonly'), 'true');
    assert.equal(h.editor.notice.children.length, 3);
    assert.equal(h.editor.notice.inert, false);
});
test('opening a healthy document restores editing and removes the warning', (t) => {
    const h = setup(t);
    recovery.applyPisiEditorRecoveryState(h.node, h.editor, h.title);
    const notice = h.editor.notice;
    recovery.applyPisiEditorRecoveryState(null, h.editor, h.title);
    assert.equal(h.editor.inert, false);
    assert.equal(h.title.readOnly, false);
    assert.equal(h.toolbar.inert, false);
    assert.equal(notice.removed, true);
});
test('unchanged recovery note passes navigation and application-close flush without any write', async (t) => {
    const h = setup(t);
    assert.equal(await h.c.saveCurrentCenterNodeEditor({ allowDiscardRecovery: true }), true);
    assert.equal(await h.c.flushPisiPendingSaves(), true);
    assert.deepEqual(h.counts(), { writes: 0, renames: 0, confirms: 0 });
});
test('automatic save does not prompt or discard dirty protected content', async (t) => {
    const h = setup(t);
    h.node.dirty = true;
    assert.equal(await h.c.saveCurrentCenterNodeEditor(), false);
    assert.equal(h.node.dirty, true);
    assert.equal(h.counts().confirms, 0);
});
test('canceling departure preserves dirty content and prevents exit', async (t) => {
    const h = setup(t);
    h.node.dirty = true;
    assert.equal(await h.c.flushPisiPendingSaves(), false);
    assert.equal(h.node.dirty, true);
    assert.equal(h.editor.innerHTML, 'content');
    assert.equal(h.counts().writes, 0);
});
test('confirming discard allows exit without overwriting the damaged document', async (t) => {
    const h = setup(t);
    h.node.dirty = true;
    h.answer(true);
    assert.equal(await h.c.flushPisiPendingSaves(), true);
    assert.equal(h.node.dirty, false);
    assert.deepEqual(h.counts(), { writes: 0, renames: 0, confirms: 1 });
});
test('a late discard confirmation cannot discard a different revision', async (t) => {
    const h = setup(t);
    h.node.dirty = true;
    window.pisiConfirm = async () => {
        h.node.revision++;
        return true;
    };
    assert.equal(await recovery.allowPisiRecoveryDeparture(h.node, true), false);
    assert.equal(h.node.dirty, true);
});
test('a late discard confirmation cannot affect a different active note', async (t) => {
    const h = setup(t);
    h.node.dirty = true;
    window.pisiConfirm = async () => {
        window.activeCenterNode = {};
        return true;
    };
    assert.equal(await recovery.allowPisiRecoveryDeparture(h.node, true), false);
    assert.equal(h.node.dirty, true);
});
test('unchanged protected modal closes without saving', async (t) => {
    const h = setup(t);
    h.c.activeModalNode = h.node;
    window.activeModalNode = h.node;
    assert.equal(await h.c.closeNodeModalAndSave(), true);
    assert.equal(h.c.activeModalNode, null);
    assert.equal(h.counts().writes, 0);
});
test('a failed post-restore reload permits leaving a clean stale editor but never writes it', async (t) => {
    const h = setup(t);
    h.node.assetRecoveryWarning = '';
    h.node.restoreReloadRequired = true;
    h.c.isPisiEditorWriteBlocked = () => true;
    assert.equal(await h.c.flushPisiPendingSaves(), true);
    assert.equal(h.counts().writes, 0);
});

test('failed center reload does not block saving another modal document during exit', async (t) => {
    const h = setup(t);
    h.node.assetRecoveryWarning = '';
    h.node.restoreReloadRequired = true;
    const modal = { path: 'other.node', dirty: true, revision: 0, metadata: { title: 'Note' }, box: { querySelector: () => null } };
    h.c.activeModalNode = window.activeModalNode = modal;
    h.c.isPisiEditorWriteBlocked = isPisiEditorWriteBlocked;
    h.c.runPisiEditorWrite = runPisiEditorWrite;
    h.c.suppressNextFileSystemRefresh = () => {};
    h.c.animateMapBox = () => {};
    h.c.refreshPisiTagsPanelSoon = () => {};
    h.c.alert = (message) => assert.fail(message);
    h.c.console = console;
    assert.equal(await h.c.flushPisiPendingSaves(), true);
    assert.equal(h.c.activeModalNode, null);
    assert.deepEqual(h.counts(), { writes: 1, renames: 0, confirms: 0 });
    assert.equal(h.node.restoreReloadRequired, true);
});
