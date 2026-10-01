import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePisiSheetSectionTitle
} from '../renderer/editor/pisi-editor-sheet-section-ui.mjs';

test('Sheet section title falls back to Sheet', () => {
    assert.equal(
        normalizePisiSheetSectionTitle(''),
        'Sheet'
    );
    assert.equal(
        normalizePisiSheetSectionTitle('   '),
        'Sheet'
    );
});

test('Sheet section title trims and caps editable titles', () => {
    assert.equal(
        normalizePisiSheetSectionTitle(
            '  Experiments  '
        ),
        'Experiments'
    );

    assert.equal(
        normalizePisiSheetSectionTitle(
            'x'.repeat(100)
        ).length,
        80
    );
});
