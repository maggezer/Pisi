import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    normalizePisiCanvasSectionTitle
} from '../renderer/editor/pisi-editor-canvas-section-ui.mjs';

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);

test('Canvas section title normalizes editable titles', () => {
    assert.equal(
        normalizePisiCanvasSectionTitle(''),
        'Canvas'
    );
    assert.equal(
        normalizePisiCanvasSectionTitle('  Sketch  '),
        'Sketch'
    );
    assert.equal(
        normalizePisiCanvasSectionTitle('x'.repeat(100)).length,
        80
    );
});

test('Canvas uses Sheet-style section chrome and persistent metadata', () => {
    const paint = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-paint.mjs'
        ),
        'utf8'
    );
    const section = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-canvas-section-ui.mjs'
        ),
        'utf8'
    );
    const nodeEditor = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-node-editor.mjs'
        ),
        'utf8'
    );
    const blocks = fs.readFileSync(
        path.join(
            root,
            'renderer/tags/pisi-editor-blocks.mjs'
        ),
        'utf8'
    );
    const blockEditor = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-block-editor.mjs'
        ),
        'utf8'
    );
    const css = fs.readFileSync(
        path.join(root, 'styles/70-components.css'),
        'utf8'
    );

    assert.match(
        paint,
        /ensurePisiCanvasSectionHeader/
    );
    assert.match(
        paint,
        /block\.dataset\.pisiCanvasTitle = 'Canvas'/
    );
    assert.match(
        paint,
        /block\.dataset\.pisiCanvasCollapsed = '0'/
    );
    assert.match(
        paint,
        /range\.setStartAfter\(block\)/
    );

    assert.match(
        section,
        /pisi-canvas-section-header/
    );
    assert.match(
        section,
        /pisi-canvas-section-toggle/
    );
    assert.match(
        section,
        /pisi-canvas-section-title/
    );
    assert.match(
        section,
        /pisi-canvas-section-delete/
    );
    assert.match(
        section,
        /pisi-section-copy/
    );
    assert.match(
        section,
        /pisi-section-new-line/
    );
    assert.match(
        section,
        /ensurePisiEditableLineAfter/
    );
    assert.match(
        section,
        /ensurePisiCompositeAlignment/
    );
    assert.match(
        section,
        /selectPisiCompositeAlignmentBlock/
    );
    assert.match(
        paint,
        /pisiCompositeAlign = 'center'/
    );
    assert.match(
        paint,
        /const wasSelected =/
    );
    assert.match(
        paint,
        /if \(!wasSelected\)/
    );
    assert.match(
        paint,
        /selectPisiCompositeAlignmentBlock/
    );
    assert.match(
        section,
        /deletePisiCanvasSection/
    );
    assert.match(
        section,
        /pisi-canvas-collapsed/
    );

    assert.match(
        nodeEditor,
        /pisi-canvas-section-header/
    );
    assert.match(
        nodeEditor,
        /data-pisi-canvas-title/
    );
    assert.match(
        nodeEditor,
        /data-pisi-canvas-collapsed/
    );

    assert.match(
        blocks,
        /pisi-canvas-block/
    );
    assert.match(
        blockEditor,
        /pisi-canvas-block/
    );

    assert.match(
        css,
        /\.pisi-canvas-section-header/
    );
    assert.match(
        css,
        /\.pisi-canvas-section-toggle/
    );
    assert.match(
        css,
        /\.pisi-canvas-section-title/
    );
    assert.match(
        css,
        /\.pisi-section-delete/
    );
    assert.match(
        css,
        /\.pisi-section-copy/
    );
    assert.match(
        css,
        /\.pisi-section-new-line/
    );
    assert.match(
        css,
        /\.pisi-canvas-block\.pisi-canvas-collapsed/
    );
    const sheetBlockStart =
        css.indexOf('.pisi-sheet-block {');
    const sheetBlockEnd =
        css.indexOf('}', sheetBlockStart);
    const sheetBlockRule =
        css.slice(
            sheetBlockStart,
            sheetBlockEnd + 1
        );

    assert.ok(sheetBlockStart >= 0);
    assert.ok(sheetBlockEnd > sheetBlockStart);
    assert.match(
        sheetBlockRule,
        /padding:\s*0 0 5px/
    );
});
