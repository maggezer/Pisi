import assert from 'node:assert/strict';

// Exercise Chromium input together with the application's DOM-based operations.
export async function testEditorHistory(cdp) {
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>History text</div><h2>History boundary</h2>');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor.firstElementChild);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    })()`);
    const snapshot = () => cdp.evaluate(`window.getPisiEditorContent(document.getElementById('center-node-editor-content'))`);
    const states = [await snapshot()];
    await cdp.request('Input.insertText', { text: ' typed' });
    states.push(await snapshot());
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const range = document.createRange();
        range.selectNodeContents(editor.firstElementChild);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand('bold');
    })()`);
    states.push(await snapshot());
    await cdp.evaluate(`window.applyPisiBlockType(document.getElementById('center-node-editor-content').firstElementChild, 'heading2')`);
    states.push(await snapshot());
    await cdp.evaluate(`window.movePisiBlock(document.getElementById('center-node-editor-content').firstElementChild, 1)`);
    states.push(await snapshot());
    await cdp.evaluate(`window.deletePisiBlock(document.getElementById('center-node-editor-content').lastElementChild)`);
    states.push(await snapshot());
    for (let i = 1; i < states.length; i += 1) assert.notEqual(states[i], states[i - 1], 'history action must change the document');
    const shortcut = async (redo) => {
        await cdp.evaluate(`document.getElementById('center-node-editor-content').focus()`);
        const key = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: redo ? 10 : 2 };
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    };
    for (let i = states.length - 2; i >= 0; i -= 1) {
        await shortcut(false);
        assert.equal(await snapshot(), states[i], 'undo must restore document state ' + i);
    }
    for (let i = 1; i < states.length; i += 1) {
        await shortcut(true);
        assert.equal(await snapshot(), states[i], 'redo must restore document state ' + i);
    }
    console.log('EDITOR_HISTORY_E2E_OK: native typing/formatting and structural edits undo and redo in order');
}
