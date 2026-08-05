'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'apply-todo-navigation-filter-fix.js');
const lines = fs.readFileSync(file, 'utf8').split('\n');
const index = lines.findIndex((line) => {
    return line.includes('.pisi-editor-block[data-pisi-block-id=') &&
        line.includes('${escapedBlockId}');
});

if (index < 0) {
    throw new Error('Nested selector template target not found.');
}

lines[index] = "            '.pisi-editor-block[data-pisi-block-id=\"' + escapedBlockId + '\"]'";
fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed Todo codemod selector template.');
