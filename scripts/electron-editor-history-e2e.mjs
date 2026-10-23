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
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const toolbar = document.querySelector('.pisi-editor-toolbar[data-editor-target="center-node-editor-content"], .pisi-word-toolbar[data-editor-target="center-node-editor-content"]');
        const select = toolbar?.querySelector('select[data-pisi-unified-command="fontSize"]');
        if (!select) throw new Error('Word font size control missing');
        const range = document.createRange();
        range.selectNodeContents(editor.firstElementChild);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        select.value = '24';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (!editor.querySelector('[style*="24px"]')) throw new Error('Range font formatting did not run');
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
    await shortcut(false);
    await cdp.request('Input.insertText', { text: ' new history branch' });
    const branch = await snapshot();
    assert.notEqual(branch, states[states.length - 2]);
    await shortcut(true);
    assert.equal(await snapshot(), branch, 'new input after undo must invalidate redo');

    await cdp.evaluate(`window.setPisiEditorContent(document.getElementById('center-node-editor-content'), '<div>Different document</div>')`);
    const reset = await snapshot();
    await shortcut(false);
    assert.equal(await snapshot(), reset, 'loading a document must discard the previous document history');
    await cdp.evaluate(`window.addPisiBlockBelow(document.getElementById('center-node-editor-content').firstElementChild)`);
    const added = await snapshot();
    await cdp.evaluate(
        `document.getElementById('center-node-editor-content').dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' }))`
    );
    assert.equal(await snapshot(), reset, 'native historyUndo input must use the same stack');
    await cdp.evaluate(
        `document.getElementById('center-node-editor-content').dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyRedo' }))`
    );
    assert.equal(await snapshot(), added, 'native historyRedo input must use the same stack');

    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>Composite history text</div>');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor.firstElementChild);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        window.insertPisiSheet(editor, 2, 2);
        const table = editor.querySelector('table[data-pisi-sheet]');
        const database = window.getPisiSheetDatabase(table);
        database.items[0].values[database.fields[0].id] = { value: 'KEEP_SHEET_HISTORY', formula: null, format: {} };
        window.persistPisiSheetDatabase(table);
        window.renderPisiSheetDatabase(table);
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        toolbar.querySelector('[data-pisi-paint-action="createCanvas"]').click();
        const canvas = editor.querySelector('canvas[data-pisi-canvas]');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(2, 2, 8, 8);
        window.savePisiCanvasData(canvas);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        const text = editor.firstElementChild;
        range.selectNodeContents(text);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        editor.focus();
    })()`);
    await cdp.request('Input.insertText', { text: ' edit beside composites' });
    await shortcut(false);
    const composites = await cdp.evaluate(`(async () => {
        const editor = document.getElementById('center-node-editor-content');
        const table = editor.querySelector('table[data-pisi-sheet]');
        const database = table && window.getPisiSheetDatabase(table);
        const canvas = editor.querySelector('canvas[data-pisi-canvas]');
        for (let i = 0; i < 20; i += 1) {
            const pixel = canvas?.getContext('2d').getImageData(4, 4, 1, 1).data;
            if (pixel?.[0] === 255 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255) {
                return { sheet: database?.items[0]?.values[database.fields[0].id]?.value, canvas: true };
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return { canvas: false };
    })()`);
    assert.deepEqual(composites, { sheet: 'KEEP_SHEET_HISTORY', canvas: true }, 'text undo must preserve Sheet values and Canvas pixels');
    console.log('EDITOR_HISTORY_E2E_OK: native typing/formatting and structural edits undo and redo in order');
}
