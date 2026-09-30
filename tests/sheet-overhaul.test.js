const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

async function loadSheetModel() {
    const modelUrl = pathToFileURL(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-model.mjs'
        )
    );

    return import(modelUrl.href);
}

test('tablo referansları satır ve sütun değişikliklerinde güncellenir', async () => {
    const model = await loadSheetModel();

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=SUM(A1:B4)+C2',
            {
                type: 'insert-row',
                index: 1,
                count: 1
            }
        ),
        '=SUM(A1:B5)+C3'
    );

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=A1+B1+D1',
            {
                type: 'delete-col',
                index: 1,
                count: 2
            }
        ),
        '=A1+#REF!+B1'
    );
});

test('range referansları silmede daralır ve yalnız tamamen silinirse REF olur', async () => {
    const model = await loadSheetModel();

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=SUM(A1:A5)',
            {
                type: 'delete-row',
                index: 0,
                count: 1
            }
        ),
        '=SUM(A1:A4)'
    );

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=SUM(A1:A5)',
            {
                type: 'delete-row',
                index: 1,
                count: 2
            }
        ),
        '=SUM(A1:A3)'
    );

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=SUM(A1:A2)',
            {
                type: 'delete-row',
                index: 0,
                count: 2
            }
        ),
        '=SUM(#REF!)'
    );
});

test('formula rewrite stringleri ve fonksiyon adlarını değiştirmez', async () => {
    const model = await loadSheetModel();

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=CONCAT("A1:B2",A1)+LOG10(B1)',
            {
                type: 'insert-row',
                index: 0,
                count: 1
            }
        ),
        '=CONCAT("A1:B2",A2)+LOG10(B2)'
    );
});

test('absolute ve Z sonrası sütun referansları structural editlerde korunur', async () => {
    const model = await loadSheetModel();

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=$A$1+B$2+$C3',
            {
                type: 'insert-row',
                index: 1,
                count: 1
            }
        ),
        '=$A$1+B$3+$C4'
    );

    assert.equal(
        model.transformPisiSheetFormulaReferences(
            '=Z1+AA1+AB1',
            {
                type: 'insert-col',
                index: 26,
                count: 1
            }
        ),
        '=Z1+AB1+AC1'
    );
});

test('Sheet Database 1. aşama DOM dışı state ve view model kullanır', () => {
    const database = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-database.mjs'
        ),
        'utf8'
    );
    const databaseDom = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-database-dom.mjs'
        ),
        'utf8'
    );
    const sheet = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet.mjs'
        ),
        'utf8'
    );
    const selectionState = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-selection-state.mjs'
        ),
        'utf8'
    );
    const selection = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-selection.mjs'
        ),
        'utf8'
    );
    const interactions = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-interactions.mjs'
        ),
        'utf8'
    );
    const structure = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-structure.mjs'
        ),
        'utf8'
    );
    const toolbar = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-paint.mjs'
        ),
        'utf8'
    );
    const popovers = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-toolbar-popovers.mjs'
        ),
        'utf8'
    );
    const unifiedToolbar = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-unified-toolbar.mjs'
        ),
        'utf8'
    );

    assert.match(database, /databaseId/);
    assert.match(database, /fields/);
    assert.match(database, /items/);
    assert.match(database, /views/);
    assert.match(database, /activeViewId/);
    assert.match(database, /fieldOrder/);
    assert.match(database, /type: 'table'/);
    assert.match(database, /pisiSheetDatabases = new WeakMap/);

    assert.doesNotMatch(database, /querySelector/);
    assert.doesNotMatch(database, /querySelectorAll/);
    assert.doesNotMatch(database, /\.textContent/);

    assert.match(databaseDom, /migratePisiSheetDatabaseFromDom/);
    assert.match(databaseDom, /hydratePisiSheetDatabase/);
    assert.match(databaseDom, /renderPisiSheetDatabase/);
    assert.match(databaseDom, /pisiRowId/);
    assert.match(databaseDom, /pisiColId/);

    assert.match(sheet, /getPisiSheetCellSource/);
    assert.match(sheet, /getPisiSheetDatabaseDimensions/);
    assert.doesNotMatch(
        sheet,
        /const text = String\(cell\.textContent/
    );

    assert.match(structure, /insertPisiSheetItem/);
    assert.match(structure, /deletePisiSheetItems/);
    assert.match(structure, /getPisiSheetSelectionFocus/);
    assert.doesNotMatch(structure, /__pisiActiveSheetCell/);
    assert.doesNotMatch(structure, /pisiSheetSelections\.get/);
    assert.match(structure, /insertPisiSheetField/);
    assert.match(structure, /deletePisiSheetFields/);
    assert.match(
        structure,
        /transformPisiSheetDatabaseFormulas/
    );
    assert.doesNotMatch(structure, /tbody\.insertBefore/);
    assert.doesNotMatch(structure, /cell\.remove\(\)/);

    assert.match(selectionState, /rowId/);
    assert.match(selectionState, /colId/);
    assert.match(selectionState, /groupId/);
    assert.match(selectionState, /pisiSheetSelections = new Map/);
    assert.match(selectionState, /pisiActiveSheetGroupId/);
    assert.match(
        selectionState,
        /getPisiSheetSelectionStateForDatabase/
    );
    assert.match(
        selectionState,
        /setPisiSheetSelectionStateForDatabase/
    );
    assert.match(
        selectionState,
        /getPisiSelectedSheetPointsForDatabase/
    );
    assert.doesNotMatch(selectionState, /querySelector/);
    assert.doesNotMatch(selectionState, /querySelectorAll/);
    assert.doesNotMatch(selectionState, /window\./);
    assert.doesNotMatch(selectionState, /contenteditable/);

    assert.match(selection, /getPisiSheetSelectionState/);
    assert.match(selection, /setPisiSheetSelectionState/);
    assert.match(selection, /getPisiSheetSelectionFocus/);
    assert.match(selection, /getPisiSheetActiveTable/);
    assert.match(selection, /getPisiSelectedSheetPoints/);
    assert.match(selection, /getPisiSheetCellSource/);
    assert.doesNotMatch(
        selection,
        /pisiSheetSelections = new WeakMap/
    );
    assert.doesNotMatch(
        selection,
        /__pisiActiveSheetCell/
    );
    assert.match(
        selection,
        /setAttribute\('contenteditable', 'plaintext-only'\)/
    );
    assert.match(
        selection,
        /setAttribute\('contenteditable', 'false'\)/
    );

    assert.match(interactions, /hydratePisiSheetDatabase\(table\)/);
    assert.match(interactions, /renderPisiSheetDatabase\(table\)/);
    assert.match(interactions, /reconcilePisiSheetSelection\(table\)/);
    assert.match(interactions, /setPisiSheetSelectionState/);
    assert.doesNotMatch(interactions, /__pisiActiveSheetCell/);
    assert.doesNotMatch(
        interactions,
        /pisiSheetSelections\.(get|set)/
    );
    assert.match(interactions, /setPisiSheetFieldWidth/);
    assert.doesNotMatch(interactions, /pisiColumnWidths/);

    assert.match(interactions, /event\.key === 'Tab'/);
    assert.match(interactions, /event\.key === 'Enter'/);
    assert.match(interactions, /pisiSheetDragSelection/);
    assert.match(interactions, /data-pisi-sheet-context-action/);
    assert.match(interactions, /action: 'addRow'/);
    assert.match(interactions, /action: 'deleteRow'/);
    assert.match(interactions, /action: 'addCol'/);
    assert.match(interactions, /action: 'deleteCol'/);

    assert.match(sheet, /PISI_SHEET_MAX_ROWS = 300/);
    assert.match(sheet, /PISI_SHEET_MAX_COLS = 80/);
    assert.match(toolbar, /max="300".*data-pisi-excel-rows/);
    assert.match(toolbar, /max="80".*data-pisi-excel-cols/);

    assert.doesNotMatch(popovers, /openPisiToolbarTablePopover/);
    assert.doesNotMatch(popovers, /data-pisi-sheet-popover-action/);
    assert.doesNotMatch(unifiedToolbar, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(unifiedToolbar, /data-pisi-excel-action=/);
    assert.match(unifiedToolbar, /getPisiSheetActiveTable/);
    assert.doesNotMatch(
        unifiedToolbar,
        /__pisiActiveSheetCell/
    );
    assert.doesNotMatch(sheet, /__pisiActiveSheetCell/);
    assert.match(unifiedToolbar, /insertPisiSheet\(editor, 5, 5\)/);
});
