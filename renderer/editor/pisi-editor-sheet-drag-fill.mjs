import {
    getPisiSheetDragFillRect,
    getPisiSheetDragFillSeriesValue,
    getPisiSheetDragFillSourcePoint,
    isPisiSheetPointInFillRect
} from "./pisi-editor-sheet-drag-fill-core.mjs";
import {
    shiftPisiSheetFormulaReferences
} from "./pisi-editor-sheet-model.mjs";
import {
    setPisiSheetCellRecordsBatch
} from "./pisi-editor-sheet-database.mjs";

let pisiSheetDragFillState = null;
const pisiSheetDragFillPreviewCells = new Set();

function clearPisiSheetDragFillPreview() {
    for (const cell of pisiSheetDragFillPreviewCells) {
        cell.classList.remove(
            'pisi-sheet-drag-fill-preview'
        );
    }

    pisiSheetDragFillPreviewCells.clear();
}

function clearPisiSheetDragFillHandle(table) {
    table?.querySelectorAll?.(
        '[data-pisi-sheet-drag-fill-handle]'
    ).forEach((handle) => handle.remove());

    table?.querySelectorAll?.(
        '.pisi-sheet-fill-handle-cell'
    ).forEach((cell) => {
        cell.classList.remove(
            'pisi-sheet-fill-handle-cell'
        );
    });
}

function renderPisiSheetDragFillPreview(
    table,
    sourceRect,
    fillRect
) {
    clearPisiSheetDragFillPreview();

    if (!table || !sourceRect || !fillRect) return;

    table.querySelectorAll(
        'tbody td[data-cell]'
    ).forEach((cell) => {
        const point =
            getPisiSheetCellPosition(cell);

        if (
            !point ||
            !isPisiSheetPointInFillRect(
                point.row,
                point.col,
                fillRect
            ) ||
            isPisiSheetPointInFillRect(
                point.row,
                point.col,
                sourceRect
            )
        ) {
            return;
        }

        cell.classList.add(
            'pisi-sheet-drag-fill-preview'
        );
        pisiSheetDragFillPreviewCells.add(cell);
    });
}

function getPisiSheetDragFillSourceMatrix(
    table,
    sourceRect
) {
    const matrix = [];

    for (
        let row = sourceRect.rowStart;
        row <= sourceRect.rowEnd;
        row += 1
    ) {
        const line = [];

        for (
            let col = sourceRect.colStart;
            col <= sourceRect.colEnd;
            col += 1
        ) {
            const source =
                getPisiSheetCellSource(
                    table,
                    row,
                    col
                );

            line.push({
                value: source.value,
                formula: source.formula,
                format: structuredClone(
                    source.format || {}
                )
            });
        }

        matrix.push(line);
    }

    return matrix;
}

function getPisiSheetDragFillMatrixSource(
    matrix,
    sourceRect,
    sourcePoint
) {
    return matrix[
        sourcePoint.row - sourceRect.rowStart
    ]?.[
        sourcePoint.col - sourceRect.colStart
    ] || {
        value: '',
        formula: null,
        format: {}
    };
}

function applyPisiSheetDragFill(
    table,
    sourceRect,
    targetPoint
) {
    const fillRect = getPisiSheetDragFillRect(
        sourceRect,
        targetPoint
    );

    if (!fillRect) return false;

    if (
        fillRect.rowStart === sourceRect.rowStart &&
        fillRect.rowEnd === sourceRect.rowEnd &&
        fillRect.colStart === sourceRect.colStart &&
        fillRect.colEnd === sourceRect.colEnd
    ) {
        return false;
    }

    const matrix =
        getPisiSheetDragFillSourceMatrix(
            table,
            sourceRect
        );
    const sourceValues = matrix.map((line) => (
        line.map((source) => source.value)
    ));
    const canUseSeries = matrix.every((line) => (
        line.every((source) => !source.formula)
    ));
    const changes = [];

    for (
        let row = fillRect.rowStart;
        row <= fillRect.rowEnd;
        row += 1
    ) {
        for (
            let col = fillRect.colStart;
            col <= fillRect.colEnd;
            col += 1
        ) {
            if (
                isPisiSheetPointInFillRect(
                    row,
                    col,
                    sourceRect
                )
            ) {
                continue;
            }

            const sourcePoint =
                getPisiSheetDragFillSourcePoint(
                    sourceRect,
                    row,
                    col
                );
            const source =
                getPisiSheetDragFillMatrixSource(
                    matrix,
                    sourceRect,
                    sourcePoint
                );
            const seriesValue = canUseSeries
                ? getPisiSheetDragFillSeriesValue(
                    sourceRect,
                    sourceValues,
                    row,
                    col
                )
                : null;

            changes.push({
                row,
                col,
                value:
                    seriesValue !== null
                        ? seriesValue
                        : source.value,
                formula: source.formula
                    ? shiftPisiSheetFormulaReferences(
                        source.formula,
                        row - sourcePoint.row,
                        col - sourcePoint.col
                    )
                    : null,
                format: structuredClone(
                    source.format || {}
                )
            });
        }
    }

    if (
        !changes.length ||
        !setPisiSheetCellRecordsBatch(
            table,
            changes
        )
    ) {
        return false;
    }

    recalcPisiSheet(table);
    renderPisiSheetDatabase(table);

    const anchor = getPisiSheetPointByIndex(
        table,
        fillRect.rowStart,
        fillRect.colStart
    );
    const focus = getPisiSheetPointByIndex(
        table,
        fillRect.rowEnd,
        fillRect.colEnd
    );

    if (anchor && focus) {
        setPisiSheetRangeSelection(
            table,
            anchor,
            focus,
            {
                mode: 'range',
                active: focus,
                ensureVisible: true
            }
        );
    } else {
        reconcilePisiSheetSelection(table);
    }

    schedulePisiSheetEditorNotification(table);
    return true;
}

function updatePisiSheetDragFillTarget(
    table,
    cell
) {
    if (
        !pisiSheetDragFillState ||
        pisiSheetDragFillState.table !== table
    ) {
        return false;
    }

    const point = getPisiSheetCellPosition(cell);
    if (!point) return false;

    const state = pisiSheetDragFillState;

    if (
        state.target?.rowId === point.rowId &&
        state.target?.colId === point.colId
    ) {
        return true;
    }

    state.target = point;

    const fillRect = getPisiSheetDragFillRect(
        state.sourceRect,
        point
    );

    renderPisiSheetDragFillPreview(
        table,
        state.sourceRect,
        fillRect
    );

    return true;
}

function maybeAutoScrollPisiSheetDragFill(
    table,
    event
) {
    const block = table.closest(
        '.pisi-sheet-block'
    );
    if (!block) return;

    const rect = block.getBoundingClientRect();
    const edge = 32;
    let delta = 0;

    if (event.clientY < rect.top + edge) {
        delta = -28;
    } else if (
        event.clientY > rect.bottom - edge
    ) {
        delta = 28;
    }

    if (delta) {
        block.scrollTop += delta;
    }
}

function startPisiSheetDragFill(
    table,
    sourceRect,
    event
) {
    if (
        !table ||
        !sourceRect ||
        event.button !== 0
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    finishPisiSheetCellEdit(table, {
        commit: true,
        refocus: false
    });

    pisiSheetDragFillState = {
        table,
        sourceRect: { ...sourceRect },
        target: null
    };

    table.classList.add(
        'pisi-sheet-drag-filling'
    );
}

function finishPisiSheetDragFill() {
    const state = pisiSheetDragFillState;

    if (!state) return false;

    pisiSheetDragFillState = null;
    state.table.classList.remove(
        'pisi-sheet-drag-filling'
    );

    clearPisiSheetDragFillPreview();

    if (!state.target) {
        renderPisiSheetSelection(state.table);
        return false;
    }

    const changed = applyPisiSheetDragFill(
        state.table,
        state.sourceRect,
        state.target
    );

    if (!changed) {
        renderPisiSheetSelection(state.table);
    }

    return changed;
}

function renderPisiSheetDragFillHandle(
    table,
    selection
) {
    clearPisiSheetDragFillHandle(table);

    if (
        !table ||
        !selection ||
        ['row', 'column'].includes(selection.mode) ||
        getPisiSheetCellEditState(table) ||
        table.classList.contains(
            'pisi-sheet-formula-reference-mode'
        )
    ) {
        return null;
    }

    const sourceRect =
        getPisiSheetSelectionRect(
            selection.anchor,
            selection.focus
        );

    if (!sourceRect) return null;

    const cell = getPisiSheetCell(
        table,
        sourceRect.rowEnd,
        sourceRect.colEnd
    );

    if (!cell || cell.hidden) return null;

    const handle = document.createElement('span');

    handle.className =
        'pisi-sheet-drag-fill-handle';
    handle.dataset.pisiSheetDragFillHandle = '1';
    handle.setAttribute('role', 'button');
    handle.setAttribute(
        'aria-label',
        window.pisiT?.('Doldurma tutamacı') ||
            'Doldurma tutamacı'
    );
    handle.setAttribute('contenteditable', 'false');

    handle.addEventListener(
        'mousedown',
        (/** @type {MouseEvent} */ event) => {
            event.stopImmediatePropagation();
            startPisiSheetDragFill(
                table,
                sourceRect,
                event
            );
        }
    );

    handle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    });

    cell.classList.add(
        'pisi-sheet-fill-handle-cell'
    );
    cell.appendChild(handle);

    return handle;
}

document.addEventListener(
    'mousemove',
    (/** @type {MouseEvent} */ event) => {
        const state = pisiSheetDragFillState;
        if (!state || !(event.buttons & 1)) return;

        maybeAutoScrollPisiSheetDragFill(
            state.table,
            event
        );

        const target = document.elementFromPoint(
            event.clientX,
            event.clientY
        );
        const cell = target instanceof Element
            ? target.closest('td[data-cell]')
            : null;

        if (
            cell &&
            state.table.contains(cell)
        ) {
            event.preventDefault();
            updatePisiSheetDragFillTarget(
                state.table,
                cell
            );
        }
    },
    true
);

document.addEventListener(
    'mouseup',
    () => {
        finishPisiSheetDragFill();
    },
    true
);

window.addEventListener('blur', () => {
    if (!pisiSheetDragFillState) return;

    pisiSheetDragFillState.table.classList.remove(
        'pisi-sheet-drag-filling'
    );
    pisiSheetDragFillState = null;
    clearPisiSheetDragFillPreview();
});

export {
    applyPisiSheetDragFill,
    clearPisiSheetDragFillHandle,
    renderPisiSheetDragFillHandle
};
