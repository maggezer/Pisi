import { getPisiBlockKeyboardContext } from './pisi-block-keyboard-context.mjs';

function isTextBlock(editor, block) {
    return (
        block?.parentElement === editor &&
        block.matches('.pisi-editor-block') &&
        /^(paragraph|heading[1-5]|quote|code|bullet|number|task)$/.test(block.dataset.pisiBlockType) &&
        !block.querySelector('hr, table, canvas, img, video, audio, iframe, object, [data-pisi-rollup-relation]')
    );
}

export function mergePisiKeyboardBlocks(editor, left, right, removeTaskMetadata) {
    if (!isTextBlock(editor, left) || !isTextBlock(editor, right) || left.nextElementSibling !== right) return false;
    if (right.dataset.pisiBlockType === 'task') removeTaskMetadata(right);
    const target = left.querySelector('.pisi-todo-source') || left;
    if (!target.textContent && target.childNodes.length === 1 && target.firstChild.nodeName === 'BR') target.firstChild.remove();
    const join = target.childNodes.length;
    while (right.firstChild) target.appendChild(right.firstChild);
    right.remove();
    const range = document.createRange();
    range.setStart(target, join);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    window.syncPisiTodoBlockMarkers?.(left);
    window.syncPisiWordHeadingCollapse?.(editor);
    window.selectPisiBlock?.(editor, left);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

export function handlePisiBlockBoundaryKey(editor, event, removeTaskMetadata) {
    if (!['Backspace', 'Delete'].includes(event.key) || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const context = getPisiBlockKeyboardContext(editor, event);
    if (!context?.range.collapsed) return false;
    const { block, range } = context;
    const side = document.createRange();
    side.selectNodeContents(block);
    if (event.key === 'Backspace') side.setEnd(range.startContainer, range.startOffset);
    else side.setStart(range.startContainer, range.startOffset);
    const fragment = side.cloneContents();
    // Spaces and soft line breaks are real content: deleting them must not join blocks.
    if (fragment.textContent.replace(/\u200b/g, '') || fragment.querySelector('br, img, table, canvas, [contenteditable="false"]')) return false;
    const left = event.key === 'Backspace' ? block.previousElementSibling : block;
    const right = event.key === 'Backspace' ? block : block.nextElementSibling;
    // A boundary beside a composite block is not a text merge. Never let a
    // native merge absorb a Sheet, Canvas, rollup or its controls into text.
    if (!isTextBlock(editor, left) || !isTextBlock(editor, right)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return mergePisiKeyboardBlocks(editor, left, right, removeTaskMetadata);
}
