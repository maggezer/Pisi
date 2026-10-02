import test from 'node:test';
import assert from 'node:assert/strict';

import { getPisiSearchHistoryKey, makePisiSearchRecentMap, readPisiSearchHistory, rememberPisiSearchResult } from '../renderer/search/pisi-search-history.mjs';

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

test('quick navigation history is project-scoped', () => {
    const storage = makeStorage();
    rememberPisiSearchResult(
        '/Pisi/A',
        {
            id: 'node:a',
            kind: 'node',
            title: 'A'
        },
        { storage, now: 100 }
    );
    rememberPisiSearchResult(
        '/Pisi/B',
        {
            id: 'node:b',
            kind: 'node',
            title: 'B'
        },
        { storage, now: 200 }
    );

    assert.notEqual(getPisiSearchHistoryKey('/Pisi/A'), getPisiSearchHistoryKey('/Pisi/B'));
    assert.deepEqual(
        readPisiSearchHistory('/Pisi/A', storage).map((item) => item.id),
        ['node:a']
    );
    assert.deepEqual(
        readPisiSearchHistory('/Pisi/B', storage).map((item) => item.id),
        ['node:b']
    );
});

test('reopening the same result moves it to top and increments usage', () => {
    const storage = makeStorage();
    rememberPisiSearchResult(
        '/Pisi/A',
        {
            id: 'node:a',
            kind: 'node',
            title: 'A'
        },
        { storage, now: 100 }
    );
    rememberPisiSearchResult(
        '/Pisi/A',
        {
            id: 'node:b',
            kind: 'node',
            title: 'B'
        },
        { storage, now: 200 }
    );
    rememberPisiSearchResult(
        '/Pisi/A',
        {
            id: 'node:a',
            kind: 'node',
            title: 'A'
        },
        { storage, now: 300 }
    );

    const history = readPisiSearchHistory('/Pisi/A', storage);
    assert.deepEqual(
        history.map((item) => item.id),
        ['node:a', 'node:b']
    );
    assert.equal(history[0].openCount, 2);
    assert.equal(makePisiSearchRecentMap('/Pisi/A', storage).get('node:a').lastOpened, 300);
});
