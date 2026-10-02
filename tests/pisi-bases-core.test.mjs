import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPisiBaseProjection,
    collectPisiBaseColumns,
    formatPisiBasePropertyValue,
    normalizePisiBaseLayout,
    sortPisiBaseDocuments
} from '../renderer/data/pisi-bases-core.mjs';

const definitions = [
    { id: 'priority', name: 'Öncelik', type: 'number' },
    { id: 'status', name: 'Durum', type: 'multiselect' },
    { id: 'relation', name: 'Bağlı', type: 'relation' },
    { id: 'unused', name: 'Kullanılmıyor', type: 'text' }
];

const documents = [
    {
        title: 'Beta',
        path: '/project/Beta.node',
        relativePath: 'Beta.node',
        metadata: { id: 'node_beta' },
        properties: {
            status: { id: 'status', name: 'Eski Durum Adı', type: 'multiselect', value: ['Aktif'] },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 2 }
        }
    },
    {
        title: 'Alpha',
        path: '/project/Alpha.node',
        relativePath: 'Alpha.node',
        metadata: { id: 'node_alpha' },
        properties: {
            relation: { id: 'relation', name: 'Bağlı', type: 'relation', value: ['Beta.node'] },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 5 }
        }
    }
];

test('table and card projection share one canonical used-column order independent of filter result', () => {
    const all = buildPisiBaseProjection(documents, definitions, '');
    const filtered = buildPisiBaseProjection(documents, definitions, 'Öncelik:>=5');

    assert.deepEqual(
        all.columns.map((item) => item.id),
        ['priority', 'status', 'relation']
    );
    assert.deepEqual(
        filtered.columns.map((item) => item.id),
        ['priority', 'status', 'relation']
    );
    assert.deepEqual(
        all.cardColumns.map((item) => item.id),
        ['priority', 'status', 'relation']
    );
    assert.deepEqual(
        filtered.documents.map((item) => item.title),
        ['Alpha']
    );
});

test('canonical schema name wins over stale redundant node copies while unused definitions stay hidden', () => {
    const columns = collectPisiBaseColumns(documents, definitions);
    assert.deepEqual(
        columns.map(({ id, name }) => ({ id, name })),
        [
            { id: 'priority', name: 'Öncelik' },
            { id: 'status', name: 'Durum' },
            { id: 'relation', name: 'Bağlı' }
        ]
    );
});

test('missing and empty cells render consistently and relation values resolve to node labels', () => {
    const projection = buildPisiBaseProjection(documents, definitions, '');
    const alpha = projection.rows.find((row) => row.document.title === 'Alpha');
    assert.equal(formatPisiBasePropertyValue(alpha.properties.get('status'), documents), '—');
    assert.equal(formatPisiBasePropertyValue(alpha.properties.get('relation'), documents), 'Beta');
    assert.equal(formatPisiBasePropertyValue({ type: 'multiselect', value: [] }, documents), '—');
    assert.equal(formatPisiBasePropertyValue({ type: 'number', value: 0 }, documents), '0');
});

test('document order is deterministic for duplicate titles by path and identity', () => {
    const records = [
        { title: 'Node 2', path: '/project/z/Node.node', metadata: { id: 'b' } },
        { title: 'Node 2', path: '/project/a/Node.node', metadata: { id: 'c' } },
        { title: 'Node 10', path: '/project/Node10.node', metadata: { id: 'd' } },
        { title: 'Node 2', path: '/project/a/Node.node', metadata: { id: 'a' } }
    ];
    assert.deepEqual(
        sortPisiBaseDocuments(records).map((item) => item.metadata.id),
        ['a', 'c', 'b', 'd']
    );
});

test('invalid saved-view layout values fail closed to table', () => {
    assert.equal(normalizePisiBaseLayout('table'), 'table');
    assert.equal(normalizePisiBaseLayout('cards'), 'cards');
    assert.equal(normalizePisiBaseLayout('grid'), 'table');
    assert.equal(normalizePisiBaseLayout(null), 'table');
});

test('projection keeps source count separate from filtered count for UI consistency', () => {
    const projection = buildPisiBaseProjection(documents, definitions, 'Durum:Aktif');
    assert.equal(projection.sourceCount, 2);
    assert.equal(projection.count, 1);
    assert.equal(projection.documents[0].title, 'Beta');
});
