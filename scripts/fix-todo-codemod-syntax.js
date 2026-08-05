'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'apply-todo-navigation-filter-fix.js');
let source = fs.readFileSync(file, 'utf8');

const before = '            `.pisi-editor-block[data-pisi-block-id=\\"${escapedBlockId}\\"]`';
const after = "            '.pisi-editor-block[data-pisi-block-id=\"' + escapedBlockId + '\"]'";

if (!source.includes(before)) {
    throw new Error('Nested selector template target not found.');
}

source = source.replace(before, after);
fs.writeFileSync(file, source);
console.log('Fixed Todo codemod selector template.');
