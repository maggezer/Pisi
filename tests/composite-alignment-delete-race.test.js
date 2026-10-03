'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('composite alignment prefers explicit block context and selected Canvas state', () => {
    const source = read('renderer/editor/pisi-editor-composite-blocks.mjs');
    const resolver = source.slice(source.indexOf('function getPisiActiveCompositeAlignmentBlock'), source.indexOf('function makePisiCompositeId'));

    assert.match(source, /function getPisiSelectedCanvasAlignmentBlock/);
    assert.match(resolver, /getPisiSelectedCanvasAlignmentBlock\(editor\)/);
    assert.match(resolver, /PISI_COMPOSITE_ACTIVE_CLASS/);
    assert.match(resolver, /pisiActiveCompositeContexts\.get\(editor\)/);
    assert.doesNotMatch(resolver, /document\.activeElement/);
});

test('Sheet and Canvas use full-width section chrome with aligned inner content', () => {
    const composite = read('renderer/editor/pisi-editor-composite-blocks.mjs');
    const sheetSection = read('renderer/editor/pisi-editor-sheet-section-ui.mjs');
    const canvasSection = read('renderer/editor/pisi-editor-canvas-section-ui.mjs');
    const css = read('styles/65-shared-ui.css');

    assert.match(composite, /function normalizePisiCompositeBlockLayout\(block\)/);
    assert.match(composite, /'margin-left'[\s\S]{0,220}'margin-right'/);
    assert.match(composite, /style\.removeProperty\(property\)/);
    assert.match(sheetSection, /normalizePisiCompositeBlockLayout\(block\)/);
    assert.match(canvasSection, /normalizePisiCompositeBlockLayout\(block\)/);
    assert.match(css, /--pisi-composite-divider-color/);
    assert.match(css, /\.pisi-sheet-block\s*\{[\s\S]{0,220}width:\s*100%/);
    assert.match(css, /\.pisi-canvas-block\s*\{[\s\S]{0,220}width:\s*100%/);
    assert.match(
        css,
        /\.pisi-sheet-block\[data-pisi-composite-align=["\']center["\']\][\s\S]*?> \.pisi-sheet-search-row,[\s\S]*?> \.pisi-sheet-table[\s\S]*?margin-inline-start:\s*auto;[\s\S]*?margin-inline-end:\s*auto;/
    );
    assert.match(css, /\.pisi-canvas-block\[data-pisi-composite-align=["\']center["\']\][\s\S]*?> \.pisi-paint-canvas/);
    assert.match(css, /\.pisi-sheet-block\.pisi-sheet-collapsed[\s\S]{0,180}border-bottom:\s*1px solid var\(--pisi-composite-divider-color\)/);
    assert.match(css, /\.pisi-canvas-block\.pisi-canvas-collapsed[\s\S]{0,180}border-bottom:\s*1px solid var\(--pisi-composite-divider-color\)/);
});

test('Sheet alignment comes from blank chrome, not title/search/table controls', () => {
    const search = read('renderer/editor/pisi-editor-sheet-search-ui.mjs');
    const section = read('renderer/editor/pisi-editor-sheet-section-ui.mjs');
    const composite = read('renderer/editor/pisi-editor-composite-blocks.mjs');
    const css = read('styles/65-shared-ui.css');

    assert.match(composite, /function isPisiSheetBlankAlignmentTarget/);
    assert.match(composite, /\.pisi-sheet-table,/);
    assert.match(composite, /\.pisi-sheet-search,/);
    assert.match(composite, /\.pisi-sheet-section-title,/);
    assert.doesNotMatch(search, /selectPisiCompositeAlignmentBlock/);
    assert.doesNotMatch(section, /selectPisiCompositeAlignmentBlock/);
    assert.doesNotMatch(search, /pisi-sheet-selection-surface/);
    assert.match(css, /\.pisi-sheet-search-row\s*\{[\s\S]{0,180}width:\s*min\(420px, 100%\)/);
    assert.match(css, /\.pisi-sheet-block\.pisi-composite-alignment-active[\s\S]{0,120}> \.pisi-sheet-table[\s\S]{0,180}box-shadow:/);
});

test('tree delete flushes pending editor saves before moving a file and re-resolves the live tree node', () => {
    const source = read('renderer/tree/pisi-tree-dnd.mjs');
    const deletion = source.slice(source.indexOf('async function deleteTreePisiItem'), source.indexOf('async function handleDeletedMapFromTree'));

    const flushIndex = deletion.indexOf('flushPisiPendingSaves');
    const deleteIndex = deletion.indexOf('deletePisiFile');

    assert.ok(flushIndex >= 0);
    assert.ok(deleteIndex > flushIndex);
    assert.match(deletion, /cancelPendingPisiTreeFileClick\(\)/);
    assert.match(deletion, /let deletePath = item\.fullPath/);
    assert.match(deletion, /centerWasExactTarget/);
    assert.match(deletion, /modalWasExactTarget/);
    assert.match(deletion, /findTreeNodeByPath\(deletePath\)/);

    const nodeEditor = read('renderer/editor/pisi-node-editor.mjs');
    assert.match(nodeEditor, /function clearCenterNodeEditor\(\)\s*\{\s*clearTimeout\(centerNodeSaveTimer\);\s*centerNodeSaveTimer = null;/);
});
