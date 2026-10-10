'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function walk(directory) {
    const full = path.join(root, directory);
    if (!fs.existsSync(full)) return [];
    const result = [];
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...walk(relative));
        else result.push(relative);
    }
    return result;
}

test('Comic Sans and Comic Neue are reconciled into every editor font list', () => {
    const moduleSource = read('renderer/editor/pisi-editor-system-fonts.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');

    assert.match(moduleSource, /value:\s*'"Comic Sans MS", "Comic Sans", cursive'/);
    assert.match(moduleSource, /label:\s*'Comic Sans MS'/);
    assert.match(moduleSource, /value:\s*'Comic Neue'/);
    assert.match(moduleSource, /label:\s*'Comic Neue'/);
    assert.match(moduleSource, /\.pisi-font-family-select/);
    assert.match(moduleSource, /DOMContentLoaded/);
    assert.match(moduleSource, /setTimeout\(refreshPisiEditorExtraFontOptions, 0\)/);
    assert.match(moduleSource, /document\.addEventListener\(\s*'mousedown'/);
    assert.match(moduleSource, /document\.addEventListener\(\s*'focusin'/);
    assert.match(moduleSource, /loadPisiComicNeueFont/);
    assert.doesNotMatch(moduleSource, /ensurePisiEditorSystemFontOptions|PISI_SYSTEM_FONT_OPTIONS/);
    assert.doesNotMatch(moduleSource, /@font-face/i);
    assert.doesNotMatch(moduleSource, /https?:\/\//i);
    assert.match(bootstrap, /import\s+["\']\.\/editor\/pisi-editor-system-fonts\.mjs["\'];/);
    assert.match(bootstrap, /import\s+["\']\.\/editor\/pisi-editor-bundled-fonts\.mjs["\'];/);

    const bundledComicSansFiles = walk('assets').filter((file) => /comic[\s_-]*sans/i.test(path.basename(file)) && /\.(?:ttf|otf|woff2?|eot)$/i.test(file));
    assert.deepEqual(bundledComicSansFiles, []);
});
