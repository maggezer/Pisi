'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const mainDomain = read('main/functions/domain-command-query.js');
const rendererDomain = read('renderer/domain/pisi-domain-client.mjs');

test('domain contract command ve query registrylerini ayrı ve versioned tutar', () => {
    assert.match(mainDomain, /PISI_DOMAIN_CONTRACT_VERSION\s*=\s*1/);
    assert.match(mainDomain, /const pisiDomainQueries = new Map\(\)/);
    assert.match(mainDomain, /const pisiDomainCommands = new Map\(\)/);
    assert.match(mainDomain, /registerPisiDomainQuery\('task\.list\.v1'/);
    assert.match(mainDomain, /registerPisiDomainQuery\('map\.projection\.v1'/);
    assert.match(mainDomain, /registerPisiDomainCommand\('task\.capture\.v1'/);
    assert.match(mainDomain, /registerPisiDomainCommand\('map\.relationship\.upsert\.v1'/);
    assert.match(mainDomain, /registerPisiDomainCommand\('map\.operational\.mutate\.v1'/);
});

test('unknown domain command ve query fail closed davranır', () => {
    assert.match(mainDomain, /DOMAIN_QUERY_NOT_FOUND/);
    assert.match(mainDomain, /DOMAIN_COMMAND_NOT_FOUND/);
    assert.doesNotMatch(mainDomain, /modules\s*\[\s*name\s*\]/);
    assert.doesNotMatch(rendererDomain, /api\s*\[\s*name\s*\]/);
});

test('task domain canonical task store ve capture servisini kullanır', () => {
    assert.match(mainDomain, /taskStore\.listPisiFirstClassTasks/);
    assert.match(mainDomain, /taskCapture\.quickAddPisiTask/);
    assert.match(mainDomain, /taskStore\.upsertPisiFirstClassTask/);
    assert.match(mainDomain, /taskStore\.updatePisiFirstClassTask/);
    assert.match(mainDomain, /taskStore\.deletePisiFirstClassTask/);
    assert.match(mainDomain, /taskStore\.syncPisiFirstClassTaskIndex/);
    assert.doesNotMatch(mainDomain, /writePisiTaskStore/);
});

test('map relationship commandlari semantic operation katmanını aşmaz', () => {
    assert.match(mainDomain, /mapSemanticOperations\.upsertPisiMapSemanticConnection/);
    assert.match(mainDomain, /mapSemanticOperations\.deletePisiMapSemanticConnection/);
    assert.match(mainDomain, /mapSemanticOperations\.reparentPisiMapSemanticNode/);
    assert.doesNotMatch(mainDomain, /relationshipStore\./);
    assert.doesNotMatch(mainDomain, /relationships\.json/);
});

test('operational mutation camera yan etkisinden ayrı domain commanddır', () => {
    assert.match(mainDomain, /'map\.operational\.mutate\.v1'/);
    assert.match(mainDomain, /mapOperationalStore\.savePisiOperationalMapState/);
    assert.match(mainDomain, /delete camera\.operationalPayload/);
    assert.match(mainDomain, /executePisiDomainCommand\(\s*'map\.operational\.mutate\.v1'/);
});

test('compatibility IPC core task ve map çağrılarını domain dispatchere reroute eder', () => {
    for (const channel of [
        'project:quick-add-task',
        'project:get-pisi-document',
        'project:list-map-nodes',
        'project:upsert-map-connection',
        'project:delete-map-connection',
        'project:reparent-map-node',
        'project:save-map-layout',
        'project:save-map-camera',
        'project:detach-map-reference',
        'project:create-node-under-map'
    ]) {
        assert.match(mainDomain, new RegExp(`removeHandler\\('${channel}'\\)`));
        assert.match(mainDomain, new RegExp(`handle\\('${channel}'`));
    }
    assert.match(mainDomain, /executePisiDomainQuery/);
    assert.match(mainDomain, /executePisiDomainCommand/);
});

test('domain path guard aktif proje kökü ve typed document yollarını zorunlu kılar', () => {
    assert.match(mainDomain, /assertPisiDomainProjectRoot/);
    assert.match(mainDomain, /normalizePathForCompare/);
    assert.match(mainDomain, /extensions:\s*\['\.map'\]/);
    assert.match(mainDomain, /extensions:\s*\['\.node'\]/);
    assert.match(mainDomain, /extensions:\s*\['\.map', '\.node'\]/);
});

test('renderer domain client semantic isimleri compatibility transporttan ayırır', () => {
    assert.match(rendererDomain, /registerModule\('domain\.client'/);
    assert.match(rendererDomain, /case 'task\.capture\.v1'/);
    assert.match(rendererDomain, /case 'task\.sync-projection\.v1'/);
    assert.match(rendererDomain, /case 'map\.relationship\.upsert\.v1'/);
    assert.match(rendererDomain, /case 'map\.operational\.mutate\.v1'/);
    assert.match(rendererDomain, /case 'map\.node\.create-linked\.v1'/);
});

test('Quick Add UI storage API yerine task capture domain commandını çağırır', () => {
    const quickCapture = read('renderer/productivity/pisi-quick-capture.mjs');
    const start = quickCapture.indexOf('async function submitPisiQuickAdd');
    const end = quickCapture.indexOf('function buildPisiQuickAddForm', start);
    const submit = quickCapture.slice(start, end);
    assert.match(submit, /modules\?\.\['domain\.client'\]/);
    assert.match(submit, /domain\.command\('task\.capture\.v1'/);
    assert.doesNotMatch(submit, /pisiProject\?\.quickAddTask|pisiProject\.quickAddTask/);
});

test('domain katmanı storage dosyalarına doğrudan fs yazımı yapmaz', () => {
    assert.doesNotMatch(mainDomain, /require\('fs'\)/);
    assert.doesNotMatch(mainDomain, /writeFileSync|readFileSync|unlinkSync|renameSync/);
    assert.doesNotMatch(mainDomain, /tasks\.json|relationships\.json/);
});

test('domain katmanları kritik feature modüllerinden önce ve IPC hooklarından sonra yüklenir', () => {
    const main = read('main.js');
    const bootstrap = read('renderer/bootstrap.mjs');
    const mainDomainIndex = main.indexOf('./main/functions/domain-command-query');
    assert.ok(mainDomainIndex > main.indexOf('./main/functions/task-reference-operation-hooks'));
    assert.ok(mainDomainIndex > main.indexOf('./main/functions/map-semantic-operation-hooks'));

    const rendererDomainIndex = bootstrap.indexOf('./domain/pisi-domain-client.mjs');
    assert.ok(rendererDomainIndex >= 0);
    assert.ok(rendererDomainIndex < bootstrap.indexOf('./tags/pisi-task-store.mjs'));
    assert.ok(rendererDomainIndex < bootstrap.indexOf('./productivity/pisi-quick-capture.mjs'));
    assert.ok(rendererDomainIndex < bootstrap.indexOf('./map/pisi-map-operational.mjs'));
});
