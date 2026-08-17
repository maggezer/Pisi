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

test('underline and strike toggle independently without leaving a stuck decoration', async () => {
    const core = await loadCore();

    assert.deepEqual(
        core.resolvePisiInlineTextMutation('strikeThrough', {
            textDecorationLine: 'line-through'
        }),
        { property: 'textDecoration', value: 'none' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('underline', {
            textDecorationLine: 'underline line-through'
        }),
        { property: 'textDecoration', value: 'line-through' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('strikeThrough', {
            textDecorationLine: 'underline line-through'
        }),
        { property: 'textDecoration', value: 'underline' }
    );
    assert.deepEqual(
        core.resolvePisiInlineTextMutation('underline', {
            textDecorationLine: 'line-through'
        }),
        { property: 'textDecoration', value: 'line-through underline' }
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

test('decoration off splits the owning span instead of nesting text-decoration none', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(source, /function splitPisiAuthorityDecorationSelection/);
    assert.match(source, /function splitPisiAuthorityDecorationCaret/);
    assert.match(source, /getPisiAuthorityRemovedDecorations/);
    assert.match(source, /startSpan\.replaceWith\(replacement\)/);
    assert.match(source, /span\.replaceWith\(replacement\)/);
    assert.match(source, /range\.setStart\(caretText, 0\)/);
    assert.match(source, /clone\.classList\.remove\('pisi-typing-style'\)/);
});

test('typing format state only overrides a collapsed caret and resets on navigation', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(source, /const typing = range\?\.collapsed/);
    assert.match(source, /if \(!range\.collapsed\) \{\s*clearPisiAuthorityTypingStyles\(editor\)/);
    assert.match(source, /PISI_AUTHORITY_NAVIGATION_KEYS/);
    assert.match(source, /handlePisiAuthorityNavigationKeydown/);
    assert.match(source, /handlePisiAuthorityEditorPointerUp/);
    assert.match(source, /clearPisiAuthorityTypingStyles\(editor\)/);
});

test('nested underline and strike state is resolved through ancestors', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(source, /function getPisiAuthorityDecorationsAtRange/);
    assert.match(source, /while \(element && editor\.contains\(element\)\)/);
    assert.match(source, /addPisiAuthorityDecorations\(decorations, getComputedStyle\(element\)\)/);
    assert.match(source, /tag === 'u'/);
    assert.match(source, /tag === 's' \|\| tag === 'strike'/);
    assert.match(source, /getPisiAuthorityEffectiveStyle\(editor, range\)/);
});

test('toolbar state has one final inline authority after legacy Word synchronization', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');
    const syncStart = source.indexOf('function syncPisiAuthorityToolbarState');
    const syncEnd = source.indexOf('\n}\n', syncStart);
    const syncBody = source.slice(syncStart, syncEnd);

    assert.ok(syncStart >= 0);
    assert.match(syncBody, /window\.syncPisiWordToolbarState\?\.\(toolbar\)/);
    assert.match(syncBody, /syncPisiAuthorityToolbarTypingState\(editor\)/);
    assert.ok(
        syncBody.indexOf('syncPisiWordToolbarState') <
        syncBody.indexOf('syncPisiAuthorityToolbarTypingState')
    );
    assert.match(source, /function getPisiAuthorityCommandActive/);
    assert.match(source, /getPisiAuthorityCurrentRange\(editor\)/);
    assert.match(source, /window\.addEventListener\('keyup', handlePisiAuthorityPostEditorEvent\)/);
    assert.match(source, /window\.addEventListener\('input', handlePisiAuthorityPostEditorEvent\)/);
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
