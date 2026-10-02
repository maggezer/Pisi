'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('project fs bridge loads after runtime operation hooks and atomic hardening', () => {
    const main = read('main.js');
    const bridgeIndex = main.indexOf('storage-project-fs-bridge');
    assert.ok(bridgeIndex > main.indexOf('./main/runtime'));
    assert.ok(bridgeIndex > main.indexOf('version-history-operation-hooks'));
    assert.ok(bridgeIndex > main.indexOf('map-semantic-operation-hooks'));
    assert.ok(bridgeIndex > main.indexOf('property-schema-operation-hooks'));
    assert.ok(bridgeIndex > main.indexOf('atomic-domain-hardening'));
});

test('wave two routes document map and sidecar metadata IO but keeps atomic bytes physical', () => {
    const bridge = read('main/functions/storage-project-fs-bridge.js');
    for (const method of ['existsSync', 'readFileSync', 'readdirSync', 'statSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync']) {
        assert.match(bridge, new RegExp(`fs\\.${method}\\s*=`));
    }

    assert.doesNotMatch(bridge, /fs\.openSync\s*=/);
    assert.doesNotMatch(bridge, /fs\.writeFileSync\s*=/);
    assert.doesNotMatch(bridge, /fs\.copyFileSync\s*=/);

    const storage = read('main/functions/storage.js');
    assert.match(storage, /isPisiStorageDriverIoActive/);
    assert.match(storage, /runPisiStorageDriverIo/);
    assert.match(storage, /globalThis\.writeFileAtomic/);
});

test('atomic mutation journal is explicitly excluded from the compatibility bridge', () => {
    const bridge = read('main/functions/storage-project-fs-bridge.js');
    assert.match(bridge, /normalized === '\.pisi\/mutations'/);
    assert.match(bridge, /normalized\.startsWith\('\.pisi\/mutations\/'\)/);
});

test('storage bridge does not redefine task relationship property or map authority', () => {
    const bridge = read('main/functions/storage-project-fs-bridge.js');
    assert.doesNotMatch(bridge, /tasks\.json/);
    assert.doesNotMatch(bridge, /relationships\.json/);
    assert.doesNotMatch(bridge, /property-schema\.json/);
    assert.doesNotMatch(bridge, /\.map\.data|relationshipViews|taskId|propertyDefinitions/);
});
