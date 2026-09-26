'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('task store tek semantik otoritedir; projection yazımları canonical store üzerinden korunur', () => {
    const mainGuard = read('main/functions/source-of-truth.js');
    const mainBootstrap = read('main.js');

    assert.match(mainGuard, /operation === 'sync-index'/);
    assert.match(mainGuard, /allowProjectionWrite === true/);
    assert.match(mainGuard, /ignoredProjectionWrite:\s*true/);
    assert.match(mainGuard, /authority:\s*'\.pisi\/tasks\.json'/);
    assert.doesNotMatch(mainGuard, /migration-status|complete-migration|legacyImportedAt/);
    assert.ok(
        mainBootstrap.indexOf('task-store') < mainBootstrap.indexOf('source-of-truth'),
        'source-of-truth guard task-store bridge kurulduktan sonra yüklenmeli'
    );
});

test('yalnız kontrollü kullanıcı işlemleri projection -> task store write-through yapabilir', () => {
    const rendererGuard = read('renderer/tags/pisi-source-of-truth.mjs');

    assert.match(rendererGuard, /allowProjectionWrite:\s*true/);
    assert.match(rendererGuard, /status-change/);
    assert.match(rendererGuard, /completion-change/);
    assert.match(rendererGuard, /hasPisiTaskProjectionWriteIntent/);
    assert.match(rendererGuard, /#center-node-editor-content, #node-modal-content/);
});

test('persisted search task kayıtları canonical task store projectionından üretilir', () => {
    const rendererGuard = read('renderer/tags/pisi-source-of-truth.mjs');

    assert.match(rendererGuard, /pisiFirstClassTaskState/);
    assert.match(rendererGuard, /record\?\.kind !== 'task'/);
    assert.match(rendererGuard, /makePisiCanonicalTaskSearchRecord/);
    assert.match(rendererGuard, /buildPisiSearchAccelerator\(records\)/);
    assert.match(rendererGuard, /taskAuthority = '\.pisi\/tasks\.json'/);
});

test('diary canonical tasklardan üretilen read-only projectiondır ve task HTML kopyalamaz', () => {
    const rendererGuard = read('renderer/tags/pisi-source-of-truth.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');

    assert.match(rendererGuard, /getPisiCanonicalDiaryEntries/);
    assert.match(rendererGuard, /blockId:\s*task\.id/);
    assert.match(rendererGuard, /text:\s*task\.title/);
    assert.doesNotMatch(rendererGuard, /html:\s*block\.html/);
    assert.match(rendererGuard, /syncPisiDiaryFromMissionIndex = syncPisiDiaryFromCanonicalTasks/);
    assert.ok(
        bootstrap.indexOf('./runtime.mjs') <
            bootstrap.indexOf('./tags/pisi-source-of-truth.mjs'),
        'canonical diary override runtime calendar kurulduktan sonra yüklenmeli'
    );
});

test('progress canonical task projectionundan türetilir', () => {
    const todo = read('renderer/tags/pisi-todo-third-release.mjs');

    assert.match(todo, /getPisiThirdAllMissions\(\)/);
    assert.match(todo, /completed\s*=\s*missions\.filter/);
    assert.match(todo, /rate\s*=\s*total/);
});

test('semantic relationship otoritesi proje storeudur; map yalnız presentation state taşır', () => {
    const relationshipStore = read('main/functions/relationship-store.js');
    const mapCore = read('main/functions/map-semantic-core.js');
    const hooks = read('main/functions/map-semantic-operation-hooks.js');
    const bootstrap = read('main.js');

    assert.match(relationshipStore, /'\.pisi', 'relationships\.json'/);
    assert.match(relationshipStore, /sourceId:/);
    assert.match(relationshipStore, /targetId:/);
    assert.match(relationshipStore, /sourceRole:/);
    assert.match(relationshipStore, /targetRole:/);
    assert.match(mapCore, /relationshipId/);
    assert.match(mapCore, /sourcePort/);
    assert.match(mapCore, /targetPort/);
    assert.doesNotMatch(mapCore, /mapData\.edges|collapsedAnchors/);
    assert.match(mapCore, /relationshipViews/);
    assert.match(mapCore, /PISI_MAP_RELATIONSHIP_VIEW_VERSION/);
    assert.match(hooks, /relationshipAuthority:/);
    assert.match(hooks, /mapStateAuthority:/);
    assert.doesNotMatch(hooks, /syncMapConnectionMetadata\(/);
    assert.ok(
        bootstrap.indexOf('relationship-store') <
            bootstrap.indexOf('map-semantic-operation-hooks'),
        'canonical relationship store map IPC adapterından önce yüklenmeli'
    );
});

test('node connectionTypes semantic store üzerinden yalnız query-time projectiondır', () => {
    const mapCore = read('main/functions/map-semantic-core.js');
    const hooks = read('main/functions/map-semantic-operation-hooks.js');

    assert.match(mapCore, /derivePisiConnectionTypesFromRelationships/);
    assert.match(mapCore, /node\.metadata\.connectionTypes = byId\.get\(node\.id\)/);
    assert.match(hooks, /applyPisiDerivedConnectionTypes/);
    assert.doesNotMatch(hooks, /writePisiDocumentsTransaction/);
});

test('map node konumu yalnız map layout kaydına yazılır', () => {
    const mapStore = read('main/functions/map-store.js');
    const start = mapStore.indexOf('function saveMapNodeLayout');
    const end = mapStore.indexOf('function saveMapCamera', start);
    const layoutWriter = mapStore.slice(start, end);

    assert.match(layoutWriter, /mapInfo\.data\.map\.nodes/);
    assert.doesNotMatch(
        layoutWriter,
        /nodeInfo\.data\.pisi\.(?:x|y|width|height)/
    );
});