'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('task store tek semantik otoritedir; legacy node taraması yalnız migration içindir', () => {
    const mainStore = read('main/functions/task-store.js');
    const rendererStore = read('renderer/tags/pisi-task-store.mjs');

    assert.match(mainStore, /legacyImportedAt/);
    assert.match(mainStore, /operation === 'migration-status'/);
    assert.match(mainStore, /operation === 'complete-migration'/);
    assert.match(rendererStore, /ensurePisiLegacyTaskMigration/);
    assert.doesNotMatch(
        rendererStore,
        /pisi:mission-index-updated[\s\S]{0,900}syncLegacy:\s*true/
    );
});

test('search görevleri node HTML kopyasından değil canonical task store projectionından üretir', () => {
    const search = read('renderer/search/pisi-search-index.mjs');

    assert.doesNotMatch(search, /function extractPisiSearchTasks\(/);
    assert.match(search, /pisiFirstClassTaskState/);
    assert.match(search, /kind:\s*'task'/);
    assert.match(search, /\.pisi-diary-managed-block/);
});

test('diary görev içeriğini kopyalamaz; task referansı taşır', () => {
    const runtime = read('renderer/runtime.mjs');
    const documents = read('main/functions/document-store.js');

    assert.match(runtime, /taskId:/);
    assert.doesNotMatch(runtime, /html:\s*block\.html/);
    assert.match(documents, /data-pisi-task-ref=/);
    assert.doesNotMatch(documents, /const blockHtml = entry\.html/);
});

test('progress task projectionundan türetilir', () => {
    const todo = read('renderer/tags/pisi-todo-third-release.mjs');

    assert.match(todo, /getPisiThirdAllMissions\(\)/);
    assert.match(todo, /completed\s*=\s*missions\.filter/);
    assert.match(todo, /rate\s*=\s*total/);
});

test('ilişkilerin otoritesi map edges, node connectionTypes yalnız projectiondır', () => {
    const mapStore = read('main/functions/map-store.js');

    assert.match(
        mapStore,
        /const normalizedEdges = normalizePisiMapEdges\(\s*mapInfo\.data\.map\.edges/
    );
    assert.match(mapStore, /resetNodeConnectionTypes\(nodeInfo\.data\.pisi\)/);
    assert.match(mapStore, /addUniqueConnectionType\(/);
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
