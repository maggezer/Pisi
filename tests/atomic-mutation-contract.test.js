'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const core = read('main/functions/atomic-mutation-core.js');
const runtime = read('main/functions/atomic-mutation.js');
const domain = read('main/functions/domain-command-query.js');

test('atomic manifest commit marker is durable before journal cleanup', () => {
    assert.match(core, /manifest\.phase = 'committed'/);
    const phaseIndex = core.indexOf("manifest.phase = 'committed'");
    const persistIndex = core.indexOf('persistAtomicManifest(transaction)', phaseIndex);
    const cleanupIndex = core.indexOf('fs.rmSync(transaction.directoryPath', phaseIndex);
    assert.ok(persistIndex > phaseIndex);
    assert.ok(cleanupIndex > persistIndex);
});

test('non-committed restart paths roll back snapshots instead of guessing', () => {
    assert.match(core, /if \(manifest\.phase === 'committed'\)/);
    assert.match(core, /rollbackAtomicMutation\(transaction\)/);
    assert.match(core, /rollback-failed/);
    assert.doesNotMatch(core, /manifest\.phase === 'running'.*committed/s);
});

test('journal paths cannot recursively snapshot their own ancestor', () => {
    assert.match(core, /getAtomicMutationRoot\(transaction\.projectRoot\)/);
    assert.match(core, /kendi journal klasörünü kapsayan yolu değiştiremez/);
});

test('nested transaction context uses AsyncLocalStorage', () => {
    assert.match(runtime, /AsyncLocalStorage/);
    assert.match(runtime, /pisiAtomicContext\.getStore\(\)/);
    assert.match(runtime, /pisiAtomicContext\.run\(transaction, operation\)/);
    assert.doesNotMatch(runtime, /let activePisiAtomicMutation/);
});

test('top-level mutations in the same project are serialized', () => {
    assert.match(runtime, /const pisiAtomicProjectQueues = new Map\(\)/);
    assert.match(runtime, /function getPisiAtomicProjectQueue/);
    assert.match(runtime, /queue\.pending\.push\(/);
    assert.match(runtime, /function executePisiQueuedAtomicMutation/);
    assert.match(runtime, /releasePisiAtomicProjectQueue/);
    assert.match(runtime, /if \(queue\.busy\)/);
});

test('filesystem hooks capture rename write mkdir unlink and rm boundaries', () => {
    assert.match(runtime, /fs\.renameSync = function pisiAtomicRenameSync/);
    assert.match(runtime, /fs\.writeFileSync = function pisiAtomicWriteFileSync/);
    assert.match(runtime, /fs\.mkdirSync = function pisiAtomicMkdirSync/);
    assert.match(runtime, /fs\.unlinkSync = function pisiAtomicUnlinkSync/);
    assert.match(runtime, /fs\.rmSync = function pisiAtomicRmSync/);
});

test('bulk mutation is bounded and recursive batch command is not allowed', () => {
    assert.match(domain, /operations\.length > 100/);
    assert.match(domain, /PISI_BATCH_MUTATION_COMMANDS/);
    const allowedBlock = domain.slice(
        domain.indexOf('const PISI_BATCH_MUTATION_COMMANDS'),
        domain.indexOf('function registerPisiDomainQuery')
    );
    assert.doesNotMatch(allowedBlock, /project\.batch\.v1/);
});

test('high-frequency camera saves are atomic only for compound operational payloads', () => {
    assert.match(domain, /name === 'map\.camera\.save\.v1'/);
    assert.match(domain, /payload\.operationalPayload \|\| payload\.camera\?\.operationalPayload/);
});

test('destructive compatibility IPC handlers are rebound after legacy hooks', () => {
    for (const channel of [
        'project:rename-pisi-file',
        'project:move-pisi-item',
        'project:delete-pisi-file',
        'project:delete-node-from-map',
        'project:delete-path'
    ]) {
        assert.match(domain, new RegExp(`removeHandler\\('${channel}'\\)`));
    }
    const main = read('main.js');
    assert.ok(
        main.indexOf('./main/functions/domain-command-query') >
        main.indexOf('./main/functions/task-reference-operation-hooks')
    );
});