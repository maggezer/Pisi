'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const operational = read('renderer/map/pisi-map-operational.mjs');
const panel = read('renderer/map/pisi-map-right-panel.mjs');
const preference = read('renderer/map/pisi-map-label-preference.mjs');

test('Labels remains a visible Mind Map primary action', () => {
    assert.match(operational, /'focus', 'deps', 'labels', 'work'/);
    assert.match(operational, /pisi-map-operational-labels/);
    assert.match(operational, /togglePisiOperationalDisplay\('showRelationshipLabels'\)/);
    assert.match(panel, /'pisi-map-operational-labels'/);
    assert.doesNotMatch(preference, /getElementById\('pisi-map-operational-labels'\)\?\.remove\(\)/);
});

test('Labels button stays synchronized with the Preferences label toggle', () => {
    assert.match(preference, /closest\?\.\('#pisi-map-operational-labels'\)/);
    assert.match(preference, /queueMicrotask\(syncPreferenceFromOperationalButton\)/);
    assert.match(preference, /setPisiRelationshipLabelsPreference\(enabled\)/);
    assert.match(preference, /display\.showRelationshipLabels !== false/);
});
