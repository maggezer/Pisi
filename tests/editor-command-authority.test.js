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

test('command authority owns toolbar and unified-menu inline commands', () => {
    const source = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(source, /handlePisiAuthorityToolbarClick/);
    assert.match(source, /button\[data-pisi-unified-command\]/);
    assert.match(source, /handlePisiAuthorityMenuPointerDown/);
    assert.match(source, /pisi-unified-command-option/);
    assert.match(source, /runPisiAuthoritativeMenuInlineCommand/);
    assert.match(source, /applyPisiAuthorityMutationToRange/);
    assert.match(source, /pisi-inline-command-style/);
    assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('legacy slash popup is removed and command typing cleans legacy tag menu', () => {
    const authority = read('renderer/editor/pisi-editor-command-authority.mjs');

    assert.match(authority, /removePisiLegacyBlockSlashMenus/);
    assert.match(authority, /document\.querySelectorAll\('\.pisi-block-slash-menu'\)/);
    assert.match(authority, /\.forEach\(\(menu\) => menu\.remove\(\)\)/);
    assert.match(authority, /schedulePisiLegacyCommandMenuCleanup/);
    assert.match(authority, /window\.closePisiTagMenu\?\.\(\)/);
    assert.match(authority, /event\.key === '\/'/);
    assert.match(authority, /MutationObserver/);
});

test('authority loads after routing and word behavior', () => {
    const bootstrap = read('renderer/bootstrap.mjs');

    const routing = bootstrap.indexOf('pisi-editor-command-routing.mjs');
    const word = bootstrap.indexOf('pisi-editor-word-behavior.mjs');
    const authority = bootstrap.indexOf('pisi-editor-command-authority.mjs');

    assert.ok(routing >= 0);
    assert.ok(word > routing);
    assert.ok(authority > word);
});
