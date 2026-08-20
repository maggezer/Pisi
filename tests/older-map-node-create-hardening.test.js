'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const hardening = read('main/functions/map-node-create-hardening.js');
const bootstrap = read('main.js');

test('older map hardening is loaded after the original IPC handlers', () => {
    const runtime = bootstrap.indexOf('require("./main/runtime")');
    const hardeningLoad = bootstrap.indexOf('require("./main/functions/map-node-create-hardening")');

    assert.ok(runtime >= 0);
    assert.ok(hardeningLoad > runtime);
    assert.match(hardening, /ipcMain\.removeHandler\('project:create-node-under-map'\)/);
    assert.match(hardening, /ipcMain\.removeHandler\('project:list-map-nodes'\)/);
});

test('new nodebox creation does not depend on reparsing every old map node', () => {
    const createStart = hardening.indexOf('function createPisiMapNodeResilient');
    const installStart = hardening.indexOf('function installPisiMapNodeCreateHardening', createStart);
    const createBlock = hardening.slice(createStart, installStart);

    assert.match(createBlock, /createUniquePisiFile\(mapSidecarPath, '\.node'/);
    assert.match(createBlock, /makePisiCreatedMapNode\(mapPath, mapInfo, nodeInfo\)/);
    assert.doesNotMatch(createBlock, /listNodesForMap\(/);
    assert.match(hardening, /mapData\.nodes\.push\(storedLayout\)/);
    assert.match(hardening, /writePisiDocument\(mapPath, mapInfo\.data\)/);
});

test('stored sidecar from an older map is preserved and migrated safely', () => {
    assert.match(hardening, /function getPisiStoredMapSidecarPath/);
    assert.match(hardening, /path\.basename\(storedName\) !== storedName/);
    assert.match(hardening, /data\?\.kedi/);
    assert.match(hardening, /function repairPisiStoredMapSidecar/);
    assert.match(hardening, /fs\.readdirSync\(desiredSidecarPath\)/);
    assert.match(hardening, /if \(entries\.length > 0\)/);
    assert.match(hardening, /renamePathInternal\(storedSidecarPath, desiredSidecarPath\)/);
});

test('malformed old map containers are normalized before adding the new layout', () => {
    assert.match(hardening, /Array\.isArray\(mapInfo\.data\.map\)/);
    assert.match(hardening, /if \(!Array\.isArray\(mapInfo\.data\.map\.nodes\)\)/);
    assert.match(hardening, /normalizePisiNodeLayout\(/);
    assert.match(hardening, /normalizePisiMapNodeCustomization\(/);
});
