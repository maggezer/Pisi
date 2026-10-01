import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getPisiSheetDragFillRect,
    getPisiSheetDragFillSeriesValue,
    getPisiSheetDragFillSourcePoint,
    isPisiSheetPointInFillRect
} from '../renderer/editor/pisi-editor-sheet-drag-fill-core.mjs';
import {
    shiftPisiSheetFormulaReferences
} from '../renderer/editor/pisi-editor-sheet-model.mjs';

test('drag fill expands the selected rectangle to the pointer target', () => {
    const source = {
        rowStart: 1,
        rowEnd: 2,
        colStart: 1,
        colEnd: 2
    };

    assert.deepEqual(
        getPisiSheetDragFillRect(
            source,
            { row: 5, col: 3 }
        ),
        {
            rowStart: 1,
            rowEnd: 5,
            colStart: 1,
            colEnd: 3
        }
    );

    assert.equal(
        isPisiSheetPointInFillRect(
            4,
            3,
            source
        ),
        false
    );
});

test('drag fill tiles a multi-cell source pattern', () => {
    const source = {
        rowStart: 2,
        rowEnd: 3,
        colStart: 4,
        colEnd: 5
    };

    assert.deepEqual(
        getPisiSheetDragFillSourcePoint(
            source,
            4,
            6
        ),
        { row: 2, col: 4 }
    );

    assert.deepEqual(
        getPisiSheetDragFillSourcePoint(
            source,
            5,
            7
        ),
        { row: 3, col: 5 }
    );
});

test('vertical numeric drag fill continues an arithmetic series', () => {
    const source = {
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 0
    };
    const values = [
        [1],
        [2]
    ];

    assert.equal(
        getPisiSheetDragFillSeriesValue(
            source,
            values,
            2,
            0
        ),
        3
    );

    assert.equal(
        getPisiSheetDragFillSeriesValue(
            source,
            values,
            4,
            0
        ),
        5
    );

    assert.equal(
        getPisiSheetDragFillSeriesValue(
            source,
            values,
            -1,
            0
        ),
        0
    );
});

test('horizontal numeric drag fill continues an arithmetic series', () => {
    const source = {
        rowStart: 3,
        rowEnd: 3,
        colStart: 1,
        colEnd: 2
    };
    const values = [[10, 15]];

    assert.equal(
        getPisiSheetDragFillSeriesValue(
            source,
            values,
            3,
            3
        ),
        20
    );
});

test('drag-filled formulas shift relative references but preserve absolute axes', () => {
    assert.equal(
        shiftPisiSheetFormulaReferences(
            '=A1+$B2+C$3+$D$4',
            2,
            3
        ),
        '=D3+$B4+F$3+$D$4'
    );

    assert.equal(
        shiftPisiSheetFormulaReferences(
            '=SUM(A1:B2)',
            1,
            2
        ),
        '=SUM(C2:D3)'
    );
});

test('drag-filled formulas do not rewrite quoted cell-like text', () => {
    assert.equal(
        shiftPisiSheetFormulaReferences(
            '=CONCAT("A1",A1)',
            1,
            1
        ),
        '=CONCAT("A1",B2)'
    );
});
