'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolbarPath = path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs');
const sheetPath = path.join(root, 'renderer/editor/pisi-editor-sheet-structure.mjs');
const cssPath = path.join(root, 'styles/65-unified-toolbar.css');
const iconPath = path.join(root, 'assets/toolbar/align-justify.svg');
const iconTestPath = path.join(root, 'tests/toolbar-icons.test.js');
const refinementTestPath = path.join(root, 'tests/toolbar-refinement.test.js');

function replaceOnce(source, from, to, label) {
    if (!source.includes(from)) {
        throw new Error(`Missing ${label}`);
    }
    return source.replace(from, to);
}

let toolbar = fs.readFileSync(toolbarPath, 'utf8');
const textStart = toolbar.indexOf(
    '                <div class="pisi-toolbar-section-row">\n' +
    '                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="bold"'
);
const stylesStart = toolbar.indexOf(
    '\n            <section class="pisi-toolbar-section pisi-toolbar-section-styles"',
    textStart
);
if (textStart < 0 || stylesStart < 0) {
    throw new Error('Unable to locate text toolbar body');
}

const textBody = [
    '                <div class="pisi-toolbar-text-controls">',
    '                    <div class="pisi-toolbar-align-grid" aria-label="Paragraf hizalama">',
    '                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyLeft" title="Sola yasla">${pisiToolbarIcon(\'align-left\')}</button>',
    '                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyRight" title="Sağa yasla">${pisiToolbarIcon(\'align-right\')}</button>',
    '                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyCenter" title="Ortala">${pisiToolbarIcon(\'align-center\')}</button>',
    '                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyFull" title="İki yana yasla">${pisiToolbarIcon(\'align-justify\')}</button>',
    '                    </div>',
    '                    <div class="pisi-toolbar-text-action-stack">',
    '                        <div class="pisi-toolbar-section-row">',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="bold" title="Bold">${pisiToolbarIcon(\'bold\')}</button>',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="italic" title="Italic">${pisiToolbarIcon(\'italic\')}</button>',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="strikeThrough" title="Strikethrough">${pisiToolbarIcon(\'strike\')}</button>',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="underline" title="Underline">${pisiToolbarIcon(\'underline\')}</button>',
    '                        </div>',
    '                        <div class="pisi-toolbar-section-row">',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="font" title="Font color">${pisiToolbarIcon(\'font-color\')}</button>',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="highlight" title="Highlight; tabloda hücre rengi">${pisiToolbarIcon(\'highlight\')}</button>',
    '                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-symbol-trigger title="Insert symbol">${pisiToolbarIcon(\'symbol\')}</button>',
    '                        </div>',
    '                    </div>',
    '                </div>',
    '            </section>',
    ''
].join('\n');

toolbar = toolbar.slice(0, textStart) + textBody + toolbar.slice(stylesStart);
toolbar = replaceOnce(
    toolbar,
    "        justifyRight: 'alignRight',\n",
    "        justifyRight: 'alignRight',\n        justifyFull: 'alignJustify',\n",
    'justify command mapping'
);
fs.writeFileSync(toolbarPath, toolbar);

let sheet = fs.readFileSync(sheetPath, 'utf8');
sheet = replaceOnce(
    sheet,
    "    } else if (action === 'alignRight') {\n        cells.forEach((cell) => {\n            cell.style.textAlign = 'right';\n        });\n    } else if (action === 'textColor' && value) {",
    "    } else if (action === 'alignRight') {\n        cells.forEach((cell) => {\n            cell.style.textAlign = 'right';\n        });\n    } else if (action === 'alignJustify') {\n        cells.forEach((cell) => {\n            cell.style.textAlign = 'justify';\n        });\n    } else if (action === 'textColor' && value) {",
    'table justify formatting'
);
fs.writeFileSync(sheetPath, sheet);

let css = fs.readFileSync(cssPath, 'utf8');
css = replaceOnce(
    css,
    '    grid-template-columns: 232px 148px 104px 76px 244px minmax(40px, 1fr);',
    '    grid-template-columns: 250px 118px 104px 76px 282px minmax(40px, 1fr);',
    'toolbar columns'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-section {\n    min-width: 0;\n    display: flex;\n    flex-direction: column;\n    justify-content: flex-start;\n    gap: 4px;\n    padding: 6px;\n    border: 1px solid #3a3b40;\n    border-radius: 7px;\n    background: linear-gradient(180deg, #303135 0%, #292a2e 100%);\n    box-shadow: inset 0 1px rgba(255, 255, 255, 0.035), 0 1px 2px rgba(0, 0, 0, 0.24);\n}`,
    `.pisi-toolbar-section {\n    min-width: 0;\n    display: flex;\n    flex-direction: column;\n    justify-content: flex-start;\n    gap: 4px;\n    padding: 6px 10px 6px 6px;\n    border: 0;\n    border-right: 1px solid #3a3b40;\n    border-radius: 0;\n    background: transparent;\n    box-shadow: none;\n}`,
    'section surface'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-section-reserved {\n    border-color: transparent;\n    background: transparent;\n    box-shadow: none;\n}`,
    `.pisi-toolbar-section-reserved {\n    border-right: 0;\n    background: transparent;\n    box-shadow: none;\n}`,
    'reserved section'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-section-row-top {\n    min-height: 28px;\n}`,
    `.pisi-toolbar-section-row-top {\n    min-height: 28px;\n}\n\n.pisi-toolbar-text-controls {\n    display: grid;\n    grid-template-columns: 56px minmax(0, 1fr);\n    align-items: start;\n    gap: 7px;\n}\n\n.pisi-toolbar-align-grid {\n    display: grid;\n    grid-template-columns: repeat(2, 26px);\n    grid-template-rows: repeat(2, 26px);\n    gap: 4px;\n}\n\n.pisi-toolbar-text-action-stack {\n    min-width: 0;\n    display: grid;\n    align-content: start;\n    gap: 4px;\n}`,
    'text toolbar layout'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-style-grid {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    gap: 4px;\n}\n\n.pisi-toolbar-style-grid .pisi-ribbon-btn {\n    width: 100%;\n}`,
    `.pisi-toolbar-style-grid {\n    display: grid;\n    grid-template-columns: repeat(2, 26px);\n    grid-auto-rows: 26px;\n    justify-content: start;\n    align-content: start;\n    gap: 4px;\n}\n\n.pisi-toolbar-style-grid .pisi-ribbon-btn {\n    width: 26px;\n    min-width: 26px;\n}`,
    'fixed style buttons'
);
css = replaceOnce(
    css,
    '    grid-template-columns: 64px 1fr;',
    '    grid-template-columns: 112px minmax(0, 1fr);',
    'drawing columns'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-canvas-column {\n    display: flex;\n    flex-direction: column;\n    gap: 4px;\n}`,
    `.pisi-toolbar-canvas-column {\n    width: 112px;\n    display: flex;\n    flex-direction: column;\n    align-items: flex-start;\n    gap: 4px;\n}`,
    'canvas column'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-dimension-row {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    gap: 3px;\n}`,
    `.pisi-toolbar-dimension-row {\n    width: 108px;\n    display: grid;\n    grid-template-columns: repeat(2, 52px);\n    gap: 4px;\n}`,
    'canvas dimensions'
);
css = replaceOnce(
    css,
    `.pisi-ribbon-number {\n    height: 24px;\n    min-width: 0;`,
    `.pisi-ribbon-number {\n    width: 52px;\n    height: 24px;\n    min-width: 52px;`,
    'dimension input width'
);
css = replaceOnce(
    css,
    '        grid-template-columns: 232px 148px 104px 76px 244px 40px;',
    '        grid-template-columns: 250px 118px 104px 76px 282px 40px;',
    'responsive toolbar columns'
);
fs.writeFileSync(cssPath, css);

fs.writeFileSync(iconPath, `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d8d8da" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">\n  <path d="M5 6h14M5 10h14M5 14h14M5 18h14"/>\n  <path stroke="#f39c12" d="M5 21h14"/>\n</svg>\n`);

let iconTest = fs.readFileSync(iconTestPath, 'utf8');
iconTest = replaceOnce(
    iconTest,
    '    "align-right",\n',
    '    "align-right",\n    "align-justify",\n',
    'justify icon test entry'
);
fs.writeFileSync(iconTestPath, iconTest);

fs.writeFileSync(refinementTestPath, `'use strict';\n\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst test = require('node:test');\n\nconst root = path.resolve(__dirname, '..');\nconst read = (file) => fs.readFileSync(path.join(root, file), 'utf8');\n\ntest('toolbar sections use separators and alignment controls use a fixed 2x2 grid', () => {\n    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');\n    const css = read('styles/65-unified-toolbar.css');\n    assert.match(toolbar, /data-pisi-unified-command="justifyFull"/);\n    assert.match(toolbar, /pisiToolbarIcon\\('align-justify'\\)/);\n    assert.match(css, /pisi-toolbar-align-grid[\\s\\S]*repeat\\(2, 26px\\)/);\n    assert.match(css, /pisi-toolbar-section[\\s\\S]*border-right: 1px solid #3a3b40/);\n    assert.match(css, /pisi-toolbar-section[\\s\\S]*background: transparent/);\n});\n\ntest('table cells support justify and compact style buttons stay fixed width', () => {\n    const sheet = read('renderer/editor/pisi-editor-sheet-structure.mjs');\n    const css = read('styles/65-unified-toolbar.css');\n    assert.match(sheet, /action === 'alignJustify'/);\n    assert.match(sheet, /textAlign = 'justify'/);\n    assert.match(css, /pisi-toolbar-style-grid \\.pisi-ribbon-btn[\\s\\S]*width: 26px/);\n});\n\ntest('canvas dimensions provide four-digit input space', () => {\n    const css = read('styles/65-unified-toolbar.css');\n    assert.match(css, /pisi-toolbar-dimension-row[\\s\\S]*repeat\\(2, 52px\\)/);\n    assert.match(css, /pisi-ribbon-number[\\s\\S]*min-width: 52px/);\n});\n`);

console.log('Toolbar separators, alignment grid and canvas dimensions refined.');
