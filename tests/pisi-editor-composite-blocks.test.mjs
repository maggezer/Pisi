import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parsePisiCompositePayload,
    serializePisiCompositePayload
} from '../renderer/editor/pisi-editor-composite-blocks.mjs';

test('composite clipboard round-trips Sheet payloads', () => {
    const payload = {
        version: 1,
        type: 'sheet',
        database: {
            databaseId: 'database-source',
            fields: [],
            items: []
        }
    };

    const serialized =
        serializePisiCompositePayload(payload);
    const parsed =
        parsePisiCompositePayload(serialized);

    assert.equal(parsed.type, 'sheet');
    assert.equal(
        parsed.database.databaseId,
        'database-source'
    );
});

test('composite clipboard rejects normal clipboard text', () => {
    assert.equal(
        parsePisiCompositePayload('normal text'),
        null
    );
});
