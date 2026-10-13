import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { getPisiSheetViewItemRecords } from '../renderer/editor/pisi-editor-sheet-view-query-core.mjs';
import * as selection from '../renderer/editor/pisi-editor-sheet-view-selection.mjs';
import * as fill from '../renderer/editor/pisi-editor-sheet-drag-fill-core.mjs';
import { shiftPisiSheetFormulaReferences } from '../renderer/editor/pisi-editor-sheet-model.mjs';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');
const db = () => ({
    fields: [{ id: 'value', type: 'number' }],
    items: [40, 20, 50, 10, 30].map((value, i) => ({ id: 'row' + i, values: { value: { value: String(value) } } }))
});
const axes = { rows: [3, 1, 4, 0, 2], cols: [0, 2] };
const range = { mode: 'range', anchor: { row: 3, col: 0 }, focus: { row: 4, col: 2 } };
function load(file, names, context) {
    const source = fs.readFileSync(new URL('../renderer/editor/' + file, import.meta.url), 'utf8');
    vm.createContext(context);
    vm.runInContext(names.map((name) => extractFunction(source, name)).join('\n'), context);
    return context;
}
test('sorted range selects the visible interval, excluding unrelated model rows and hidden columns', () => {
    const rows = getPisiSheetViewItemRecords(db(), { sorts: [{ fieldId: 'value', direction: 'asc' }] }).map((r) => r.modelIndex);
    assert.deepEqual(rows, axes.rows);
    assert.deepEqual(
        selection.getPisiSheetViewSelectionIndices({ ...axes, rows }, range),
        [3, 1, 4].flatMap((row) => [0, 2].map((col) => ({ row, col })))
    );
});
test('reverse Shift selection selects the same visible interval', () => {
    assert.deepEqual(
        selection.getPisiSheetViewSelectionIndices(axes, { ...range, anchor: range.focus, focus: range.anchor }),
        selection.getPisiSheetViewSelectionIndices(axes, range)
    );
});
test('filtered-out endpoints fail closed and filtered rows are never selected', () => {
    const filtered = { ...axes, rows: [3, 4, 0, 2] };
    assert.deepEqual(
        selection.getPisiSheetViewSelectionIndices(filtered, range).map((p) => p.row),
        [3, 3, 4, 4]
    );
    assert.deepEqual(selection.getPisiSheetViewSelectionIndices(filtered, { ...range, focus: { row: 1, col: 2 } }), []);
});
test('row and column headers use view axes even when their opposite endpoint is hidden', () => {
    assert.equal(selection.getPisiSheetViewSelectionIndices(axes, { ...range, mode: 'row', anchor: { row: 3, col: 1 } }).length, 6);
    assert.deepEqual(
        [
            ...new Set(
                selection
                    .getPisiSheetViewSelectionIndices({ ...axes, rows: [3, 4] }, { ...range, mode: 'column', anchor: { row: 1, col: 0 } })
                    .map((p) => p.row)
            )
        ],
        [3, 4]
    );
});
test('selection spans the whole view independently of the virtual rendering window', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => 999 - i);
    const points = selection.getPisiSheetViewSelectionIndices({ rows, cols: [0] }, { mode: 'range', anchor: { row: 999, col: 0 }, focus: { row: 0, col: 0 } });
    assert.equal(points.length, 1000);
    assert.equal(points.at(-1).row, 0);
});
test('clear uses selected model points including cells not currently rendered', () => {
    const cleared = [];
    const c = load('pisi-editor-sheet-structure.mjs', ['clearPisiSheetSelectedCells'], {
        getPisiSheetViewAxes: () => axes,
        getPisiSheetSelection: () => range,
        getPisiSheetViewSelectionIndices: selection.getPisiSheetViewSelectionIndices,
        clearPisiSheetCellsBatch: (_t, points) => {
            cleared.push(...points.map(({ row, col }) => [row, col]));
            return true;
        },
        getPisiSheetCell: () => null,
        pisiEditedSheetCells: new Set(),
        recalcPisiSheet() {},
        schedulePisiSheetEditorNotification() {}
    });
    assert.equal(c.clearPisiSheetSelectedCells({ querySelectorAll: () => [] }), true);
    assert.deepEqual(cleared, [
        [3, 0],
        [3, 2],
        [1, 0],
        [1, 2],
        [4, 0],
        [4, 2]
    ]);
});
test('deleting sorted selected rows preserves unselected rows and transforms references in descending model order', () => {
    const data = db(),
        transforms = [];
    const c = load('pisi-editor-sheet-structure.mjs', ['deletePisiSheetRows'], {
        getPisiSheetDimensions: () => ({ rows: data.items.length, cols: 3 }),
        getPisiSheetMutationFocus: () => range.focus,
        getPisiSelectedSheetPoints: () => selection.getPisiSheetViewSelectionIndices(axes, range),
        deletePisiSheetItems: (_t, index, count) => data.items.splice(index, count),
        updatePisiSheetFormulaReferences: (_t, change) => transforms.push(change.index),
        refreshPisiSheetCellMetadata() {},
        recalcPisiSheet() {},
        getPisiSheetCell: () => null
    });
    assert.equal(c.deletePisiSheetRows({}), true);
    assert.deepEqual(
        data.items.map((i) => i.id),
        ['row0', 'row2']
    );
    assert.deepEqual(transforms, [4, 3, 1]);
});
function fillContext(formula = null) {
    const changes = [];
    const c = load('pisi-editor-sheet-drag-fill.mjs', ['getPisiSheetDragFillSourceMatrix', 'getPisiSheetDragFillMatrixSource', 'applyPisiSheetDragFill'], {
        ...fill,
        structuredClone,
        shiftPisiSheetFormulaReferences,
        getPisiSheetViewAxes: () => axes,
        getPisiSheetCellSource: (_t, row) => ({ value: row === 3 ? '1' : '2', formula, format: {} }),
        setPisiSheetCellRecordsBatch: (_t, items) => {
            changes.push(...items);
            return true;
        },
        recalcPisiSheet() {},
        renderPisiSheetDatabase() {},
        getPisiSheetPointByIndex: (_t, row, col) => ({ row, col }),
        setPisiSheetRangeSelection() {},
        reconcilePisiSheetSelection() {},
        schedulePisiSheetEditorNotification() {}
    });
    return { c, changes };
}
test('drag fill follows sorted visual rows and skips hidden columns', () => {
    const { c, changes } = fillContext();
    c.applyPisiSheetDragFill({}, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 0 }, { row: 3, col: 0 });
    assert.deepEqual(
        changes.map((x) => [x.row, x.col, x.value]),
        [
            [4, 0, 3],
            [0, 0, 4]
        ]
    );
});
test('drag fill shifts formulas by model coordinates rather than visual row distance', () => {
    const { c, changes } = fillContext('=A4');
    c.applyPisiSheetDragFill({}, { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 0 }, { row: 1, col: 1 });
    assert.equal(changes.find((x) => x.row === 1 && x.col === 0).formula, '=A2');
    assert.equal(changes.find((x) => x.row === 3 && x.col === 2).formula, '=C4');
});

test('formatting includes selected cells outside the rendered window', () => {
    const written = [];
    const c = load('pisi-editor-sheet-structure.mjs', ['applyPisiSheetCellFormat'], {
        getPisiSelectedSheetPoints: () => selection.getPisiSheetViewSelectionIndices(axes, range),
        getPisiSheetCell: () => null,
        document: { createElement: () => ({ style: {} }) },
        getPisiSheetCellSource: () => ({ format: {} }),
        applyPisiSheetCellFormatToDom: (cell, format) => Object.assign(cell.style, format),
        capturePisiSheetCellFormat: (cell) => cell.style,
        setPisiSheetCellFormat: (_t, row, col, format) => written.push([row, col, format.fontWeight]),
        renderPisiSheetSelection() {}
    });
    assert.equal(c.applyPisiSheetCellFormat({}, 'toggleBold'), true);
    assert.deepEqual(
        written,
        [3, 1, 4].flatMap((row) => [0, 2].map((col) => [row, col, '700']))
    );
});

test('column deletion skips hidden fields between selected visible columns', () => {
    const fields = ['first', 'hidden', 'last', 'remaining'],
        deleted = [];
    const c = load('pisi-editor-sheet-structure.mjs', ['deletePisiSheetColumns'], {
        getPisiSheetDimensions: () => ({ rows: 5, cols: fields.length }),
        getPisiSheetMutationFocus: () => range.focus,
        getPisiSelectedSheetPoints: () => selection.getPisiSheetViewSelectionIndices(axes, range),
        deletePisiSheetFields: (_t, index, count) => {
            deleted.push(index);
            fields.splice(index, count);
        },
        updatePisiSheetFormulaReferences() {},
        refreshPisiSheetCellMetadata() {},
        recalcPisiSheet() {},
        getPisiSheetCell: () => null
    });
    assert.equal(c.deletePisiSheetColumns({}), true);
    assert.deepEqual(fields, ['hidden', 'remaining']);
    assert.deepEqual(deleted, [2, 0]);
});
