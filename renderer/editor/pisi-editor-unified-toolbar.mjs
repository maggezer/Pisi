import { registerModule } from "../core/module-registry.mjs";

const PISI_FONT_SIZE_LABELS = {
    '1': '8',
    '2': '10',
    '3': '12',
    '4': '14',
    '5': '18',
    '6': '24',
    '7': '32'
};

const PISI_TOOLBAR_ICON_ROOT = 'assets/toolbar';

function pisiToolbarIcon(name) {
    return `<img class="pisi-toolbar-icon" src="${PISI_TOOLBAR_ICON_ROOT}/${name}.svg" alt="" aria-hidden="true">`;
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
                <div class="pisi-toolbar-text-controls">
                    <div class="pisi-toolbar-text-action-stack">
                        <div class="pisi-toolbar-section-row">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="bold" title="Bold">${pisiToolbarIcon('bold')}</button>
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="italic" title="Italic">${pisiToolbarIcon('italic')}</button>
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="strikeThrough" title="Strikethrough">${pisiToolbarIcon('strike')}</button>
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="underline" title="Underline">${pisiToolbarIcon('underline')}</button>
                        </div>
                        <div class="pisi-toolbar-section-row">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="font" title="Font color">${pisiToolbarIcon('font-color')}</button>
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-color-trigger="highlight" title="Highlight; tabloda hücre rengi">${pisiToolbarIcon('highlight')}</button>
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn pisi-ribbon-dropdown" data-pisi-symbol-trigger title="Insert symbol">${pisiToolbarIcon('symbol')}</button>
                        </div>
                    </div>
                    <div class="pisi-toolbar-align-grid" aria-label="Paragraf hizalama">
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyLeft" title="Sola yasla">${pisiToolbarIcon('align-left')}</button>
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyRight" title="Sağa yasla">${pisiToolbarIcon('align-right')}</button>
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyCenter" title="Ortala">${pisiToolbarIcon('align-center')}</button>
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="justifyFull" title="İki yana yasla">${pisiToolbarIcon('align-justify')}</button>
                    </div>
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
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="subscript" title="Subscript">${pisiToolbarIcon('subscript')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="insertUnorderedList" title="Bullet point">${pisiToolbarIcon('bullet-list')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="superscript" title="Superscript">${pisiToolbarIcon('superscript')}</button>
                    <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-unified-command="insertOrderedList" title="Numbering">${pisiToolbarIcon('number-list')}</button>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-table" aria-label="Formül araçları">
                <div class="pisi-toolbar-section-row pisi-toolbar-formula-row">
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="logical" title="Logical formulas">${pisiToolbarIcon('formula-logical')}<span>F1</span></button>
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="text" title="Text formulas">${pisiToolbarIcon('formula-text')}<span>F2</span></button>
                </div>
                <div class="pisi-toolbar-section-row pisi-toolbar-formula-row">
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="math" title="Math formulas">${pisiToolbarIcon('formula-math')}<span>F3</span></button>
                    <button type="button" class="pisi-ribbon-btn pisi-formula-btn pisi-ribbon-dropdown" data-pisi-formula-trigger="personal" title="Personal formulas">${pisiToolbarIcon('formula-personal')}<span>F4</span></button>
                </div>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-excel" aria-label="Tablo araçları">
                <button type="button" class="pisi-ribbon-btn pisi-ribbon-btn-large pisi-icon-tile pisi-ribbon-dropdown" data-pisi-table-trigger title="Tablo ekle">${pisiToolbarIcon('table')}<span>Table</span></button>
            </section>

            <section class="pisi-toolbar-section pisi-toolbar-section-drawing" aria-label="Çizim araçları">
                <div class="pisi-toolbar-drawing-layout">
                    <div class="pisi-toolbar-canvas-column">
                        <button type="button" class="pisi-ribbon-btn pisi-ribbon-btn-canvas pisi-icon-tile" data-pisi-paint-action="createCanvas" draggable="true" title="Canvas oluştur">${pisiToolbarIcon('canvas')}<span>Canvas</span></button>
                        <div class="pisi-toolbar-dimension-row">
                            <label class="pisi-ribbon-number" title="Canvas eni">x<input type="number" min="80" max="1600" step="10" value="520" data-pisi-paint-width></label>
                            <label class="pisi-ribbon-number" title="Canvas boyu">y<input type="number" min="60" max="1200" step="10" value="320" data-pisi-paint-height></label>
                        </div>
                    </div>
                    <div class="pisi-toolbar-draw-grid">
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn active" data-pisi-paint-tool="pencil" title="Pen">${pisiToolbarIcon('pen')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Pen" data-pisi-size-tool="pencil" aria-label="Pen boyutu">${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-shape-trigger data-pisi-paint-tool="rect" title="Shape: Dikdörtgen">${pisiToolbarIcon('shape')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-shape-menu aria-label="Shape seç">${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-paint-tool="brush" title="Brush">${pisiToolbarIcon('brush')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Brush" data-pisi-size-tool="brush" aria-label="Brush boyutu">${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                        <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-lasso-tool disabled title="Kement seçimi sonraki çizim aşamasında etkinleştirilecek">${pisiToolbarIcon('lasso')}</button>
                        <div class="pisi-ribbon-split">
                            <button type="button" class="pisi-ribbon-btn pisi-icon-btn" data-pisi-paint-tool="eraser" title="Erase">${pisiToolbarIcon('eraser')}</button>
                            <button type="button" class="pisi-ribbon-split-arrow" data-pisi-size-trigger="Erase" data-pisi-size-tool="eraser" aria-label="Silgi boyutu">${pisiToolbarIcon('chevron-down')}</button>
                        </div>
                    </div>
                    <input type="hidden" value="4" data-pisi-paint-size>
                    <input type="hidden" value="#f39c12" data-pisi-paint-color>
                </div>
            </section>

        </div>
    `;
}

function getPisiUnifiedToolbarActiveTable(toolbar) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return null;
    const activeCell = window.__pisiActiveSheetCell;
    if (!activeCell || !editor.contains(activeCell)) return null;
    return activeCell.closest('table[data-pisi-sheet]');
}

function runPisiUnifiedTextCommand(toolbar, command, value = null) {
    const table = getPisiUnifiedToolbarActiveTable(toolbar);
    const tableActions = {
        bold: 'toggleBold',
        italic: 'toggleItalic',
        underline: 'toggleUnderline',
        strikeThrough: 'toggleStrikeThrough',
        justifyLeft: 'alignLeft',
        justifyCenter: 'alignCenter',
        justifyRight: 'alignRight',
        justifyFull: 'alignJustify',
        foreColor: 'textColor',
        hiliteColor: 'fillColor',
        fontName: 'fontFamily',
        fontSize: 'fontSize'
    };
    const tableAction = tableActions[command];

    if (table && tableAction) {
        const changed = applyPisiSheetCellFormat(table, tableAction, value);
        if (changed) {
            schedulePisiSheetEditorNotification(table);
            syncPisiSheetToolbarState(toolbar, table);
        }
        return;
    }

    runPisiEditorCommand(toolbar, command, value);
}

function insertPisiToolbarSymbol(toolbar, symbol) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return;
    const activeElement = document.activeElement;
    if (!activeElement || !editor.contains(activeElement)) {
        editor.focus({ preventScroll: true });
    }
    document.execCommand('insertText', false, String(symbol || ''));
    notifyPisiEditorChanged(editor);
}

function syncPisiUnifiedToolbarContext(toolbar) {
    const table = getPisiUnifiedToolbarActiveTable(toolbar);
    toolbar.classList.toggle('pisi-table-context', Boolean(table));
    syncPisiSheetToolbarState(toolbar, table);
}

function bindPisiUnifiedToolbarEvents(toolbar) {
    toolbar.addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) event.preventDefault();
    });

    toolbar.addEventListener('click', (event) => {
        const command = event.target.closest('button[data-pisi-unified-command]');
        if (command) {
            runPisiUnifiedTextCommand(toolbar, command.dataset.pisiUnifiedCommand);
            return;
        }

        const color = event.target.closest('[data-pisi-color-trigger]');
        if (color) {
            openPisiToolbarColorPopover(
                toolbar,
                color,
                color.dataset.pisiColorTrigger
            );
            return;
        }

        const symbol = event.target.closest('[data-pisi-symbol-trigger]');
        if (symbol) {
            openPisiToolbarSymbolPopover(toolbar, symbol);
            return;
        }

        const tableTrigger = event.target.closest('[data-pisi-table-trigger]');
        if (tableTrigger) {
            openPisiToolbarTablePopover(toolbar, tableTrigger);
            return;
        }

        const formula = event.target.closest('[data-pisi-formula-trigger]');
        if (formula) {
            openPisiToolbarFormulaPopover(
                toolbar,
                formula,
                formula.dataset.pisiFormulaTrigger
            );
            return;
        }

        const excelAction = event.target.closest('[data-pisi-excel-action]');
        if (excelAction) {
            runPisiExcelAction(toolbar, excelAction.dataset.pisiExcelAction);
            return;
        }

        const paintAction = event.target.closest('[data-pisi-paint-action]');
        if (paintAction) {
            runPisiPaintAction(toolbar, paintAction.dataset.pisiPaintAction);
            return;
        }

        const sizeTrigger = event.target.closest('[data-pisi-size-trigger]');
        if (sizeTrigger) {
            setPisiPaintTool(toolbar, sizeTrigger.dataset.pisiSizeTool);
            openPisiToolbarSizePopover(
                toolbar,
                sizeTrigger,
                sizeTrigger.dataset.pisiSizeTrigger
            );
            return;
        }

        const shapeMenu = event.target.closest('[data-pisi-shape-menu]');
        if (shapeMenu) {
            openPisiToolbarShapePopover(toolbar, shapeMenu);
            return;
        }

        const paintTool = event.target.closest('[data-pisi-paint-tool]');
        if (paintTool) {
            setPisiPaintTool(toolbar, paintTool.dataset.pisiPaintTool);
        }
    });

    toolbar.addEventListener('change', (event) => {
        const command = event.target.closest('select[data-pisi-unified-command]');
        if (command) {
            runPisiUnifiedTextCommand(
                toolbar,
                command.dataset.pisiUnifiedCommand,
                command.value
            );
            return;
        }

        if (event.target.matches('[data-pisi-paint-width], [data-pisi-paint-height]')) {
            event.target.value = String(Math.max(
                Number(event.target.min) || 1,
                Math.min(Number(event.target.max) || 1600, Number(event.target.value) || 1)
            ));
        }
    });

    const createCanvas = toolbar.querySelector('[data-pisi-paint-action="createCanvas"]');
    createCanvas?.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/x-pisi-paint-canvas', '1');
        event.dataTransfer?.setData('text/plain', 'PISI_CANVAS');
        event.dataTransfer.effectAllowed = 'copy';
    });

    const shapeTrigger = toolbar.querySelector('[data-pisi-shape-trigger]');
    let shapeHoldTimer = null;
    let shapeHeld = false;
    shapeTrigger?.addEventListener('pointerdown', () => {
        shapeHeld = false;
        shapeHoldTimer = setTimeout(() => {
            shapeHeld = true;
            openPisiToolbarShapePopover(toolbar, shapeTrigger);
        }, 450);
    });
    const clearShapeHold = () => {
        if (shapeHoldTimer) clearTimeout(shapeHoldTimer);
        shapeHoldTimer = null;
    };
    shapeTrigger?.addEventListener('pointerup', clearShapeHold);
    shapeTrigger?.addEventListener('pointercancel', clearShapeHold);
    shapeTrigger?.addEventListener('pointerleave', clearShapeHold);
    shapeTrigger?.addEventListener('click', (event) => {
        if (shapeHeld) {
            event.preventDefault();
            event.stopImmediatePropagation();
            shapeHeld = false;
        }
    });

    const editor = getPisiToolbarEditor(toolbar);
    editor?.addEventListener('focusin', () => syncPisiUnifiedToolbarContext(toolbar));
    editor?.addEventListener('pointerup', () => syncPisiUnifiedToolbarContext(toolbar));
}

function setupPisiUnifiedToolbar(toolbar) {
    if (!toolbar || toolbar.dataset.unifiedBound === '1') return;
    toolbar.innerHTML = buildPisiUnifiedToolbarMarkup();
    bindPisiUnifiedToolbarEvents(toolbar);
    toolbar.dataset.unifiedBound = '1';
    window.mountPisiToolbarExtensions?.(toolbar);
    syncPisiUnifiedToolbarContext(toolbar);
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    PISI_FONT_SIZE_LABELS: { enumerable: true, get() { return PISI_FONT_SIZE_LABELS; } },
    buildPisiUnifiedToolbarMarkup: { enumerable: true, get() { return buildPisiUnifiedToolbarMarkup; } },
    getPisiUnifiedToolbarActiveTable: { enumerable: true, get() { return getPisiUnifiedToolbarActiveTable; } },
    runPisiUnifiedTextCommand: { enumerable: true, get() { return runPisiUnifiedTextCommand; } },
    insertPisiToolbarSymbol: { enumerable: true, get() { return insertPisiToolbarSymbol; } },
    syncPisiUnifiedToolbarContext: { enumerable: true, get() { return syncPisiUnifiedToolbarContext; } },
    bindPisiUnifiedToolbarEvents: { enumerable: true, get() { return bindPisiUnifiedToolbarEvents; } },
    setupPisiUnifiedToolbar: { enumerable: true, get() { return setupPisiUnifiedToolbar; } }
});
registerModule('editor.unifiedToolbar', moduleApi);
