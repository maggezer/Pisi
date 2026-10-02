'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('ağaç oku dalı, dosya satırı ise yalnız node veya map içeriğini açar', () => {
    const source = read('renderer/tree/pisi-tree-dnd.mjs');
    const scheduler = source.slice(source.indexOf('function schedulePisiTreeFileClick'), source.indexOf('function getPisiTreeDragStateItem'));
    const treeNode = source.slice(source.indexOf('async function createTreeNode'), source.indexOf('async function deleteTreePisiItem'));

    assert.match(treeNode, /toggleControl\?\.addEventListener\('click'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?await toggleChildren\(\)/);
    assert.match(treeNode, /cancelPendingPisiTreeFileClick\(\)/);
    assert.match(treeNode, /event\.target\.closest\('\.tree-toggle'\)/);
    assert.match(treeNode, /schedulePisiTreeFileClick\(item, row\);/);
    assert.doesNotMatch(treeNode, /schedulePisiTreeFileClick\(item, row, toggleChildren\)/);
    assert.doesNotMatch(scheduler, /afterOpen|toggleChildren/);
});
