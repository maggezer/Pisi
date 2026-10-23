const composing = new WeakSet();
const bound = new WeakSet();
const isolated = 'input, textarea, select, .pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas], [contenteditable="false"]';

export function bindPisiEditorComposition(editor) {
    if (!editor || bound.has(editor)) return;
    bound.add(editor);
    editor.addEventListener('compositionstart', () => composing.add(editor), true);
    editor.addEventListener('compositionend', () => composing.delete(editor), true);
}

export function resetPisiEditorComposition(editor) {
    composing.delete(editor);
}

export function isPisiEditorComposing(editor, event = {}) {
    return Boolean(composing.has(editor) || event.isComposing || event.keyCode === 229 || event.key === 'Process');
}

export function isPisiEditorEventSuppressed(editor, event = {}) {
    return Boolean(
        !editor || event.defaultPrevented || isPisiEditorComposing(editor, event) || editor.inert || editor.getAttribute?.('contenteditable') === 'false'
    );
}

export function canHandlePisiEditorTextEvent(editor, event = {}) {
    return !isPisiEditorEventSuppressed(editor, event) && !(event.target !== editor && event.target?.closest?.(isolated));
}
