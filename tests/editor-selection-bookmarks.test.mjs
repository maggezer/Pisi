import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolvePisiBookmarkOffset,
    resetPisiSelectionBookmarks,
    isPisiSelectionBookmarkDisplaced,
    resolvePisiSelectionBookmark
} from '../renderer/editor/pisi-selection-bookmarks.mjs';

const text = (value) => ({ node: { nodeValue: value }, length: value.length, atomic: false });

test('bookmark offsets survive a text node being split into formatting spans', () => {
    const tokens = [text('ab'), text('cdef')];
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 4, {}), { node: tokens[1].node, offset: 2 });
});

test('UTF-16 offsets preserve emoji and combining character caret positions', () => {
    const tokens = [text('A😀'), text('e\u0301Z')];
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 5, {}), { node: tokens[1].node, offset: 2 });
});

test('soft breaks distinguish positions before and after a line break', () => {
    const br = {};
    const parent = { childNodes: [br] };
    br.parentNode = parent;
    const tokens = [{ node: br, length: 1, atomic: true }, text('next')];
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 0, parent), { node: parent, offset: 0 });
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 1, parent), { node: parent, offset: 1 });
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 3, parent), { node: tokens[1].node, offset: 2 });
});

test('shortened text clamps stale offsets and empty blocks resolve safely', () => {
    const tokens = [text('short')];
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, 99, {}), { node: tokens[0].node, offset: 5 });
    const root = { childNodes: [] };
    assert.deepEqual(resolvePisiBookmarkOffset([], 10, root), { node: root, offset: 0 });
    assert.deepEqual(resolvePisiBookmarkOffset(tokens, -1, root), { node: tokens[0].node, offset: 0 });
});

test('document reload invalidates bookmarks before passive selection updates can reuse them', () => {
    const editor = { id: 'test-editor' };
    const saved = { editor, scope: '', version: 0 };
    resetPisiSelectionBookmarks(editor);
    assert.equal(isPisiSelectionBookmarkDisplaced(editor, saved), true);
    assert.equal(resolvePisiSelectionBookmark(editor, saved), null);
    assert.equal(isPisiSelectionBookmarkDisplaced(editor, null), false);
});
