import assert from 'node:assert/strict';

export async function testEditorSelection(cdp) {
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, '<div>abcdef</div><div>uvwxyz</div>');
        editor.focus();
        const [first, last] = editor.children;
        window.getSelection().setBaseAndExtent(last.firstChild, 4, first.firstChild, 2);
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
            backward: anchor?.closest('.pisi-editor-block') === editor.lastElementChild && focus?.closest('.pisi-editor-block') === editor.firstElementChild
        };
    })()`);
    assert.deepEqual(result.styled, ['cdef', 'uvwx'], 'toolbar must format the original text after a block DOM rebuild');
    assert.equal(result.text, 'abcdefuvwxyz');
    assert.equal(result.selection, 'cdefuvwx');
    assert.equal(result.backward, true, 'backward selection direction must survive DOM rebuild and formatting');
    console.log('EDITOR_SELECTION_E2E_OK: toolbar selection survives block DOM replacement');
}
