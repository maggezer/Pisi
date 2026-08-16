'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'main/functions/trash-store.js'), 'utf8');
const domain = fs.readFileSync(path.join(root, 'main/functions/trash-domain.js'), 'utf8');

test('restore rejects reused Pisi identities before relationship merge', () => {
    assert.match(store, /type: 'node-id'/);
    assert.match(store, /type: 'map-id'/);
    assert.match(store, /activeIdentity\.nodeIds\.has\(nodeId\)/);
    assert.match(store, /activeIdentity\.mapIds\.has\(mapId\)/);
});

test('restore rejects missing semantic relationship endpoints', () => {
    assert.match(store, /relationship-endpoint-missing/);
    assert.match(store, /availableNodeIds/);
    assert.match(store, /relationship\.sourceId/);
    assert.match(store, /relationship\.targetId/);
});

test('restored map views retain presentation schema version', () => {
    assert.match(
        store,
        /mapData\.relationshipViewVersion = mapSemanticCore\.PISI_MAP_RELATIONSHIP_VIEW_VERSION/
    );
});

test('legacy OS trash remains outside new destructive domain route', () => {
    assert.doesNotMatch(domain, /projectOperations\.deletePisiFile/);
    assert.doesNotMatch(domain, /projectOperations\.deleteProjectPath/);
    assert.doesNotMatch(domain, /shell\.trashItem/);
});