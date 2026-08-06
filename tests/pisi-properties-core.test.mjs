import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectPisiPropertyColumns,
    filterPisiPropertyDocuments,
    matchesPisiPropertyQuery,
    parsePisiPropertyQuery
} from '../renderer/data/pisi-properties-core.mjs';

const documents = [
    {
        title: 'Deney A',
        path: '/project/Deney A.node',
        relativePath: 'Deney A.node',
        tags: [{ value: 'makale' }],
        properties: {
            status: { id: 'status', name: 'Durum', type: 'select', value: 'Devam ediyor' },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 5 },
            done: { id: 'done', name: 'Tamamlandı', type: 'checkbox', value: false }
        }
    },
    {
        title: 'Deney B',
        path: '/project/Deney B.node',
        relativePath: 'Deney B.node',
        tags: [{ value: 'arşiv' }],
        properties: {
            status: { id: 'status', name: 'Durum', type: 'select', value: 'Bitti' },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 2 },
            done: { id: 'done', name: 'Tamamlandı', type: 'checkbox', value: true }
        }
    }
];

test('özellik sorgusunu operatörlü koşullara ayırır', () => {
    assert.deepEqual(
        parsePisiPropertyQuery('Durum:"Devam ediyor" Öncelik:>=4'),
        [
            { field: 'Durum', operator: ':', value: 'Devam ediyor' },
            { field: 'Öncelik', operator: '>=', value: '4' }
        ]
    );
});

test('metin, sayı, onay kutusu ve etiket alanlarını filtreler', () => {
    assert.equal(matchesPisiPropertyQuery(documents[0], 'Durum:"Devam ediyor"'), true);
    assert.equal(matchesPisiPropertyQuery(documents[0], 'Öncelik:>=4'), true);
    assert.equal(matchesPisiPropertyQuery(documents[1], 'Tamamlandı=true'), true);
    assert.equal(matchesPisiPropertyQuery(documents[0], 'etiket:makale'), true);
    assert.deepEqual(
        filterPisiPropertyDocuments(documents, 'Öncelik:>=4').map((item) => item.title),
        ['Deney A']
    );
});

test('tablo ve kart görünümü için özellik sütunlarını tekilleştirir', () => {
    assert.deepEqual(
        collectPisiPropertyColumns(documents).map((item) => item.id),
        ['status', 'priority', 'done']
    );
});
