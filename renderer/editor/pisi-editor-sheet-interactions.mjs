import { registerModule } from "../core/module-registry.mjs";

const pisiSheetSelections = new WeakMap();

const pisiSheetNotifyTimers = new WeakMap();

let pisiSheetDragSelection = null;

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

        table.addEventListener('mousedown', (/** @type {MouseEvent} */ event) => {
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
                const selectedCells = getPisiSelectedSheetCells(table);
                if (
                    window.__pisiActiveSheetCell !== cell ||
                    selectedCells.length > 1
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
    return table.querySelector(
        `td[data-row="${row}"][data-col="${col}"]`
    );
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
    table.querySelectorAll(
        '.pisi-sheet-cell-selected, .pisi-sheet-cell-range'
    ).forEach((cell) => {
        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-range'
        );
    });

    const selection = pisiSheetSelections.get(table);
    if (!selection) return;

    getPisiSelectedSheetCells(table).forEach((cell) => {
        cell.classList.add('pisi-sheet-cell-range');
    });

    getPisiSheetCell(
        table,
        selection.focus.row,
        selection.focus.col
    )?.classList.add('pisi-sheet-cell-selected');
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
