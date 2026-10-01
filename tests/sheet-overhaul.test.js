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
    const fieldTypesCore = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-field-types-core.mjs'
        ),
        'utf8'
    );
    const fieldTypesUi = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-field-types-ui.mjs'
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
    const headerSelection = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-header-selection.mjs'
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
    const sheetViewQueryCore = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-view-query-core.mjs'
        ),
        'utf8'
    );
    const sheetViewQuery = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-view-query.mjs'
        ),
        'utf8'
    );
    const sheetPaginationCore = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-pagination-core.mjs'
        ),
        'utf8'
    );
    const sheetVirtualScroll = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-virtual-scroll.mjs'
        ),
        'utf8'
    );
    const sheetDragFill = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-drag-fill.mjs'
        ),
        'utf8'
    );
    const sheetDragFillCore = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-drag-fill-core.mjs'
        ),
        'utf8'
    );
    const sheetViewRulesUi = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-view-rules-ui.mjs'
        ),
        'utf8'
    );
    const sheetConditionalColorsUi = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-conditional-colors-ui.mjs'
        ),
        'utf8'
    );
    const sheetViewState = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-view-state.mjs'
        ),
        'utf8'
    );
    const columnReorder = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-column-reorder.mjs'
        ),
        'utf8'
    );
    const columnProperties = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-column-properties.mjs'
        ),
        'utf8'
    );
    const columnIcon = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-column-icon.mjs'
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
    const formulaReference = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-formula-reference.mjs'
        ),
        'utf8'
    );
    const keyboard = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-keyboard.mjs'
        ),
        'utf8'
    );
    const componentsCss = fs.readFileSync(
        path.join(root, 'styles/70-components.css'),
        'utf8'
    );
    const nodeEditor = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-node-editor.mjs'
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
    assert.match(
        database,
        /PISI_SHEET_DEFAULT_COLUMN_WIDTH = 96/
    );
    assert.match(database, /description:/);
    assert.match(
        database,
        /setPisiSheetCellRecordsBatch/
    );
    assert.match(database, /icon:/);
    assert.match(database, /wrap:/);
    assert.match(database, /pin:/);
    assert.match(database, /options:/);
    assert.match(database, /numberFormat:/);
    assert.match(
        database,
        /normalizePisiSheetFieldType/
    );
    assert.match(
        database,
        /normalizePisiSheetStoredValue/
    );
    assert.match(database, /updatePisiSheetField/);
    assert.match(database, /setPisiSheetFieldHidden/);
    assert.match(database, /hiddenFieldIds/);
    assert.match(database, /fieldOrder/);
    assert.match(database, /activeViewId/);
    assert.match(
        database,
        /makePisiSheetEmptyFilterTree/
    );
    assert.match(
        database,
        /normalizePisiSheetFilterTree/
    );
    assert.match(
        database,
        /normalizePisiSheetSorts/
    );
    assert.match(
        database,
        /conditionalColors/
    );
    assert.match(database, /page:/);
    assert.match(database, /pageSize:/);
    assert.match(database, /virtualScroll:/);
    assert.match(
        database,
        /normalizePisiSheetConditionalColors/
    );

    assert.doesNotMatch(database, /querySelector/);
    assert.doesNotMatch(database, /querySelectorAll/);
    assert.doesNotMatch(database, /\.textContent/);

    for (const type of [
        'text',
        'number',
        'date',
        'select',
        'mSelect',
        'checkbox',
        'formula'
    ]) {
        assert.match(
            fieldTypesCore,
            new RegExp("value: '" + type + "'")
        );
    }
    assert.match(
        fieldTypesCore,
        /PISI_SHEET_SELECT_COLORS/
    );
    assert.match(
        fieldTypesCore,
        /PISI_SHEET_NUMBER_FORMATS/
    );
    assert.match(
        fieldTypesCore,
        /normalizePisiSheetDateValue/
    );
    assert.match(
        fieldTypesCore,
        /normalizePisiSheetTypedValue/
    );
    assert.match(
        fieldTypesCore,
        /getPisiSheetTypedDisplayParts/
    );

    assert.match(
        fieldTypesUi,
        /renderPisiSheetTypedCell/
    );
    assert.match(
        fieldTypesUi,
        /beginPisiSheetTypedCellEdit/
    );
    assert.match(
        fieldTypesUi,
        /togglePisiSheetCheckboxCell/
    );
    assert.match(
        fieldTypesUi,
        /pisi-sheet-option-chip/
    );
    assert.match(
        fieldTypesUi,
        /input\.type = 'date'/
    );

    assert.match(databaseDom, /migratePisiSheetDatabaseFromDom/);
    assert.match(databaseDom, /hydratePisiSheetDatabase/);
    assert.match(databaseDom, /renderPisiSheetDatabase/);
    assert.match(databaseDom, /pisiRowId/);
    assert.match(databaseDom, /pisiColId/);
    assert.match(databaseDom, /hiddenFieldIds/);
    assert.match(databaseDom, /field\.wrap/);
    assert.match(databaseDom, /field\.pin/);
    assert.match(databaseDom, /pisi-sheet-column-pinned/);
    assert.match(
        databaseDom,
        /pisi-sheet-column-pinned-last/
    );
    assert.match(
        databaseDom,
        /label\.draggable = true/
    );
    assert.match(
        databaseDom,
        /visiblePinnedFieldIds/
    );
    assert.match(
        databaseDom,
        /modelIndex: rowIndex/
    );
    assert.match(
        databaseDom,
        /applyPisiSheetConditionalColorsToRow/
    );
    assert.match(
        databaseDom,
        /pisiConditionalColor/
    );
    assert.match(
        databaseDom,
        /pisiFieldIcon/
    );
    assert.match(
        databaseDom,
        /getPisiSheetVirtualRenderState/
    );
    assert.match(
        databaseDom,
        /pisi-sheet-virtual-spacer/
    );
    assert.match(
        databaseDom,
        /finalizePisiSheetVirtualRender/
    );
    assert.match(
        databaseDom,
        /setAttribute\(\s*'contenteditable',\s*'false'/
    );

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
    assert.match(selectionState, /active/);
    assert.match(
        selectionState,
        /getPisiSheetActivePointForDatabase/
    );
    assert.match(selectionState, /pisiSheetSelections = new Map/);
    assert.match(
        selectionState,
        /pisiSheetHeaderSelections = new Map/
    );
    assert.match(
        selectionState,
        /setPisiSheetHeaderSelectionStateForDatabase/
    );
    assert.match(
        selectionState,
        /getPisiSheetHeaderSelectionForDatabase/
    );
    assert.match(
        selectionState,
        /pisiSheetHeaderSelections\.delete\(groupId\)/
    );
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
    assert.match(
        headerSelection,
        /getPisiSheetHeaderSelection/
    );
    assert.match(
        headerSelection,
        /setPisiSheetHeaderSelectionStateForDatabase/
    );
    assert.match(
        headerSelection,
        /selectPisiSheetRow/
    );
    assert.match(
        headerSelection,
        /selectPisiSheetColumn/
    );
    assert.match(
        headerSelection,
        /getPisiSheetVisibleColumnIndices/
    );
    assert.match(
        selection,
        /pisi-sheet-header-selected/
    );
    assert.match(selection, /setPisiSheetSelectionState/);
    assert.match(selection, /getPisiSheetSelectionFocus/);
    assert.match(selection, /getPisiSheetActivePoint/);
    assert.match(
        selection,
        /function setPisiSheetRangeSelection/
    );
    assert.match(
        selection,
        /function ensurePisiSheetCellVisible/
    );
    assert.match(
        selection,
        /scrollIntoView\(\{[\s\S]*block: 'nearest',[\s\S]*inline: 'nearest'/
    );
    assert.match(
        selection,
        /extendPisiSheetSelectionByKeyboard[\s\S]*setPisiSheetRangeSelection/
    );
    assert.match(
        selection,
        /movePisiSheetCellFocus[\s\S]*ensureVisible: true/
    );
    assert.match(
        selection,
        /getPisiSheetVisibleRowIndices/
    );
    assert.match(
        selection,
        /getPisiSheetNextVisibleRowIndex/
    );
    assert.match(
        selection,
        /ensurePisiSheetModelCellRendered/
    );
    assert.match(
        selection,
        /renderPisiSheetDragFillHandle/
    );
    assert.match(
        selection,
        /clearPisiSheetDragFillHandle/
    );
    assert.match(selection, /pisi-sheet-cell-active/);
    assert.match(selection, /pisi-sheet-cell-selected/);
    assert.doesNotMatch(selection, /pisi-sheet-cell-range/);
    assert.match(selection, /getPisiSheetActiveTable/);
    assert.match(selection, /getPisiSelectedSheetPoints/);
    assert.match(selection, /getPisiSheetCellSource/);
    assert.match(selection, /getPisiSheetCellEditState/);
    assert.match(
        selection,
        /markPisiSheetCellEditFormulaReference/
    );
    assert.match(selection, /forceFormula/);
    assert.match(
        selection,
        /closePisiSheetFormulaReferenceSession\(table\)/
    );
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
    assert.match(
        interactions,
        /setPisiSheetRangeSelection/
    );
    assert.doesNotMatch(
        interactions,
        /setPisiSheetSelectionState\(table, \{[\s\S]*mode: 'range'/
    );
    assert.doesNotMatch(interactions, /__pisiActiveSheetCell/);
    assert.doesNotMatch(
        interactions,
        /pisiSheetSelections\.(get|set)/
    );
    assert.match(
        columnProperties,
        /setPisiSheetFieldWidth/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_MIN_COLUMN_WIDTH = 25/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_AUTO_FIT_MIN_WIDTH = 64/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_AUTO_FIT_MAX_WIDTH = 480/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_RESIZE_SNAP_PX = 4/
    );
    assert.match(
        columnProperties,
        /autoFitPisiSheetColumn/
    );
    assert.match(
        columnProperties,
        /measurePisiSheetText/
    );
    assert.match(
        columnProperties,
        /updatePisiSheetField/
    );
    assert.match(
        columnProperties,
        /setPisiSheetFieldHidden/
    );
    assert.match(
        columnProperties,
        /pisi-sheet-column-property-row/
    );
    assert.match(
        columnProperties,
        /configurePisiSheetColumnIconControl/
    );
    assert.match(
        columnIcon,
        /pisi-sheet-column-icon-input/
    );
    assert.match(
        columnIcon,
        /getPisiSheetFieldTypeIcon/
    );
    assert.match(
        columnProperties,
        /pisiSheetColumnAction/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_FIELD_TYPES/
    );
    assert.match(
        columnProperties,
        /PISI_SHEET_NUMBER_FORMATS/
    );
    assert.match(
        columnProperties,
        /pisi-sheet-column-options-group/
    );
    assert.match(
        columnProperties,
        /pisi-sheet-column-option-color/
    );
    assert.match(
        columnProperties,
        /numberFormatSelect/
    );
    assert.match(
        columnProperties,
        /movePisiSheetColumn/
    );
    assert.match(
        columnProperties,
        /'moveLeft'/
    );
    assert.match(
        columnProperties,
        /'moveRight'/
    );
    assert.doesNotMatch(
        columnProperties,
        /pisi-sheet-col-editor/
    );
    assert.match(
        interactions,
        /openPisiSheetColumnMenu/
    );
    assert.match(
        interactions,
        /autoFitPisiSheetColumn/
    );
    assert.match(
        interactions,
        /bindPisiSheetColumnReorder/
    );
    assert.match(
        interactions,
        /togglePisiSheetCheckboxCell/
    );
    assert.match(
        interactions,
        /beginPisiSheetTypedCellEdit/
    );
    assert.match(
        interactions,
        /beginPisiSheetFormulaReferencePick/
    );
    assert.match(
        interactions,
        /updatePisiSheetFormulaReferencePick/
    );
    assert.match(
        interactions,
        /finishPisiSheetFormulaReferencePick/
    );
    assert.doesNotMatch(interactions, /pisiColumnWidths/);

    assert.match(
        keyboard,
        /beginPisiSheetTypedCellEdit/
    );
    assert.match(
        keyboard,
        /isPisiSheetTypedEditorTarget/
    );

    assert.match(interactions, /event\.key === 'Tab'/);
    assert.match(interactions, /event\.key === 'Enter'/);
    assert.match(interactions, /event\.key === 'Escape'/);
    assert.match(
        interactions,
        /movePisiSheetFormulaReferenceByKeyboard/
    );
    assert.match(
        interactions,
        /movePisiSheetFormulaReferenceByKeyboard/
    );
    assert.doesNotMatch(
        interactions,
        /extendPisiSheetSelectionByKeyboard/
    );
    assert.doesNotMatch(interactions, /Backspace/);
    assert.doesNotMatch(
        interactions,
        /isPisiSheetPrintableKey/
    );
    assert.match(interactions, /pisiSheetDragSelection/);
    assert.match(
        interactions,
        /setPisiSheetRangeSelection/
    );
    assert.match(
        interactions,
        /anchor: \{ \.\.\.selection\.anchor \}/
    );
    assert.match(interactions, /data-pisi-sheet-context-action/);
    assert.match(interactions, /action: 'addRow'/);
    assert.match(interactions, /action: 'deleteRow'/);
    assert.match(interactions, /action: 'addCol'/);
    assert.match(interactions, /action: 'deleteCol'/);

    assert.match(
        sheetViewState,
        /clonePisiSheetTableView/
    );
    assert.match(
        sheetViewState,
        /setPisiSheetActiveView/
    );
    assert.match(
        sheetViewState,
        /activeViewId/
    );
    assert.match(
        sheetViewState,
        /conditionalColors/
    );
    assert.match(sheetViewState, /pageSize/);
    assert.match(sheetViewState, /virtualScroll/);
    assert.match(
        sheetViewQueryCore,
        /PISI_SHEET_FILTER_OPERATORS/
    );
    assert.match(
        sheetViewQueryCore,
        /normalizePisiSheetFilterTree/
    );
    assert.match(
        sheetViewQueryCore,
        /evaluatePisiSheetFilterTree/
    );
    assert.match(
        sheetViewQueryCore,
        /getPisiSheetViewItemRecords/
    );
    assert.match(
        sheetViewQueryCore,
        /resolvePisiSheetDateFilterValue/
    );
    assert.match(
        sheetViewQueryCore,
        /normalizePisiSheetConditionalColors/
    );
    assert.match(
        sheetViewQueryCore,
        /getPisiSheetConditionalColorMatches/
    );
    assert.match(
        sheetViewQuery,
        /setPisiSheetViewFilters/
    );
    assert.match(
        sheetViewQuery,
        /setPisiSheetViewSorts/
    );
    assert.match(
        sheetViewQuery,
        /addPisiSheetViewFilterGroup/
    );
    assert.match(
        sheetViewQuery,
        /movePisiSheetViewSort/
    );
    assert.match(
        sheetViewQuery,
        /setPisiSheetViewConditionalColors/
    );
    assert.match(
        sheetViewQuery,
        /movePisiSheetViewConditionalColor/
    );
    assert.match(
        sheetViewQuery,
        /getPisiSheetViewRecords/
    );
    assert.match(
        sheetPaginationCore,
        /paginatePisiSheetRecords/
    );
    assert.match(
        sheetPaginationCore,
        /computePisiSheetVirtualWindow/
    );
    assert.match(
        sheetVirtualScroll,
        /ensurePisiSheetPointRendered/
    );
    assert.match(
        sheetVirtualScroll,
        /setPisiSheetViewPageSize/
    );
    assert.match(
        sheetVirtualScroll,
        /pisi-sheet-pagination/
    );
    assert.match(
        sheetDragFillCore,
        /getPisiSheetDragFillSeriesValue/
    );
    assert.match(
        sheetDragFill,
        /pisi-sheet-drag-fill-handle/
    );
    assert.match(
        sheetDragFill,
        /applyPisiSheetDragFill/
    );
    assert.match(
        sheetDragFill,
        /shiftPisiSheetFormulaReferences/
    );
    assert.match(
        sheetDragFill,
        /setPisiSheetCellRecordsBatch/
    );
    assert.match(
        sheetViewRulesUi,
        /pisi-sheet-filter-group/
    );
    assert.match(
        sheetViewRulesUi,
        /pisi-sheet-sort-row/
    );
    assert.match(
        sheetConditionalColorsUi,
        /pisi-sheet-conditional-color-row/
    );
    assert.match(
        sheetConditionalColorsUi,
        /Koşullu renkler/
    );
    assert.match(
        sheetViewRulesUi,
        /'@today'/
    );
    assert.match(
        sheetViewRulesUi,
        /openPisiSheetViewRulesPanel/
    );
    assert.match(
        columnProperties,
        /openPisiSheetViewRulesPanel/
    );
    assert.match(
        columnReorder,
        /view\?\.fieldOrder/
    );
    assert.match(
        columnReorder,
        /reorder-col/
    );
    assert.match(
        columnReorder,
        /transformPisiSheetFormulaReferences/
    );
    assert.match(
        columnReorder,
        /dragstart/
    );
    assert.match(
        columnReorder,
        /dragover/
    );
    assert.match(
        columnReorder,
        /drop/
    );

    assert.match(sheet, /PISI_SHEET_MAX_ROWS = 10000/);
    assert.match(sheet, /PISI_SHEET_MAX_COLS = 80/);
    assert.match(sheet, /options\.forceFormula === true/);
    assert.match(toolbar, /max="10000".*data-pisi-excel-rows/);
    assert.match(toolbar, /max="80".*data-pisi-excel-cols/);

    assert.doesNotMatch(popovers, /openPisiToolbarTablePopover/);
    assert.doesNotMatch(popovers, /data-pisi-sheet-popover-action/);
    assert.doesNotMatch(unifiedToolbar, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(unifiedToolbar, /data-pisi-excel-action=/);
    assert.match(unifiedToolbar, /getPisiSheetActiveTable/);
    assert.match(
        formulaReference,
        /pisiSheetPointsToReference/
    );
    assert.match(
        formulaReference,
        /createPisiSheetCellReferenceTarget/
    );
    assert.match(
        formulaReference,
        /isPisiSheetCellReferenceExpression/
    );
    assert.match(
        formulaReference,
        /markPisiSheetCellEditFormulaReference/
    );
    assert.match(
        formulaReference,
        /active: session\.activePoint \|\| point/
    );
    assert.match(
        formulaReference,
        /movePisiSheetFormulaReferenceByKeyboard/
    );
    assert.match(
        formulaReference,
        /handlePisiSheetFormulaReferenceKeydown/
    );
    assert.match(
        formulaReference,
        /stopImmediatePropagation/
    );
    assert.match(
        formulaReference,
        /window\.addEventListener\([\s\S]*'keydown'[\s\S]*true/
    );
    assert.match(
        formulaReference,
        /closePisiSheetFormulaReferenceSession/
    );
    assert.match(
        formulaReference,
        /options\.extend !== true/
    );
    assert.match(
        formulaReference,
        /setPisiSheetRangeSelection/
    );
    assert.match(
        formulaReference,
        /data-pisi-excel-formula/
    );
    assert.match(
        keyboard,
        /handlePisiSheetSelectionKeydown/
    );
    assert.match(keyboard, /event\.key === 'Enter'/);
    assert.match(keyboard, /event\.key === 'Tab'/);
    assert.match(
        keyboard,
        /event\.shiftKey \? -1 : 1/
    );
    assert.match(keyboard, /event\.key === 'Delete'/);
    assert.match(keyboard, /event\.key === 'Backspace'/);
    assert.match(keyboard, /event\.key === 'Escape'/);
    assert.match(keyboard, /ArrowUp/);
    assert.match(keyboard, /ArrowDown/);
    assert.match(keyboard, /ArrowLeft/);
    assert.match(keyboard, /ArrowRight/);
    assert.match(
        keyboard,
        /beginPisiSheetCellEdit\(cell, \{/
    );
    assert.match(
        keyboard,
        /ensurePisiSheetModelCellRendered/
    );
    assert.match(
        keyboard,
        /pisi-sheet-block/
    );
    assert.match(
        keyboard,
        /getPisiSheetActivePoint/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-cell-active/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-cell-selected/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-header-selected/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-column-property-row/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-column-icon-input/
    );
    assert.match(
        componentsCss,
        /data-pisi-field-icon/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-virtualized/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-virtual-spacer/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-pagination/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-drag-fill-handle/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-drag-fill-preview/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-column-pinned/
    );
    assert.match(
        componentsCss,
        /position: sticky/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-column-pinned-last/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-col-drop-before/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-option-chip/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-checkbox-control/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-typed-editor/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-column-option-row/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-view-rules-panel/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-filter-condition/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-sort-row/
    );
    assert.match(
        componentsCss,
        /pisi-sheet-conditional-color-row/
    );
    assert.match(
        componentsCss,
        /data-pisi-conditional-color/
    );
    assert.match(
        componentsCss,
        /th\[data-row-header\]/
    );
    assert.match(
        componentsCss,
        /min-width: 25px/
    );
    assert.doesNotMatch(
        componentsCss,
        /pisi-sheet-formula-reference-mode[\s\S]*td\.pisi-sheet-cell-active[\s\S]*#42a5f5/
    );
    assert.match(
        componentsCss,
        /max-width: 36px/
    );
    assert.doesNotMatch(
        componentsCss,
        /pisi-sheet-cell-range/
    );
    assert.doesNotMatch(
        unifiedToolbar,
        /__pisiActiveSheetCell/
    );
    assert.doesNotMatch(sheet, /__pisiActiveSheetCell/);
    assert.match(unifiedToolbar, /insertPisiSheet\(editor, 5, 5\)/);
    assert.match(unifiedToolbar, /data-pisi-excel-formula/);
    assert.match(unifiedToolbar, /pisi-sheet-formula-input/);
    assert.match(
        nodeEditor,
        /data-pisi-sheet-model/
    );
    assert.match(
        nodeEditor,
        /data-pisi-database-id/
    );
    assert.match(
        nodeEditor,
        /JSON\.parse\(value\)/
    );
    assert.match(
        nodeEditor,
        /JSON\.stringify\(snapshot\)/
    );
});
