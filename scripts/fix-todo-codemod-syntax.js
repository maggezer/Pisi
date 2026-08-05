'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'apply-todo-navigation-filter-fix.js');
const lines = fs.readFileSync(file, 'utf8').split('\n');

function replaceLine(predicate, replacement, label) {
    const index = lines.findIndex(predicate);
    if (index < 0) throw new Error(`${label} target not found.`);
    lines[index] = replacement;
}

replaceLine(
    (line) => line.includes('.pisi-editor-block[data-pisi-block-id=') &&
        line.includes('${escapedBlockId}'),
    "            '.pisi-editor-block[data-pisi-block-id=\"' + escapedBlockId + '\"]'",
    'Block selector template'
);

replaceLine(
    (line) => line.includes('.map-node-box[data-node-path=') &&
        line.includes('${escapedPath}'),
    "        '.map-node-box[data-node-path=\"' + escapedPath + '\"]'",
    'Map node selector template'
);

fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed Todo codemod selector templates.');
