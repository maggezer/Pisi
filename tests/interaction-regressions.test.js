'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('interaction regression layer is loaded by renderer bootstrap', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    assert.match(
        bootstrap,
        /import "\.\/shell\/pisi-interaction-regressions\.mjs";/
    );
});

test('map edge deletion restores renderer interaction state', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /closest\?\.\('\.map-edge-delete'\)/);
    assert.match(source, /window\.pisiConfirm/);
    assert.match(source, /deleteMapConnection/);
    assert.match(source, /resetPisiMapConnectionInteractions/);
    assert.match(source, /resetPisiKeyboardAndPointerState/);
    assert.match(source, /refocusPisiRenderer/);
    assert.match(source, /stopImmediatePropagation/);
});

test('map rename closes outside and finishes before node modal opens', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /querySelector\('\.map-node-title-input'\)/);
    assert.match(source, /document\.addEventListener\('mousedown', finishPisiMapRenameOnOutsidePointer, true\)/);
    assert.match(source, /box\.querySelector\('\.map-node-title-input'\)\?\.blur/);
    assert.match(source, /waitForPisiMapRename/);
    assert.match(source, /window\.openNodeModalFromBox/);
});

test('Tab inserts indentation into rich text instead of leaving editor', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /'\\u00a0'\.repeat\(4\)/);
    assert.match(source, /event\.key !== 'Tab'/);
    assert.match(source, /\.pisi-rich-editor\[contenteditable=\\"true\\"\]/);
    assert.match(source, /range\.insertNode\(tabNode\)/);
    assert.match(source, /new Event\('input', \{ bubbles: true \}\)/);
});

test('node modal covers Pisi menu and titlebar language toggle is removed', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');
    const styleIndex = read('style.css');
    const styles = read('styles/92-interaction-fixes.css');

    assert.match(source, /getElementById\('pisi-language-toggle'\)\?\.remove/);
    assert.match(styleIndex, /92-interaction-fixes\.css/);
    assert.match(styles, /html body #pisi-app-menu \{/);
    assert.match(styles, /z-index: 7000/);
    assert.match(styles, /html body #pisi-app-menu-dropdown \{/);
    assert.doesNotMatch(styles, /z-index:\s*(?:8\d{3}|[1-9]\d{4,})/);
});
