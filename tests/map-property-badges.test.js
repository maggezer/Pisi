'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Workspace Center Preferences Add badge akışı yalnız Metin, Sayı ve Etiket property tiplerini sunar', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');

    assert.match(source, /PISI_MAP_PROPERTY_BADGE_TYPES = new Set\(\['text', 'number', 'multiselect'\]\)/);
    assert.match(source, /for \(const type of \['text', 'number', 'multiselect'\]\)/);
    assert.match(source, /text: 'Metin'/);
    assert.match(source, /number: 'Sayı'/);
    assert.match(source, /multiselect: 'Etiket'/);
    assert.doesNotMatch(source, /PISI_MAP_PROPERTY_BADGE_TYPES[^\n]*relation/);
    assert.match(source, /getPisiActiveMapPropertyContext\(\)/);
    assert.match(source, /context\.propertyDefinitions/);
});

test('badge picker önce tip sonra o tipe ait mevcut propertyleri listeler', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');

    assert.match(source, /function renderPisiBadgeTypeMenu/);
    assert.match(source, /function renderPisiBadgePropertyMenu/);
    assert.match(source, /definitions\.filter\(\(definition\) => definition\.type === type\)/);
    assert.match(source, /button\.dataset\.propertyId = definition\.id/);
    assert.match(source, /button\.dataset\.propertyType = definition\.type/);
    assert.match(source, /savePisiMapPropertyBadgeSelections\(next\)/);
});

test('mindmap badge görünür metin olarak property adını değil node üzerindeki değeri kullanır', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');
    const start = source.indexOf('function syncPisiMapPropertyBadgeForNode');
    const end = source.indexOf('function syncPisiMapPropertyBadges', start);
    const renderer = source.slice(start, end);

    assert.match(renderer, /const property = findPisiBadgeProperty\(node, selection\)/);
    assert.match(renderer, /for \(const value of getPisiBadgePropertyValues\(property\)\)/);
    assert.match(renderer, /badge\.textContent = value/);
    assert.match(renderer, /badge\.title = `\$\{selection\.name\}: \$\{value\}`/);
    assert.doesNotMatch(renderer, /badge\.textContent = selection\.name/);
});

test('Etiket propertysinin tüm dolu değerleri ayrı badge değerleri olarak üretilir, boş değer çizilmez', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');
    const start = source.indexOf('function getPisiBadgePropertyValues');
    const end = source.indexOf('function syncPisiMapPropertyBadgeForNode', start);
    const formatter = source.slice(start, end);

    assert.match(formatter, /property\.type === 'multiselect'/);
    assert.match(formatter, /\.split\(','\)/);
    assert.match(formatter, /\.filter\(Boolean\)/);
    assert.match(formatter, /property\.value === null/);
    assert.match(formatter, /return value \? \[value\] : \[\]/);
});

test('badge seçimi aktif mindmap bazında saklanır ve aynı property ikinci kez eklenmez', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');

    assert.match(source, /PISI_MAP_PROPERTY_BADGES_STORAGE_KEY = 'pisi\.map\.propertyBadges\.v1'/);
    assert.match(source, /getPisiMapPropertyBadgeSelections\(mapPath = window\.activeMapPath\)/);
    assert.match(source, /savePisiMapPropertyBadgeSelections\(selections, mapPath = window\.activeMapPath\)/);
    assert.match(source, /const key = normalizePisiBadgePath\(mapPath\)/);
    assert.match(source, /seen\.has\(key\)/);
});

test('node property kaydı değişince açık mindmapteki badge değeri yeniden çizilir', () => {
    const source = read('renderer/map/pisi-map-property-badges.mjs');

    assert.match(source, /pisi:node-properties-changed/);
    assert.match(source, /node\.properties = detail\.properties/);
    assert.match(source, /syncPisiMapPropertyBadges\(\)/);
    assert.match(source, /pisi:map-customization-context-changed/);
});

test('badge sistemi structured property authorityden sonra bootstrapa yüklenir ve kendi stilini taşır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const css = read('renderer/map/pisi-map-property-badges.css');
    const structuredIndex = bootstrap.indexOf('./data/pisi-structured-views.mjs');
    const badgesIndex = bootstrap.indexOf('./map/pisi-map-property-badges.mjs');
    const runtimeIndex = bootstrap.indexOf('./runtime.mjs');

    assert.ok(structuredIndex >= 0);
    assert.ok(badgesIndex > structuredIndex);
    assert.ok(runtimeIndex > badgesIndex);
    assert.match(css, /\.pisi-map-property-badges/);
    assert.match(css, /\.pisi-map-property-badge/);
    assert.match(css, /\.pisi-badge-picker/);
    assert.match(css, /\.pisi-badge-preference-item/);
});
