const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles/118-center-dynamic-divider.css'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'renderer/shell/pisi-center-tab-divider.mjs'), 'utf8');
const styleIndex = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'renderer/bootstrap.mjs'), 'utf8');

assert.match(styleIndex, /118-center-dynamic-divider\.css/, 'dynamic center divider stylesheet should be loaded');
assert.match(bootstrap, /pisi-center-tab-divider\.mjs/, 'dynamic center divider module should be loaded');
assert.match(css, /width:\s*var\(--pisi-center-divider-width,\s*0px\)/, 'divider width should be controlled by the measured last tab edge');
assert.match(moduleSource, /querySelectorAll\('\.center-tab'\)/, 'divider should measure open center tabs');
assert.match(moduleSource, /const lastTab = openTabs\.at\(-1\)/, 'divider should follow the final visible open tab');
assert.match(moduleSource, /getComputedStyle\(tabs\)/, 'divider should read the live tab-strip spacing');
assert.match(moduleSource, /tabsStyle\.paddingLeft/, 'divider should reuse the left tab-strip padding as its trailing gap');
assert.match(moduleSource, /lastTabRect\.right - toolbarRect\.left \+ trailingGap/, 'divider should extend beyond the last tab by the matching left-side gap');
assert.match(moduleSource, /--pisi-center-divider-width/, 'measured width should be written to the center toolbar CSS variable');
assert.match(moduleSource, /MutationObserver/, 'divider should update when tabs open, close, rename, or change state');
assert.match(moduleSource, /ResizeObserver/, 'divider should update when the toolbar or tab strip resizes');

console.log('center dynamic divider regression checks passed');
