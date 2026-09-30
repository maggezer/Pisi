import { registerModule } from "../core/module-registry.mjs";

const pisiRenderedSheetSelectionCells = new WeakMap();
const pisiSheetEditStates = new WeakMap();

function getPisiSheetDimensions(table) {
    return getPisiSheetDatabaseDimensions(table);
}

function getPisiSheetSelectionGroupId(table) {
    const database = getPisiSheetDatabase(table);

    return getPisiSheetSelectionGroupIdFromDatabase(
        database
    );
}

function getPisiSheetSelectionState(table) {
    const database = getPisiSheetDatabase(table);

    return getPisiSheetSelectionStateForDatabase(
        database
    );
}

function getPisiSheetActiveTable(root = document) {
    const activeGroupId = getPisiSheetActiveGroupId();

    if (!activeGroupId || !root) return null;

    return Array.from(
        root.querySelectorAll('table[data-pisi-sheet]')
    ).find((table) => {
        return (
            getPisiSheetSelectionGroupId(table) ===
            activeGroupId
        );
    }) || null;
}

function getPisiSheetPointByIndex(table, row, col) {
    return getPisiSheetPointByIndexFromDatabase(
        getPisiSheetDatabase(table),
        row,
        col
    );
}

function getPisiSheetCellPosition(cell) {
    if (!cell) return null;

    const table = cell.closest('table[data-pisi-sheet]');
    const database = getPisiSheetDatabase(table);

    if (!table || !database) return null;

    return resolvePisiSheetSelectionPoint(
        database,
        {
            groupId: database.databaseId,
            rowId: String(
                cell.dataset.pisiRowId || ''
            ),
            colId: String(
                cell.dataset.pisiColId || ''
            )
        }
    );
}


function getPisiSheetCell(table, row, col) {
    const point = getPisiSheetPointByIndex(
        table,
        row,
        col
    );

    if (!point) return null;

    return table.querySelector(
        'tbody tr[data-pisi-row-id="' +
        point.rowId +
        '"] td[data-pisi-col-id="' +
        point.colId +
        '"]'
    );
}

function setPisiSheetSelectionState(table, selection) {
    return setPisiSheetSelectionStateForDatabase(
        getPisiSheetDatabase(table),
        selection
    );
}

function normalizePisiSheetSelection(table) {
    return getPisiSheetSelectionForDatabase(
        getPisiSheetDatabase(table)
    );
}

function getPisiSheetSelectionFocus(table) {
    return getPisiSheetSelectionFocusForDatabase(
        getPisiSheetDatabase(table)
    );
}

function getPisiSheetActivePoint(table) {
    return getPisiSheetActivePointForDatabase(
        getPisiSheetDatabase(table)
    );
}

function getPisiSheetSelection(table) {
    return normalizePisiSheetSelection(table);
}


function getPisiSelectedSheetPoints(table) {
    return getPisiSelectedSheetPointsForDatabase(
        getPisiSheetDatabase(table)
    );
}


function getPisiSelectedSheetCells(table) {
    return getPisiSelectedSheetPoints(table)
        .map((point) => {
            return getPisiSheetCell(
                table,
                point.row,
                point.col
            );
        })
        .filter(Boolean);
}

function renderPisiSheetSelection(table) {
    const previous =
        pisiRenderedSheetSelectionCells.get(table) || new Set();
    const selection = normalizePisiSheetSelection(table);
    const points = selection
        ? getPisiSelectedSheetPoints(table)
        : [];
    const next = new Set(
        points
            .map((point) => getPisiSheetCell(
                table,
                point.row,
                point.col
            ))
            .filter(Boolean)
    );

    for (const cell of previous) {
        if (next.has(cell)) continue;

        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-active'
        );
    }

    for (const cell of next) {
        cell.classList.add('pisi-sheet-cell-selected');
        cell.classList.remove('pisi-sheet-cell-active');
    }

    if (selection?.active) {
        getPisiSheetCell(
            table,
            selection.active.row,
            selection.active.col
        )?.classList.add('pisi-sheet-cell-active');
    }

    pisiRenderedSheetSelectionCells.set(table, next);
}

function syncPisiSheetSelectionProjection(table) {
    const selection = normalizePisiSheetSelection(table);

    renderPisiSheetSelection(table);

    const active = selection?.active
        ? getPisiSheetCell(
            table,
            selection.active.row,
            selection.active.col
        )
        : null;

    if (
        active &&
        !table.classList.contains(
            'pisi-sheet-formula-reference-mode'
        )
    ) {
        syncPisiSheetFormulaInput(active);
    }

    syncPisiSheetToolbarForTable(table);
    return active;
}

function reconcilePisiSheetSelection(table) {
    return Boolean(
        syncPisiSheetSelectionProjection(table)
    );
}

function clearPisiSheetSelection(table) {
    const previous =
        pisiRenderedSheetSelectionCells.get(table) || new Set();

    for (const cell of previous) {
        cell.classList.remove(
            'pisi-sheet-cell-selected',
            'pisi-sheet-cell-active'
        );
    }

    pisiRenderedSheetSelectionCells.set(table, new Set());

    clearPisiSheetSelectionStateForDatabase(
        getPisiSheetDatabase(table)
    );

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

    setPisiSheetSelectionState(table, {
        mode: options.extend ? 'range' : 'cell',
        anchor,
        focus: point,
        active: point
    });

    syncPisiSheetSelectionProjection(table);

    if (options.focus) {
        revealPisiSheetCell(cell);
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

    const startPoint = getPisiSheetPointByIndex(
        table,
        rowIndex,
        0
    );
    const endPoint = getPisiSheetPointByIndex(
        table,
        rowIndex,
        dimensions.cols - 1
    );

    if (!startPoint || !endPoint) return;

    const previous = normalizePisiSheetSelection(table);

    setPisiSheetSelectionState(table, {
        mode: 'row',
        anchor: extend && previous
            ? previous.anchor
            : startPoint,
        focus: endPoint,
        active: endPoint
    });

    syncPisiSheetSelectionProjection(table);
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

    const startPoint = getPisiSheetPointByIndex(
        table,
        0,
        colIndex
    );
    const endPoint = getPisiSheetPointByIndex(
        table,
        dimensions.rows - 1,
        colIndex
    );

    if (!startPoint || !endPoint) return;

    const previous = normalizePisiSheetSelection(table);

    setPisiSheetSelectionState(table, {
        mode: 'column',
        anchor: extend && previous
            ? previous.anchor
            : startPoint,
        focus: endPoint,
        active: endPoint
    });

    syncPisiSheetSelectionProjection(table);
}


function selectAllPisiSheetCells(table) {
    const dimensions = getPisiSheetDimensions(table);

    if (!dimensions.rows || !dimensions.cols) return;

    const anchor = getPisiSheetPointByIndex(
        table,
        0,
        0
    );
    const focus = getPisiSheetPointByIndex(
        table,
        dimensions.rows - 1,
        dimensions.cols - 1
    );

    if (!anchor || !focus) return;

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor,
        focus,
        active: focus
    });

    syncPisiSheetSelectionProjection(table);
}


function revealPisiSheetCell(cell) {
    if (!cell) return;

    cell.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
    });
}

function focusPisiSheetCell(cell) {
    if (!cell) return;

    cell.focus({ preventScroll: true });
    cell.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
    });
}

function syncPisiSheetFormulaInput(cell) {
    if (!cell) return;

    const table = cell.closest('table[data-pisi-sheet]');
    const position = getPisiSheetCellPosition(cell);
    if (!table || !position) return;

    const source = getPisiSheetCellSource(
        table,
        position.row,
        position.col
    );
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
            source.formula ||
            source.value;
    }
}


function beginPisiSheetCellEdit(cell, options = {}) {
    if (!cell) return false;

    const table = cell.closest('table[data-pisi-sheet]');
    const position = getPisiSheetCellPosition(cell);
    if (!table || !position) return false;

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

    const source = getPisiSheetCellSource(
        table,
        position.row,
        position.col
    );
    const sourceText =
        source.formula ||
        source.value;

    pisiSheetEditStates.set(table, {
        cell,
        groupId: position.groupId,
        rowId: position.rowId,
        colId: position.colId
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
        pisiEditedSheetCells.delete(cell);
    } else {
        commitPisiSheetCell(cell);
    }

    cell.classList.remove('pisi-sheet-cell-editing');
    cell.setAttribute('contenteditable', 'false');
    cell.removeAttribute('spellcheck');

    if (document.activeElement === cell) {
        cell.blur();
    }

    recalcPisiSheet(table);
    selectPisiSheetCell(cell);

    if (options.commit !== false) {
        schedulePisiSheetEditorNotification(table);
    }

    if (options.refocus !== false) {
        revealPisiSheetCell(cell);
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
    const next = getPisiSheetPointByIndex(
        table,
        Math.max(
            0,
            Math.min(
                dimensions.rows - 1,
                position.row + delta[0]
            )
        ),
        Math.max(
            0,
            Math.min(
                dimensions.cols - 1,
                position.col + delta[1]
            )
        )
    );

    if (!next) return;

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor: current?.anchor || position,
        focus: next,
        active: next
    });

    const nextCell = syncPisiSheetSelectionProjection(table);

    if (nextCell) {
        revealPisiSheetCell(nextCell);
    }
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
    "getPisiSheetDimensions": {
        enumerable: true,
        get() { return getPisiSheetDimensions; }
    },
    "getPisiSheetSelectionGroupId": {
        enumerable: true,
        get() { return getPisiSheetSelectionGroupId; }
    },
    "getPisiSheetSelectionState": {
        enumerable: true,
        get() { return getPisiSheetSelectionState; }
    },
    "getPisiSheetSelection": {
        enumerable: true,
        get() { return getPisiSheetSelection; }
    },
    "setPisiSheetSelectionState": {
        enumerable: true,
        get() { return setPisiSheetSelectionState; }
    },
    "getPisiSheetSelectionFocus": {
        enumerable: true,
        get() { return getPisiSheetSelectionFocus; }
    },
    "getPisiSheetActivePoint": {
        enumerable: true,
        get() { return getPisiSheetActivePoint; }
    },
    "getPisiSheetActiveTable": {
        enumerable: true,
        get() { return getPisiSheetActiveTable; }
    },
    "getPisiSheetPointByIndex": {
        enumerable: true,
        get() { return getPisiSheetPointByIndex; }
    },
    "syncPisiSheetSelectionProjection": {
        enumerable: true,
        get() { return syncPisiSheetSelectionProjection; }
    },
    "getPisiSheetCellPosition": {
        enumerable: true,
        get() { return getPisiSheetCellPosition; }
    },
    "getPisiSheetCell": {
        enumerable: true,
        get() { return getPisiSheetCell; }
    },
    "getPisiSelectedSheetPoints": {
        enumerable: true,
        get() { return getPisiSelectedSheetPoints; }
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
