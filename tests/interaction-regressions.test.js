'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('interaction regression layer is loaded by renderer bootstrap', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    assert.match(bootstrap, /import\s+["\']\.\/shell\/pisi-interaction-regressions\.mjs["\'];/);
});

test('map edge deletion has one canonical handler and does not steal editor focus', () => {
    const edges = read('renderer/map/pisi-map-edges.mjs');
    const regressions = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(edges, /async function deleteMapEdge\(edgeId\)/);
    assert.match(edges, /pisiConfirm\('Bu bağlantı silinsin mi\?'/);
    assert.match(edges, /deleteMapConnection/);
    assert.match(edges, /resetPisiMapConnectionInteractions\(\)/);

    // A delayed renderer/body refocus can blur a rename input or editor that
    // the user opens immediately after deleting an edge.
    assert.doesNotMatch(edges, /setTimeout\([\s\S]{0,160}refocusPisiRenderer/);
    assert.doesNotMatch(edges, /resetPisiKeyboardAndPointerState\(\)/);

    // Deletion must not be duplicated by the regression capture layer.
    assert.doesNotMatch(regressions, /deletePisiMapEdgeSafely/);
    assert.doesNotMatch(regressions, /handlePisiMapEdgeDeleteCapture/);
    assert.doesNotMatch(regressions, /addEventListener\('click',\s*handlePisiMapEdgeDeleteCapture/);
});

test('map rename closes outside without leaking the same pointer event', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /querySelector\('\.map-node-title-input'\)/);
    assert.match(source, /document\.addEventListener\('mousedown', finishPisiMapRenameOnOutsidePointer, true\)/);
    assert.match(source, /document\.addEventListener\('contextmenu', finishPisiMapRenameOnOutsideContextMenu, true\)/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /event\.stopImmediatePropagation\(\)/);
    assert.match(source, /input\.blur\(\)/);
});

test('map rename finishes before the same node opens in modal', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /box\.querySelector\('\.map-node-title-input'\)\?\.blur/);
    assert.match(source, /waitForPisiMapRename/);
    assert.match(source, /preview && event\.type !== 'dblclick'/);
    assert.match(source, /openButton && event\.type !== 'click'/);
    assert.match(source, /window\.openNodeModalFromBox/);
});

test('Tab inserts indentation into rich text blocks instead of leaving editor', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /'\\u00a0'\.repeat\(4\)/);
    assert.match(source, /event\.key !== 'Tab'/);
    assert.ok(source.includes('.pisi-rich-editor[contenteditable="true"]'));
    assert.match(source, /const nestedEditable = event\.target\?\.closest\?\.\('\[contenteditable="true"\]'\)/);
    assert.match(source, /nestedEditable && nestedEditable !== editor/);
    assert.doesNotMatch(source, /event\.target !== editor/);
    assert.match(source, /range\.insertNode\(tabNode\)/);
    assert.match(source, /new Event\('input', \{ bubbles: true \}\)/);
});

test('visible node modal owns Escape before background rename handlers', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');

    assert.match(source, /async function handlePisiNodeModalEscapeCapture/);
    assert.match(source, /modalOverlay\?\.classList\.contains\('visible'\)/);
    assert.match(source, /event\.stopImmediatePropagation\(\)/);
    assert.match(source, /window\.closeNodeModalAndSave\?\.\(\)/);
    assert.match(source, /document\.addEventListener\('keydown', handlePisiNodeModalEscapeCapture, true\)/);
});

test('node modal blocks Pisi menu and titlebar language toggle is removed', () => {
    const source = read('renderer/shell/pisi-interaction-regressions.mjs');
    const styleIndex = read('style.css');
    const styles = read('styles/92-interaction-fixes.css');

    assert.match(source, /getElementById\('pisi-language-toggle'\)\?\.remove/);
    assert.match(source, /new MutationObserver/);
    assert.match(source, /pisiTitlebarLanguageObserver\.observe\(controls, \{ childList: true \}\)/);
    assert.match(source, /appMenuButton\.disabled = Boolean\(modalVisible\)/);
    assert.match(source, /closePisiAppMenuForModal\(\)/);

    assert.match(styleIndex, /92-interaction-fixes\.css/);
    assert.match(styles, /html body #pisi-app-menu \{/);
    assert.match(styles, /z-index: 7000/);
    assert.match(styles, /html body #pisi-app-menu-dropdown \{/);
    assert.match(styles, /html body #node-modal-overlay \{/);
    assert.match(styles, /z-index: 30000/);
    assert.match(styles, /backdrop-filter: blur\(6px\)/);
    assert.match(styles, /pointer-events: auto/);
});
