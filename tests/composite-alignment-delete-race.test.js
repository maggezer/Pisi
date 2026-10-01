'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) =>
    fs.readFileSync(path.join(root, file), 'utf8');

test('composite alignment can be recovered from real focus and selected Canvas state', () => {
    const source = read(
        'renderer/editor/pisi-editor-composite-blocks.mjs'
    );
    const resolver = source.slice(
        source.indexOf(
            'function getPisiActiveCompositeAlignmentBlock'
        ),
        source.indexOf('function makePisiCompositeId')
    );

    assert.match(
        source,
        /function getPisiFocusedCompositeAlignmentBlock/
    );
    assert.match(
        source,
        /function getPisiSelectedCanvasAlignmentBlock/
    );
    assert.match(
        resolver,
        /document\.activeElement/
    );
    assert.match(
        resolver,
        /getPisiSelectedCanvasAlignmentBlock\(editor\)/
    );
    assert.match(
        resolver,
        /PISI_COMPOSITE_ACTIVE_CLASS/
    );
});

test('Sheet and Canvas keep visible section dividers and logical auto-margin alignment', () => {
    const css = read('styles/70-components.css');

    assert.match(
        css,
        /--pisi-composite-divider-color/
    );
    assert.match(
        css,
        /border-bottom:\s*1px solid var\(--pisi-composite-divider-color\)/
    );
    assert.match(
        css,
        /data-pisi-composite-align="center"[\s\S]*?margin-inline-start:\s*auto;[\s\S]*?margin-inline-end:\s*auto;/
    );
});

test('tree delete flushes pending editor saves before moving a file and re-resolves the live tree node', () => {
    const source = read(
        'renderer/tree/pisi-tree-dnd.mjs'
    );
    const deletion = source.slice(
        source.indexOf(
            'async function deleteTreePisiItem'
        ),
        source.indexOf(
            'async function handleDeletedMapFromTree'
        )
    );

    const flushIndex =
        deletion.indexOf('flushPisiPendingSaves');
    const deleteIndex =
        deletion.indexOf('deletePisiFile');

    assert.ok(flushIndex >= 0);
    assert.ok(deleteIndex > flushIndex);
    assert.match(
        deletion,
        /cancelPendingPisiTreeFileClick\(\)/
    );
    assert.match(
        deletion,
        /findTreeNodeByPath\(item\.fullPath\)/
    );
});
