import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getPisiSheetTypedDisplayParts,
    normalizePisiSheetDateValue,
    normalizePisiSheetFieldOptions,
    normalizePisiSheetNumberFormat,
    normalizePisiSheetTypedValue
} from '../renderer/editor/pisi-editor-sheet-field-types-core.mjs';

test('Sheet date values are canonical ISO dates rather than display text', () => {
    assert.equal(normalizePisiSheetDateValue('2026-09-30'), '2026-09-30');
    assert.equal(normalizePisiSheetDateValue('2026-09-30T18:00:00+03:00'), '2026-09-30');
    assert.equal(normalizePisiSheetDateValue('not-a-date'), '');
});

test('select and multi-select values use stable option ids', () => {
    const field = {
        type: 'mSelect',
        options: [
            {
                id: 'todo',
                label: 'Todo',
                color: '#e57373'
            },
            {
                id: 'done',
                label: 'Done',
                color: '#81c784'
            }
        ]
    };

    assert.deepEqual(normalizePisiSheetTypedValue(field, ['Todo', 'done', 'unknown']), ['todo', 'done']);

    const normalized = normalizePisiSheetFieldOptions(field.options);
    assert.deepEqual(
        normalized.map((item) => item.id),
        ['todo', 'done']
    );
    assert.equal(normalized[0].color, '#e57373');
});

test('checkbox stays boolean and number stays numeric', () => {
    assert.equal(normalizePisiSheetTypedValue({ type: 'checkbox' }, 'true'), true);
    assert.equal(normalizePisiSheetTypedValue({ type: 'checkbox' }, false), false);
    assert.equal(normalizePisiSheetTypedValue({ type: 'number' }, '1234.5'), 1234.5);
});

test('number formatting changes display without changing the raw value', () => {
    const currency = {
        type: 'number',
        numberFormat: {
            style: 'currency-TRY',
            decimals: 2
        }
    };
    const percent = {
        type: 'number',
        numberFormat: {
            style: 'percent',
            decimals: 0
        }
    };

    assert.equal(normalizePisiSheetNumberFormat(currency.numberFormat).style, 'currency-TRY');

    const currencyDisplay = getPisiSheetTypedDisplayParts(currency, 1234.5, 'tr-TR');
    assert.equal(currencyDisplay.kind, 'text');
    assert.match(currencyDisplay.text, /₺|TL/);

    const percentDisplay = getPisiSheetTypedDisplayParts(percent, 0.34, 'tr-TR');
    assert.match(percentDisplay.text, /34/);
    assert.match(percentDisplay.text, /%/);
});

test('date and select display are derived from typed raw values', () => {
    const dateDisplay = getPisiSheetTypedDisplayParts({ type: 'date' }, '2026-09-30', 'tr-TR');
    assert.equal(dateDisplay.kind, 'text');
    assert.notEqual(dateDisplay.text, '2026-09-30');

    const selectDisplay = getPisiSheetTypedDisplayParts(
        {
            type: 'select',
            options: [
                {
                    id: 'doing',
                    label: 'Doing',
                    color: '#ffd54f'
                }
            ]
        },
        'doing',
        'tr-TR'
    );

    assert.equal(selectDisplay.kind, 'chips');
    assert.equal(selectDisplay.chips[0].label, 'Doing');
    assert.equal(selectDisplay.chips[0].color, '#ffd54f');
});
