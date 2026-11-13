import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getPisiFileExt,
    getPisiPhysicalFileName,
    getPisiSidecarName,
    getPisiSidecarPrefix,
    getPisiTypeFromExt,
    getPisiVisibleTitleFromBaseName,
    isPisiManagedSidecarFolder,
    isPisiVisibleFile,
    sanitizeForSidecarName,
    sanitizePisiBaseName,
    stripPisiIdSuffix
} from '../shared/document-naming.mjs';

test('dosya adı: yasak karakterler, boşluklar ve sondaki noktalar temizlenir', () => {
    assert.equal(sanitizePisiBaseName('  Proje:  Planı?  '), 'Proje_ Planı_');
    assert.equal(sanitizePisiBaseName('rapor...'), 'rapor');
    assert.equal(sanitizePisiBaseName('nokta. '), 'nokta');
    assert.equal(sanitizePisiBaseName('a\tb\nc'), 'a_b_c');
    assert.equal(sanitizePisiBaseName('../not:allowed'), '.._not_allowed');
    assert.equal(sanitizePisiBaseName('a/b\\c'), 'a_b_c');
    assert.equal(sanitizePisiBaseName('İstanbul <1>'), 'İstanbul _1_');
    assert.equal(sanitizePisiBaseName('x'.repeat(130)), 'x'.repeat(120));
});

test('dosya adı: Windows ayrılmış adları öne alt çizgi alır, boş ad varsayılana döner', () => {
    assert.equal(sanitizePisiBaseName('CON'), '_CON');
    assert.equal(sanitizePisiBaseName('con'), '_con');
    assert.equal(sanitizePisiBaseName('COM1.txt'), '_COM1.txt');
    assert.equal(sanitizePisiBaseName('LPT9'), '_LPT9');
    assert.equal(sanitizePisiBaseName('CONSOLE'), 'CONSOLE');

    for (const empty of ['', '   ', '...', null, undefined]) {
        assert.equal(sanitizePisiBaseName(empty), 'Yeni Dosya');
    }
});

test('uzantı, tür ve sidecar öneki', () => {
    assert.equal(getPisiFileExt('Not.node'), '.node');
    assert.equal(getPisiFileExt('Not.NODE'), '.node');
    assert.equal(getPisiFileExt('a/b/Harita.map'), '.map');
    assert.equal(getPisiFileExt('x.txt'), '');
    assert.equal(getPisiFileExt('a.node.bak'), '');

    assert.equal(getPisiTypeFromExt('.node'), 'node');
    assert.equal(getPisiTypeFromExt('.map'), 'map');
    assert.equal(getPisiTypeFromExt('.txt'), '');

    assert.equal(getPisiSidecarPrefix('.node'), 'inv_');
    assert.equal(getPisiSidecarPrefix('.map'), 'nd_');
    assert.equal(getPisiSidecarPrefix(''), '');

    assert.equal(isPisiVisibleFile('Not.node'), true);
    assert.equal(isPisiVisibleFile('HARITA.MAP'), true);
    assert.equal(isPisiVisibleFile('not.txt'), false);
});

test('sidecar adı: önek + temiz başlık + kimlik; kimlik türü uymazsa ad üretilmez', () => {
    assert.equal(getPisiSidecarName('Proje Planı', '.node', 'node_abc'), 'inv_Proje Planı__node_abc');
    assert.equal(getPisiSidecarName('Proje Planı', '.map', 'map_1'), 'nd_Proje Planı__map_1');
    assert.equal(getPisiSidecarName('a/b: c', '.node', 'node_abc'), 'inv_a_b_ c__node_abc');
    assert.equal(getPisiSidecarName('Proje Planı', '.node', 'map_1'), null);
    assert.equal(getPisiSidecarName('Proje Planı', '.txt', 'node_abc'), null);
    assert.equal(getPisiSidecarName('Proje Planı', '.node', 'bad id'), null);

    assert.equal(sanitizeForSidecarName('y'.repeat(100)), 'y'.repeat(80));
    assert.equal(getPisiSidecarName('y'.repeat(100), '.node', 'node_abc'), `inv_${'y'.repeat(80)}__node_abc`);
});

test('yönetilen sidecar klasörü yalnız tam desene uyan addır', () => {
    assert.equal(isPisiManagedSidecarFolder('inv_Not__node_abc'), true);
    assert.equal(isPisiManagedSidecarFolder('nd_Harita__map_1'), true);
    assert.equal(isPisiManagedSidecarFolder('.pisi.lock'), true);
    assert.equal(isPisiManagedSidecarFolder(getPisiSidecarName('Proje Planı', '.node', 'node_abc')), true);

    assert.equal(isPisiManagedSidecarFolder('inv_notlarım'), false);
    assert.equal(isPisiManagedSidecarFolder('inv___node_1'), false);
    assert.equal(isPisiManagedSidecarFolder('xinv_a__node_1'), false);
    assert.equal(isPisiManagedSidecarFolder(''), false);
    assert.equal(isPisiManagedSidecarFolder(null), false);
});

test('kimlik soneki ve görünen başlık', () => {
    assert.equal(stripPisiIdSuffix('Not__node_1', 'node_1'), 'Not');
    assert.equal(stripPisiIdSuffix('Not', 'node_1'), 'Not');
    assert.equal(stripPisiIdSuffix('Not__node_1', ''), 'Not__node_1');
    assert.equal(stripPisiIdSuffix('', 'node_1'), '');

    assert.equal(getPisiVisibleTitleFromBaseName('Not__node_1', 'node_1'), 'Not');
    assert.equal(getPisiVisibleTitleFromBaseName('Not'), 'Not');
    assert.equal(getPisiVisibleTitleFromBaseName('CON', ''), '_CON');
});

test('dosya adı adayları masaüstünün denediği sırayla gelir', () => {
    assert.equal(getPisiPhysicalFileName('Not', '.node', 'node_1'), 'Not.node');
    assert.equal(getPisiPhysicalFileName('Not', '.node', 'node_1', 0), 'Not.node');
    assert.equal(getPisiPhysicalFileName('Not', '.node', 'node_1', 1), 'Not__node_1.node');
    assert.equal(getPisiPhysicalFileName('Not', '.node', 'node_1', 2), 'Not__node_1_1.node');
    assert.equal(getPisiPhysicalFileName('Not', '.node', 'node_1', 3), 'Not__node_1_2.node');
    assert.equal(getPisiPhysicalFileName(' N:ot. ', '.map', 'map_9', 0), 'N_ot.map');
    assert.equal(getPisiPhysicalFileName('', '.node', 'node_1', 1), 'Yeni Dosya__node_1.node');

    // The id suffix of a candidate is what the visible title strips again.
    assert.equal(getPisiVisibleTitleFromBaseName('Not__node_1', 'node_1'), 'Not');
});
