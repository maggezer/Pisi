'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const store = read('main/functions/trash-store.js');
const domain = read('main/functions/trash-domain.js');
const main = read('main.js');
const preload = read('preload.js');
const rendererDomain = read('renderer/domain/pisi-domain-client.mjs');
const rendererTrash = read('renderer/shell/pisi-trash.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const style = read('style.css');
const trashCss = read('styles/61-trash.css');

test('project delete commands are rebound to project-local reversible Trash', () => {
    assert.match(domain, /pisiDomainCommands\.set\('project\.item\.delete\.v1'/);
    assert.match(domain, /pisiDomainCommands\.set\('project\.path\.delete\.v1'/);
    assert.match(domain, /trashStore\.movePisiPathToTrash/);
    assert.doesNotMatch(domain, /shell\.trashItem/);
    assert.match(store, /PISI_TRASH_DIR/);
    assert.match(store, /PISI_TRASH_ITEMS_DIR/);
});

test('Trash payload and manifest stay inside .pisi/trash and reject project internals', () => {
    assert.match(store, /getPisiTrashItemsRoot/);
    assert.match(store, /manifest\.json/);
    assert.match(store, /payload/);
    assert.match(store, /first === '\.pisi'/);
    assert.match(store, /first === '\.git'/);
    assert.match(store, /first === 'node_modules'/);
    assert.match(store, /Aktif proje kökü Trash’e taşınamaz/);
});

test('deletion archives canonical tasks semantic relationships and external map references', () => {
    assert.match(store, /taskStore\.readPisiTaskStore/);
    assert.match(store, /taskStore\.writePisiTaskStore/);
    assert.match(store, /relationshipStore\.readPisiRelationshipStore/);
    assert.match(store, /relationshipStore\.writePisiRelationshipStore/);
    assert.match(store, /collectPisiTrashMapReferences/);
    assert.match(store, /relationshipViews/);
    assert.match(store, /mapData\.nodes/);
});

test('restore is a delta merge rather than a whole-project snapshot overwrite', () => {
    assert.match(store, /currentNodeIds/);
    assert.match(store, /currentViewIds/);
    assert.match(store, /taskState\.tasks, \.\.\.restoredTasks/);
    assert.match(store, /mergePisiTrashTaskDependencies/);
    assert.doesNotMatch(store, /projectSnapshot/);
    assert.doesNotMatch(store, /restoreWholeProject/);
});

test('restore fails closed on path task and semantic conflicts', () => {
    assert.match(store, /type: 'path-exists'/);
    assert.match(store, /type: 'parent-missing'/);
    assert.match(store, /type: 'task-id'/);
    assert.match(store, /prepareSemanticRelationshipUpsert/);
    assert.match(store, /TRASH_RESTORE_CONFLICT/);
});

test('restore captures Trash item as one atomic ancestor before moving payload out', () => {
    const captureIndex = store.indexOf('capturePisiAtomicPathBeforeChange(itemDirectory)');
    const loopIndex = store.indexOf('for (const entry of manifest.entries)', captureIndex);
    const renameIndex = store.indexOf('renamePathInternal(source, destination)', loopIndex);
    assert.ok(captureIndex >= 0);
    assert.ok(loopIndex > captureIndex);
    assert.ok(renameIndex > loopIndex);
});

test('permanent delete and empty Trash remain explicit atomic domain commands', () => {
    for (const command of [
        'trash.restore.v1',
        'trash.delete-permanently.v1',
        'trash.empty.v1'
    ]) {
        assert.match(domain, new RegExp(command.replaceAll('.', '\\.')));
    }
    assert.match(domain, /PISI_ATOMIC_DOMAIN_COMMANDS\.add\(command\)/);
    assert.match(store, /permanentlyDeletePisiTrashItem/);
    assert.match(store, /emptyPisiTrash/);
});

test('Trash deletion retries transient Windows locks and keeps emptying other items', () => {
    assert.match(store, /PISI_TRASH_DELETE_RETRY_CODES/);
    assert.match(store, /'EPERM'/);
    assert.match(store, /'EACCES'/);
    assert.match(store, /maxRetries:\s*8/);
    assert.match(store, /retryDelay:\s*120/);
    assert.match(store, /fs\.chmodSync\(resolved, 0o700\)/);
    assert.match(store, /removePisiTrashPathWithRetry/);
    assert.match(store, /const failed = \[\]/);
    assert.match(store, /TRASH_EMPTY_PARTIAL/);
    assert.match(store, /failed\.push\(/);
});

test('Trash modules load after canonical stores and after base domain registration', () => {
    const taskStoreIndex = main.indexOf('./main/functions/task-store');
    const trashStoreIndex = main.indexOf('./main/functions/trash-store');
    const domainIndex = main.indexOf('./main/functions/domain-command-query');
    const trashDomainIndex = main.indexOf('./main/functions/trash-domain');
    const hardeningIndex = main.indexOf('./main/functions/atomic-domain-hardening');
    assert.ok(trashStoreIndex > taskStoreIndex);
    assert.ok(trashDomainIndex > domainIndex);
    assert.ok(hardeningIndex > trashDomainIndex);
});

test('preload exposes only bounded Trash actions and renderer domain consumes them', () => {
    assert.match(preload, /exposeInMainWorld\('pisiTrash'/);
    assert.match(preload, /project:list-trash/);
    assert.match(preload, /project:restore-trash-item/);
    assert.match(preload, /project:delete-trash-item/);
    assert.match(preload, /project:empty-trash/);
    assert.match(rendererDomain, /trash\.list\.v1/);
    assert.match(rendererDomain, /trash\.restore\.v1/);
    assert.match(rendererDomain, /trash\.delete-permanently\.v1/);
    assert.match(rendererDomain, /trash\.empty\.v1/);
});

test('Workspace Center exposes reviewable Trash with restore permanent delete and empty actions', () => {
    assert.match(rendererTrash, /registerPisiCommandCenterPage/);
    assert.match(rendererTrash, /id: 'trash'/);
    assert.match(rendererTrash, /pisiTrashText\('restore'\)/);
    assert.match(rendererTrash, /pisiTrashText\('deletePermanently'\)/);
    assert.match(rendererTrash, /pisiTrashText\('empty'\)/);
    assert.match(rendererTrash, /makePisiTrashCounts/);
    assert.match(rendererTrash, /TRASH_RESTORE_CONFLICT/);
});

test('Trash UI ships in both Turkish and English and refreshes the project tree after restore', () => {
    assert.match(rendererTrash, /tr:\s*\{/);
    assert.match(rendererTrash, /eng:\s*\{/);
    assert.match(rendererTrash, /Çöp Kutusu/);
    assert.match(rendererTrash, /Trash/);
    assert.match(rendererTrash, /refreshCurrentProjectTree/);
});

test('Trash page and styles are part of bootstrap and layered CSS', () => {
    assert.match(bootstrap, /\.\/shell\/pisi-trash\.mjs/);
    assert.match(style, /styles\/61-trash\.css/);
    assert.match(trashCss, /\.pisi-trash-page/);
    assert.match(trashCss, /html\[data-theme="light"\]/);
});