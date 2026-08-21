'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const preference = read('renderer/map/pisi-map-label-preference.mjs');
const toggle = read('renderer/map/pisi-map-property-badges-toggle.mjs');
const toggleCss = read('renderer/map/pisi-map-property-badges-toggle.css');
const bootstrap = read('renderer/bootstrap.mjs');
const operationalRender = read('renderer/map/pisi-map-operational-render.mjs');
const propertyBadges = read('renderer/map/pisi-map-property-badges.mjs');

test('connection Labels button is retired from the Mind Map toolbar', () => {
    assert.match(preference, /removeLegacyLabelsButton/);
    assert.match(preference, /getElementById\('pisi-map-operational-labels'\)\?\.remove\(\)/);
});

test('property Badges has its own persistent Mind Map visibility toggle beside Work badges', () => {
    assert.match(bootstrap, /pisi-map-property-badges-toggle\.mjs/);
    assert.match(toggle, /pisi\.map\.propertyBadges\.visible\.v1/);
    assert.match(toggle, /pisi-map-property-badges-toggle/);
    assert.match(toggle, /workButton\.insertAdjacentElement\('afterend', button\)/);
    assert.match(toggle, /dataset\.pisiToolIcon = 'labels'/);
    assert.match(toggle, /setPisiPropertyBadgesVisible\(!getPisiPropertyBadgesVisible\(\)\)/);
    assert.match(toggleCss, /data-pisi-property-badges-visible="false"/);
});

test('property badges and Work badges remain independent render layers', () => {
    assert.match(propertyBadges, /box\.querySelector\('\.pisi-map-property-badges'\)\?\.remove\(\)/);
    assert.doesNotMatch(propertyBadges, /pisi-map-work-badges.*remove/s);
    assert.match(operationalRender, /box\.querySelector\('\.pisi-map-work-badges'\)\?\.remove\(\)/);
    assert.doesNotMatch(operationalRender, /pisi-map-property-badges.*remove/s);
    assert.match(toggleCss, /\.map-node-box > \.pisi-map-work-badges/);
    assert.match(toggleCss, /\.map-node-box > \.pisi-map-property-badges/);
});
