import { bindPisiEditorComposition, resetPisiEditorComposition, canHandlePisiEditorTextEvent } from './pisi-editor-input-policy.mjs';
import { createEditorHistory } from './pisi-editor-history-state.mjs';
import { captureHistorySelection, restoreHistorySelection } from './pisi-editor-history-selection.mjs';

const histories = new WeakMap();
const bound = new WeakSet();
const compositeSelector = '.pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas]';
// The note's tasks are part of a step (docs/task-plan.md G3.6): their fields
// come from the task store (renderer/tasks/pisi-task-history.mjs).
const makeKey = (entry) => `${entry.content}\u0001${window.makePisiTaskHistoryKey?.(entry.tasks) ?? ''}`;
const captureTasks = (editor) => window.capturePisiTaskHistoryState?.(editor) ?? null;
const snapshot = (editor) => {
    const entry = { content: window.getPisiEditorContent(editor), selection: captureHistorySelection(editor), tasks: captureTasks(editor) };
    return { ...entry, key: makeKey(entry) };
};
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
    resetPisiEditorComposition(editor);
    histories.set(editor, { history: createEditorHistory(snapshot(editor)), restoring: false, pending: false, kind: '', composing: false, ownTasks: false });
}

function flush(editor, state) {
    if (histories.get(editor) !== state || state.restoring || state.composing) return;
    state.pending = false;
    const next = snapshot(editor);
    // A text step carries no task change: what changed elsewhere joins every step.
    if (!state.ownTasks) state.history.adopt(next.tasks, makeKey);
    state.ownTasks = false;
    state.history.commit(next, state.kind);
    state.kind = '';
}

/**
 * Before a task change made from this editor: the steps take in what changed
 * elsewhere, so that the next step holds only this editor's change.
 */
export function rebasePisiEditorHistory(editor) {
    const state = histories.get(editor);
    if (!state || state.restoring) return;
    if (state.pending) flush(editor, state);
    state.history.adopt(captureTasks(editor), makeKey);
}

/** Records the editor's state as a step after a task change made from it (`kind` 'typing' merges keystrokes). */
export function recordPisiEditorHistory(editor, kind = '') {
    const state = histories.get(editor);
    if (!state || state.restoring) return;
    state.kind = kind;
    state.ownTasks = true;
    if (state.pending) return;
    state.pending = true;
    queueMicrotask(() => flush(editor, state));
}

/** Undo (-1) or redo (1) from outside the editor's own keys (a task title). */
export function stepPisiEditorHistory(editor, delta) {
    navigate(editor, delta < 0 ? -1 : 1);
}

function navigate(editor, delta) {
    const state = histories.get(editor);
    if (!state || state.restoring || state.composing || editor.inert || editor.getAttribute('contenteditable') === 'false') return;
    if (state.pending) flush(editor, state);
    state.history.adopt(captureTasks(editor), makeKey);
    const from = state.history.current();
    const target = state.history.step(delta);
    // Consume an empty stack as well; never fall through to Chromium's stale stack.
    if (!target) return;
    state.restoring = true;
    try {
        window.restorePisiTaskHistoryState?.(editor, from?.tasks || null, target.tasks || null);
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
    bindPisiEditorComposition(editor);
    trackSelection();
    if (!histories.has(editor)) resetPisiEditorHistory(editor);
    const nestedControl = (event) => event.target !== editor && event.target?.closest?.('input, textarea, select, ' + compositeSelector);
    editor.addEventListener(
        'keydown',
        (event) => {
            if (!canHandlePisiEditorTextEvent(editor, event) || nestedControl(event) || event.altKey) return;
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
            if (!state || state.restoring || !canHandlePisiEditorTextEvent(editor, event) || nestedControl(event)) return;
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
