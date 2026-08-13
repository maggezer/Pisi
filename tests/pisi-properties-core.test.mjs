import test from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregatePisiRollupValues,
    collectPisiPropertyColumns,
    filterPisiPropertyDocuments,
    materializePisiDatabaseDocuments,
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
            status: { id: 'status', name: 'Durum', type: 'multiselect', value: ['Devam ediyor'] },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 5 },
            labels: { id: 'labels', name: 'Etiketler', type: 'multiselect', value: ['aktif'] }
        }
    },
    {
        title: 'Deney B',
        path: '/project/Deney B.node',
        relativePath: 'Deney B.node',
        tags: [{ value: 'arşiv' }],
        properties: {
            status: { id: 'status', name: 'Durum', type: 'multiselect', value: ['Bitti'] },
            priority: { id: 'priority', name: 'Öncelik', type: 'number', value: 2 },
            labels: { id: 'labels', name: 'Etiketler', type: 'multiselect', value: ['tamamlandı'] }
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

test('relation kayıtları rollup toplamı ve sayısına dönüştürülür', () => {
    const related = [
        {
            title: 'A', path: '/project/A.node', relativePath: 'A.node',
            properties: { effort: { id: 'effort', name: 'Efor', type: 'number', value: 3 } }
        },
        {
            title: 'B', path: '/project/B.node', relativePath: 'B.node',
            properties: { effort: { id: 'effort', name: 'Efor', type: 'number', value: 5 } }
        }
    ];
    const database = [{
        title: 'Proje', path: '/project/Proje.node', relativePath: 'Proje.node',
        properties: {
            tasks: { id: 'tasks', name: 'Görevler', type: 'relation', value: ['A.node', 'B.node'] },
            effort_total: {
                id: 'effort_total', name: 'Toplam efor', type: 'rollup',
                value: { relationProperty: 'tasks', targetProperty: 'effort', aggregate: 'sum' }
            }
        }
    }, ...related];
    const result = materializePisiDatabaseDocuments(database);
    assert.equal(result[0].properties.effort_total.value, 8);
    assert.deepEqual(aggregatePisiRollupValues(['A', 'A', 'B'], 'unique'), ['A', 'B']);
});

test('metin, sayı ve Tags alanlarını filtreler', () => {
    assert.equal(matchesPisiPropertyQuery(documents[0], 'Durum:"Devam ediyor"'), true);
    assert.equal(matchesPisiPropertyQuery(documents[0], 'Öncelik:>=4'), true);
    assert.equal(matchesPisiPropertyQuery(documents[1], 'Etiketler:tamamlandı'), true);
    assert.equal(matchesPisiPropertyQuery(documents[0], 'etiket:makale'), true);
    assert.deepEqual(
        filterPisiPropertyDocuments(documents, 'Öncelik:>=4').map((item) => item.title),
        ['Deney A']
    );
});

test('tablo ve kart görünümü için özellik sütunlarını tekilleştirir', () => {
    assert.deepEqual(
        collectPisiPropertyColumns(documents).map((item) => item.id),
        ['status', 'priority', 'labels']
    );
});
