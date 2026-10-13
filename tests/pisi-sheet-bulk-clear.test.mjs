import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { getPisiSheetViewSelectionIndices } from '../renderer/editor/pisi-editor-sheet-view-selection.mjs';
const { extractFunction } = createRequire(import.meta.url)('./source-helper.js');
function load(file, names, context) {
    const source = fs.readFileSync(new URL('../renderer/editor/' + file, import.meta.url), 'utf8');
    vm.createContext(context);
    vm.runInContext(names.map((name) => extractFunction(source, name)).join('\n'), context);
    return context;
}
function setup(rows, cols) {
    const database = {
        fields: Array.from({ length: cols }, (_, i) => ({ id: 'c' + i })),
        items: Array.from({ length: rows }, (_, i) => ({ id: 'r' + i, values: { c0: { value: 'value ' + i, formula: null, format: {} } } }))
    };
    let persists = 0,
        fieldLookups = 0,
        snapshot;
    const c = load('pisi-editor-sheet-database.mjs', ['clearPisiSheetCellsBatch'], {
        requirePisiSheetDatabase: () => database,
        getPisiSheetOrderedFields: () => {
            fieldLookups++;
            return database.fields;
        },
        persistPisiSheetDatabase: () => {
            persists++;
            snapshot = JSON.stringify(database);
        }
    });
    return { c, database, counts: () => ({ persists, fieldLookups }), saved: () => JSON.parse(snapshot) };
}
test('bulk clear reaches the last cell of a 10000 by 80 sheet and serializes once', () => {
    const h = setup(10000, 80);
    h.database.items[9999].values.c79 = { value: '999', formula: '=A10000', format: { fontWeight: '700' } };
    const points = getPisiSheetViewSelectionIndices(
        { rows: Array.from({ length: 10000 }, (_, i) => i), cols: Array.from({ length: 80 }, (_, i) => i) },
        { mode: 'range', anchor: { row: 0, col: 0 }, focus: { row: 9999, col: 79 } }
    );
    assert.equal(h.c.clearPisiSheetCellsBatch({}, points), true);
    assert.deepEqual(h.counts(), { persists: 1, fieldLookups: 1 });
    const saved = h.saved();
    assert.equal(
        saved.items.every((item) => !item.values.c0),
        true
    );
    assert.deepEqual(saved.items[9999].values.c79, { value: '', formula: null, format: { fontWeight: '700' } });
});
test('filtered sorted selection clears offscreen values and formulas while retaining hidden cells and unselected rows', () => {
    const h = setup(10000, 3);
    for (const item of h.database.items) {
        item.values.c1 = { value: 'hidden', format: {} };
        item.values.c2 = { value: '', formula: '=A1', format: {} };
    }
    const points = getPisiSheetViewSelectionIndices(
        { rows: [9999, 5000, 0], cols: [0, 2] },
        { mode: 'range', anchor: { row: 9999, col: 0 }, focus: { row: 0, col: 2 } }
    );
    h.c.clearPisiSheetCellsBatch({}, points);
    const saved = h.saved();
    for (const row of [9999, 5000, 0]) assert.deepEqual(saved.items[row].values, { c1: { value: 'hidden', format: {} } });
    assert.equal(saved.items[1].values.c0.value, 'value 1');
    assert.equal(saved.items[1].values.c2.formula, '=A1');
});
test('bulk clear with an empty or invalid selection does not persist', () => {
    const h = setup(2, 2);
    assert.equal(h.c.clearPisiSheetCellsBatch({}, []), false);
    assert.equal(
        h.c.clearPisiSheetCellsBatch({}, [
            { row: -1, col: 0 },
            { row: 2, col: 0 },
            { row: 0, col: 4 }
        ]),
        false
    );
    assert.equal(h.counts().persists, 0);
    assert.equal(h.database.items[0].values.c0.value, 'value 0');
});
test('bulk-clear recalculation reads only rendered rows, including formulas dependent on cleared offscreen cells', () => {
    const reads = [],
        rendered = [];
    const c = load('pisi-editor-sheet.mjs', ['recalcPisiSheet'], {
        getPisiSheetDatabaseDimensions: () => ({ rows: 10000, cols: 2 }),
        getPisiSheetCellSource: (_table, row, col) => {
            reads.push([row, col]);
            return col ? { formula: '=A10000' } : { value: '' };
        },
        renderPisiSheetCellFromDatabase: (_table, row, col, value) => rendered.push([row, col, value]),
        pisiColumnName: () => 'B',
        evaluatePisiSheetFormulaResult: (_table, formula) => {
            assert.equal(formula, '=A10000');
            return { ok: true, value: 0 };
        },
        formatPisiSheetValue: String
    });
    c.recalcPisiSheet({ querySelectorAll: () => [{ dataset: { row: '0' } }, { dataset: { row: '0' } }, { dataset: { row: '9999' } }] }, { renderedOnly: true });
    assert.deepEqual(reads, [
        [0, 0],
        [0, 1],
        [9999, 0],
        [9999, 1]
    ]);
    assert.equal(rendered[3][2], '0');
});
