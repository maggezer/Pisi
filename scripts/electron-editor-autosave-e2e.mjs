import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function testEditorAutosave(cdp, nodePath) {
    const path = JSON.stringify(nodePath);
    const read = () => cdp.evaluate(`window.pisiProject.getPisiDocument(${path}).then(r => ({ ok: r.ok, content: r.data?.content }))`);
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        for (let i = 0; i < 12; i++) {
            window.setPisiEditorContent(editor, '<div>E9 burst ' + i + '</div>');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    })()`);
    let autosaved = false;
    for (let i = 0; i < 60; i++) {
        await delay(100);
        const result = await read();
        if (result.ok && result.content.includes('E9 burst 11')) {
            autosaved = true;
            break;
        }
    }
    assert.equal(autosaved, true, 'debounced autosave must persist the last rapid edit');

    for (const departure of ['save', 'navigate', 'close']) {
        const result = await cdp.evaluate(`(async () => {
            const editor = document.getElementById('center-node-editor-content');
            const edit = text => { window.setPisiEditorContent(editor, '<div>' + text + '</div>'); editor.dispatchEvent(new Event('input', { bubbles: true })); };
            edit('E9 first ${departure}');
            const pending = '${departure}' === 'navigate' ? window.openCenterNodeEditor({ fullPath: ${path} }) : '${departure}' === 'close' ? window.closePisiOpenTab(${path}) : window.saveCurrentCenterNodeEditor();
            for (let i = 0; i < 10; i++) await Promise.resolve();
            edit('E9 latest ${departure}');
            const completed = await pending;
            const preserved = window.activeCenterNode?.path === ${path} && editor.textContent === 'E9 latest ${departure}' && window.activeCenterNode.dirty;
            const saved = await window.saveCurrentCenterNodeEditor();
            return { completed, preserved: Boolean(preserved), saved };
        })()`);
        assert.deepEqual(result, { completed: false, preserved: true, saved: true }, departure + ': a pending write must not authorize discarding later edits');
        assert.ok((await read()).content.includes('E9 latest ' + departure));
    }

    const modalResult = await cdp.evaluate(`(async () => {
        const center = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(center, '<div>E9 unsaved center</div>');
        center.dispatchEvent(new Event('input', { bubbles: true }));
        const box = document.createElement('div'); box.className = 'map-node-box'; box.dataset.nodePath = ${path};
        if (!(await window.openNodeModalFromBox(box))) return { opened: false };
        const modal = document.getElementById('node-modal-content');
        const loadedLatest = modal.textContent === 'E9 unsaved center';
        window.setPisiEditorContent(modal, '<div>E9 modal first</div>');
        modal.dispatchEvent(new Event('input', { bubbles: true }));
        await window.saveCurrentCenterNodeEditor();
        const pending = window.closeNodeModalAndSave();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        window.setPisiEditorContent(modal, '<div>E9 modal latest</div>');
        modal.dispatchEvent(new Event('input', { bubbles: true }));
        const staleClose = await pending;
        const stayedOpen = Boolean(window.activeModalNode) && modal.textContent === 'E9 modal latest';
        const flushed = await window.flushPisiPendingSaves();
        return { opened: true, loadedLatest, staleClose, stayedOpen, flushed, centerLatest: center.textContent === 'E9 modal latest' };
    })()`);
    assert.deepEqual(modalResult, { opened: true, loadedLatest: true, staleClose: false, stayedOpen: true, flushed: true, centerLatest: true });
    assert.ok((await read()).content.includes('E9 modal latest'), 'exit flush must not overwrite the modal with stale center content');

    const renamed = await cdp.evaluate(`(async () => {
        const originalTitle = window.activeCenterNode.metadata.title;
        const open = async path => { const box = document.createElement('div'); box.dataset.nodePath = path; return window.openNodeModalFromBox(box); };
        if (!(await open(${path}))) return { opened: false };
        const title = document.getElementById('node-modal-title');
        title.value = 'E9 renamed note'; title.dispatchEvent(new Event('input', { bubbles: true }));
        const saved = await window.closeNodeModalAndSave();
        const renamedPath = window.activeCenterNode.path;
        const tabUpdated = Array.from(document.querySelectorAll('.center-tab')).some(tab => tab.title === renamedPath);
        const savedDocument = await window.pisiProject.getPisiDocument(renamedPath);
        const flushed = await window.flushPisiPendingSaves();
        if (!(await open(renamedPath))) return { opened: false };
        title.value = originalTitle; title.dispatchEvent(new Event('input', { bubbles: true }));
        const restored = await window.closeNodeModalAndSave();
        return { opened: true, saved, pathChanged: renamedPath !== ${path}, tabUpdated, contentPreserved: savedDocument.data.content.includes('E9 modal latest'), flushed, restored, originalPath: window.activeCenterNode.path === ${path} };
    })()`);
    assert.deepEqual(renamed, {
        opened: true,
        saved: true,
        pathChanged: true,
        tabUpdated: true,
        contentPreserved: true,
        flushed: true,
        restored: true,
        originalPath: true
    });
    console.log('EDITOR_AUTOSAVE_E2E_OK: rapid edits, pending saves, navigation, modal ownership, rename and close');
}
