import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
    bindPisiEditorComposition,
    resetPisiEditorComposition,
    isPisiEditorComposing,
    isPisiEditorEventSuppressed,
    canHandlePisiEditorTextEvent
} from '../renderer/editor/pisi-editor-input-policy.mjs';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');

test('cancelled, inert and read-only editors cannot claim keyboard or text input', () => {
    assert.equal(canHandlePisiEditorTextEvent({}, { defaultPrevented: true }), false);
    assert.equal(canHandlePisiEditorTextEvent({ inert: true }, {}), false);
    assert.equal(canHandlePisiEditorTextEvent({ getAttribute: () => 'false' }, {}), false);
    assert.equal(canHandlePisiEditorTextEvent(null, {}), false);
    assert.equal(canHandlePisiEditorTextEvent({}, {}), true);
});

test('IME flags and legacy Process/229 keys share the same suppression rule', () => {
    for (const event of [{ isComposing: true }, { key: 'Process' }, { keyCode: 229 }]) assert.equal(isPisiEditorEventSuppressed({}, event), true);
});

test('composition lifetime is tracked even when subsequent events omit isComposing', () => {
    const listeners = new Map();
    const editor = {
        addEventListener: (name, fn) => {
            assert.equal(listeners.has(name), false);
            listeners.set(name, fn);
        }
    };
    bindPisiEditorComposition(editor);
    bindPisiEditorComposition(editor);
    listeners.get('compositionstart')();
    assert.equal(isPisiEditorComposing(editor), true);
    assert.equal(canHandlePisiEditorTextEvent(editor, {}), false);
    listeners.get('compositionend')();
    assert.equal(canHandlePisiEditorTextEvent(editor, {}), true);
    listeners.get('compositionstart')();
    resetPisiEditorComposition(editor);
    assert.equal(isPisiEditorComposing(editor), false, 'loading another document clears abandoned composition state');
});

test('nested controls retain text input ownership while task markers can use their own key handler', () => {
    const editor = {},
        target = { closest: () => ({}) };
    assert.equal(canHandlePisiEditorTextEvent(editor, { target }), false);
    assert.equal(isPisiEditorEventSuppressed(editor, { target }), false);
});

for (const event of [
    { inputType: 'insertCompositionText', isComposing: true },
    { inputType: 'insertCompositionText' },
    { inputType: 'insertText', defaultPrevented: true },
    { inputType: 'insertText', keyCode: 229 },
    { inputType: 'insertText', nested: true }
])
    test('format authority does not intercept ' + JSON.stringify(event), () => {
        const editor = {},
            target = event.nested ? { closest: () => ({}) } : editor;
        const source = fs.readFileSync(new URL('../renderer/editor/pisi-editor-command-authority.mjs', import.meta.url), 'utf8');
        const context = vm.createContext({
            canHandlePisiEditorTextEvent,
            getPisiAuthorityEditorFromTarget: () => editor,
            pisiAuthorityTypingStyles: new Map([[editor, { fontWeight: 'bold' }]]),
            getPisiAuthorityRangeInsideEditor: () => assert.fail('native/cancelled input must not enter formatting'),
            event: { ...event, target, data: '日本', preventDefault: () => assert.fail('must not cancel native input') }
        });
        vm.runInContext(extractFunction(source, 'handlePisiAuthorityBeforeInput') + ';handlePisiAuthorityBeforeInput(event)', context);
    });
