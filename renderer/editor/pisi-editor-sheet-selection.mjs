import { registerModule } from '../core/module-registry.mjs';
import { ensurePisiSheetModelCellRendered } from './pisi-editor-sheet-virtual-scroll.mjs';
import { clearPisiSheetDragFillHandle, renderPisiSheetDragFillHandle } from './pisi-editor-sheet-drag-fill.mjs';

const pisiRenderedSheetSelectionCells = new WeakMap();
const pisiRenderedSheetSelectionHeaders = new WeakMap();
const pisiSheetEditStates = new WeakMap();

function getPisiSheetDimensions(table) {
    return getPisiSheetDatabaseDimensions(table);
}

function getPisiSheetSelectionGroupId(table) {
    const database = getPisiSheetDatabase(table);

    return getPisiSheetSelectionGroupIdFromDatabase(database);
}

function getPisiSheetSelectionState(table) {
    const database = getPisiSheetDatabase(table);

    return getPisiSheetSelectionStateForDatabase(database);
}

function getPisiSheetActiveTable(root = document) {
    const activeGroupId = getPisiSheetActiveGroupId();

    if (!activeGroupId || !root) return null;

    return (
        Array.from(root.querySelectorAll('table[data-pisi-sheet]')).find((table) => {
            return getPisiSheetSelectionGroupId(table) === activeGroupId;
        }) || null
    );
}

function getPisiSheetPointByIndex(table, row, col) {
    return getPisiSheetPointByIndexFromDatabase(getPisiSheetDatabase(table), row, col);
}

function getPisiSheetCellPosition(cell) {
    if (!cell) return null;

    const table = cell.closest('table[data-pisi-sheet]');
    const database = getPisiSheetDatabase(table);

    if (!table || !database) return null;

    return resolvePisiSheetSelectionPoint(database, {
        groupId: database.databaseId,
        rowId: String(cell.dataset.pisiRowId || ''),
        colId: String(cell.dataset.pisiColId || '')
    });
}

function getPisiSheetCell(table, row, col) {
    const point = getPisiSheetPointByIndex(table, row, col);

    if (!point) return null;

    return table.querySelector('tbody tr[data-pisi-row-id="' + point.rowId + '"] td[data-pisi-col-id="' + point.colId + '"]');
}

function setPisiSheetSelectionState(table, selection) {
    return setPisiSheetSelectionStateForDatabase(getPisiSheetDatabase(table), selection);
}

function normalizePisiSheetSelection(table) {
    return getPisiSheetSelectionForDatabase(getPisiSheetDatabase(table));
}

function getPisiSheetSelectionFocus(table) {
    return getPisiSheetSelectionFocusForDatabase(getPisiSheetDatabase(table));
}

function getPisiSheetActivePoint(table) {
    return getPisiSheetActivePointForDatabase(getPisiSheetDatabase(table));
}

function getPisiSelectedSheetCells(table) {
    return getPisiSelectedSheetPoints(table)
        .map((point) => {
            return getPisiSheetCell(table, point.row, point.col);
        })
        .filter(Boolean);
}

function renderPisiSheetSelection(table) {
    const previousCells = pisiRenderedSheetSelectionCells.get(table) || new Set();
    const previousHeaders = pisiRenderedSheetSelectionHeaders.get(table) || new Set();
    const selection = getPisiSheetSelection(table);
    const points = selection ? getPisiSelectedSheetPoints(table) : [];
    const selectedCells = new Set(points.map((point) => getPisiSheetCell(table, point.row, point.col)).filter(Boolean));
    const activeCell =
        selection && !['row', 'column'].includes(selection.mode) && selection.active
            ? getPisiSheetCell(table, selection.active.row, selection.active.col)
            : null;
    const renderedCells = new Set(selectedCells);
    const renderedHeaders = new Set();

    if (activeCell) {
        renderedCells.add(activeCell);
    }

    for (const cell of previousCells) {
        if (renderedCells.has(cell)) continue;

        cell.classList.remove('pisi-sheet-cell-selected', 'pisi-sheet-cell-active');
    }

    for (const header of previousHeaders) {
        if (renderedHeaders.has(header)) continue;
        header.classList.remove('pisi-sheet-header-selected');
    }

    for (const cell of selectedCells) {
        cell.classList.add('pisi-sheet-cell-selected');
        cell.classList.remove('pisi-sheet-cell-active');
    }

    if (activeCell) {
        if (!selectedCells.has(activeCell)) {
            activeCell.classList.remove('pisi-sheet-cell-selected');
        }

        activeCell.classList.add('pisi-sheet-cell-active');
    }

    if (selection?.mode === 'row') {
        const rect = getPisiSheetSelectionRect(selection.anchor, selection.focus);

        if (rect) {
            for (let row = rect.rowStart; row <= rect.rowEnd; row += 1) {
                const header = table.querySelector('tbody th[data-row-header="' + row + '"]');

                if (header) {
                    header.classList.add('pisi-sheet-header-selected');
                    renderedHeaders.add(header);
                }
            }
        }
    } else if (selection?.mode === 'column') {
        const rect = getPisiSheetSelectionRect(selection.anchor, selection.focus);

        if (rect) {
            for (let col = rect.colStart; col <= rect.colEnd; col += 1) {
                const header = table.querySelector('thead th[data-col-header="' + col + '"]');

                if (header) {
                    header.classList.add('pisi-sheet-header-selected');
                    renderedHeaders.add(header);
                }
            }
        }
    }

    renderPisiSheetDragFillHandle(table, selection);

    pisiRenderedSheetSelectionCells.set(table, renderedCells);
    pisiRenderedSheetSelectionHeaders.set(table, renderedHeaders);
}

function syncPisiSheetSelectionProjection(table) {
    const selection = normalizePisiSheetSelection(table);

    renderPisiSheetSelection(table);

    const active = selection?.active ? getPisiSheetCell(table, selection.active.row, selection.active.col) : null;

    if (active && !table.classList.contains('pisi-sheet-formula-reference-mode')) {
        syncPisiSheetFormulaInput(active);
    }

    syncPisiSheetToolbarForTable(table);
    return active;
}

function reconcilePisiSheetSelection(table) {
    return Boolean(syncPisiSheetSelectionProjection(table));
}

function clearPisiSheetSelection(table) {
    const previousCells = pisiRenderedSheetSelectionCells.get(table) || new Set();
    const previousHeaders = pisiRenderedSheetSelectionHeaders.get(table) || new Set();

    for (const cell of previousCells) {
        cell.classList.remove('pisi-sheet-cell-selected', 'pisi-sheet-cell-active');
    }

    for (const header of previousHeaders) {
        header.classList.remove('pisi-sheet-header-selected');
    }

    pisiRenderedSheetSelectionCells.set(table, new Set());
    pisiRenderedSheetSelectionHeaders.set(table, new Set());
    clearPisiSheetDragFillHandle(table);

    clearPisiSheetAllSelectionStateForDatabase(getPisiSheetDatabase(table));

    window.getSelection?.()?.removeAllRanges?.();
    syncPisiSheetToolbarForTable(table);
}

function isPisiSheetCellSelected(table, cell) {
    const point = getPisiSheetCellPosition(cell);
    const selection = normalizePisiSheetSelection(table);
    if (!point || !selection) return false;

    const rect = getPisiSheetSelectionRect(selection.anchor, selection.focus);

    return Boolean(rect && point.row >= rect.rowStart && point.row <= rect.rowEnd && point.col >= rect.colStart && point.col <= rect.colEnd);
}

function setPisiSheetRangeSelection(table, anchor, focus, options = {}) {
    if (!table || !anchor || !focus) return null;

    const state = setPisiSheetSelectionState(table, {
        mode: options.mode || 'range',
        anchor,
        focus,
        active: options.active || focus
    });

    if (!state) return null;

    if (options.ensureVisible !== false) {
        const focusCell = ensurePisiSheetModelCellRendered(table, focus.row, focus.col) || getPisiSheetCell(table, focus.row, focus.col);

        syncPisiSheetSelectionProjection(table);
        ensurePisiSheetCellVisible(focusCell);
    } else {
        syncPisiSheetSelectionProjection(table);
    }

    return state;
}

function selectPisiSheetCell(cell, options = {}) {
    if (!cell) return;

    const table = cell.closest('table[data-pisi-sheet]');
    const point = getPisiSheetCellPosition(cell);
    if (!table || !point) return;

    const previous = normalizePisiSheetSelection(table);
    const anchor = options.extend && previous ? previous.anchor : point;

    setPisiSheetRangeSelection(table, anchor, point, {
        mode: options.extend ? 'range' : 'cell',
        active: point,
        ensureVisible: options.ensureVisible === true
    });
}

function selectAllPisiSheetCells(table) {
    const dimensions = getPisiSheetDimensions(table);

    if (!dimensions.rows || !dimensions.cols) return;

    const anchor = getPisiSheetPointByIndex(table, 0, 0);
    const focus = getPisiSheetPointByIndex(table, dimensions.rows - 1, dimensions.cols - 1);

    if (!anchor || !focus) return;

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor,
        focus,
        active: focus
    });

    syncPisiSheetSelectionProjection(table);
}

function ensurePisiSheetCellVisible(cell) {
    if (!cell) return false;

    cell.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
    });

    return true;
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

    const source = getPisiSheetCellSource(table, position.row, position.col);
    const editor = getEditorForPisiElement(cell);
    const toolbar = editor ? document.querySelector('.pisi-editor-toolbar[data-editor-target="' + editor.id + '"]') : null;
    const formulaInput = toolbar?.querySelector('[data-pisi-excel-formula]');

    if (formulaInput) {
        formulaInput.value = source.formula || source.value;
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

    const source = getPisiSheetCellSource(table, position.row, position.col);
    const sourceText = source.formula || source.value;

    pisiSheetEditStates.set(table, {
        cell,
        groupId: position.groupId,
        rowId: position.rowId,
        colId: position.colId,
        forceFormula: Boolean(source.formula),
        referenceUsed: false
    });

    cell.classList.add('pisi-sheet-cell-editing');
    cell.setAttribute('contenteditable', 'plaintext-only');
    cell.setAttribute('spellcheck', 'false');
    cell.textContent = options.replace ? String(options.initialText || '') : sourceText;

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

function getPisiSheetCellEditState(table) {
    return pisiSheetEditStates.get(table) || null;
}

function markPisiSheetCellEditFormulaReference(table) {
    const state = pisiSheetEditStates.get(table);
    if (!state) return false;

    state.forceFormula = true;
    state.referenceUsed = true;
    return true;
}

function finishPisiSheetCellEdit(table, options = {}) {
    const state = pisiSheetEditStates.get(table);
    if (!state) return false;

    closePisiSheetFormulaReferenceSession(table);
    pisiSheetEditStates.delete(table);

    const cell = state.cell;

    if (options.commit === false) {
        pisiEditedSheetCells.delete(cell);
    } else {
        commitPisiSheetCell(cell, {
            forceFormula: state.forceFormula === true
        });
    }

    cell.classList.remove('pisi-sheet-cell-editing');
    cell.setAttribute('contenteditable', 'false');
    cell.removeAttribute('spellcheck');

    if (document.activeElement === cell) {
        cell.blur();
    }

    table.classList.remove('pisi-sheet-formula-reference-mode');

    recalcPisiSheet(table);
    selectPisiSheetCell(cell);

    if (options.commit !== false) {
        schedulePisiSheetEditorNotification(table);
    }

    if (options.refocus !== false) {
        ensurePisiSheetCellVisible(cell);
    }

    return true;
}

function isPisiSheetEditingCell(table, cell) {
    return pisiSheetEditStates.get(table)?.cell === cell;
}

function extendPisiSheetSelectionByKeyboard(table, cell, key) {
    const current = normalizePisiSheetSelection(table);
    const dimensions = getPisiSheetDimensions(table);
    const position = current?.focus || getPisiSheetCellPosition(cell);

    if (!position) return;

    const deltas = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1]
    };
    const delta = deltas[key];
    let nextRow = position.row;
    let nextCol = position.col;

    if (delta[0]) {
        nextRow = getPisiSheetNextVisibleRowIndex(table, position.row, delta[0]);
    }

    if (delta[1]) {
        nextCol = getPisiSheetNextVisibleColumn(table, position.col, delta[1]);
    }

    const next = getPisiSheetPointByIndex(table, nextRow, nextCol);

    if (!next) return;

    setPisiSheetRangeSelection(table, current?.anchor || position, next, {
        mode: 'range',
        active: next,
        ensureVisible: true
    });
}

function movePisiSheetCellFocus(table, cell, rowDelta, colDelta, options = {}) {
    let dimensions = getPisiSheetDimensions(table);
    const position = getPisiSheetCellPosition(cell);
    if (!position) return false;

    const visibleCols = getPisiSheetVisibleColumnIndices(table);
    const visibleRows = getPisiSheetVisibleRowIndices(table);
    if (!visibleCols.length || !visibleRows.length) {
        return false;
    }

    let nextRow = position.row;
    let nextCol = position.col;

    if (rowDelta !== 0) {
        nextRow = getPisiSheetNextVisibleRowIndex(table, position.row, rowDelta);
    }

    if (colDelta !== 0) {
        const currentVisibleIndex = visibleCols.indexOf(position.col);
        let visibleIndex = currentVisibleIndex >= 0 ? currentVisibleIndex : 0;
        visibleIndex += colDelta > 0 ? 1 : -1;

        if (options.wrap && visibleIndex >= visibleCols.length) {
            visibleIndex = 0;
            nextRow = getPisiSheetNextVisibleRowIndex(table, position.row, 1);
        } else if (options.wrap && visibleIndex < 0) {
            visibleIndex = visibleCols.length - 1;
            nextRow = getPisiSheetNextVisibleRowIndex(table, position.row, -1);
        } else {
            visibleIndex = Math.max(0, Math.min(visibleCols.length - 1, visibleIndex));
        }

        nextCol = visibleCols[visibleIndex];
    } else if (!visibleCols.includes(nextCol)) {
        nextCol = visibleCols[0];
    }

    const atLastVisibleRow = position.row === visibleRows.at(-1);

    if (
        options.addRowAtEnd &&
        colDelta > 0 &&
        atLastVisibleRow &&
        nextRow === position.row &&
        dimensions.rows < PISI_SHEET_MAX_ROWS &&
        visibleRows.length === dimensions.rows
    ) {
        addPisiSheetRow(table, dimensions.rows - 1);
        dimensions = getPisiSheetDimensions(table);
        nextRow = dimensions.rows - 1;
        nextCol = visibleCols[0];
    }

    const next = getPisiSheetPointByIndex(table, nextRow, nextCol);

    if (!next) return false;

    return Boolean(
        setPisiSheetRangeSelection(table, next, next, {
            mode: 'cell',
            active: next,
            ensureVisible: true
        })
    );
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getPisiSheetDimensions: {
        enumerable: true,
        get() {
            return getPisiSheetDimensions;
        }
    },
    getPisiSheetSelectionGroupId: {
        enumerable: true,
        get() {
            return getPisiSheetSelectionGroupId;
        }
    },
    getPisiSheetSelectionState: {
        enumerable: true,
        get() {
            return getPisiSheetSelectionState;
        }
    },
    setPisiSheetSelectionState: {
        enumerable: true,
        get() {
            return setPisiSheetSelectionState;
        }
    },
    getPisiSheetSelectionFocus: {
        enumerable: true,
        get() {
            return getPisiSheetSelectionFocus;
        }
    },
    getPisiSheetActivePoint: {
        enumerable: true,
        get() {
            return getPisiSheetActivePoint;
        }
    },
    getPisiSheetActiveTable: {
        enumerable: true,
        get() {
            return getPisiSheetActiveTable;
        }
    },
    getPisiSheetPointByIndex: {
        enumerable: true,
        get() {
            return getPisiSheetPointByIndex;
        }
    },
    syncPisiSheetSelectionProjection: {
        enumerable: true,
        get() {
            return syncPisiSheetSelectionProjection;
        }
    },
    getPisiSheetCellPosition: {
        enumerable: true,
        get() {
            return getPisiSheetCellPosition;
        }
    },
    getPisiSheetCell: {
        enumerable: true,
        get() {
            return getPisiSheetCell;
        }
    },
    getPisiSelectedSheetCells: {
        enumerable: true,
        get() {
            return getPisiSelectedSheetCells;
        }
    },
    isPisiSheetCellSelected: {
        enumerable: true,
        get() {
            return isPisiSheetCellSelected;
        }
    },
    renderPisiSheetSelection: {
        enumerable: true,
        get() {
            return renderPisiSheetSelection;
        }
    },
    setPisiSheetRangeSelection: {
        enumerable: true,
        get() {
            return setPisiSheetRangeSelection;
        }
    },
    ensurePisiSheetCellVisible: {
        enumerable: true,
        get() {
            return ensurePisiSheetCellVisible;
        }
    },
    selectPisiSheetCell: {
        enumerable: true,
        get() {
            return selectPisiSheetCell;
        }
    },
    selectAllPisiSheetCells: {
        enumerable: true,
        get() {
            return selectAllPisiSheetCells;
        }
    },
    focusPisiSheetCell: {
        enumerable: true,
        get() {
            return focusPisiSheetCell;
        }
    },
    syncPisiSheetFormulaInput: {
        enumerable: true,
        get() {
            return syncPisiSheetFormulaInput;
        }
    },
    beginPisiSheetCellEdit: {
        enumerable: true,
        get() {
            return beginPisiSheetCellEdit;
        }
    },
    getPisiSheetCellEditState: {
        enumerable: true,
        get() {
            return getPisiSheetCellEditState;
        }
    },
    markPisiSheetCellEditFormulaReference: {
        enumerable: true,
        get() {
            return markPisiSheetCellEditFormulaReference;
        }
    },
    finishPisiSheetCellEdit: {
        enumerable: true,
        get() {
            return finishPisiSheetCellEdit;
        }
    },
    isPisiSheetEditingCell: {
        enumerable: true,
        get() {
            return isPisiSheetEditingCell;
        }
    },
    extendPisiSheetSelectionByKeyboard: {
        enumerable: true,
        get() {
            return extendPisiSheetSelectionByKeyboard;
        }
    },
    movePisiSheetCellFocus: {
        enumerable: true,
        get() {
            return movePisiSheetCellFocus;
        }
    },
    reconcilePisiSheetSelection: {
        enumerable: true,
        get() {
            return reconcilePisiSheetSelection;
        }
    },
    clearPisiSheetSelection: {
        enumerable: true,
        get() {
            return clearPisiSheetSelection;
        }
    }
});
registerModule('editor.sheetSelection', moduleApi);
