import assert from 'node:assert/strict';

export async function testEditorKeyboard(cdp) {
    const run = (expression) => cdp.evaluate(expression);
    const setup = async (html, offset = 0) =>
        run(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, ${JSON.stringify(html)});
        editor.focus();
        const block = editor.firstElementChild;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && text.parentElement.closest('.pisi-block-task-marker, .pisi-task-metadata')) text = walker.nextNode();
        const range = document.createRange();
        range.setStart(text || block, Math.min(${offset}, text ? text.length : block.childNodes.length));
        range.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    })()`);
    const key = async (name, shift = false) => {
        const code = { Enter: 13, Backspace: 8, Delete: 46 }[name];
        const params = { key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    };
    const blocks = () =>
        run(
            `Array.from(document.getElementById('center-node-editor-content').children).map(block => ({ type: block.dataset.pisiBlockType, text: block.textContent.replace(/[☐☑]/g, '').trim(), id: block.dataset.pisiBlockId }))`
        );
    const beforeInput = (inputType, isComposing = false) =>
        run(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        return !editor.dispatchEvent(new InputEvent('beforeinput', { inputType: ${JSON.stringify(inputType)}, isComposing: ${isComposing}, bubbles: true, cancelable: true }));
    })()`);

    // The established two-Enter rule is deliberate: first a soft line, then a new block.
    for (const [tag, type] of [
        ['div', 'paragraph'],
        ['blockquote', 'quote'],
        ['pre', 'code']
    ]) {
        await setup('<' + tag + '>alpha</' + tag + '>', 5);
        const original = (await blocks())[0].id;
        await key('Enter');
        assert.equal((await blocks()).length, 1, type + ': first Enter stays in block');
        await key('Enter');
        const result = await blocks();
        assert.equal(result.length, 2, type + ': second Enter exits block');
        assert.equal(result[0].id, original);
        assert.equal(result[0].text, 'alpha');
        assert.equal(result[1].type, 'paragraph');
    }
    for (const level of [1, 2, 3, 4, 5]) {
        await setup('<h' + level + '>abcdef</h' + level + '>', 3);
        await key('Enter');
        assert.deepEqual(
            (await blocks()).map(({ type, text }) => ({ type, text })),
            [
                { type: 'heading' + level, text: 'abc' },
                { type: 'paragraph', text: 'def' }
            ]
        );
    }
    for (const type of ['paragraph', 'heading2', 'quote', 'code', 'bullet', 'number', 'task']) {
        const tag = type === 'heading2' ? 'h2' : type === 'quote' ? 'blockquote' : type === 'code' ? 'pre' : 'div';
        await setup('<' + tag + ' data-pisi-block-type="' + type + '">abcdef</' + tag + '>', 3);
        await key('Enter', true);
        const result = await blocks();
        assert.equal(result.length, 1, type + ': Shift+Enter stays in block');
        assert.equal(result[0].type, type);
        assert.equal(result[0].text.replace(/\s/g, ''), 'abcdef');
    }

    // Touch keyboards can emit beforeinput without a preceding keydown.
    await setup('<h2>abcdef</h2>', 3);
    assert.equal(await beforeInput('insertParagraph'), true);
    assert.deepEqual(
        (await blocks()).map(({ type, text }) => ({ type, text })),
        [
            { type: 'heading2', text: 'abc' },
            { type: 'paragraph', text: 'def' }
        ]
    );
    await setup('<h2>abcdef</h2>', 3);
    const composingBefore = await blocks();
    assert.equal(await beforeInput('insertParagraph', true), false);
    assert.deepEqual(await blocks(), composingBefore, 'IME composition must not split a heading');
    console.log('EDITOR_KEYBOARD_E2E_OK: block Enter, Shift+Enter, deletion and beforeinput rules');
}
