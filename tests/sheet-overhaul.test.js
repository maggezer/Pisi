const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

test('tablo referansları satır ve sütun değişikliklerinde güncellenir', async () => {
    const modelUrl = pathToFileURL(
        path.join(
            root,
            'renderer/editor/pisi-editor-sheet-model.mjs'
        )
    );

    const model = await import(modelUrl.href);

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

test('tablo arayüzünde gezinme, çoklu seçim ve biçimlendirme bulunur', () => {
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
    const tableSource = [sheet, interactions, structure].join('\n');

    assert.match(tableSource, /event\.key === 'Tab'/);
    assert.match(tableSource, /event\.key === 'Enter'/);
    assert.match(tableSource, /requestAnimationFrame/);
    assert.match(tableSource, /schedulePisiSheetEditorNotification/);
    assert.match(tableSource, /deletePisiSheetRows/);
    assert.match(tableSource, /deletePisiSheetColumns/);
    assert.match(tableSource, /applyPisiSheetCellFormat/);
    assert.match(tableSource, /transformPisiSheetFormulaReferences/);
    assert.match(toolbar, /data-pisi-excel-action="deleteRow"/);
    assert.match(toolbar, /data-pisi-excel-action="deleteCol"/);
    assert.match(toolbar, /data-pisi-excel-format="textColor"/);
    assert.match(toolbar, /data-pisi-excel-format="fillColor"/);
});
