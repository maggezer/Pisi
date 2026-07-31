'use strict';

const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'styles', '65-unified-toolbar.css');
let source = fs.readFileSync(file, 'utf8');
const before = '.pisi-sheet-toolbar-status {';
const after = '.pisi-toolbar-table-actions .pisi-sheet-toolbar-status {';
if (!source.includes(before)) {
    throw new Error('Unified toolbar status selector not found.');
}
source = source.replace(before, after);
fs.writeFileSync(file, source);
console.log('Unified toolbar status selector made context-specific.');
