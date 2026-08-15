'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('task store tek semantik otoritedir; legacy tarama migration sonrası salt okunurdur', () => {
    const mainGuard = read('main/functions/source-of-truth.js');
    const mainBootstrap = read('main.js');

    assert.match(mainGuard, /legacyImportedAt/);
    assert.match(mainGuard, /operation === 'migration-status'/);
    assert.match(mainGuard, /operation === 'complete-migration'/);
    assert.match(mainGuard, /migration\.complete && !explicitProjectionWrite/);
    assert.match(mainGuard, /authority:\s*'\.pisi\/tasks\.json'/);
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
