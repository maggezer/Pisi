import test from 'node:test';
import assert from 'node:assert/strict';

import {
    transformPisiSheetFormulaReferences
} from '../renderer/editor/pisi-editor-sheet-model.mjs';

test('column reorder keeps single-cell references bound to the same logical fields', () => {
    const result = transformPisiSheetFormulaReferences(
        '=A1+B2+$C$3',
        {
            type: 'reorder-col',
            indexMap: [2, 0, 1]
        }
    );

    assert.equal(
        result,
        '=C1+A2+$B$3'
    );
});

test('column reorder splits a displaced range into equivalent contiguous groups', () => {
    const result = transformPisiSheetFormulaReferences(
        '=SUM(A1:B2)',
        {
            type: 'reorder-col',
            indexMap: [2, 0, 1]
        }
    );

    assert.equal(
        result,
        '=SUM(A1:A2,C1:C2)'
    );
});

test('column reorder keeps a range compact when its logical fields remain contiguous', () => {
    const result = transformPisiSheetFormulaReferences(
        '=SUM(A1:C2)',
        {
            type: 'reorder-col',
            indexMap: [2, 0, 1]
        }
    );

    assert.equal(
        result,
        '=SUM(A1:C2)'
    );
});
