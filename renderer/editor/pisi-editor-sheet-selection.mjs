import { registerModule } from "../core/module-registry.mjs";

const pisiSheetSelections = new WeakMap();
const pisiRenderedSheetSelectionCells = new WeakMap();
const pisiSheetEditStates = new WeakMap();

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
    const rowId = String(cell.dataset.pisiRowId || '');
    const colId = String(cell.dataset.pisiColId || '');

    if (
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        !rowId ||
        !colId
    ) {
        return null;
    }

    return { row, col, rowId, colId };
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

function resolvePisiSheetPoint(table, point) {
    if (!table || !point) return null;

    let cell = null;

    if (point.rowId && point.colId) {
        cell = table.querySelector(
            'tbody tr[data-pisi-row-id="' + point.rowId + '"] ' +
            'td[data-pisi-col-id="' + point.colId + '"]'
        );
    }

    if (
        !cell &&
        Number.isInteger(point.row) &&
        Number.isInteger(point.col)
    ) {
        cell = getPisiSheetCell(table, point.row, point.col);
    }

    return cell ? getPisiSheetCellPosition(cell) : null;
}

function normalizePisiSheetSelection(table) {
    const selection = pisiSheetSelections.get(table);
    if (!selection) return null;

    const anchor = resolvePisiSheetPoint(
        table,
        selection.anchor
    );
    const focus = resolvePisiSheetPoint(
        table,
        selection.focus
    );

    if (!anchor || !focus) {
        pisiSheetSelections.delete(table);
        return null;
    }

    const next = {
        mode: selection.mode || 'cell',
        anchor,
        focus
    };

    pisiSheetSelections.set(table, next);
    return next;
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

function getPisiSelectedSheetCells(table) {
    const selection = normalizePisiSheetSelection(table);
    if (!selection) return [];

    const rect = getPisiSheetSelectionRect(
        selection.anchor,
        selection.focus
    );
    if (!rect) return [];

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
    const previous =
        pisiRenderedSheetSelectionCells.get(table) || new Set();
    const selection = normalizePisiSheetSelection(table);
    const next = new Set(
        selection ? getPisiSelectedSheetCells(table) : []
    );

    for (const cell of previous) {
        if (next.has(cell)) continue;

        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-range'
        );
    }

    for (const cell of next) {
        cell.classList.add('pisi-sheet-cell-range');
        cell.classList.remove('pisi-sheet-cell-selected');
    }

    if (selection) {
        getPisiSheetCell(
            table,
            selection.focus.row,
            selection.focus.col
        )?.classList.add('pisi-sheet-cell-selected');
    }

    pisiRenderedSheetSelectionCells.set(table, next);
}

function reconcilePisiSheetSelection(table) {
    const selection = normalizePisiSheetSelection(table);

    if (!selection) {
        const active = window.__pisiActiveSheetCell;

        if (active && table.contains(active)) {
            window.__pisiActiveSheetCell = null;
        }

        renderPisiSheetSelection(table);
        return false;
    }

    const active = getPisiSheetCell(
        table,
        selection.focus.row,
        selection.focus.col
    );

    window.__pisiActiveSheetCell = active;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(active);
    return true;
}

function clearPisiSheetSelection(table) {
    const previous =
        pisiRenderedSheetSelectionCells.get(table) || new Set();

    for (const cell of previous) {
        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-range'
        );
    }

    pisiRenderedSheetSelectionCells.set(table, new Set());
    pisiSheetSelections.delete(table);

    const active = window.__pisiActiveSheetCell;

    if (active && table.contains(active)) {
        window.__pisiActiveSheetCell = null;
    }

    window.getSelection?.()?.removeAllRanges?.();
    syncPisiSheetToolbarForTable(table);
}

function isPisiSheetCellSelected(table, cell) {
    const point = getPisiSheetCellPosition(cell);
    const selection = normalizePisiSheetSelection(table);
    if (!point || !selection) return false;

    const rect = getPisiSheetSelectionRect(
        selection.anchor,
        selection.focus
    );

    return Boolean(
        rect &&
        point.row >= rect.rowStart &&
        point.row <= rect.rowEnd &&
        point.col >= rect.colStart &&
        point.col <= rect.colEnd
    );
}

function selectPisiSheetCell(cell, options = {}) {
    if (!cell) return;

    const table = cell.closest('table[data-pisi-sheet]');
    const point = getPisiSheetCellPosition(cell);
    if (!table || !point) return;

    const previous = normalizePisiSheetSelection(table);
    const anchor = options.extend && previous
        ? previous.anchor
        : point;

    pisiSheetSelections.set(table, {
        mode: options.extend ? 'range' : 'cell',
        anchor,
        focus: point
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
        rowIndex >= dimensions.rows ||
        dimensions.cols < 1
    ) {
        return;
    }

    const start = getPisiSheetCell(table, rowIndex, 0);
    const end = getPisiSheetCell(
        table,
        rowIndex,
        dimensions.cols - 1
    );
    const startPoint = getPisiSheetCellPosition(start);
    const endPoint = getPisiSheetCellPosition(end);
    if (!startPoint || !endPoint) return;

    const previous = normalizePisiSheetSelection(table);

    pisiSheetSelections.set(table, {
        mode: 'row',
        anchor: extend && previous
            ? previous.anchor
            : startPoint,
        focus: endPoint
    });

    window.__pisiActiveSheetCell = end;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(end);
    syncPisiSheetToolbarForTable(table);
}

function selectPisiSheetColumn(table, colIndex, extend = false) {
    const dimensions = getPisiSheetDimensions(table);

    if (
        !Number.isInteger(colIndex) ||
        colIndex < 0 ||
        colIndex >= dimensions.cols ||
        dimensions.rows < 1
    ) {
        return;
    }

    const start = getPisiSheetCell(table, 0, colIndex);
    const end = getPisiSheetCell(
        table,
        dimensions.rows - 1,
        colIndex
    );
    const startPoint = getPisiSheetCellPosition(start);
    const endPoint = getPisiSheetCellPosition(end);
    if (!startPoint || !endPoint) return;

    const previous = normalizePisiSheetSelection(table);

    pisiSheetSelections.set(table, {
        mode: 'column',
        anchor: extend && previous
            ? previous.anchor
            : startPoint,
        focus: endPoint
    });

    window.__pisiActiveSheetCell = end;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(end);
    syncPisiSheetToolbarForTable(table);
}

function selectAllPisiSheetCells(table) {
    const dimensions = getPisiSheetDimensions(table);
    if (!dimensions.rows || !dimensions.cols) return;

    const first = getPisiSheetCell(table, 0, 0);
    const last = getPisiSheetCell(
        table,
        dimensions.rows - 1,
        dimensions.cols - 1
    );
    const anchor = getPisiSheetCellPosition(first);
    const focus = getPisiSheetCellPosition(last);
    if (!anchor || !focus) return;

    pisiSheetSelections.set(table, {
        mode: 'range',
        anchor,
        focus
    });

    window.__pisiActiveSheetCell = last;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(last);
    syncPisiSheetToolbarForTable(table);
}

function focusPisiSheetCell(cell) {
    if (!cell) return;

    cell.focus({ preventScroll: true });

    if (!cell.classList.contains('pisi-sheet-cell-editing')) {
        window.getSelection?.()?.removeAllRanges?.();
    }

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
            '.pisi-editor-toolbar[data-editor-target="' +
            editor.id + '"]'
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

function beginPisiSheetCellEdit(cell, options = {}) {
    if (!cell) return false;

    const table = cell.closest('table[data-pisi-sheet]');
    if (!table) return false;

    const current = pisiSheetEditStates.get(table);

    if (current?.cell === cell) {
        return true;
    }

    if (current) {
        finishPisiSheetCellEdit(table, {
            commit: true,
            refocus: false
        });
    }

    selectPisiSheetCell(cell);

    const originalText = String(cell.textContent || '');
    const originalFormula = cell.dataset.formula || null;
    const sourceText = originalFormula || originalText;

    pisiSheetEditStates.set(table, {
        cell,
        originalText,
        originalFormula
    });

    cell.classList.add('pisi-sheet-cell-editing');
    cell.setAttribute('contenteditable', 'plaintext-only');
    cell.setAttribute('spellcheck', 'false');
    cell.textContent = options.replace
        ? String(options.initialText || '')
        : sourceText;

    pisiEditedSheetCells.add(cell);
    cell.focus({ preventScroll: true });

    const selection = window.getSelection?.();

    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    cell.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
    });
    syncPisiSheetFormulaInput(cell);
    return true;
}

function finishPisiSheetCellEdit(table, options = {}) {
    const state = pisiSheetEditStates.get(table);
    if (!state) return false;

    pisiSheetEditStates.delete(table);
    const cell = state.cell;

    if (options.commit === false) {
        cell.textContent = state.originalText;

        if (state.originalFormula) {
            cell.dataset.formula = state.originalFormula;
        } else {
            delete cell.dataset.formula;
        }

        pisiEditedSheetCells.delete(cell);
    } else {
        commitPisiSheetCell(cell);
    }

    cell.classList.remove('pisi-sheet-cell-editing');
    cell.setAttribute('contenteditable', 'false');
    cell.removeAttribute('spellcheck');

    recalcPisiSheet(table);
    selectPisiSheetCell(cell);

    if (options.commit !== false) {
        schedulePisiSheetEditorNotification(table);
    }

    if (options.refocus !== false) {
        focusPisiSheetCell(cell);
    }

    return true;
}

function isPisiSheetEditingCell(table, cell) {
    return pisiSheetEditStates.get(table)?.cell === cell;
}

function extendPisiSheetSelectionByKeyboard(
    table,
    cell,
    key
) {
    const current = normalizePisiSheetSelection(table);
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
    const delta = deltas[key];
    const nextCell = getPisiSheetCell(
        table,
        Math.max(
            0,
            Math.min(dimensions.rows - 1, position.row + delta[0])
        ),
        Math.max(
            0,
            Math.min(dimensions.cols - 1, position.col + delta[1])
        )
    );
    const next = getPisiSheetCellPosition(nextCell);
    if (!next) return;

    pisiSheetSelections.set(table, {
        mode: 'range',
        anchor: current?.anchor || position,
        focus: next
    });

    window.__pisiActiveSheetCell = nextCell;
    renderPisiSheetSelection(table);
    syncPisiSheetFormulaInput(nextCell);
    syncPisiSheetToolbarForTable(table);
    focusPisiSheetCell(nextCell);
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
    "isPisiSheetCellSelected": {
        enumerable: true,
        get() { return isPisiSheetCellSelected; }
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
    "selectAllPisiSheetCells": {
        enumerable: true,
        get() { return selectAllPisiSheetCells; }
    },
    "focusPisiSheetCell": {
        enumerable: true,
        get() { return focusPisiSheetCell; }
    },
    "syncPisiSheetFormulaInput": {
        enumerable: true,
        get() { return syncPisiSheetFormulaInput; }
    },
    "beginPisiSheetCellEdit": {
        enumerable: true,
        get() { return beginPisiSheetCellEdit; }
    },
    "finishPisiSheetCellEdit": {
        enumerable: true,
        get() { return finishPisiSheetCellEdit; }
    },
    "isPisiSheetEditingCell": {
        enumerable: true,
        get() { return isPisiSheetEditingCell; }
    },
    "extendPisiSheetSelectionByKeyboard": {
        enumerable: true,
        get() { return extendPisiSheetSelectionByKeyboard; }
    },
    "movePisiSheetCellFocus": {
        enumerable: true,
        get() { return movePisiSheetCellFocus; }
    },
    "reconcilePisiSheetSelection": {
        enumerable: true,
        get() { return reconcilePisiSheetSelection; }
    },
    "clearPisiSheetSelection": {
        enumerable: true,
        get() { return clearPisiSheetSelection; }
    }
});
registerModule("editor.sheetSelection", moduleApi);
