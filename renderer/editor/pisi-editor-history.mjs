import { createEditorHistory } from './pisi-editor-history-state.mjs';
import { captureHistorySelection, restoreHistorySelection } from './pisi-editor-history-selection.mjs';

const histories = new WeakMap();
const bound = new WeakSet();
const compositeSelector = '.pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas]';
const snapshot = (editor) => ({ content: window.getPisiEditorContent(editor), selection: captureHistorySelection(editor) });
let selectionListenerInstalled = false;

function trackSelection() {
    if (selectionListenerInstalled) return;
    selectionListenerInstalled = true;
    document.addEventListener('selectionchange', () => {
        const node = window.getSelection()?.anchorNode;
        const editor = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.('.pisi-rich-editor');
        const state = histories.get(editor);
        if (!state || state.pending || state.restoring || state.composing) return;
        const selection = captureHistorySelection(editor);
        if (JSON.stringify(selection) !== JSON.stringify(state.history.current().selection)) state.history.boundary();
        state.history.selection(selection);
    });
}

export function resetPisiEditorHistory(editor) {
    if (!editor || histories.get(editor)?.restoring) return;
    histories.set(editor, { history: createEditorHistory(snapshot(editor)), restoring: false, pending: false, kind: '', composing: false });
}

function flush(editor, state) {
    if (histories.get(editor) !== state || state.restoring || state.composing) return;
    state.pending = false;
    state.history.commit(snapshot(editor), state.kind);
    state.kind = '';
}

function navigate(editor, delta) {
    const state = histories.get(editor);
    if (!state || state.restoring || state.composing || editor.inert || editor.getAttribute('contenteditable') === 'false') return;
    if (state.pending) flush(editor, state);
    const target = state.history.step(delta);
    // Consume an empty stack as well; never fall through to Chromium's stale stack.
    if (!target) return;
    state.restoring = true;
    try {
        window.setPisiEditorContent(editor, target.content);
        editor.focus({ preventScroll: true });
        restoreHistorySelection(editor, target.selection);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: delta < 0 ? 'historyUndo' : 'historyRedo' }));
    } finally {
        state.restoring = false;
    }
}

export function bindPisiEditorHistory(editor) {
    if (!editor || bound.has(editor)) return;
    bound.add(editor);
    trackSelection();
    if (!histories.has(editor)) resetPisiEditorHistory(editor);
    const nestedControl = (event) => event.target !== editor && event.target?.closest?.('input, textarea, select, ' + compositeSelector);
    editor.addEventListener(
        'keydown',
        (event) => {
            if (nestedControl(event) || event.isComposing || event.altKey) return;
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
                event.preventDefault();
                event.stopImmediatePropagation();
                navigate(editor, key === 'y' || event.shiftKey ? 1 : -1);
            } else if (/^(Arrow|Home|End|Page)/.test(event.key)) {
                histories.get(editor)?.history.boundary();
            }
        },
        true
    );
    editor.addEventListener(
        'beforeinput',
        (event) => {
            const state = histories.get(editor);
            if (!state || state.restoring || nestedControl(event)) return;
            if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
                event.preventDefault();
                event.stopImmediatePropagation();
                navigate(editor, event.inputType === 'historyUndo' ? -1 : 1);
                return;
            }
            if (state.pending) flush(editor, state);
            const selection = captureHistorySelection(editor);
            if (JSON.stringify(selection) !== JSON.stringify(state.history.current().selection)) state.history.boundary();
            state.history.selection(selection);
        },
        true
    );
    editor.addEventListener('input', (event) => {
        const state = histories.get(editor);
        if (!state || state.restoring) return;
        state.kind = ['insertText', 'insertCompositionText'].includes(event.inputType) ? 'typing' : '';
        if (state.pending) return;
        state.pending = true;
        // All input normalization and metadata listeners finish before capture.
        queueMicrotask(() => flush(editor, state));
    });
    editor.addEventListener('compositionstart', () => {
        const state = histories.get(editor);
        if (!state) return;
        if (state.pending) flush(editor, state);
        state.history.boundary();
        state.composing = true;
    });
    editor.addEventListener('compositionend', () => {
        const state = histories.get(editor);
        if (!state) return;
        state.composing = false;
        queueMicrotask(() => {
            flush(editor, state);
            state.history.boundary();
        });
    });
    editor.addEventListener('pointerdown', () => histories.get(editor)?.history.boundary());
}
