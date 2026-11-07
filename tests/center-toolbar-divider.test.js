const fs = require('fs');
const path = require('path');
const assert = require('assert');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles', '105-feature-polish.css'), 'utf8');
assert.match(css, /#center-panel\s*>\s*#center-toolbar\s*\{[^}]*border-bottom:\s*0\s*;/s);
assert.match(css, /#center-panel\s*>\s*#workspace\s*\{[^}]*border-top:\s*0\s*;/s);

console.log('center-toolbar-divider: ok');
