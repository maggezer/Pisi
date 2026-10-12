// Selection coordinates stay in model space; rectangles use the filtered,
// sorted view, including rows outside the current virtual rendering window.
export function getPisiSheetViewAxes(table) {
    return { rows: getPisiSheetVisibleRowIndices(table), cols: getPisiSheetVisibleColumnIndices(table) };
}

export function getPisiSheetViewPoint(axes, point) {
    if (!point) return null;
    const row = axes.rows.indexOf(point.row);
    const col = axes.cols.indexOf(point.col);
    return row < 0 || col < 0 ? null : { ...point, row, col };
}

export function getPisiSheetViewSelectionRect(axes, selection) {
    if (!selection || !axes.rows.length || !axes.cols.length) return null;
    const anchor = getPisiSheetViewPoint(axes, selection.anchor);
    const focus = getPisiSheetViewPoint(axes, selection.focus);
    const rowA = axes.rows.indexOf(selection.anchor.row),
        rowB = axes.rows.indexOf(selection.focus.row);
    const colA = axes.cols.indexOf(selection.anchor.col),
        colB = axes.cols.indexOf(selection.focus.col);
    if (selection.mode === 'row')
        return rowA < 0 || rowB < 0 ? null : { rowStart: Math.min(rowA, rowB), rowEnd: Math.max(rowA, rowB), colStart: 0, colEnd: axes.cols.length - 1 };
    if (selection.mode === 'column')
        return colA < 0 || colB < 0 ? null : { rowStart: 0, rowEnd: axes.rows.length - 1, colStart: Math.min(colA, colB), colEnd: Math.max(colA, colB) };
    if (!anchor || !focus) return null;
    return {
        rowStart: Math.min(anchor.row, focus.row),
        rowEnd: Math.max(anchor.row, focus.row),
        colStart: Math.min(anchor.col, focus.col),
        colEnd: Math.max(anchor.col, focus.col)
    };
}

export function getPisiSheetViewSelectionIndices(axes, selection) {
    const rect = getPisiSheetViewSelectionRect(axes, selection);
    if (!rect) return [];
    const points = [];
    for (let row = rect.rowStart; row <= rect.rowEnd; row += 1) {
        for (let col = rect.colStart; col <= rect.colEnd; col += 1) points.push({ row: axes.rows[row], col: axes.cols[col] });
    }
    return points;
}
