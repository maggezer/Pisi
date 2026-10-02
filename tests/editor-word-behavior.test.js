'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Word-like behavior layer is loaded after block editor', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const blockIndex = bootstrap.indexOf('pisi-block-editor.mjs');
    const wordIndex = bootstrap.indexOf('pisi-editor-word-behavior.mjs');

    assert.ok(blockIndex >= 0);
    assert.ok(wordIndex > blockIndex);
});

test('toolbar remembers selection and synchronizes font and command state', () => {
    const source = read('renderer/editor/pisi-editor-word-behavior.mjs');

    assert.match(source, /const pisiWordToolbarSelections = new WeakMap\(\)/);
    assert.match(source, /function rememberPisiWordSelection\(toolbar\)/);
    assert.match(source, /function restorePisiWordSelection\(toolbar\)/);
    assert.match(source, /document\.addEventListener\('selectionchange'/);
    assert.match(source, /getComputedStyle\(probe\)/);
    assert.match(source, /pisi-font-family-select/);
    assert.match(source, /pisi-font-size-select/);
    assert.match(source, /setPisiWordCommandPressed\(toolbar, 'bold'/);
    assert.match(source, /setPisiWordCommandPressed\(toolbar, 'italic'/);
    assert.match(source, /setPisiWordCommandPressed\(toolbar, 'underline'/);
    assert.match(source, /setPisiWordCommandPressed\(toolbar, 'strikeThrough'/);
});

test('composite alignment owns alignment buttons over Word state', () => {
    const source = read('renderer/editor/pisi-editor-word-behavior.mjs');

    assert.match(source, /toolbar\.classList\.contains\([\s\S]{0,80}'pisi-composite-context'/);
    assert.match(source, /if \(!compositeOwnsAlignment\)[\s\S]{0,500}justifyLeft[\s\S]{0,500}justifyCenter[\s\S]{0,500}justifyRight/);
    assert.match(source, /const compositeAlignmentCommand[\s\S]{0,420}'justifyLeft'[\s\S]{0,220}'justifyCenter'[\s\S]{0,220}'justifyRight'/);
    assert.match(source, /if \(compositeAlignmentCommand\) \{[\s\S]{0,80}return;/);
});

test('font changes use real sizes and keep a collapsed caret typing style', () => {
    const source = read('renderer/editor/pisi-editor-word-behavior.mjs');

    assert.match(source, /8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 72/);
    assert.match(source, /className = 'pisi-typing-style'/);
    assert.match(source, /document\.createTextNode\(''\)/);
    assert.match(source, /span\.style\[property\] = value/);
    assert.match(source, /fontFamily/);
    assert.match(source, /fontSize/);
    assert.match(source, /applyPisiWordSheetFormat/);
    assert.match(source, /px`/);
});

test('style selector matches the block model and headings can collapse sections', () => {
    const source = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const styles = read('styles/94-editor-word-behavior.css');
    const styleIndex = read('style.css');

    assert.match(source, /h1: 'heading1'/);
    assert.match(source, /h2: 'heading2'/);
    assert.match(source, /h3: 'heading3'/);
    assert.match(source, /window\.applyPisiBlockType/);
    assert.match(source, /pisi-heading-collapsed/);
    assert.match(source, /pisi-heading-section-hidden/);
    assert.match(source, /togglePisiWordHeading/);

    assert.match(styleIndex, /94-editor-word-behavior\.css/);
    assert.match(styles, /content:\s*["\']▾["\']/);
    assert.match(styles, /content:\s*["\']▸["\']/);
    assert.match(styles, /pisi-heading-section-hidden/);
    assert.match(styles, /display: none/);
});
