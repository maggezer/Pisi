import assert from 'node:assert/strict';

export async function testEditorInputOwnership(cdp) {
    const setup = (html) =>
        cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.closePisiTagMenu(); window.closePisiUnifiedCommandMenu();
        window.setPisiEditorContent(editor, ${JSON.stringify(html)});
        editor.focus();
        const range = document.createRange(); range.selectNodeContents(editor.lastElementChild); range.collapse(false);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    })()`);
    const key = async (name, modifiers = 0) => {
        const params = {
            key: name,
            code: name.length === 1 ? 'Key' + name.toUpperCase() : name,
            windowsVirtualKeyCode: { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, z: 90 }[name],
            modifiers
        };
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
        await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    };
    const text = () => cdp.evaluate(`document.getElementById('center-node-editor-content').textContent`);

    await setup('<div>/h2</div>');
    await cdp.evaluate(`document.getElementById('center-node-editor-content').dispatchEvent(new Event('input', { bubbles: true }))`);
    assert.equal(await cdp.evaluate('window.pisiUnifiedCommandState.active'), true, 'slash command menu must be open');
    await key('Tab');
    assert.deepEqual(
        await cdp.evaluate(`Array.from(document.getElementById('center-node-editor-content').children).map(el => ({ tag: el.tagName, text: el.textContent }))`),
        [{ tag: 'H2', text: '' }],
        'menu Tab must execute the command once without inserting indentation'
    );

    await setup('<div data-pisi-block-type="bullet">item</div>');
    await key('Tab');
    assert.equal(await cdp.evaluate(`document.getElementById('center-node-editor-content').firstElementChild.dataset.pisiBulletIndent`), '1');
    await key('Tab', 8);
    assert.equal(await cdp.evaluate(`document.getElementById('center-node-editor-content').firstElementChild.dataset.pisiBulletIndent || '0'`), '0');
    assert.equal(await text(), 'item', 'list Tab/Shift+Tab must not also insert spaces');

    await setup('<div>plain</div>');
    await key('Tab');
    assert.equal((await text()).replace(/\u00a0/g, ' '), 'plain    ', 'plain Tab must insert exactly one indentation');

    const cancelled = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const before = editor.innerHTML;
        for (const name of ['Enter', 'Backspace', 'Delete', 'Tab', 'z']) {
            const event = new KeyboardEvent('keydown', { key: name, ctrlKey: name === 'z', bubbles: true, cancelable: true });
            event.preventDefault(); editor.dispatchEvent(event);
        }
        for (const inputType of ['insertParagraph', 'deleteContentBackward', 'historyUndo', 'insertText']) {
            const event = new InputEvent('beforeinput', { inputType, data: 'X', bubbles: true, cancelable: true });
            event.preventDefault(); editor.dispatchEvent(event);
        }
        return editor.innerHTML === before;
    })()`);
    assert.equal(cancelled, true, 'already cancelled events must not reach another editor owner');

    const nested = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const input = document.createElement('textarea'); input.value = 'nested'; editor.appendChild(input); input.focus();
        const before = editor.innerHTML;
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        const result = !event.defaultPrevented && editor.innerHTML === before && input.value === 'nested';
        input.remove(); return result;
    })()`);
    assert.equal(nested, true, 'nested text controls own their Tab key');

    await setup('<h2>heading</h2>');
    const composing = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        const before = editor.innerHTML;
        let untouched = true;
        for (const name of ['Enter', 'Backspace', 'Delete', 'Tab', 'z']) {
            const event = new KeyboardEvent('keydown', { key: name, ctrlKey: name === 'z', bubbles: true, cancelable: true });
            editor.dispatchEvent(event); untouched = untouched && !event.defaultPrevented;
        }
        const event = new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        untouched = untouched && !event.defaultPrevented && editor.innerHTML === before;
        editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
        return untouched;
    })()`);
    assert.equal(composing, true, 'composition lifetime must protect even events without isComposing');
    await key('Enter');
    assert.equal(await cdp.evaluate(`document.getElementById('center-node-editor-content').children.length`), 2, 'normal commands resume after compositionend');

    await setup('<div>prefix</div>');
    await cdp.evaluate(
        `document.querySelector('.pisi-word-toolbar[data-editor-target="center-node-editor-content"] button[data-pisi-unified-command="bold"]').click()`
    );
    const nativeComposition = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const before = editor.innerHTML;
        const event = new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '日本', isComposing: true, bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        return !event.defaultPrevented && editor.innerHTML === before;
    })()`);
    assert.equal(nativeComposition, true, 'typing-format authority must leave native IME composition untouched');
    await cdp.request('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await cdp.request('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
    await cdp.request('Input.insertText', { text: '日本' });
    assert.equal(await text(), 'prefix日本', 'IME updates must replace the composition rather than append every intermediate string');
    await key('z', 2);
    assert.equal(await text(), 'prefix', 'one undo must remove the committed IME text');

    await setup(
        '<div data-pisi-block-type="task"><span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="todo.1.none" contenteditable="false">todo.1.none</span><span class="pisi-todo-source" data-pisi-todo-for="todo.1.none">task</span></div>'
    );
    const toggle = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const marker = editor.querySelector('.pisi-block-task-marker');
        if (!marker) return { marker: false };
        let inputs = 0; const count = () => inputs++; editor.addEventListener('input', count);
        const checked = marker.getAttribute('aria-checked');
        marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
        const compositionIgnored = checked === marker.getAttribute('aria-checked') && inputs === 0;
        marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        editor.removeEventListener('input', count);
        return { marker: true, compositionIgnored, toggled: checked !== marker.getAttribute('aria-checked'), inputs, blocks: editor.children.length };
    })()`);
    assert.deepEqual(
        toggle,
        { marker: true, compositionIgnored: true, toggled: true, inputs: 1, blocks: 1 },
        'task toggle must run once and must not split the task'
    );
    console.log('EDITOR_INPUT_OWNERSHIP_E2E_OK: menu/list/plain Tab, cancellation, nested controls, IME and task toggle');
}
