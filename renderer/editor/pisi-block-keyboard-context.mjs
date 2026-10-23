import { canHandlePisiEditorTextEvent } from './pisi-editor-input-policy.mjs';
const isolated = 'input, textarea, select, .pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas], [contenteditable="false"]';
const media = 'img, hr, table, canvas, video, audio, iframe, object, [contenteditable="false"]';

export function getPisiBlockKeyboardContext(editor, event, override = null) {
    if (!canHandlePisiEditorTextEvent(editor, event)) return null;
    const selection = window.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    if (element !== editor && element?.closest?.(isolated)) return null;
    const block = override || element?.closest?.('.pisi-editor-block');
    // Cross-block selections stay with Chromium; a single-block handler must
    // never delete/extract only one end of a selection spanning other blocks.
    if (!block || block.parentElement !== editor || !block.contains(range.startContainer) || !block.contains(range.endContainer)) return null;
    return { block, range, selection };
}

export function pisiBeforeInputAsKey(event) {
    const key = { insertParagraph: 'Enter', insertLineBreak: 'Enter', deleteContentBackward: 'Backspace', deleteContentForward: 'Delete' }[event.inputType];
    if (!key) return null;
    return {
        key,
        target: event.target,
        shiftKey: event.inputType === 'insertLineBreak',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: event.isComposing,
        get defaultPrevented() {
            return event.defaultPrevented;
        },
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        stopImmediatePropagation: () => event.stopImmediatePropagation()
    };
}

export function hasPisiKeyboardContent(node) {
    return Boolean(node?.textContent?.replace(/[\s\u00a0\u200b]/g, '') || node?.querySelector?.(media));
}

function lineText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeName === 'BR') return '\n';
    if (node.matches?.(media)) return '\ufffc';
    return Array.from(node.childNodes).map(lineText).join('');
}

export function isPisiKeyboardLineEmpty(block, range) {
    if (!range || !block.contains(range.startContainer) || !block.contains(range.endContainer)) return false;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    const left = lineText(before.cloneContents()).split('\n').at(-1);
    const right = lineText(after.cloneContents()).split('\n')[0];
    return !(left + right).replace(/[\s\u00a0\u200b]/g, '');
}

export function insertPisiKeyboardLineBreak(editor, block, range) {
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    const suffix = document.createRange();
    suffix.selectNodeContents(block);
    suffix.setStartAfter(br);
    const fragment = suffix.cloneContents();
    // Chromium needs a terminal placeholder to render a caret on the empty line.
    if (!hasPisiKeyboardContent(fragment) && !fragment.querySelector('br')) br.after(document.createElement('br'));
    range.setStartAfter(br);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus({ preventScroll: true });
}
