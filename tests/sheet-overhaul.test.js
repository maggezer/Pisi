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

test('tablo arayüzünde Phase 2 gezinme, seçim, yapı ve biçimlendirme bulunur', () => {
    const sheet = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet.mjs'
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
    const paint = fs.readFileSync(
        path.join(
            root,
            'renderer/editor/pisi-editor-paint.mjs'
        ),
        'utf8'
    );
    const tableSource = [sheet, interactions, structure].join('\n');

    assert.match(tableSource, /event\.key === 'Tab'/);
    assert.match(tableSource, /event\.key === 'Enter'/);
    assert.match(interactions, /pisiSheetDragSelection/);
    assert.match(interactions, /table\.addEventListener\('mouseover'/);
    assert.match(interactions, /data-pisi-sheet-corner/);
    assert.match(tableSource, /deletePisiSheetRows/);
    assert.match(tableSource, /deletePisiSheetColumns/);
    assert.match(tableSource, /applyPisiSheetCellFormat/);
    assert.match(tableSource, /transformPisiSheetFormulaReferences/);

    assert.match(structure, /verticalMiddle/);
    assert.match(structure, /toggleWrap/);
    assert.match(structure, /borderAll/);
    assert.match(structure, /borderNone/);

    assert.match(sheet, /PISI_SHEET_MAX_ROWS = 300/);
    assert.match(sheet, /PISI_SHEET_MAX_COLS = 80/);
    assert.match(toolbar, /max="300".*data-pisi-excel-rows/);
    assert.match(toolbar, /max="80".*data-pisi-excel-cols/);

    assert.doesNotMatch(popovers, /openPisiToolbarTablePopover/);
    assert.doesNotMatch(popovers, /data-pisi-sheet-popover-action/);
    assert.doesNotMatch(popovers, /data-pisi-table-custom-rows/);

    assert.doesNotMatch(unifiedToolbar, /pisi-sheet-inline-tools/);
    assert.doesNotMatch(unifiedToolbar, /data-pisi-excel-action=/);
    assert.match(unifiedToolbar, /insertPisiSheet\(editor, 5, 5\)/);
    assert.doesNotMatch(unifiedToolbar, /openPisiToolbarTablePopover/);

    assert.match(interactions, /table\.addEventListener\('contextmenu'/);
    assert.match(interactions, /data-pisi-sheet-context-action/);
    assert.match(interactions, /action: 'addRow'/);
    assert.match(interactions, /action: 'deleteRow'/);
    assert.match(interactions, /action: 'addCol'/);
    assert.match(interactions, /action: 'deleteCol'/);
    assert.match(interactions, /label: 'Satır ekle'/);
    assert.match(interactions, /label: 'Sütun sil'/);

    assert.match(paint, /notifyPisiEditorChanged\(editor, rehydrate = true\)/);
    assert.match(structure, /notifyPisiEditorChanged\(editor, false\)/);
    assert.match(
        interactions,
        /if \(pisiBoundSheets\.has\(table\)\) return;[\s\S]*refreshPisiSheetCellMetadata\(table\)/
    );
    assert.match(interactions, /function isPisiSheetCellSelected/);
    assert.match(interactions, /pisiRenderedSheetSelectionCells/);
    assert.match(
        interactions,
        /table\.tBodies\?\.\[0\]\?\.rows\?\.\[row\]/
    );
    assert.doesNotMatch(
        interactions,
        /getPisiSelectedSheetCells\(table\)\.includes\(cell\)/
    );
    assert.doesNotMatch(
        interactions,
        /table\.querySelectorAll\(\s*['"]\.pisi-sheet-cell-selected/
    );
});
