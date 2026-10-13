import { clearPisiSheetCellsBatch } from './pisi-editor-sheet-database.mjs';
import { getPisiSheetViewAxes, getPisiSheetViewSelectionIndices } from './pisi-editor-sheet-view-selection.mjs';
import { registerModule } from '../core/module-registry.mjs';
function setPisiSheetColumnLabel(table, colIndex, value) {
    const label = renamePisiSheetField(table, colIndex, value);
    if (!label) return null;

    const labelElement = table.querySelector('thead th[data-col-header="' + colIndex + '"] .pisi-sheet-col-label');

    if (labelElement) {
        labelElement.textContent = label;
    }

    return label;
}

function refreshPisiSheetCellMetadata(table) {
    renderPisiSheetDatabase(table);

    if (typeof reconcilePisiSheetSelection === 'function') {
        reconcilePisiSheetSelection(table);
    }
}

function getPisiSheetMutationFocus(table) {
    return getPisiSheetSelection(table)?.focus || getPisiSheetSelectionFocus(table) || getPisiSheetPointByIndex(table, 0, 0) || { row: 0, col: 0 };
}

function updatePisiSheetFormulaReferences(table, change) {
    transformPisiSheetDatabaseFormulas(table, change);
}

function addPisiSheetRow(table, afterRowIndex = null) {
    const dimensions = getPisiSheetDimensions(table);

    if (dimensions.rows >= PISI_SHEET_MAX_ROWS) {
        return false;
    }

    const focus = getPisiSheetMutationFocus(table);
    const after = Number.isInteger(afterRowIndex) ? afterRowIndex : focus.row;
    const insertIndex = Math.max(0, Math.min(dimensions.rows, after + 1));
    const colCount = Math.max(1, dimensions.cols);

    insertPisiSheetItem(table, insertIndex);
    updatePisiSheetFormulaReferences(table, {
        type: 'insert-row',
        index: insertIndex,
        count: 1
    });
    refreshPisiSheetCellMetadata(table);
    recalcPisiSheet(table);

    const nextCell = getPisiSheetCell(table, insertIndex, Math.min(focus.col, colCount - 1));

    if (nextCell) {
        selectPisiSheetCell(nextCell, { focus: true });
    }

    return true;
}

function addPisiSheetColumn(table, afterColIndex = null) {
    const dimensions = getPisiSheetDimensions(table);

    if (dimensions.cols >= PISI_SHEET_MAX_COLS) {
        return false;
    }

    const focus = getPisiSheetMutationFocus(table);
    const after = Number.isInteger(afterColIndex) ? afterColIndex : focus.col;
    const insertIndex = Math.max(0, Math.min(dimensions.cols, after + 1));

    insertPisiSheetField(table, insertIndex);
    updatePisiSheetFormulaReferences(table, {
        type: 'insert-col',
        index: insertIndex,
        count: 1
    });
    refreshPisiSheetCellMetadata(table);
    recalcPisiSheet(table);

    const next = getPisiSheetDimensions(table);
    const nextCell = getPisiSheetCell(table, Math.min(focus.row, next.rows - 1), insertIndex);

    if (nextCell) {
        selectPisiSheetCell(nextCell, { focus: true });
    }

    return true;
}

function deletePisiSheetRows(table) {
    const dimensions = getPisiSheetDimensions(table);
    if (dimensions.rows <= 1) return false;

    const focus = getPisiSheetMutationFocus(table);
    const selected = [...new Set(getPisiSelectedSheetPoints(table).map((point) => point.row))];
    if (!selected.length && getPisiSheetSelection(table)) return false;
    const rows = (selected.length ? selected : [focus.row]).slice(0, dimensions.rows - 1).sort((a, b) => b - a);
    if (!rows.length) return false;
    const start = Math.min(...rows);
    // Delete from the end so each model index and formula transform stays valid.
    for (const row of rows) {
        deletePisiSheetItems(table, row, 1);
        updatePisiSheetFormulaReferences(table, { type: 'delete-row', index: row, count: 1 });
    }
    refreshPisiSheetCellMetadata(table);
    recalcPisiSheet(table);

    const next = getPisiSheetDimensions(table);
    const nextCell = getPisiSheetCell(table, Math.min(start, next.rows - 1), Math.min(focus.col, next.cols - 1));

    if (nextCell) {
        selectPisiSheetCell(nextCell, { focus: true });
    }

    return true;
}

function deletePisiSheetColumns(table) {
    const dimensions = getPisiSheetDimensions(table);
    if (dimensions.cols <= 1) return false;

    const focus = getPisiSheetMutationFocus(table);
    const selected = [...new Set(getPisiSelectedSheetPoints(table).map((point) => point.col))];
    if (!selected.length && getPisiSheetSelection(table)) return false;
    const cols = (selected.length ? selected : [focus.col]).slice(0, dimensions.cols - 1).sort((a, b) => b - a);
    if (!cols.length) return false;
    const start = Math.min(...cols);
    for (const col of cols) {
        deletePisiSheetFields(table, col, 1);
        updatePisiSheetFormulaReferences(table, { type: 'delete-col', index: col, count: 1 });
    }
    refreshPisiSheetCellMetadata(table);
    recalcPisiSheet(table);

    const next = getPisiSheetDimensions(table);
    const nextCell = getPisiSheetCell(table, Math.min(focus.row, next.rows - 1), Math.min(start, next.cols - 1));

    if (nextCell) {
        selectPisiSheetCell(nextCell, { focus: true });
    }

    return true;
}

function applyPisiSheetCellFormat(table, action, value = null) {
    const points = getPisiSelectedSheetPoints(table);
    const cells = points.map((point) => {
        const cell = getPisiSheetCell(table, point.row, point.col) || document.createElement('td');
        applyPisiSheetCellFormatToDom(cell, getPisiSheetCellSource(table, point.row, point.col).format);
        return cell;
    });
    if (!cells.length) return false;

    if (action === 'toggleBold') {
        const enable = !cells.every((cell) => {
            return cell.style.fontWeight === '700';
        });

        cells.forEach((cell) => {
            cell.style.fontWeight = enable ? '700' : '';
        });
    } else if (action === 'toggleItalic') {
        const enable = !cells.every((cell) => {
            return cell.style.fontStyle === 'italic';
        });

        cells.forEach((cell) => {
            cell.style.fontStyle = enable ? 'italic' : '';
        });
    } else if (action === 'toggleUnderline') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine.split(/\s+/).includes('underline');
        });
        cells.forEach((cell) => {
            const values = new Set(cell.style.textDecorationLine.split(/\s+/).filter(Boolean));
            if (enable) values.add('underline');
            else values.delete('underline');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'toggleStrikeThrough') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine.split(/\s+/).includes('line-through');
        });
        cells.forEach((cell) => {
            const values = new Set(cell.style.textDecorationLine.split(/\s+/).filter(Boolean));
            if (enable) values.add('line-through');
            else values.delete('line-through');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'fontFamily' && value) {
        cells.forEach((cell) => {
            cell.style.fontFamily = value;
        });
    } else if (action === 'fontSize' && value) {
        const sizes = {
            1: '8px',
            2: '10px',
            3: '12px',
            4: '14px',
            5: '18px',
            6: '24px',
            7: '32px'
        };
        const size = sizes[String(value)] || String(value);
        cells.forEach((cell) => {
            cell.style.fontSize = size;
        });
    } else if (action === 'alignLeft') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'left';
        });
    } else if (action === 'alignCenter') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'center';
        });
    } else if (action === 'alignRight') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'right';
        });
    } else if (action === 'alignJustify') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'justify';
        });
    } else if (action === 'verticalTop') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'top';
        });
    } else if (action === 'verticalMiddle') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'middle';
        });
    } else if (action === 'verticalBottom') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'bottom';
        });
    } else if (action === 'toggleWrap') {
        const enable = !cells.every((cell) => {
            return cell.style.whiteSpace === 'normal';
        });

        cells.forEach((cell) => {
            cell.style.whiteSpace = enable ? 'normal' : 'nowrap';
            cell.style.overflowWrap = enable ? 'anywhere' : '';
        });
    } else if (action === 'borderAll') {
        cells.forEach((cell) => {
            cell.style.border = '1px solid rgba(127, 127, 127, 0.7)';
        });
    } else if (action === 'borderNone') {
        cells.forEach((cell) => {
            cell.style.border = '';
        });
    } else if (action === 'textColor' && value) {
        cells.forEach((cell) => {
            cell.style.color = value;
        });
    } else if (action === 'fillColor' && value) {
        cells.forEach((cell) => {
            cell.style.backgroundColor = value;
        });
    } else if (action === 'clearFormat') {
        cells.forEach((cell) => {
            cell.style.fontWeight = '';
            cell.style.fontStyle = '';
            cell.style.textDecorationLine = '';
            cell.style.fontFamily = '';
            cell.style.fontSize = '';
            cell.style.textAlign = '';
            cell.style.verticalAlign = '';
            cell.style.whiteSpace = '';
            cell.style.overflowWrap = '';
            cell.style.border = '';
            cell.style.color = '';
            cell.style.backgroundColor = '';
        });
    } else {
        return false;
    }

    cells.forEach((cell, index) => {
        const position = points[index];

        if (!position) return;

        setPisiSheetCellFormat(table, position.row, position.col, capturePisiSheetCellFormat(cell));
    });

    renderPisiSheetSelection(table);
    return true;
}

function clearPisiSheetSelectedCells(table) {
    // Snapshot the entire view selection before changing values used by filters/sorts.
    const points = getPisiSheetViewSelectionIndices(getPisiSheetViewAxes(table), getPisiSheetSelection(table));
    if (!points.length || !clearPisiSheetCellsBatch(table, points)) return false;
    const selected = new Set(points.map(({ row, col }) => row + ':' + col));
    for (const cell of table.querySelectorAll('tbody td[data-row][data-col]')) {
        if (selected.has(cell.dataset.row + ':' + cell.dataset.col)) pisiEditedSheetCells.delete(cell);
    }

    recalcPisiSheet(table, { renderedOnly: true });
    schedulePisiSheetEditorNotification(table);
    return true;
}

function schedulePisiSheetEditorNotification(table) {
    persistPisiSheetDatabase(table);

    const previousTimer = pisiSheetNotifyTimers.get(table);

    if (previousTimer) {
        clearTimeout(previousTimer);
    }

    const timer = setTimeout(() => {
        pisiSheetNotifyTimers.delete(table);

        const editor = getEditorForPisiElement(table);
        if (editor) {
            notifyPisiEditorChanged(editor, false);
        }
    }, 0);

    pisiSheetNotifyTimers.set(table, timer);
}

function setPisiSheetToolbarStatus(toolbar, message) {
    const status = toolbar?.querySelector('[data-pisi-sheet-status]');

    if (status) {
        status.textContent = String(message || '');
    }
}

function syncPisiSheetToolbarForTable(table) {
    const editor = getEditorForPisiElement(table);
    const toolbar = editor ? document.querySelector(`.pisi-editor-toolbar[data-editor-target="${editor.id}"]`) : null;

    if (toolbar) {
        toolbar.classList.toggle('pisi-table-context', Boolean(table));
    }

    syncPisiSheetToolbarState(toolbar, table);
}

function syncPisiSheetToolbarState(toolbar, table) {
    if (!toolbar) return;

    const dimensions = table ? getPisiSheetDimensions(table) : { rows: 0, cols: 0 };

    toolbar.querySelectorAll('[data-pisi-excel-action]').forEach((button) => {
        button.disabled = !table;
    });

    const setDisabled = (action, disabled) => {
        const button = toolbar.querySelector(`[data-pisi-excel-action="${action}"]`);

        if (button) {
            button.disabled = disabled;
        }
    };

    setDisabled('addRow', !table || dimensions.rows >= PISI_SHEET_MAX_ROWS);
    setDisabled('deleteRow', !table || dimensions.rows <= 1);
    setDisabled('addCol', !table || dimensions.cols >= PISI_SHEET_MAX_COLS);
    setDisabled('deleteCol', !table || dimensions.cols <= 1);

    const status = toolbar.querySelector('[data-pisi-sheet-status]');

    if (status && table) {
        const selection = getPisiSheetSelection(table);
        const rect = selection ? getPisiSheetSelectionRect(selection.anchor, selection.focus) : null;
        const selectedRows = new Set(getPisiSelectedSheetPoints(table).map((point) => point.row)).size || 1;
        const selectedCols = rect ? rect.colEnd - rect.colStart + 1 : 1;
        const selectionLabel = selectedRows > 1 || selectedCols > 1 ? ` · ${selectedRows}×${selectedCols} seçili` : '';

        status.textContent = `${dimensions.rows} × ${dimensions.cols}${selectionLabel}`;
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    setPisiSheetColumnLabel: {
        enumerable: true,
        get() {
            return setPisiSheetColumnLabel;
        }
    },
    refreshPisiSheetCellMetadata: {
        enumerable: true,
        get() {
            return refreshPisiSheetCellMetadata;
        }
    },
    getPisiSheetMutationFocus: {
        enumerable: true,
        get() {
            return getPisiSheetMutationFocus;
        }
    },
    updatePisiSheetFormulaReferences: {
        enumerable: true,
        get() {
            return updatePisiSheetFormulaReferences;
        }
    },
    addPisiSheetRow: {
        enumerable: true,
        get() {
            return addPisiSheetRow;
        }
    },
    addPisiSheetColumn: {
        enumerable: true,
        get() {
            return addPisiSheetColumn;
        }
    },
    deletePisiSheetRows: {
        enumerable: true,
        get() {
            return deletePisiSheetRows;
        }
    },
    deletePisiSheetColumns: {
        enumerable: true,
        get() {
            return deletePisiSheetColumns;
        }
    },
    applyPisiSheetCellFormat: {
        enumerable: true,
        get() {
            return applyPisiSheetCellFormat;
        }
    },
    clearPisiSheetSelectedCells: {
        enumerable: true,
        get() {
            return clearPisiSheetSelectedCells;
        }
    },
    schedulePisiSheetEditorNotification: {
        enumerable: true,
        get() {
            return schedulePisiSheetEditorNotification;
        }
    },
    setPisiSheetToolbarStatus: {
        enumerable: true,
        get() {
            return setPisiSheetToolbarStatus;
        }
    },
    syncPisiSheetToolbarForTable: {
        enumerable: true,
        get() {
            return syncPisiSheetToolbarForTable;
        }
    },
    syncPisiSheetToolbarState: {
        enumerable: true,
        get() {
            return syncPisiSheetToolbarState;
        }
    }
});
registerModule('editor.sheetStructure', moduleApi);
