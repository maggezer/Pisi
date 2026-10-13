import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPisiSheetSelection } from '../renderer/editor/pisi-editor-sheet-format-core.mjs';

test('format toggle accounts for offscreen records in a 10000-row selection without mutating the input', () => {
    const formats = Array.from({ length: 10000 }, (_, row) => (row < 9999 ? { fontWeight: '700' } : {}));
    const bold = formatPisiSheetSelection(formats, 'toggleBold');
    assert.equal(
        bold.every((format) => format.fontWeight === '700'),
        true
    );
    assert.deepEqual(formats.at(-1), {});
    assert.equal(
        formatPisiSheetSelection(bold, 'toggleBold').every((format) => !format.fontWeight),
        true
    );
});
test('underline and strike toggles preserve the other text decoration and unrelated formats', () => {
    const formats = [{ textDecorationLine: 'line-through', color: '#123456' }, { textDecorationLine: 'underline line-through' }];
    const underlined = formatPisiSheetSelection(formats, 'toggleUnderline');
    assert.equal(
        underlined.every((format) => format.textDecorationLine.includes('underline')),
        true
    );
    const unstruck = formatPisiSheetSelection(underlined, 'toggleStrikeThrough');
    assert.equal(
        unstruck.every((format) => format.textDecorationLine === 'underline'),
        true
    );
    assert.equal(unstruck[0].color, '#123456');
});
test('all bulk format actions work on model-only records', () => {
    for (const [action, value, expected] of [
        ['toggleItalic', null, { fontStyle: 'italic' }],
        ['fontFamily', 'Arial', { fontFamily: 'Arial' }],
        ['fontSize', '5', { fontSize: '18px' }],
        ['alignLeft', null, { textAlign: 'left' }],
        ['alignCenter', null, { textAlign: 'center' }],
        ['alignRight', null, { textAlign: 'right' }],
        ['alignJustify', null, { textAlign: 'justify' }],
        ['verticalTop', null, { verticalAlign: 'top' }],
        ['verticalMiddle', null, { verticalAlign: 'middle' }],
        ['verticalBottom', null, { verticalAlign: 'bottom' }],
        ['toggleWrap', null, { whiteSpace: 'normal', overflowWrap: 'anywhere' }],
        ['borderAll', null, { border: '1px solid rgba(127, 127, 127, 0.7)' }],
        ['textColor', '#123456', { color: '#123456' }],
        ['fillColor', '#abcdef', { backgroundColor: '#abcdef' }]
    ])
        assert.deepEqual(formatPisiSheetSelection([{}, {}], action, value), [expected, expected], action);
});
test('clear formatting removes styles and unsupported actions leave the selection untouched', () => {
    const formats = [{ fontWeight: '700', fontStyle: 'italic', textDecorationLine: 'underline', color: 'red', border: '1px solid red' }];
    assert.deepEqual(formatPisiSheetSelection(formats, 'clearFormat'), [{}]);
    assert.deepEqual(formatPisiSheetSelection(formats, 'borderNone')[0].color, 'red');
    assert.equal(formatPisiSheetSelection(formats, 'unknown'), null);
    assert.equal(formatPisiSheetSelection([], 'toggleBold'), null);
    assert.equal(formats[0].fontWeight, '700');
});
