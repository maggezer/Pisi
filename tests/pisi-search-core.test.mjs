import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPisiSearchAccelerator,
    buildPisiRelationshipModel,
    containsPisiTitleMention,
    normalizePisiSearchText,
    pisiSearchPathKey,
    getPisiSearchCandidates,
    searchPisiIndex,
    searchPisiRecords
} from '../renderer/search/pisi-search-core.mjs';

test('Türkçe karakterler aksansız sorgularla eşleşir', () => {
    assert.equal(
        normalizePisiSearchText('Çizim İçeriği — GÖREV'),
        'cizim icerigi gorev'
    );
    assert.equal(
        containsPisiTitleMention(
            'Bu bölüm deney planı sonuçlarını açıklar.',
            'Deney Planı'
        ),
        true
    );
});

test('üçlü-karakter indeksi büyük kayıt kümesinde güvenli aday daraltır', () => {
    const records = Array.from({ length: 5000 }, (_value, index) => ({
        id: `record-${index}`,
        kind: 'content',
        title: `Belge ${index}`,
        searchFields: [{
            kind: 'content',
            value: index === 4321 ? 'benzersiz kuantum pusulası' : `sıradan içerik ${index}`
        }]
    }));
    const accelerator = buildPisiSearchAccelerator(records);
    const candidates = getPisiSearchCandidates(accelerator, 'kuantum pusulası');
    assert.ok(candidates.length < records.length / 100);
    assert.deepEqual(
        searchPisiIndex({ records, accelerator }, 'kuantum pusulası').map((item) => item.id),
        ['record-4321']
    );
});

test('başlık eşleşmesi içerik eşleşmesinden önce sıralanır', () => {
    const results = searchPisiRecords([
        {
            id: 'content',
            kind: 'content',
            title: 'Başka Node',
            searchFields: [
                { kind: 'content', value: 'Goldbach deneyi' }
            ]
        },
        {
            id: 'title',
            kind: 'node',
            title: 'Goldbach',
            searchFields: [
                { kind: 'title', value: 'Goldbach' }
            ]
        }
    ], 'goldbach');

    assert.deepEqual(
        results.map((result) => result.id),
        ['title', 'content']
    );
});

test('çok sözcüklü sorgunun bütün parçaları bulunmalıdır', () => {
    const results = searchPisiRecords([
        {
            id: 'full',
            kind: 'task',
            title: 'Makale',
            searchFields: [
                { kind: 'task', value: 'abstract bölümünü yarın düzelt' }
            ]
        },
        {
            id: 'partial',
            kind: 'task',
            title: 'Makale',
            searchFields: [
                { kind: 'task', value: 'abstract bölümünü düzelt' }
            ]
        }
    ], 'abstract yarın');

    assert.deepEqual(
        results.map((result) => result.id),
        ['full']
    );
});

test('metin, map ve bağlantısız bahsetme ilişkileri birlikte kurulur', () => {
    const targetPath = 'C:\\Pisi\\Deney.node';
    const sourcePath = 'C:\\Pisi\\Kaynak.node';
    const mentionPath = 'C:\\Pisi\\Not.node';
    const outboundPath = 'C:\\Pisi\\Sonuç.node';
    const membership = {
        mapPath: 'C:\\Pisi\\Araştırma.map',
        mapTitle: 'Araştırma',
        nodeId: 'target'
    };
    const documents = new Map([
        [pisiSearchPathKey(targetPath), {
            path: targetPath,
            fileName: 'Deney.node',
            title: 'Deney Planı',
            plainText: '[[Sonuçlar]]',
            unlinkedText: '',
            directTitles: ['Sonuçlar'],
            tasks: [{ text: 'Numuneyi hazırla' }],
            memberships: [membership]
        }],
        [pisiSearchPathKey(sourcePath), {
            path: sourcePath,
            fileName: 'Kaynak.node',
            title: 'Kaynak',
            plainText: '[[Deney Planı]]',
            unlinkedText: '',
            directTitles: ['Deney Planı'],
            tasks: [],
            memberships: [{
                mapPath: membership.mapPath,
                mapTitle: membership.mapTitle,
                nodeId: 'source'
            }]
        }],
        [pisiSearchPathKey(mentionPath), {
            path: mentionPath,
            fileName: 'Not.node',
            title: 'Not',
            plainText: 'Deney planı gözden geçirilecek.',
            unlinkedText: 'Deney planı gözden geçirilecek.',
            directTitles: [],
            tasks: [],
            memberships: []
        }],
        [pisiSearchPathKey(outboundPath), {
            path: outboundPath,
            fileName: 'Sonuç.node',
            title: 'Sonuçlar',
            plainText: '',
            unlinkedText: '',
            directTitles: [],
            tasks: [],
            memberships: [{
                mapPath: membership.mapPath,
                mapTitle: membership.mapTitle,
                nodeId: 'outbound'
            }]
        }]
    ]);
    const model = buildPisiRelationshipModel({
        documents,
        maps: [{
            path: membership.mapPath,
            title: membership.mapTitle,
            nodes: [
                { id: 'target', path: targetPath },
                { id: 'source', path: sourcePath },
                { id: 'outbound', path: outboundPath }
            ],
            edges: [
                {
                    sourceId: 'source',
                    targetId: 'target',
                    type: 'down-hub'
                },
                {
                    sourceId: 'target',
                    targetId: 'outbound',
                    type: 'stream'
                }
            ]
        }]
    }, targetPath);

    assert.equal(model.target.title, 'Deney Planı');
    assert.equal(model.inbound.length, 1);
    assert.deepEqual(
        new Set(model.inbound[0].types),
        new Set(['text', 'map'])
    );
    assert.equal(model.outbound.length, 1);
    assert.deepEqual(
        new Set(model.outbound[0].types),
        new Set(['text', 'map'])
    );
    assert.equal(model.unlinked[0].path, mentionPath);
    assert.equal(model.tasks[0].text, 'Numuneyi hazırla');
    assert.equal(model.sameMaps[0].mapTitle, 'Araştırma');
});
