import assert from 'node:assert/strict';

export async function testEditorSelection(cdp) {
    await cdp.evaluate(`import('./renderer/editor/pisi-selection-bookmarks.mjs').then(api => { window.__e7SelectionApi = api; })`);
    await cdp.evaluate(`(() => {
        window.__e7Trace = [];
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>abcdef</div><div>uvwxyz</div>');
        editor.focus();
        const [first, last] = editor.children;
        window.getSelection().setBaseAndExtent(last.firstChild, 4, first.firstChild, 2);
        window.__e7SelectionSaved = window.__e7SelectionApi.capturePisiSelectionBookmark(editor);
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toolbar.querySelector('select[data-pisi-unified-command="fontSize"]').focus();
        for (const block of Array.from(editor.children)) {
            const replacement = document.createElement('h2');
            for (const attr of block.attributes) replacement.setAttribute(attr.name, attr.value);
            replacement.dataset.pisiBlockType = 'heading2';
            replacement.innerHTML = '<em>' + block.textContent + '</em>';
            block.replaceWith(replacement);
        }
    })()`);
    const result = await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        const select = toolbar.querySelector('select[data-pisi-unified-command="fontSize"]');
        select.value = '24';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const selection = window.getSelection();
        const anchor = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode;
        const focus = selection.focusNode?.nodeType === Node.TEXT_NODE ? selection.focusNode.parentElement : selection.focusNode;
        return {
            styled: Array.from(editor.querySelectorAll('[style*="24px"]')).map(el => el.textContent),
            text: editor.textContent,
            selection: selection.toString(),
            bookmarkResolvable: Boolean(window.__e7SelectionApi.resolvePisiSelectionBookmark(editor, window.__e7SelectionSaved)),
            ids: Array.from(editor.children).map(el => el.dataset.pisiBlockId),
            html: editor.innerHTML,
            trace: window.__e7Trace,
            backward: anchor?.closest('.pisi-editor-block') === editor.lastElementChild && focus?.closest('.pisi-editor-block') === editor.firstElementChild
        };
    })()`);
    assert.deepEqual(result.styled, ['cdef', 'uvwx'], 'toolbar must format the original text after a block DOM rebuild: ' + JSON.stringify(result));
    assert.equal(result.text, 'abcdefuvwxyz');
    assert.equal(result.selection, 'cdefuvwx');
    assert.equal(result.backward, true, 'backward selection direction must survive DOM rebuild and formatting');
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>untouched</div><div>A😀BC</div>');
        editor.focus();
        window.getSelection().setPosition(editor.lastElementChild.firstChild, 3);
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toolbar.querySelector('select[data-pisi-unified-command="fontSize"]').focus();
        editor.lastElementChild.innerHTML = '<strong>A😀BC</strong>';
    })()`);
    const change = (editorId = 'center-node-editor-content', command = 'fontSize', value = '24') =>
        cdp.evaluate(`(() => {
        const toolbar = document.querySelector('[data-editor-target="${editorId}"]');
        const select = toolbar.querySelector('select[data-pisi-unified-command="${command}"]');
        select.value = '${value}';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await change();
    await cdp.request('Input.insertText', { text: 'X' });
    assert.deepEqual(await cdp.evaluate(`Array.from(document.getElementById('center-node-editor-content').children).map(el => el.textContent)`), [
        'untouched',
        'A😀XBC'
    ]);

    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>one<br>two</div>');
        editor.focus();
        window.getSelection().setBaseAndExtent(editor.firstElementChild.lastChild, 1, editor.firstElementChild.lastChild, 3);
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toolbar.querySelector('select[data-pisi-unified-command="fontSize"]').focus();
        editor.firstElementChild.innerHTML = '<em>one<br>two</em>';
    })()`);
    await change();
    assert.deepEqual(
        await cdp.evaluate(`Array.from(document.querySelectorAll('#center-node-editor-content [style*="24px"]')).map(el => el.textContent)`),
        ['wo'],
        'soft breaks must count as bookmark positions'
    );

    for (const mutation of ['remove', 'duplicate', 'load']) {
        await cdp.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            window.setPisiEditorContent(editor, '<div class="pisi-editor-block" data-pisi-block-id="blk_bookmark_source">selected</div><div>keep</div>');
            editor.focus();
            window.getSelection().setBaseAndExtent(editor.firstElementChild.firstChild, 1, editor.firstElementChild.firstChild, 5);
            const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
            toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            toolbar.querySelector('select[data-pisi-unified-command="fontSize"]').focus();
            if ('${mutation}' === 'remove') editor.firstElementChild.remove();
            if ('${mutation}' === 'duplicate') editor.append(editor.firstElementChild.cloneNode(true));
            if ('${mutation}' === 'load') window.setPisiEditorContent(editor, '<div class="pisi-editor-block" data-pisi-block-id="blk_bookmark_source">new document</div>');
        })()`);
        const before = await cdp.evaluate(`document.getElementById('center-node-editor-content').innerHTML`);
        await change();
        assert.equal(
            await cdp.evaluate(`document.getElementById('center-node-editor-content').innerHTML`),
            before,
            mutation + ': invalid bookmark must not format unrelated content'
        );
    }

    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>abcdef</div><div>uvwxyz</div>');
        editor.focus();
        window.getSelection().setBaseAndExtent(editor.lastElementChild.firstChild, 4, editor.firstElementChild.firstChild, 2);
        const toolbar = document.querySelector('[data-editor-target="center-node-editor-content"]');
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toolbar.querySelector('select[data-pisi-unified-command="formatBlock"]').focus();
    })()`);
    await change('center-node-editor-content', 'formatBlock', 'h2');
    assert.deepEqual(await cdp.evaluate(`Array.from(document.getElementById('center-node-editor-content').children).map(el => el.tagName)`), ['H2', 'H2']);
    await change();
    assert.equal(await cdp.evaluate('window.getSelection().toString()'), 'cdefuvwx', 'heading then font formatting must keep the same selection');

    const centerText = await cdp.evaluate(`document.getElementById('center-node-editor-content').textContent`);
    const opened = await cdp.evaluate(`(async () => {
        const box = document.createElement('div');
        box.className = 'map-node-box';
        box.dataset.nodePath = window.activeCenterNode.path;
        if (!(await window.openNodeModalFromBox(box))) return false;
        const editor = document.getElementById('node-modal-content');
        window.setPisiEditorContent(editor, '<div>modal text</div>');
        editor.focus();
        window.getSelection().setBaseAndExtent(editor.firstElementChild.firstChild, 6, editor.firstElementChild.firstChild, 10);
        const toolbar = document.querySelector('[data-editor-target="node-modal-content"]');
        toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toolbar.querySelector('select[data-pisi-unified-command="fontSize"]').focus();
        editor.firstElementChild.innerHTML = '<strong>modal text</strong>';
        return true;
    })()`);
    assert.equal(opened, true);
    await change('node-modal-content');
    assert.deepEqual(await cdp.evaluate(`Array.from(document.querySelectorAll('#node-modal-content [style*="24px"]')).map(el => el.textContent)`), ['text']);
    assert.equal(
        await cdp.evaluate(`document.getElementById('center-node-editor-content').textContent`),
        centerText,
        'modal formatting must not target the center editor bookmark'
    );
    await cdp.evaluate('window.closeNodeModalAndSave()');
    console.log('EDITOR_SELECTION_E2E_OK: toolbar selection survives block DOM replacement');
}
