'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('single source-of-truth documentation canonical-only mimariyi anlatır', () => {
    const docs = read('docs/single-source-of-truth.md');

    assert.match(docs, /\.pisi\/tasks\.json.*authoritative task store/);
    assert.match(docs, /\.pisi\/relationships\.json.*authoritative project-wide/);
    assert.match(docs, /connectionTypes.*derived at query time.*never persisted as semantic state/);
    assert.match(docs, /map\.edges.*not part of the current persistence contract.*not migrated on access/);
    assert.doesNotMatch(docs, /one-time legacy migration marker|migrated on map access|after migration/i);
});

test('pisi-definition canonical mimariyi authority sınırlarıyla tanımlar', () => {
    const docs = read('pisi-definition.md');

    assert.match(docs, /\.pisi\/tasks\.json/);
    assert.match(docs, /\.pisi\/relationships\.json/);
    assert.match(docs, /\.pisi\/properties\.json/);
    assert.match(docs, /connectionTypes.*canonical state değildir.*diske yazılmaz/s);
    assert.match(docs, /map\.edges.*current persistence contract'ın\s+parçası değildir/s);
    assert.match(docs, /data-pisi-asset="paint\/<sha256>\.png"/);
    assert.match(docs, /data-pisi-sheet-asset="sheet\/<sha256>\.json"/);
    assert.match(docs, /Canonical priority aralığı \*\*1-5\*\*/);
    assert.match(docs, /project-local reversible\s+Trash/s);
    assert.doesNotMatch(docs, /"edges"\s*:\s*\[/);
    assert.doesNotMatch(docs, /"connectionTypes"\s*:/);
});

test('task store tek semantik otoritedir; projection yazımları canonical store üzerinden korunur', () => {
    const mainGuard = read('main/functions/source-of-truth.js');
    const mainBootstrap = read('main.mjs');

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
        bootstrap.indexOf('./runtime.mjs') < bootstrap.indexOf('./tags/pisi-source-of-truth.mjs'),
        'canonical diary override runtime calendar kurulduktan sonra yüklenmeli'
    );
});

test('progress canonical task projectionundan türetilir', () => {
    const todo = [read('renderer/tags/pisi-todo-third-release.mjs'), read('renderer/tags/pisi-todo-third-ui.mjs')].join('\n');

    assert.match(todo, /getPisiThirdAllMissions\(\)/);
    assert.match(todo, /completed\s*=\s*missions\.filter/);
    assert.match(todo, /rate\s*=\s*total/);
});

test('semantic relationship otoritesi proje storeudur; map yalnız presentation state taşır', () => {
    const relationshipStore = read('main/functions/relationship-store.js');
    const mapCore = read('main/functions/map-semantic-core.js');
    const hooks = read('main/functions/map-semantic-operation-hooks.js');
    const bootstrap = read('main.mjs');

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
        bootstrap.indexOf('relationship-store') < bootstrap.indexOf('map-semantic-operation-hooks'),
        'canonical relationship store map IPC adapterından önce yüklenmeli'
    );
});

test('node connectionTypes semantic store üzerinden yalnız query-time projectiondır', () => {
    const relationshipStore = read('main/functions/relationship-store.js');
    const mapCore = read('main/functions/map-semantic-core.js');
    const hooks = read('main/functions/map-semantic-operation-hooks.js');
    const projectOperations = read('main/functions/project-operations.js');
    const domainCommands = read('main/functions/domain-command-query.js');
    const filesystemCore = read('main/functions/filesystem-core.js');
    const documentMetadata = read('main/functions/document-store-metadata.js');
    const syncAdapter = read('main/functions/sync-project-adapter.js');
    const pathSecurity = read('main/functions/path-security.js');

    assert.match(mapCore, /derivePisiConnectionTypesFromRelationships/);
    assert.match(mapCore, /node\.metadata\.connectionTypes = byId\.get\(node\.id\)/);
    assert.match(hooks, /applyPisiDerivedConnectionTypes/);
    assert.doesNotMatch(hooks, /writePisiDocumentsTransaction/);

    assert.match(relationshipStore, /deletePisiSemanticRelationshipsForNodes/);
    assert.match(projectOperations, /deletePisiCanonicalRelationshipsForNodes/);
    assert.match(projectOperations, /relationshipViews/);
    assert.doesNotMatch(projectOperations, /removeLegacyNodeRelationship|mapInfo\.data\.map\.edges|data\.pisi\.connectionTypes/);
    assert.match(domainCommands, /getPisiMapSemanticProjection\(\s*result\.parentMapPath\s*\)/);

    assert.doesNotMatch(filesystemCore, /base\.pisi\.connectionTypes|resetNodeConnectionTypes/);
    assert.match(filesystemCore, /delete serializableData\.pisi\.connectionTypes/);
    assert.match(documentMetadata, /delete data\.pisi\.connectionTypes/);
    assert.match(syncAdapter, /delete data\.pisi\.connectionTypes/);
    assert.doesNotMatch(pathSecurity, /normalizeNodeConnectionTypes/);
});

test('map node konumu yalnız map layout kaydına yazılır', () => {
    const mapStore = read('main/functions/map-store.js');
    const start = mapStore.indexOf('function saveMapNodeLayout');
    const end = mapStore.indexOf('function saveMapCamera', start);
    const layoutWriter = mapStore.slice(start, end);

    assert.match(layoutWriter, /mapInfo\.data\.map\.nodes/);
    assert.doesNotMatch(layoutWriter, /nodeInfo\.data\.pisi\.(?:x|y|width|height)/);
});


test('aktif mimari dokümanları kaldırılmış geçiş planlarını taşımaz', () => {
    const domain = read('docs/domain-command-query.md');
    const properties = read('docs/property-schema.md');
    const storage = read('docs/storage-abstraction.md');
    const integrity = read('docs/project-integrity.md');
    const trash = read('docs/trash-restore-test-matrix.md');
    const readme = read('README.md');

    assert.match(domain, /pisi:domain-query.*pisi:domain-command/s);
    assert.doesNotMatch(domain, /compatibility transport|first migrated UI flow|legacy call/i);

    assert.match(properties, /missing canonical schema is not reconstructed/i);
    assert.doesNotMatch(properties, /supported legacy aliases|deterministic migration ID|## Legacy migration/i);

    assert.match(storage, /Project filesystem bridge/);
    assert.doesNotMatch(storage, /task-store-migration|transitional architecture|First adoption wave|Second adoption wave/i);

    assert.match(integrity, /relationshipViews/);
    assert.doesNotMatch(integrity, /incomplete legacy metadata migration|legacy `map\.edges`|connectionTypes.*rebuild|backward-compatible audit form/is);

    assert.doesNotMatch(trash, /legacy `map\.edges`|legacy edge/i);
    assert.doesNotMatch(readme, /Eski global adlar/);
});
