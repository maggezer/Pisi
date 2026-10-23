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
    const styles = read('styles/92-compatibility.css');
    const styleIndex = read('style.css');

    assert.match(source, /h1: 'heading1'/);
    assert.match(source, /h2: 'heading2'/);
    assert.match(source, /h3: 'heading3'/);
    assert.match(source, /h4: 'heading4'/);
    assert.match(source, /h5: 'heading5'/);
    assert.match(source, /window\.applyPisiBlockType/);
    assert.match(source, /pisi-heading-collapsed/);
    assert.match(source, /pisi-heading-section-hidden/);
    assert.match(source, /togglePisiWordHeading/);

    assert.match(styleIndex, /92-compatibility\.css/);
    assert.match(styles, /content:\s*["\']▾["\']/);
    assert.match(styles, /content:\s*["\']▸["\']/);
    assert.match(styles, /pisi-heading-section-hidden/);
    assert.match(styles, /display: none/);
});

test('heading levels 1 through 5 are supported with collapse/expand across both block and word layers', () => {
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const styles = read('styles/92-compatibility.css');
    const toolbarSource = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    assert.match(blockSource, /id: 'heading4', label: 'Başlık 4', tag: 'h4'/);
    assert.match(blockSource, /id: 'heading5', label: 'Başlık 5', tag: 'h5'/);
    assert.match(blockSource, /#\{1,5\}/);
    assert.match(blockSource, /'####': 'heading4'/);
    assert.match(blockSource, /'#####': 'heading5'/);
    assert.match(wordSource, /heading4: 4/);
    assert.match(wordSource, /heading5: 5/);
    assert.match(styles, /heading4/);
    assert.match(styles, /heading5/);
    assert.match(toolbarSource, /value="h4"/);
    assert.match(toolbarSource, /value="h5"/);
});
test('heading sections support double Enter exit and section break isolation', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    const styles = read('styles/92-compatibility.css');

    // Section break & exit logic
    assert.match(wordSource, /handlePisiHeadingSectionKeydown/);
    assert.match(wordSource, /getPisiHeadingSectionBlocks/);
    assert.match(wordSource, /pisi-section-break/);
    assert.match(wordSource, /pisiSectionBreak/);
    assert.match(wordSource, /pisiSectionExit/);
    assert.match(wordSource, /pisiHeadingParent/);

    // Block editor integrates section keydown and section drag
    assert.match(blockSource, /handlePisiHeadingSectionKeydown/);
    assert.match(blockSource, /getPisiHeadingSectionBlocks/);

    // CSS provides section visual nesting and break reset
    assert.match(styles, /pisi-section-break/);
});
test('SiYuan-style collapsible and indented bullet points are supported across layers', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    const styles = read('styles/92-compatibility.css');

    // Bullet indentation & hierarchy
    assert.match(wordSource, /getPisiBulletIndent/);
    assert.match(wordSource, /setPisiBulletIndent/);
    assert.match(wordSource, /getPisiBulletDescendants/);
    assert.match(wordSource, /hasPisiBulletChildren/);

    // Bullet collapse / expand
    assert.match(wordSource, /togglePisiBulletCollapse/);
    assert.match(wordSource, /syncPisiBulletCollapse/);
    assert.match(wordSource, /handlePisiBulletKeydown/);
    assert.match(wordSource, /pisi-bullet-collapsed/);
    assert.match(wordSource, /pisi-bullet-hidden/);
    assert.match(wordSource, /pisi-bullet-has-children/);

    // Block editor integrates bullet keydown, markdown indentation and drag
    assert.match(blockSource, /handlePisiBulletKeydown/);
    assert.match(blockSource, /getPisiBulletDescendants/);
    assert.match(blockSource, /pisiBulletIndent/);

    // CSS provides SiYuan styling and folding indicator
    assert.match(styles, /pisi-bullet-collapsed/);
    assert.match(styles, /pisi-bullet-hidden/);
    assert.match(styles, /content:\s*['"]⦿['"]/);
});
test('indented bullet points preserve hierarchy in markdown conversion', () => {
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    assert.match(blockSource, /pisiBlockMarkdownToHtml/);
    assert.match(blockSource, /pisiBlockHtmlToMarkdown/);
    assert.match(blockSource, /data-pisi-bullet-indent/);
    assert.match(blockSource, /--pisi-bullet-indent/);
});
test('heading section system and bullet block system do not conflict', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    const styles = read('styles/92-compatibility.css');

    // Keydown prioritization and isolation
    assert.match(wordSource, /pisiBlockType === 'bullet' \|\| block\.dataset\?\.pisiBlockType === 'task'/);
    assert.match(blockSource, /handlePisiBulletKeydown[\s\S]*handlePisiHeadingSectionKeydown/);

    // CSS visual guide excludes bullet blocks from heading section padding-left
    assert.ok(styles.includes(":not([data-pisi-block-type^='heading']):not([data-pisi-block-type='bullet'])"));
});

test('toolbar list buttons, slash commands, number blocks, and heading Enter maintain block model and caret placement', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');
    const toolbarSource = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const menuSource = read('renderer/editor/pisi-unified-command-menu.mjs');
    const formatSource = read('renderer/editor/pisi-unified-command-formatting.mjs');

    assert.match(toolbarSource, /insertUnorderedList[\s\S]*applyPisiBlockType/);
    assert.match(menuSource, /placeCaretAtStartOfPisiBlock/);
    assert.match(formatSource, /setPisiBulletIndent/);
    assert.match(wordSource, /isPisiCaretAtBlockStart/);
    assert.match(wordSource, /placePisiWordCaretAtBlockStart/);
    assert.match(blockSource, /window\.placeCaretAtStartOfPisiBlock = placeCaretAtStartOfPisiBlock/);
});

test('Tab capture handler delegates to SiYuan bullet indentation and block normalization preserves empty-block caret', () => {
    const regressionsSource = read('renderer/shell/pisi-interaction-regressions.mjs');
    const blocksSource = read('renderer/tags/pisi-editor-blocks.mjs');
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const mapSource = read('renderer/map/pisi-map-workspace.mjs');

    assert.match(regressionsSource, /window\.handlePisiBulletKeydown\(editor,\s*event\)/);
    assert.match(blocksSource, /blockId:\s*block\?\.dataset\?\.pisiBlockId/);
    assert.match(blocksSource, /resolvePisiEditorTextPosition\(block,\s*point\?\.blockTextOffset\)/);
    assert.match(wordSource, /if\s*\(!range\s*\|\|\s*!block\.contains\(range\.startContainer\)\)\s*placePisiWordCaretAtBlockStart\(editor,\s*block,\s*true\)/);
    assert.match(mapSource, /window\.decoratePisiBlockTypes\?\.\(editor\)/);
    assert.match(mapSource, /window\.syncPisiWordHeadingCollapse\?\.\(editor\)/);
});

test('editor paste normalization removes extra blank lines and paragraph spacing from external content', () => {
    const blocksSource = read('renderer/tags/pisi-editor-blocks.mjs');
    const styles = read('styles/92-compatibility.css');

    assert.match(blocksSource, /function handlePisiEditorPaste\(editor,\s*event\)/);
    assert.match(blocksSource, /function extractPisiPasteBlocks\(html = '',\s*plain = ''\)/);
    assert.match(blocksSource, /editor\.addEventListener\('paste'/);
    assert.match(blocksSource, /element\.style\?\.removeProperty\?\.\(prop\)/);
    assert.match(styles, /\.pisi-rich-editor p[\s\S]*margin-top:\s*0;\s*margin-bottom:\s*0;/);
});

test('non-heading blocks require double Enter to exit while 1st Enter inserts line break within block', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const blockSource = read('renderer/editor/pisi-block-editor.mjs');

    assert.match(wordSource, /isPisiCurrentLineEmpty/);
    assert.match(wordSource, /insertLineBreak/);
    assert.match(wordSource, /if \(!isLineEmpty\)/);
    assert.match(wordSource, /nextBlock\.dataset\.pisiBlockType = 'paragraph'/);
    assert.match(blockSource, /handlePisiHeadingSectionKeydown/);
});

test('headings encompass all descendants until next heading of same or higher level and arrow sits in left gutter', () => {
    const wordSource = read('renderer/editor/pisi-editor-word-behavior.mjs');
    const styles = read('styles/92-compatibility.css');

    assert.match(styles, /data-pisi-block-type='heading1'][\s\S]*padding-left:\s*0;/);
    assert.match(styles, /data-pisi-block-type='heading1']::before[\s\S]*left:\s*-22px;/);
    assert.match(wordSource, /currentLevel && currentLevel <= level/);
    assert.match(wordSource, /Array\.from\(editor\.children\)/);
});

test('B3 heading moves keep contiguous sections and resolve destination heading ownership', () => {
    const source = read('renderer/editor/pisi-block-editor.mjs');
    assert.ok(source.includes('function getPisiMovableBlockSection(editor, block)'));
    assert.ok(source.includes('section.some((item, index) => item.parentElement !== editor'));
    assert.ok(source.includes('const targetEnd = getPisiBlockSectionEnd(editor, boundary)'));
    assert.ok(source.includes('targetEnd.after(...items)'));
    assert.ok(source.includes('const boundary = getPisiHeadingBoundary(editor, target, getPisiMoveHeadingLevel(dragged))'));
    assert.ok(source.includes('const anchor = before ? boundary : getPisiBlockSectionEnd(editor, boundary)'));
    assert.ok(source.includes('const anchor = getPisiHeadingBoundary(editor, prev, headingLevel)'));
    assert.ok(source.includes('items.includes(target)'));
    assert.ok(source.includes('window.syncPisiWordHeadingCollapse?.(editor)'));
});

test('B4 normalization preserves direct-block identities, caret selection and direction', () => {
    const source = read('renderer/tags/pisi-editor-blocks.mjs');
    assert.match(source, /Array\.from\(editor\.children\)\.filter/);
    assert.match(source, /const seenBlockIds = new Set\(\)/);
    assert.match(source, /didChangeIdentity = true/);
    assert.match(source, /didMutateDom \|\| didChangeIdentity/);
    assert.match(source, /pathBlock\.dataset\?\.pisiBlockId !== point\?\.blockId/);
    assert.match(source, /selection\.setBaseAndExtent/);
    assert.doesNotMatch(source, /editor\.querySelectorAll\('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'\)\.forEach\(decoratePisiEditorBlock\)/);
});
