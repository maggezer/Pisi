'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let corePromise = null;
function loadCore() {
    if (!corePromise) {
        corePromise = import(pathToFileURL(
            path.join(root, 'renderer/editor/pisi-editor-text-format-core.mjs')
        ).href);
    }
    return corePromise;
}

test('inline text format core toggles bold and italic deterministically', async () => {
    const core = await loadCore();

    assert.equal(core.isPisiInlineTextCommand('bold'), true);
    assert.equal(core.isPisiInlineTextCommand('italic'), true);
    assert.equal(core.isPisiInlineTextCommand('indent'), false);

    assert.deepEqual(
        core.resolvePisiInlineTextMutation('bold', { fontWeight: '400' }),
        { property: 'fontWeight', value: '700' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('bold', { fontWeight: '700' }),
        { property: 'fontWeight', value: '400' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('italic', { fontStyle: 'normal' }),
        { property: 'fontStyle', value: 'italic' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('italic', { fontStyle: 'italic' }),
        { property: 'fontStyle', value: 'normal' }
    );
});

test('underline and strike preserve the other active decoration', async () => {
    const core = await loadCore();

    assert.deepEqual(
        core.resolvePisiInlineTextMutation('underline', { textDecorationLine: 'line-through' }),
        { property: 'textDecoration', value: 'line-through underline' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('strikeThrough', { textDecorationLine: 'underline line-through' }),
        { property: 'textDecoration', value: 'underline' }
    );
});

test('text authority owns persistent toolbar and command-menu inline formatting', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(source, /handlePisiAuthorityToolbarClick/);
    assert.match(source, /handlePisiAuthorityBeforeInput/);
    assert.match(source, /pisiAuthorityTypingStyles/);
    assert.match(source, /runPisiAuthoritativeMenuInlineCommand/);
    assert.match(source, /applyPisiAuthorityMutationToRange/);
    assert.match(source, /pisi-inline-command-style/);
    assert.match(source, /pisi-typing-style/);
    assert.match(source, /event\.stopImmediatePropagation\(\)/);

    assert.doesNotMatch(source, /pisi-block-slash-menu/);
    assert.doesNotMatch(source, /removePisiLegacyBlockSlashMenus/);
    assert.doesNotMatch(source, /schedulePisiLegacyCommandMenuCleanup/);
    assert.doesNotMatch(source, /handlePisiAuthorityMenuPointerDown/);
});

test('legacy slash popup and legacy slash tag parser are deleted from production source', () => {
    const blocks = read('renderer/editor/pisi-block-editor.mjs');
    const tags = read('renderer/tags/pisi-tag-editor.mjs');
    const routing = read('renderer/editor/pisi-editor-command-routing.mjs');
    const platformStyles = read('styles/59-platform-system.css');
    const interactionStyles = read('styles/92-interaction-fixes.css');

    assert.doesNotMatch(blocks, /ensurePisiSlashMenu|renderPisiSlashMenu|openPisiSlashMenu|isPisiSlashMenuOpen/);
    assert.doesNotMatch(blocks, /pisi-block-slash-menu|pisi-block-slash-item/);
    assert.doesNotMatch(tags, /getPisiEditorCommandAtCaret|updatePisiTagMenuForEditor|buildPisiTagMenuItems/);
    assert.doesNotMatch(tags, /PISI_SYSTEM_TAGS|applyPisiSystemTagToEditor|applyPisiHeadingTagToEditor/);
    assert.doesNotMatch(platformStyles, /pisi-block-slash-menu|pisi-block-slash-item/);
    assert.doesNotMatch(interactionStyles, /pisi-block-slash-menu/);

    assert.match(routing, /function renderPisiRoutedUnifiedMenu/);
    assert.match(routing, /function buildPisiFinalCommandItems/);
    assert.match(routing, /runPisiExtendedUnifiedCommandItem\(editor, command, item\)/);
});

test('single command router loads after tag, block, formatting and text authority services', () => {
    const bootstrap = read('renderer/bootstrap.mjs');

    const tag = bootstrap.indexOf('pisi-tag-editor.mjs');
    const block = bootstrap.indexOf('pisi-block-editor.mjs');
    const unified = bootstrap.indexOf('pisi-unified-command-menu.mjs');
    const formatting = bootstrap.indexOf('pisi-unified-command-formatting.mjs');
    const word = bootstrap.indexOf('pisi-editor-word-behavior.mjs');
    const authority = bootstrap.indexOf('pisi-editor-command-authority.mjs');
    const routing = bootstrap.indexOf('pisi-editor-command-routing.mjs');

    assert.ok(tag >= 0);
    assert.ok(block > tag);
    assert.ok(unified > block);
    assert.ok(formatting > unified);
    assert.ok(word > formatting);
    assert.ok(authority > word);
    assert.ok(routing > authority);
});
