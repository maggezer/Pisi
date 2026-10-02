import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let treeFilterPromise = null;
function loadTreeFilter() {
    if (!treeFilterPromise) {
        treeFilterPromise = import(pathToFileURL(path.join(root, 'renderer/tree/pisi-tree-internal-filter.mjs')).href);
    }
    return treeFilterPromise;
}

test('rich editor preserves repeated spaces as visible caret width', () => {
    const styleIndex = read('style.css');
    const whitespaceStyles = read('styles/99-editor-whitespace.css');

    assert.match(styleIndex, /99-editor-whitespace\.css/);
    assert.match(whitespaceStyles, /\.pisi-rich-editor \.pisi-editor-block,[\s\S]*\.pisi-rich-editor \.pisi-typing-style/);
    assert.match(whitespaceStyles, /white-space: break-spaces;/);
});

test('internal .pisi namespace is hidden without hiding a user map named pisi', async () => {
    const filter = await loadTreeFilter();

    assert.equal(filter.isPisiInternalTreePath('C:\\Project\\.pisi'), true);
    assert.equal(filter.isPisiInternalTreePath('C:\\Project\\.pisi\\mutations'), true);
    assert.equal(filter.isPisiInternalTreePath('/Project/.pisi/mutations/mut_123'), true);
    assert.equal(filter.isPisiInternalTreePath('/Project/.pisi-history'), true);

    assert.equal(filter.isPisiInternalTreePath('C:\\Project\\pisi.map'), false);
    assert.equal(filter.isPisiInternalTreePath('C:\\Project\\pisi\\mutations'), false);
    assert.equal(filter.isPisiInternalTreePath('/Project/Pisi.map'), false);
});

test('internal tree filter is loaded after the normal tree renderer and removes matching DOM nodes', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const filterSource = read('renderer/tree/pisi-tree-internal-filter.mjs');

    const treeView = bootstrap.indexOf('pisi-tree-view.mjs');
    const internalFilter = bootstrap.indexOf('pisi-tree-internal-filter.mjs');

    assert.ok(treeView >= 0);
    assert.ok(internalFilter > treeView);
    assert.match(filterSource, /document\.getElementById\('file-tree'\)/);
    assert.match(filterSource, /MutationObserver/);
    assert.match(filterSource, /node\.remove\(\)/);
    assert.match(filterSource, /segments\.includes\('\.pisi'\)/);
});
