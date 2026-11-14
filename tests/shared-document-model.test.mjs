import test from 'node:test';
import assert from 'node:assert/strict';
import { makePisiDocumentData } from '../shared/document-model.mjs';

const NOW = '2026-11-13T09:30:15.123Z';

test('yeni not iskeleti: alanlar ve sıraları masaüstünün yazdığıyla aynıdır', () => {
    const data = makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', now: NOW });

    // The exact text the desktop wrote for this document before the skeleton moved to shared/.
    assert.equal(
        JSON.stringify(data),
        '{"pisi":{"version":1,"type":"node","id":"node_abc","title":"Not","sidecar":"inv_Not__node_abc","createdAt":"2026-11-13T09:30:15.123Z","updatedAt":"2026-11-13T09:30:15.123Z","parentMap":"none"},"content":""}'
    );
    assert.equal(Object.hasOwn(data, 'properties'), false);
    assert.equal(Object.hasOwn(data.pisi, 'connectionTypes'), false);
});

test('parentMap: verilmezse veya boşsa none, verilirse o harita ya da diary', () => {
    assert.equal(makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', now: NOW }).pisi.parentMap, 'none');
    assert.equal(makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', parentMap: '', now: NOW }).pisi.parentMap, 'none');
    assert.equal(makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', parentMap: 'map_1', now: NOW }).pisi.parentMap, 'map_1');
    assert.equal(makePisiDocumentData({ ext: '.node', title: 'Not', id: 'node_abc', parentMap: 'diary', now: NOW }).pisi.parentMap, 'diary');
});

test('yeni harita iskeleti: boş üyelik, kamera ve ilişki görünümleri; map.edges yok', () => {
    const data = makePisiDocumentData({ ext: '.map', title: 'Harita', id: 'map_1', now: NOW });

    assert.equal(
        JSON.stringify(data),
        '{"pisi":{"version":1,"type":"map","id":"map_1","title":"Harita","sidecar":"nd_Harita__map_1","createdAt":"2026-11-13T09:30:15.123Z","updatedAt":"2026-11-13T09:30:15.123Z"},"map":{"nodes":[],"relationshipViews":[],"relationshipViewVersion":1,"collapsedHubs":[],"camera":{"x":0,"y":0,"zoom":1}}}'
    );
    assert.equal(Object.hasOwn(data.pisi, 'parentMap'), false);
    assert.equal(Object.hasOwn(data.map, 'edges'), false);
});

test('bilinmeyen uzantı yalnız üst veriyi döndürür; her çağrı yeni nesne üretir', () => {
    assert.equal(
        JSON.stringify(makePisiDocumentData({ ext: '.txt', title: 'X', id: 'node_abc', now: NOW })),
        '{"pisi":{"version":1,"type":"","id":"node_abc","title":"X","sidecar":null,"createdAt":"2026-11-13T09:30:15.123Z","updatedAt":"2026-11-13T09:30:15.123Z"}}'
    );

    const first = makePisiDocumentData({ ext: '.map', title: 'Harita', id: 'map_1', now: NOW });
    first.map.nodes.push({ id: 'node_x' });
    first.map.camera.zoom = 3;
    const second = makePisiDocumentData({ ext: '.map', title: 'Harita', id: 'map_1', now: NOW });
    assert.deepEqual(second.map.nodes, []);
    assert.equal(second.map.camera.zoom, 1);
});
