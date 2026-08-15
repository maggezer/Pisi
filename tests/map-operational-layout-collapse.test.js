'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '../renderer/map/pisi-map-operational.mjs'),
    'utf8'
);

function extractBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

test('saved operational layout snapshots current collapsed hubs', () => {
    const save = extractBetween(
        'async function savePisiOperationalLayout',
        'async function restorePisiOperationalLayout'
    );
    assert.match(save, /camera:\s*\{/);
    assert.match(
        save,
        /collapsedHubs:\s*Array\.from\(window\.collapsedHubPorts\s*\|\|\s*\[\]\)/
    );
});

test('restoring operational layout uses snapshot collapsed hubs instead of current map state', () => {
    const restore = extractBetween(
        'async function restorePisiOperationalLayout',
        'async function deletePisiOperationalLayout'
    );
    assert.match(restore, /layout\.camera\?\.collapsedHubs/);
    assert.match(restore, /\?\s*layout\.camera\.collapsedHubs\s*:\s*\[\]/);
    assert.doesNotMatch(
        restore,
        /collapsedHubs:\s*Array\.from\(window\.collapsedHubPorts/
    );
});