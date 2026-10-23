import test from 'node:test';
import assert from 'node:assert/strict';
import { getPisiBlockKeyboardContext, pisiBeforeInputAsKey } from '../renderer/editor/pisi-block-keyboard-context.mjs';

test('beforeinput keeps composition and cancellation state and supports every propagation method', () => {
    const calls = [];
    const event = {
        inputType: 'insertParagraph',
        isComposing: true,
        target: {},
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
            calls.push('bubble');
        },
        stopImmediatePropagation() {
            calls.push('immediate');
        }
    };
    const key = pisiBeforeInputAsKey(event);
    assert.equal(key.key, 'Enter');
    assert.equal(key.isComposing, true);
    assert.equal(key.target, event.target);
    key.preventDefault();
    assert.equal(key.defaultPrevented, true);
    key.stopPropagation();
    key.stopImmediatePropagation();
    assert.deepEqual(calls, ['bubble', 'immediate']);
    assert.equal(pisiBeforeInputAsKey({ inputType: 'insertCompositionText' }), null);
});

test('soft break and deletion input route to the same semantic keys', () => {
    assert.equal(pisiBeforeInputAsKey({ inputType: 'insertLineBreak' }).shiftKey, true);
    assert.equal(pisiBeforeInputAsKey({ inputType: 'deleteContentBackward' }).key, 'Backspace');
    assert.equal(pisiBeforeInputAsKey({ inputType: 'deleteContentForward' }).key, 'Delete');
});

test('composing, cancelled, inert and nested-control events never reach a block mutation', () => {
    assert.equal(getPisiBlockKeyboardContext({}, { isComposing: true }), null);
    assert.equal(getPisiBlockKeyboardContext({}, { defaultPrevented: true }), null);
    assert.equal(getPisiBlockKeyboardContext({ inert: true }, {}), null);
    assert.equal(getPisiBlockKeyboardContext({}, { target: { closest: () => ({}) } }), null);
});

test('a cross-block range cannot be processed as a single-block deletion', (t) => {
    const oldWindow = globalThis.window;
    const oldNode = globalThis.Node;
    const editor = { contains: () => true };
    const block = { parentElement: editor, contains: (node) => node === start };
    const start = { nodeType: 1, closest: (selector) => (selector === '.pisi-editor-block' ? block : null) };
    const end = {};
    globalThis.Node = { ELEMENT_NODE: 1 };
    globalThis.window = { getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ startContainer: start, endContainer: end }) }) };
    t.after(() => {
        globalThis.window = oldWindow;
        globalThis.Node = oldNode;
    });
    assert.equal(getPisiBlockKeyboardContext(editor, { target: editor }), null);
});
