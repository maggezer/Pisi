'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolbarPath = path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs');
const cssPath = path.join(root, 'styles/65-unified-toolbar.css');
const unifiedTestPath = path.join(root, 'tests/unified-toolbar.test.js');
const invariantTestPath = path.join(root, 'tests/source-invariants.test.js');
const iconTestPath = path.join(root, 'tests/toolbar-icons.test.js');
const iconDir = path.join(root, 'assets/toolbar');

const svg = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d8d8da" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
${body}
</svg>
`;

const icons = {
    bold: svg('  <path d="M7 4h6a4 4 0 0 1 0 8H7z"/><path d="M7 12h7a4 4 0 0 1 0 8H7z"/>'),
    italic: svg('  <path d="M10 4h8M6 20h8M14 4 10 20"/>'),
    strike: svg('  <path d="M8 8c0-2 1.8-3.5 4.5-3.5 2 0 3.4.7 4.2 1.8"/><path d="M16.5 15c-.2 2.8-2.1 4.5-5 4.5-2.2 0-3.9-.8-4.8-2.2"/><path stroke="#f39c12" d="M4 12h16"/>'),
    underline: svg('  <path d="M7 4v7a5 5 0 0 0 10 0V4"/><path stroke="#f39c12" d="M5 20h14"/>'),
    'align-left': svg('  <path d="M5 6h14M5 10h10M5 14h14M5 18h8"/>'),
    'align-center': svg('  <path d="M5 6h14M7 10h10M5 14h14M8 18h8"/>'),
    'align-right': svg('  <path d="M5 6h14M9 10h10M5 14h14M11 18h8"/>'),
    'font-color': svg('  <path d="m7 18 5-13 5 13M9 13h6"/><path stroke="#f39c12" stroke-width="3" d="M5 21h14"/>'),
    highlight: svg('  <path d="m7 15 7-9 4 4-7 9H7z"/><path stroke="#f39c12" stroke-width="3" d="M5 21h14"/>'),
    symbol: svg('  <path d="M17 6a6 6 0 1 0 0 12"/><path stroke="#f39c12" d="M14 9h5M14 15h5"/>'),
    subscript: svg('  <path d="m5 6 6 9M11 6l-6 9"/><path stroke="#f39c12" d="M14 16h4l-4 4h4"/>'),
    superscript: svg('  <path d="m5 8 6 9M11 8l-6 9"/><path stroke="#f39c12" d="M14 4h4l-4 4h4"/>'),
    'bullet-list': svg('  <circle cx="5" cy="7" r="1" fill="#f39c12" stroke="none"/><circle cx="5" cy="12" r="1" fill="#f39c12" stroke="none"/><circle cx="5" cy="17" r="1" fill="#f39c12" stroke="none"/><path d="M9 7h10M9 12h10M9 17h10"/>'),
    'number-list': svg('  <path stroke="#f39c12" d="M4 6h2v4M4 13h2l-2 3h2M4 19h2"/><path d="M9 7h10M9 12h10M9 17h10"/>'),
    'formula-logical': svg('  <circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 7h3a3 3 0 0 1 3 3v5a3 3 0 0 0 2 3M14 10a4 4 0 0 1 2-4"/><path stroke="#f39c12" d="m4.8 7 1 1 1.8-2"/>'),
    'formula-text': svg('  <path stroke="#f39c12" d="M5 5h9M9.5 5v14"/><path d="M15 10h4M15 14h4M15 18h4"/>'),
    'formula-math': svg('  <path stroke="#f39c12" d="M18 5H8l6 7-6 7h10"/><path d="M5 8h2M5 16h2"/>'),
    'formula-personal': svg('  <circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0"/><path stroke="#f39c12" d="m18 5 .8 1.5 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.5.8.3-1.7-1.2-1.2 1.7-.3z"/>'),
    table: svg('  <rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M9 4v16M15 4v16M4 14h16"/><path stroke="#f39c12" d="M4 9h16"/>'),
    canvas: svg('  <rect x="4" y="5" width="16" height="14" rx="2"/><path d="m7 16 3-4 3 3 2-2 2 3"/><circle cx="15.5" cy="9" r="1.3" fill="#f39c12" stroke="none"/>'),
    pen: svg('  <path d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5z"/><path stroke="#f39c12" d="m14.8 6.5 2.7 2.7"/>'),
    brush: svg('  <path d="m14 5 5 5-7 7-5-5z"/><path d="M7 12c-2 1-3 3-2 6 3 1 5 0 6-2"/><path stroke="#f39c12" d="m13 6 5 5"/>'),
    eraser: svg('  <path d="m6 17 8-11 5 4-7 10H8z"/><path stroke="#f39c12" d="m10 14 5 4M5 20h14"/>'),
    shape: svg('  <rect x="4" y="5" width="8" height="8" rx="1"/><circle cx="16.5" cy="15.5" r="3.5" stroke="#f39c12"/>'),
    lasso: svg('  <path d="M18 7c3 4 0 9-6 9-5 0-8-2-8-5 0-4 5-7 10-6 2 .3 3.2 1 4 2z"/><path stroke="#f39c12" d="M12 16c0 3 2 4 4 3"/>'),
    'chevron-down': svg('  <path stroke="#f39c12" d="m7 9 5 5 5-5"/>')
};

const toolbarHead = String.raw`const PISI_TOOLBAR_ICON_ROOT = 'assets/toolbar';

function pisiToolbarIcon(name) {
    return `<img class="pisi-toolbar-icon" src="\${PISI_TOOLBAR_ICON_ROOT}/\${name}.svg" alt="" aria-hidden="true">`;
}

function buildPisiUnifiedToolbarMarkup() {
    return `
        <div class="pisi-unified-toolbar" data-pisi-unified-toolbar>
            <section class="pisi-toolbar-section pisi-toolbar-section-text" aria-label="Temel yazı araçları">
                <div class="pisi-toolbar-section-row pisi-toolbar-section-row-top">
                    <select class="pisi-office-select pisi-font-family-select" data-pisi-unified-command="fontName" title="Font type" aria-label="Font type">
                        <option value="Segoe UI">Segoe UI</option>
                        <option value="Arial">Arial</option>
                        <option value="Calibri">Calibri</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Consolas">Consolas</option>
                    </select>
                    <select class="pisi-office-select pisi-font-size-select" data-pisi-unified-command="fontSize" title="Font size" aria-label="Font size">
                        <option value="1">8</option>
                        <option value="2">10</option>
                        <option value="3" selected>12</option>
                        <option value="4">14</option>
                        <option value="5">18</option>
                        <option value="6">24</option>
                        <option value="7">32</option>
                    </select>
                </div>
                <div class="pisi-toolbar-section-row">
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="bold" title="Bold">\${pisiToolbarIcon('bold')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="italic" title="Italic">\${pisiToolbarIcon('italic')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="strikeThrough" title="Strikethrough">\${pisiToolbarIcon('strike')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="underline" title="Underline">\${pisiToolbarIcon('underline')}</button>
                </div>
                <div class="pisi-toolbar-section-row">
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyLeft" title="Sola yasla">\${pisiToolbarIcon('align-left')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyCenter" title="Ortala">\${pisiToolbarIcon('align-center')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyRight" title="Sağa yasla">\${pisiToolbarIcon('align-right')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="font" title="Font color">\${pisiToolbarIcon('font-color')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="highlight" title="Highlight; tabloda hücre rengi">\${pisiToolbarIcon('highlight')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-symbol-trigger title="Insert symbol">\${pisiToolbarIcon('symbol')}</button>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-styles" aria-label="Yazı stilleri">
                <div class="pisi-toolbar-section-row pisi-toolbar-section-row-top">
                    <select class="pisi-office-select pisi-style-select" data-pisi-unified-command="formatBlock" title="Styles" aria-label="Styles">
                        <option value="div">Normal</option>
                        <option value="h2">Heading 1</option>
                        <option value="h3">Heading 2</option>
                        <option value="h4">Heading 3</option>
                        <option value="blockquote">Quote</option>
                        <option value="pre">Code</option>
                    </select>
                </div>
                <div class="pisi-toolbar-section-row pisi-toolbar-style-grid">
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="subscript" title="Subscript">\${pisiToolbarIcon('subscript')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="insertUnorderedList" title="Bullet point">\${pisiToolbarIcon('bullet-list')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="superscript" title="Superscript">\${pisiToolbarIcon('superscript')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="insertOrderedList" title="Numbering">\${pisiToolbarIcon('number-list')}</button>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-table" aria-label="Formül araçları">
                <div class="pisi-toolbar-section-row pisi-toolbar-formula-row">
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="logical" title="Logical formulas">\${pisiToolbarIcon('formula-logical')}<span>F1</span></button>
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="text" title="Text formulas">\${pisiToolbarIcon('formula-text')}<span>F2</span></button>
                </div>
                <div class="pisi-toolbar-section-row pisi-toolbar-formula-row">
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="math" title="Math formulas">\${pisiToolbarIcon('formula-math')}<span>F3</span></button>
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="personal" title="Personal formulas">\${pisiToolbarIcon('formula-personal')}<span>F4</span></button>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-excel" aria-label="Tablo araçları">
                <button type="button" class="pisi-ribbon-btn pisi-ribbon-btn-large pisi-icon-tile pisi-ribbon-dropdown" data-pisi-table-trigger title="Tablo ekle">\${pisiToolbarIcon('table')}<span>Table</span></button>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-drawing" aria-label="Çizim araçları">
                <div class="pisi-toolbar-drawing-layout">
                    <div class="pisi-toolbar-canvas-column">
                        <button type="button" class="pisi-ribbon-btn pisi-ribbon-btn-canvas pisi-icon-tile" data-pisi-paint-action="createCanvas" draggable="true" title="Canvas oluştur">\${pisiToolbarIcon('canvas')}<span>Canvas</span></button>
                        <div class="pisi-toolbar-dimension-row">
                            <label class="pisi-ribbon-number" title="Canvas eni">x<input type="number" min="80" max="1600" step="10" value="520" data-pisi-paint-width></label>
                            <label class="pisi-ribbon-number" title="Canvas boyu">y<input type="number" min="60" max="1200" step="10" value="320" data-pisi-paint-height></label>
                        </div>
                    </div>
                    <div class="pisi-toolbar-draw-grid">
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn active" data-pisi-paint-tool="pencil" title="Pen">\${pisiToolbarIcon('pen')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Pen" data-pisi-size-tool="pencil" aria-label="Pen boyutu">\${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-shape-trigger data-pisi-paint-tool="rect" title="Shape: Dikdörtgen">\${pisiToolbarIcon('shape')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-shape-menu aria-label="Shape seç">\${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-paint-tool="brush" title="Brush">\${pisiToolbarIcon('brush')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Brush" data-pisi-size-tool="brush" aria-label="Brush boyutu">\${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-lasso-tool disabled title="Kement seçimi sonraki çizim aşamasında etkinleştirilecek">\${pisiToolbarIcon('lasso')}</button>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-paint-tool="eraser" title="Erase">\${pisiToolbarIcon('eraser')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Erase" data-pisi-size-tool="eraser" aria-label="Silgi boyutu">\${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                    </div>
                    <input type="hidden" value="4" data-pisi-paint-size>
                    <input type="hidden" value="#f39c12" data-pisi-paint-color>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-reserved" aria-label="Ayrılmış toolbar alanı"></section>
        </div>
    `;
}

function getPisiUnifiedToolbarActiveTable`;

const toolbarCss = String.raw`.pisi-editor-toolbar {
    min-height: 104px;
    display: block;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
    background: #202124;
    border-bottom: 1px solid #343538;
    scrollbar-width: thin;
    scrollbar-color: #4b4c50 #202124;
}

.pisi-unified-toolbar {
    min-width: 982px;
    min-height: 102px;
    display: grid;
    grid-template-columns: 232px 148px 104px 76px 244px minmax(40px, 1fr);
    align-items: stretch;
    gap: 6px;
    padding: 6px 8px;
    background: linear-gradient(180deg, #26272a 0%, #202124 100%);
}

.pisi-toolbar-section {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 4px;
    padding: 6px;
    border: 1px solid #3a3b40;
    border-radius: 7px;
    background: linear-gradient(180deg, #303135 0%, #292a2e 100%);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.035), 0 1px 2px rgba(0, 0, 0, 0.24);
}

.pisi-toolbar-section-reserved {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
}

.pisi-toolbar-section-row {
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 4px;
}

.pisi-toolbar-section-row-top {
    min-height: 28px;
}

.pisi-office-select {
    height: 28px;
    min-width: 0;
    border: 1px solid #4c4e54;
    border-radius: 5px;
    background: #202124;
    color: #dedee0;
    padding: 0 25px 0 8px;
    font: 12px "Segoe UI", Tahoma, sans-serif;
    outline: none;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

.pisi-office-select:hover,
.pisi-office-select:focus {
    border-color: #f39c12;
    background: #26272a;
    box-shadow: 0 0 0 1px rgba(243, 156, 18, 0.2);
}

.pisi-office-select option {
    background: #252526;
    color: #dedee0;
}

.pisi-font-family-select {
    width: 164px;
}

.pisi-font-size-select {
    width: 44px;
    padding-left: 7px;
    padding-right: 18px;
}

.pisi-style-select {
    width: 100%;
}

.pisi-ribbon-btn,
.pisi-ribbon-split-arrow {
    height: 26px;
    min-width: 26px;
    border: 1px solid #46484e;
    border-radius: 5px;
    background: linear-gradient(180deg, #36373b 0%, #2d2e32 100%);
    color: #e3e3e5;
    padding: 0 6px;
    font: 700 11px/1 "Segoe UI", Tahoma, sans-serif;
    cursor: pointer;
    user-select: none;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease, transform 80ms ease;
}

.pisi-ribbon-btn:hover:not(:disabled),
.pisi-ribbon-split-arrow:hover:not(:disabled),
.pisi-ribbon-btn:focus-visible,
.pisi-ribbon-split-arrow:focus-visible {
    border-color: #f39c12;
    background: linear-gradient(180deg, #463a2b 0%, #382f25 100%);
    box-shadow: 0 0 0 1px rgba(243, 156, 18, 0.16);
    outline: none;
}

.pisi-ribbon-btn:active:not(:disabled),
.pisi-ribbon-split-arrow:active:not(:disabled) {
    transform: translateY(1px);
}

.pisi-ribbon-btn.active,
.pisi-ribbon-btn[aria-pressed="true"] {
    border-color: #f39c12;
    background: linear-gradient(180deg, #5c411f 0%, #473319 100%);
    box-shadow: inset 0 0 0 1px rgba(255, 190, 90, 0.18);
}

.pisi-ribbon-btn:disabled,
.pisi-ribbon-split-arrow:disabled {
    opacity: 0.34;
    cursor: default;
}

.pisi-icon-btn {
    width: 26px;
    padding: 4px;
}

.pisi-toolbar-icon {
    width: 16px;
    height: 16px;
    display: block;
    object-fit: contain;
    pointer-events: none;
}

.pisi-ribbon-dropdown {
    position: relative;
    padding-right: 15px;
}

.pisi-ribbon-dropdown::after {
    content: "";
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 0;
    height: 0;
    border-left: 3px solid transparent;
    border-right: 3px solid transparent;
    border-top: 4px solid #f39c12;
    opacity: 0.9;
}

.pisi-toolbar-style-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
}

.pisi-toolbar-style-grid .pisi-ribbon-btn {
    width: 100%;
}

.pisi-toolbar-formula-row {
    justify-content: center;
    gap: 6px;
}

.pisi-formula-btn {
    width: 42px;
    height: 38px;
    display: grid;
    grid-template-columns: 18px 1fr;
    align-items: center;
    gap: 2px;
    padding: 4px 12px 4px 5px;
}

.pisi-formula-btn .pisi-toolbar-icon {
    width: 17px;
    height: 17px;
}

.pisi-formula-btn span {
    color: #b9bbc0;
    font-size: 8px;
    font-weight: 700;
}

.pisi-toolbar-section-excel {
    align-items: center;
    justify-content: center;
}

.pisi-ribbon-btn-large,
.pisi-ribbon-btn-canvas {
    width: 62px;
    height: 62px;
    padding: 6px;
}

.pisi-icon-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 600;
}

.pisi-icon-tile .pisi-toolbar-icon {
    width: 25px;
    height: 25px;
}

.pisi-toolbar-drawing-layout {
    height: 100%;
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 7px;
}

.pisi-toolbar-canvas-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.pisi-ribbon-btn-canvas {
    width: 60px;
    height: 54px;
}

.pisi-toolbar-dimension-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
}

.pisi-ribbon-number {
    height: 24px;
    min-width: 0;
    display: grid;
    grid-template-columns: 13px minmax(0, 1fr);
    align-items: center;
    overflow: hidden;
    border: 1px solid #46484e;
    border-radius: 5px;
    background: #202124;
    color: #f39c12;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
}

.pisi-ribbon-number input {
    width: 100%;
    min-width: 0;
    height: 22px;
    border: none;
    border-left: 1px solid #46484e;
    background: #202124;
    color: #dedee0;
    padding: 0 2px;
    font-size: 9px;
    outline: none;
    appearance: textfield;
}

.pisi-ribbon-number:focus-within {
    border-color: #f39c12;
}

.pisi-ribbon-number input::-webkit-inner-spin-button,
.pisi-ribbon-number input::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
}

.pisi-toolbar-draw-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(62px, 1fr));
    grid-auto-rows: 26px;
    gap: 5px;
    align-content: start;
}

.pisi-ribbon-split {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(28px, 1fr) 18px;
}

.pisi-ribbon-split .pisi-ribbon-btn {
    min-width: 0;
    width: 100%;
    border-radius: 5px 0 0 5px;
}

.pisi-ribbon-split-arrow {
    min-width: 18px;
    width: 18px;
    padding: 3px;
    border-left: none;
    border-radius: 0 5px 5px 0;
}

.pisi-ribbon-split-arrow .pisi-toolbar-icon {
    width: 11px;
    height: 11px;
}

.pisi-office-popover {
    position: fixed;
    z-index: 12000;
    min-width: 190px;
    max-width: min(420px, calc(100vw - 16px));
    padding: 8px;
    border: 1px solid #aeb2b8;
    border-radius: 5px;
    background: #f7f7f8;
    color: #202124;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.38);
    font-family: "Segoe UI", Arial, sans-serif;
}

.pisi-office-popover-title {
    margin-bottom: 7px;
    padding: 2px 3px 6px;
    border-bottom: 1px solid #d7d9dd;
    color: #2a2c31;
    font-size: 12px;
    font-weight: 800;
}

.pisi-office-color-grid {
    display: grid;
    grid-template-columns: repeat(6, 25px);
    gap: 4px;
}

.pisi-office-color-swatch {
    width: 25px;
    height: 25px;
    border: 1px solid #979ba2;
    border-radius: 2px;
    cursor: pointer;
}

.pisi-office-color-swatch:hover,
.pisi-office-color-swatch:focus-visible {
    outline: 2px solid #f39c12;
    outline-offset: 1px;
}

.pisi-office-custom-color {
    min-height: 31px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    padding: 5px 7px;
    border-top: 1px solid #d7d9dd;
    font-size: 12px;
    font-weight: 700;
}

.pisi-office-custom-color input {
    width: 42px;
    height: 24px;
    padding: 0;
    border: 1px solid #aeb2b8;
    background: white;
}

.pisi-office-symbol-grid {
    display: grid;
    grid-template-columns: repeat(8, 34px);
    gap: 3px;
}

.pisi-office-symbol-item,
.pisi-office-shape-item {
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #202124;
    cursor: pointer;
}

.pisi-office-symbol-item {
    width: 34px;
    height: 32px;
    font-size: 17px;
}

.pisi-office-symbol-item:hover,
.pisi-office-shape-item:hover {
    border-color: #f39c12;
    background: #fff1dc;
}

.pisi-office-table-grid {
    display: grid;
    grid-template-columns: repeat(10, 19px);
    gap: 3px;
}

.pisi-office-table-cell {
    width: 19px;
    height: 19px;
    padding: 0;
    border: 1px solid #9da1a8;
    background: #ffffff;
    cursor: pointer;
}

.pisi-office-table-cell.selected {
    border-color: #d47800;
    background: #ffd99f;
}

.pisi-office-formula-list {
    min-width: 275px;
    display: grid;
    gap: 3px;
}

.pisi-office-formula-item,
.pisi-office-formula-save {
    width: 100%;
    min-height: 40px;
    display: grid;
    grid-template-columns: 58px 1fr;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #202124;
    text-align: left;
    cursor: pointer;
}

.pisi-office-formula-item span {
    font: 11px Consolas, monospace;
    color: #555b65;
}

.pisi-office-formula-item em {
    grid-column: 1 / -1;
    color: #8a5d1b;
    font-size: 10px;
}

.pisi-office-formula-item:hover:not(:disabled),
.pisi-office-formula-save:hover {
    border-color: #f39c12;
    background: #fff1dc;
}

.pisi-office-formula-item:disabled {
    opacity: 0.58;
    cursor: default;
}

.pisi-office-formula-empty {
    padding: 10px 6px;
    color: #737780;
    font-size: 12px;
}

.pisi-office-formula-save {
    grid-template-columns: 1fr;
    margin-top: 6px;
    border-top: 1px solid #d7d9dd;
    font-weight: 700;
}

.pisi-office-size-control {
    min-width: 235px;
    display: grid;
    grid-template-columns: 1fr 55px;
    align-items: center;
    gap: 9px;
}

.pisi-office-size-control input {
    accent-color: #f39c12;
}

.pisi-office-size-control output {
    color: #444951;
    font: 11px Consolas, monospace;
    text-align: right;
}

.pisi-office-shape-grid {
    min-width: 190px;
    display: grid;
    gap: 3px;
}

.pisi-office-shape-item {
    min-height: 34px;
    display: grid;
    grid-template-columns: 34px 1fr;
    align-items: center;
    padding: 3px 7px;
    text-align: left;
}

.pisi-office-shape-item span {
    font-size: 21px;
    text-align: center;
}
`;

fs.mkdirSync(iconDir, { recursive: true });
for (const [name, content] of Object.entries(icons)) {
    fs.writeFileSync(path.join(iconDir, `${name}.svg`), content);
}

let toolbarSource = fs.readFileSync(toolbarPath, 'utf8');
const toolbarPattern = /function buildPisiUnifiedToolbarMarkup\(\) \{[\s\S]*?\n\}\n\nfunction getPisiUnifiedToolbarActiveTable/;
if (!toolbarPattern.test(toolbarSource)) {
    throw new Error('Unified toolbar markup function was not found.');
}
toolbarSource = toolbarSource.replace(toolbarPattern, toolbarHead);
fs.writeFileSync(toolbarPath, toolbarSource);
fs.writeFileSync(cssPath, toolbarCss);

let unifiedTest = fs.readFileSync(unifiedTestPath, 'utf8');
const nextUnifiedTest = "test('unified text controls also target selected table cells'";
const firstTestStart = unifiedTest.indexOf("test('editor uses one five-section unified toolbar without mode tabs'");
const firstTestEnd = unifiedTest.indexOf(nextUnifiedTest);
if (firstTestStart < 0 || firstTestEnd < 0) {
    throw new Error('Legacy unified toolbar test block was not found.');
}
const currentToolbarTest = String.raw`test('editor preserves the current six-section toolbar selection', () => {
    const html = read('index.html');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab/);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    for (const section of [
        'pisi-toolbar-section-text',
        'pisi-toolbar-section-styles',
        'pisi-toolbar-section-table',
        'pisi-toolbar-section-excel',
        'pisi-toolbar-section-drawing',
        'pisi-toolbar-section-reserved'
    ]) {
        assert.match(toolbar, new RegExp(section));
    }
    for (const formula of ['logical', 'text', 'math', 'personal']) {
        assert.match(toolbar, new RegExp('data-pisi-formula-trigger="' + formula + '"'));
    }
    assert.doesNotMatch(toolbar, /data-pisi-formula-trigger="financial"/);
    assert.doesNotMatch(toolbar, /data-pisi-excel-action="(?:addRow|addCol|deleteRow|deleteCol)"/);
});

`;
unifiedTest = unifiedTest.slice(0, firstTestStart) + currentToolbarTest + unifiedTest.slice(firstTestEnd);
fs.writeFileSync(unifiedTestPath, unifiedTest);

let invariantTest = fs.readFileSync(invariantTestPath, 'utf8');
const invariantStart = invariantTest.indexOf("test('editör iki görünümde tek beş bölümlü toolbar kullanır'");
if (invariantStart < 0) {
    throw new Error('Legacy toolbar source invariant was not found.');
}
const currentInvariant = String.raw`test('editör iki görünümde güncel altı bölümlü toolbarı kullanır', () => {
    const html = read('index.html');
    const css = read('styles/65-unified-toolbar.css');
    const toolbarSource = read('renderer/editor/pisi-editor-unified-toolbar.mjs');

    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab=/);
    assert.ok(css.includes('grid-template-columns: 232px 148px 104px 76px 244px'));

    for (const section of [
        'pisi-toolbar-section-text',
        'pisi-toolbar-section-styles',
        'pisi-toolbar-section-table',
        'pisi-toolbar-section-excel',
        'pisi-toolbar-section-drawing',
        'pisi-toolbar-section-reserved'
    ]) {
        assert.match(toolbarSource, new RegExp(section));
    }
});
`;
invariantTest = invariantTest.slice(0, invariantStart) + currentInvariant;
fs.writeFileSync(invariantTestPath, invariantTest);

const iconNames = Object.keys(icons);
const iconTest = `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const toolbar = fs.readFileSync(
    path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs'),
    'utf8'
);

const iconNames = ${JSON.stringify(iconNames, null, 4)};

test('toolbar uses the Pisi SVG icon set', () => {
    assert.match(toolbar, /PISI_TOOLBAR_ICON_ROOT = 'assets\\/toolbar'/);
    assert.match(toolbar, /class="pisi-toolbar-icon"/);
    for (const name of iconNames) {
        const iconPath = path.join(root, 'assets', 'toolbar', name + '.svg');
        assert.equal(fs.existsSync(iconPath), true, name + ' icon is missing');
        const svg = fs.readFileSync(iconPath, 'utf8');
        assert.match(svg, /<svg[\\s\\S]*viewBox="0 0 24 24"/);
    }
});

test('removed toolbar controls stay removed', () => {
    assert.doesNotMatch(toolbar, /data-pisi-formula-trigger="financial"/);
    assert.doesNotMatch(toolbar, /data-pisi-excel-action="(?:addRow|addCol|deleteRow|deleteCol)"/);
});
`;
fs.writeFileSync(iconTestPath, iconTest);

console.log(`Toolbar polished with ${iconNames.length} SVG icons.`);
