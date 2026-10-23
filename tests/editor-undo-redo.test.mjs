import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorHistory } from '../renderer/editor/pisi-editor-history-state.mjs';

const state = (content) => ({ content, selection: null });

test('mixed typing, format, heading, move and delete undo and redo in exact order', () => {
    const states = ['', 'typed', '<b>typed</b>', '<h2>typed</h2>', 'moved heading', 'deleted'];
    const history = createEditorHistory(state(states[0]));
    states.slice(1).forEach((content, i) => history.commit(state(content), i ? '' : 'typing', i));
    for (let i = states.length - 2; i >= 0; i -= 1) assert.equal(history.step(-1)?.content, states[i]);
    assert.equal(history.step(-1), null);
    for (let i = 1; i < states.length; i += 1) assert.equal(history.step(1)?.content, states[i]);
    assert.equal(history.step(1), null);
});

test('typing coalesces but navigation, formatting and new edits after undo create boundaries', () => {
    const history = createEditorHistory(state(''));
    history.commit(state('a'), 'typing', 0);
    history.commit(state('ab'), 'typing', 10);
    assert.equal(history.step(-1).content, '');
    history.step(1);
    history.boundary();
    history.commit(state('abc'), 'typing', 20);
    assert.equal(history.step(-1).content, 'ab');
    history.commit(state('new'), 'typing', 30);
    assert.equal(history.step(1), null);
    assert.equal(history.step(-1).content, 'ab');
});

test('no-op changes preserve redo and selection direction survives snapshots', () => {
    const selection = { anchor: 5, focus: 1 };
    const history = createEditorHistory(state('a'));
    history.selection(selection);
    history.commit(state('b'));
    assert.deepEqual(history.step(-1).selection, selection);
    history.commit({ content: 'a', selection });
    assert.equal(history.step(1).content, 'b');
});

test('history is isolated per document and bounded by count and content size', () => {
    const a = createEditorHistory(state('a'), { limit: 3, maxCharacters: 10 });
    const b = createEditorHistory(state('other'));
    for (const content of ['bb', 'ccc', 'dddd', 'eeeee']) a.commit(state(content));
    assert.equal(a.step(-1).content, 'dddd');
    assert.equal(a.step(-1), null);
    assert.equal(b.current().content, 'other');
    assert.equal(b.step(-1), null);
});
