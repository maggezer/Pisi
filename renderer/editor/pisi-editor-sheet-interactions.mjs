import { registerModule } from "../core/module-registry.mjs";

const pisiSheetSelections = new WeakMap();

const pisiSheetNotifyTimers = new WeakMap();
const pisiRenderedSheetSelectionCells = new WeakMap();

let pisiSheetDragSelection = null;
let pisiSheetContextMenu = null;
let pisiSheetColumnResize = null;

const PISI_SHEET_MIN_COLUMN_WIDTH = 48;
const PISI_SHEET_MAX_COLUMN_WIDTH = 640;

function setPisiSheetColumnWidth(table, colIndex, width) {
    const nextWidth = Math.max(
        PISI_SHEET_MIN_COLUMN_WIDTH,
        Math.min(PISI_SHEET_MAX_COLUMN_WIDTH, Math.round(width))
    );
    const size = `${nextWidth}px`;
    const header = table.querySelector(
        `thead th[data-col-header="${colIndex}"]`
    );

    [header, ...Array.from(
        table.querySelectorAll(
            `tbody td[data-col="${colIndex}"]`
        )
    )]
        .filter(Boolean)
        .forEach((cell) => {
            cell.style.width = size;
            cell.style.minWidth = size;
            cell.style.maxWidth = size;
        });

    return nextWidth;
}

function startPisiSheetColumnResize(table, resizer, event) {
    const colIndex = Number(resizer.dataset.pisiSheetColResizer);
    const header = table.querySelector(
        `thead th[data-col-header="${colIndex}"]`
    );
    if (!Number.isInteger(colIndex) || !header) return;

    const startWidth = header.getBoundingClientRect().width;
    pisiSheetColumnResize = {
        table,
        colIndex,
        startX: event.clientX,
        startWidth,
        width: startWidth
    };
    document.body.classList.add('pisi-sheet-column-resizing');
}

function movePisiSheetColumnResize(event) {
    const resize = pisiSheetColumnResize;
    if (!resize) return;

    event.preventDefault();
    resize.width = setPisiSheetColumnWidth(
        resize.table,
        resize.colIndex,
        resize.startWidth + event.clientX - resize.startX
    );
}

function finishPisiSheetColumnResize() {
    const resize = pisiSheetColumnResize;
    if (!resize) return;

    pisiSheetColumnResize = null;
    document.body.classList.remove('pisi-sheet-column-resizing');

    if (Math.abs(resize.width - resize.startWidth) >= 1) {
        schedulePisiSheetEditorNotification(resize.table);
    }
}

document.addEventListener('mousemove', movePisiSheetColumnResize, true);
document.addEventListener('mouseup', finishPisiSheetColumnResize, true);

function beginPisiSheetColumnLabelEdit(table, label) {
    const header = label.closest('th[data-col-header]');
    const colIndex = Number(header?.dataset.colHeader);

    if (
        !header ||
        !Number.isInteger(colIndex) ||
        header.querySelector('[data-pisi-sheet-col-editor]')
    ) {
        return;
    }

    const originalLabel = String(label.textContent || '');
    const input = document.createElement('input');
    let finished = false;

    input.type = 'text';
    input.className = 'pisi-sheet-col-editor';
    input.setAttribute('data-pisi-sheet-col-editor', String(colIndex));
    input.setAttribute('aria-label', 'Sütun adını değiştir');
    input.maxLength = 80;
    input.value = originalLabel;

    const finish = (save) => {
        if (finished) return;
        finished = true;

        if (save) {
            setPisiSheetColumnLabel(
                table,
                colIndex,
                input.value
            );
            schedulePisiSheetEditorNotification(table);
        } else {
            label.textContent = originalLabel;
        }

        label.hidden = false;
        input.remove();
    };

    input.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });
    input.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(true), {
        once: true
    });

    label.hidden = true;
    header.insertBefore(
        input,
        header.querySelector('[data-pisi-sheet-col-resizer]')
    );

    input.focus();
    input.select();
}

function closePisiSheetContextMenu() {
    if (!pisiSheetContextMenu) return;
    pisiSheetContextMenu.remove();
    pisiSheetContextMenu = null;
}

function getPisiSheetContextToolbar(table) {
    const editor = getEditorForPisiElement(table);
    if (!editor) return null;
    return document.querySelector(
        `.pisi-editor-toolbar[data-editor-target="${editor.id}"]`
    );
}

function runPisiSheetContextAction(table, action) {
    const toolbar = getPisiSheetContextToolbar(table);
    if (toolbar) {
        runPisiExcelAction(toolbar, action);
        return;
    }

    let changed = false;
    if (action === 'addRow') changed = addPisiSheetRow(table);
    else if (action === 'deleteRow') changed = deletePisiSheetRows(table);
    else if (action === 'addCol') changed = addPisiSheetColumn(table);
    else if (action === 'deleteCol') changed = deletePisiSheetColumns(table);

    if (changed) {
        syncPisiSheetToolbarForTable(table);
        schedulePisiSheetEditorNotification(table);
    }
}

function openPisiSheetContextMenu(table, clientX, clientY) {
    closePisiSheetContextMenu();
    const dimensions = getPisiSheetDimensions(table);
    const actions = [
        { action: 'addRow', label: 'Satır ekle', disabled: dimensions.rows >= PISI_SHEET_MAX_ROWS },
        { action: 'deleteRow', label: 'Satır sil', disabled: dimensions.rows <= 1 },
        { action: 'addCol', label: 'Sütun ekle', disabled: dimensions.cols >= PISI_SHEET_MAX_COLS },
        { action: 'deleteCol', label: 'Sütun sil', disabled: dimensions.cols <= 1 }
    ];
    const menu = document.createElement('div');
    menu.className = 'pisi-sheet-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Tablo satır ve sütun işlemleri');

    actions.forEach(({ action, label, disabled }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('data-pisi-sheet-context-action', action);
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', () => {
            closePisiSheetContextMenu();
            runPisiSheetContextAction(table, action);
        });
        menu.appendChild(button);
    });

    document.body.appendChild(menu);
    pisiSheetContextMenu = menu;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin))}px`;
}

document.addEventListener('pointerdown', (event) => {
    if (pisiSheetContextMenu && !pisiSheetContextMenu.contains(event.target)) {
        closePisiSheetContextMenu();
    }
}, true);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePisiSheetContextMenu();
}, true);
document.addEventListener('scroll', closePisiSheetContextMenu, true);
window.addEventListener('blur', closePisiSheetContextMenu);

document.addEventListener('mouseup', () => {
    if (pisiSheetDragSelection?.table) {
        pisiSheetDragSelection.table.classList.remove(
            'pisi-sheet-drag-selecting'
        );
    }
    pisiSheetDragSelection = null;
}, true);

function hydratePisiSheets(root = document) {
    root.querySelectorAll('table[data-pisi-sheet]').forEach((table) => {
        table.removeAttribute('data-pisi-sheet-bound');

        if (pisiBoundSheets.has(table)) return;

        refreshPisiSheetCellMetadata(table);
        pisiBoundSheets.add(table);

        table.addEventListener('focusin', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell || !table.contains(cell)) return;

            if (!isPisiSheetCellSelected(table, cell)) {
                selectPisiSheetCell(cell);
            } else {
                window.__pisiActiveSheetCell = cell;
                syncPisiSheetFormulaInput(cell);
            }
        });

        table.addEventListener('dblclick', (/** @type {MouseEvent} */ event) => {
            const label = event.target.closest(
                '.pisi-sheet-col-label'
            );

            if (!label || !table.contains(label)) return;

            event.preventDefault();
            event.stopPropagation();
            closePisiSheetContextMenu();
            beginPisiSheetColumnLabelEdit(table, label);
        });

        table.addEventListener('contextmenu', (/** @type {MouseEvent} */ event) => {
            const rowHeader = event.target.closest('tbody th[data-row-header]');
            const colHeader = event.target.closest('thead th[data-col-header]');
            const cell = event.target.closest('td[data-cell]');

            if ((!rowHeader && !colHeader && !cell) || !table.contains(event.target)) return;

            event.preventDefault();
            event.stopPropagation();

            if (rowHeader) {
                selectPisiSheetRow(table, Number(rowHeader.dataset.rowHeader), false);
            } else if (colHeader) {
                selectPisiSheetColumn(table, Number(colHeader.dataset.colHeader), false);
            } else if (cell && !isPisiSheetCellSelected(table, cell)) {
                selectPisiSheetCell(cell);
            }

            openPisiSheetContextMenu(table, event.clientX, event.clientY);
        });

        table.addEventListener('mousedown', (/** @type {MouseEvent} */ event) => {
            const colEditor = event.target.closest(
                '[data-pisi-sheet-col-editor]'
            );
            if (colEditor && table.contains(colEditor)) {
                return;
            }

            const colLabel = event.target.closest(
                '.pisi-sheet-col-label'
            );
            if (
                colLabel &&
                table.contains(colLabel) &&
                event.button === 0 &&
                event.detail >= 2
            ) {
                event.preventDefault();
                event.stopPropagation();
                closePisiSheetContextMenu();
                beginPisiSheetColumnLabelEdit(table, colLabel);
                return;
            }

            const colResizer = event.target.closest(
                '[data-pisi-sheet-col-resizer]'
            );

            if (colResizer && table.contains(colResizer)) {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                closePisiSheetContextMenu();
                startPisiSheetColumnResize(table, colResizer, event);
                return;
            }

            const rowHeader = event.target.closest(
                'tbody th[data-row-header]'
            );
            const colHeader = event.target.closest(
                'thead th[data-col-header]'
            );
            const cornerHeader = event.target.closest(
                'thead th[data-pisi-sheet-corner]'
            );
            const cell = event.target.closest('td[data-cell]');

            if (cornerHeader && table.contains(cornerHeader)) {
                event.preventDefault();
                const dimensions = getPisiSheetDimensions(table);
                if (dimensions.rows && dimensions.cols) {
                    pisiSheetSelections.set(table, {
                        anchor: { row: 0, col: 0 },
                        focus: {
                            row: dimensions.rows - 1,
                            col: dimensions.cols - 1
                        }
                    });
                    const activeCell = getPisiSheetCell(table, 0, 0);
                    window.__pisiActiveSheetCell = activeCell;
                    renderPisiSheetSelection(table);
                    syncPisiSheetFormulaInput(activeCell);
                    syncPisiSheetToolbarForTable(table);
                }
                return;
            }

            if (rowHeader && table.contains(rowHeader)) {
                event.preventDefault();
                selectPisiSheetRow(
                    table,
                    Number(rowHeader.dataset.rowHeader),
                    event.shiftKey
                );
                return;
            }

            if (colHeader && table.contains(colHeader)) {
                event.preventDefault();
                selectPisiSheetColumn(
                    table,
                    Number(colHeader.dataset.colHeader),
                    event.shiftKey
                );
                return;
            }

            if (!cell || !table.contains(cell)) return;
            if (event.button !== 0) return;

            if (event.shiftKey) {
                event.preventDefault();
                selectPisiSheetCell(cell, {
                    extend: true,
                    focus: true
                });
            } else {
                const currentSelection = pisiSheetSelections.get(table);
                const currentRect = currentSelection
                    ? getPisiSheetSelectionRect(
                        currentSelection.anchor,
                        currentSelection.focus
                    )
                    : null;
                const selectedCellCount = currentRect
                    ? (
                        (currentRect.rowEnd - currentRect.rowStart + 1) *
                        (currentRect.colEnd - currentRect.colStart + 1)
                    )
                    : 1;

                if (
                    window.__pisiActiveSheetCell !== cell ||
                    selectedCellCount > 1
                ) {
                    selectPisiSheetCell(cell);
                    requestAnimationFrame(() => {
                        focusPisiSheetCell(cell);
                    });
                }
            }

            const selection = pisiSheetSelections.get(table);
            if (selection) {
                pisiSheetDragSelection = {
                    table,
                    anchor: { ...selection.anchor },
                    last: { ...selection.focus }
                };
            }
        });

        table.addEventListener('mouseover', (/** @type {MouseEvent} */ event) => {
            const drag = pisiSheetDragSelection;
            if (!drag || drag.table !== table) return;
            if (!(event.buttons & 1)) return;

            const cell = event.target.closest('td[data-cell]');
            if (!cell || !table.contains(cell)) return;

            const position = getPisiSheetCellPosition(cell);
            if (!position) return;
            if (
                drag.last.row === position.row &&
                drag.last.col === position.col
            ) {
                return;
            }

            event.preventDefault();
            drag.last = position;
            table.classList.add('pisi-sheet-drag-selecting');
            pisiSheetSelections.set(table, {
                anchor: drag.anchor,
                focus: position
            });
            window.__pisiActiveSheetCell = cell;
            renderPisiSheetSelection(table);
            syncPisiSheetFormulaInput(cell);
            syncPisiSheetToolbarForTable(table);
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell || !table.contains(cell)) return;

            if (event.key === 'Tab') {
                event.preventDefault();
                commitPisiSheetCell(cell);
                movePisiSheetCellFocus(
                    table,
                    cell,
                    0,
                    event.shiftKey ? -1 : 1,
                    {
                        wrap: true,
                        addRowAtEnd: !event.shiftKey
                    }
                );
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                commitPisiSheetCell(cell);
                movePisiSheetCellFocus(
                    table,
                    cell,
                    event.shiftKey ? -1 : 1,
                    0
                );
                return;
            }

            const arrowKeys = [
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight'
            ];

            if (event.shiftKey && arrowKeys.includes(event.key)) {
                event.preventDefault();
                extendPisiSheetSelectionByKeyboard(
                    table,
                    cell,
                    event.key
                );
                return;
            }

            if (
                (event.ctrlKey || event.metaKey) &&
                arrowKeys.includes(event.key)
            ) {
                event.preventDefault();
                const deltas = {
                    ArrowUp: [-1, 0],
                    ArrowDown: [1, 0],
                    ArrowLeft: [0, -1],
                    ArrowRight: [0, 1]
                };
                const [rowDelta, colDelta] = deltas[event.key];

                movePisiSheetCellFocus(
                    table,
                    cell,
                    rowDelta,
                    colDelta
                );
                return;
            }

            if (
                event.key === 'Delete' &&
                getPisiSelectedSheetCells(table).length > 1
            ) {
                event.preventDefault();
                clearPisiSheetSelectedCells(table);
            }
        });

        table.addEventListener('input', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell || !table.contains(cell)) return;

            pisiEditedSheetCells.add(cell);
            syncPisiSheetFormulaInput(cell);
        });

        table.addEventListener('focusout', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell || !table.contains(cell)) return;

            commitPisiSheetCell(cell);
            recalcPisiSheet(table);
            schedulePisiSheetEditorNotification(table);
        });
    });
}

function getPisiSheetDimensions(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    return {
        rows: rows.length,
        cols: Math.max(
            0,
            ...rows.map((row) => row.querySelectorAll('td').length)
        )
    };
}

function getPisiSheetCellPosition(cell) {
    if (!cell) return null;

    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);

    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    return { row, col };
}

function getPisiSheetCell(table, row, col) {
    if (
        !table ||
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        col < 0
    ) {
        return null;
    }

    const tableRow = table.tBodies?.[0]?.rows?.[row];
    return tableRow?.cells?.[col + 1] || null;
}

function getPisiSheetSelectionRect(anchor, focus) {
    if (!anchor || !focus) return null;

    return {
        rowStart: Math.min(anchor.row, focus.row),
        rowEnd: Math.max(anchor.row, focus.row),
        colStart: Math.min(anchor.col, focus.col),
        colEnd: Math.max(anchor.col, focus.col)
    };
}

function isPisiSheetCellSelected(table, cell) {
    const position = getPisiSheetCellPosition(cell);
    if (!position) return false;

    const selection = pisiSheetSelections.get(table);
    if (!selection) {
        return window.__pisiActiveSheetCell === cell;
    }

    const rect = getPisiSheetSelectionRect(
        selection.anchor,
        selection.focus
    );

    return Boolean(
        rect &&
        position.row >= rect.rowStart &&
        position.row <= rect.rowEnd &&
        position.col >= rect.colStart &&
        position.col <= rect.colEnd
    );
}

function getPisiSelectedSheetCells(table) {
    const selection = pisiSheetSelections.get(table);
    const rect = selection
        ? getPisiSheetSelectionRect(
            selection.anchor,
            selection.focus
        )
        : null;

    if (!rect) {
        const activeCell = window.__pisiActiveSheetCell;
        return activeCell && table.contains(activeCell)
            ? [activeCell]
            : [];
    }

    const cells = [];

    for (let row = rect.rowStart; row <= rect.rowEnd; row += 1) {
        for (let col = rect.colStart; col <= rect.colEnd; col += 1) {
            const cell = getPisiSheetCell(table, row, col);
            if (cell) cells.push(cell);
        }
    }

    return cells;
}

function renderPisiSheetSelection(table) {
    const previousCells =
        pisiRenderedSheetSelectionCells.get(table) || new Set();
    const selection = pisiSheetSelections.get(table);
    const nextCells = new Set(
        selection
            ? getPisiSelectedSheetCells(table)
            : []
    );

    for (const cell of previousCells) {
        if (nextCells.has(cell)) continue;
        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-range'
        );
    }

    for (const cell of nextCells) {
        if (!previousCells.has(cell)) {
            cell.classList.add('pisi-sheet-cell-range');
        }
        cell.classList.remove('pisi-sheet-cell-selected');
    }

    if (selection) {
        getPisiSheetCell(
            table,
            selection.focus.row,
            selection.focus.col
        )?.classList.add('pisi-sheet-cell-selected');
    }

    pisiRenderedSheetSelectionCells.set(table, nextCells);
}

function selectPisiSheetCell(cell, options = {}) {
    if (!cell) return;

    const table = cell.closest('table[data-pisi-sheet]');
    const position = getPisiSheetCellPosition(cell);
    if (!table || !position) return;

    const previous = pisiSheetSelections.get(table);
    const anchor = options.extend && previous
        ? previous.anchor
        : position;

    pisiSheetSelections.set(table, {
        anchor,
        focus: position
    });

    window.__pisiActiveSheetCell = cell;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(cell);
    syncPisiSheetToolbarForTable(table);

    if (options.focus) {
        focusPisiSheetCell(cell);
    }
}

function selectPisiSheetRow(table, rowIndex, extend = false) {
    const dimensions = getPisiSheetDimensions(table);
    if (
        !Number.isInteger(rowIndex) ||
        rowIndex < 0 ||
        rowIndex >= dimensions.rows
    ) {
        return;
    }

    const previous = pisiSheetSelections.get(table);
    pisiSheetSelections.set(table, {
        anchor: extend && previous
            ? previous.anchor
            : { row: rowIndex, col: 0 },
        focus: {
            row: rowIndex,
            col: Math.max(0, dimensions.cols - 1)
        }
    });

    const activeCell = getPisiSheetCell(table, rowIndex, 0);
    window.__pisiActiveSheetCell = activeCell;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(activeCell);
    syncPisiSheetToolbarForTable(table);
}

function selectPisiSheetColumn(table, colIndex, extend = false) {
    const dimensions = getPisiSheetDimensions(table);
    if (
        !Number.isInteger(colIndex) ||
        colIndex < 0 ||
        colIndex >= dimensions.cols
    ) {
        return;
    }

    const previous = pisiSheetSelections.get(table);
    pisiSheetSelections.set(table, {
        anchor: extend && previous
            ? previous.anchor
            : { row: 0, col: colIndex },
        focus: {
            row: Math.max(0, dimensions.rows - 1),
            col: colIndex
        }
    });

    const activeCell = getPisiSheetCell(table, 0, colIndex);
    window.__pisiActiveSheetCell = activeCell;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(activeCell);
    syncPisiSheetToolbarForTable(table);
}

function focusPisiSheetCell(cell) {
    if (!cell) return;

    cell.focus({ preventScroll: true });

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);

    selection?.removeAllRanges();
    selection?.addRange(range);
    cell.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
    });
}

function syncPisiSheetFormulaInput(cell) {
    if (!cell) return;

    const editor = getEditorForPisiElement(cell);
    const toolbar = editor
        ? document.querySelector(
            `.pisi-editor-toolbar[data-editor-target="${editor.id}"]`
        )
        : null;
    const formulaInput = toolbar?.querySelector(
        '[data-pisi-excel-formula]'
    );

    if (formulaInput) {
        formulaInput.value =
            cell.dataset.formula ||
            String(cell.textContent || '').trim();
    }
}

function extendPisiSheetSelectionByKeyboard(
    table,
    cell,
    key
) {
    const current = pisiSheetSelections.get(table);
    const dimensions = getPisiSheetDimensions(table);
    const position =
        current?.focus ||
        getPisiSheetCellPosition(cell);

    if (!position) return;

    const deltas = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1]
    };
    const [rowDelta, colDelta] = deltas[key];
    const next = {
        row: Math.max(
            0,
            Math.min(
                dimensions.rows - 1,
                position.row + rowDelta
            )
        ),
        col: Math.max(
            0,
            Math.min(
                dimensions.cols - 1,
                position.col + colDelta
            )
        )
    };

    pisiSheetSelections.set(table, {
        anchor: current?.anchor || position,
        focus: next
    });

    const nextCell = getPisiSheetCell(
        table,
        next.row,
        next.col
    );
    window.__pisiActiveSheetCell = nextCell;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(nextCell);
    syncPisiSheetToolbarForTable(table);
}

function movePisiSheetCellFocus(
    table,
    cell,
    rowDelta,
    colDelta,
    options = {}
) {
    let dimensions = getPisiSheetDimensions(table);
    const position = getPisiSheetCellPosition(cell);
    if (!position) return false;

    let nextRow = position.row + rowDelta;
    let nextCol = position.col + colDelta;

    if (options.wrap && nextCol >= dimensions.cols) {
        nextCol = 0;
        nextRow += 1;
    } else if (options.wrap && nextCol < 0) {
        nextCol = dimensions.cols - 1;
        nextRow -= 1;
    }

    if (
        options.addRowAtEnd &&
        nextRow >= dimensions.rows &&
        dimensions.rows < PISI_SHEET_MAX_ROWS
    ) {
        addPisiSheetRow(table, dimensions.rows - 1);
        dimensions = getPisiSheetDimensions(table);
        nextRow = dimensions.rows - 1;
        nextCol = 0;
    }

    nextRow = Math.max(
        0,
        Math.min(dimensions.rows - 1, nextRow)
    );
    nextCol = Math.max(
        0,
        Math.min(dimensions.cols - 1, nextCol)
    );

    const nextCell = getPisiSheetCell(
        table,
        nextRow,
        nextCol
    );
    if (!nextCell) return false;

    selectPisiSheetCell(nextCell, { focus: true });
    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "pisiSheetSelections": {
        enumerable: true,
        get() { return pisiSheetSelections; }
    },
    "pisiSheetNotifyTimers": {
        enumerable: true,
        get() { return pisiSheetNotifyTimers; }
    },
    "hydratePisiSheets": {
        enumerable: true,
        get() { return hydratePisiSheets; }
    },
    "getPisiSheetDimensions": {
        enumerable: true,
        get() { return getPisiSheetDimensions; }
    },
    "getPisiSheetCellPosition": {
        enumerable: true,
        get() { return getPisiSheetCellPosition; }
    },
    "getPisiSheetCell": {
        enumerable: true,
        get() { return getPisiSheetCell; }
    },
    "getPisiSheetSelectionRect": {
        enumerable: true,
        get() { return getPisiSheetSelectionRect; }
    },
    "getPisiSelectedSheetCells": {
        enumerable: true,
        get() { return getPisiSelectedSheetCells; }
    },
    "renderPisiSheetSelection": {
        enumerable: true,
        get() { return renderPisiSheetSelection; }
    },
    "selectPisiSheetCell": {
        enumerable: true,
        get() { return selectPisiSheetCell; }
    },
    "selectPisiSheetRow": {
        enumerable: true,
        get() { return selectPisiSheetRow; }
    },
    "selectPisiSheetColumn": {
        enumerable: true,
        get() { return selectPisiSheetColumn; }
    },
    "focusPisiSheetCell": {
        enumerable: true,
        get() { return focusPisiSheetCell; }
    },
    "syncPisiSheetFormulaInput": {
        enumerable: true,
        get() { return syncPisiSheetFormulaInput; }
    },
    "extendPisiSheetSelectionByKeyboard": {
        enumerable: true,
        get() { return extendPisiSheetSelectionByKeyboard; }
    },
    "movePisiSheetCellFocus": {
        enumerable: true,
        get() { return movePisiSheetCellFocus; }
    }
});
registerModule("editor.sheetInteractions", moduleApi);
