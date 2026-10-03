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
const hardening = read('main/functions/atomic-domain-hardening.js');

test('atomic manifest commit marker is durable before best-effort journal cleanup', () => {
    assert.match(core, /manifest\.phase = 'committed'/);
    const phaseIndex = core.indexOf("manifest.phase = 'committed'");
    const persistIndex = core.indexOf('persistAtomicManifest(transaction)', phaseIndex);
    const cleanupIndex = core.indexOf('cleanupAtomicTransactionDirectory(transaction)', persistIndex);
    assert.ok(persistIndex > phaseIndex);
    assert.ok(cleanupIndex > persistIndex);
    assert.match(core, /cleanupPending:\s*true/);
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
    const allowedBlock = domain.slice(domain.indexOf('const PISI_BATCH_MUTATION_COMMANDS'), domain.indexOf('function registerPisiDomainQuery'));
    assert.doesNotMatch(allowedBlock, /project\.batch\.v1/);
});

test('all persistent domain mutations join the atomic project queue', () => {
    for (const command of [
        'task.capture.v1',
        'task.upsert.v1',
        'task.update.v1',
        'task.delete.v1',
        'task.sync-projection.v1',
        'map.relationship.upsert.v1',
        'map.relationship.delete.v1',
        'map.relationship.reparent.v1',
        'map.layout.save.v1',
        'map.operational.mutate.v1',
        'map.camera.save.v1',
        'map.reference.detach.v1',
        'map.node.create.v1',
        'project.item.rename.v1',
        'project.item.move.v1',
        'project.item.delete.v1',
        'project.path.delete.v1',
        'project.batch.v1'
    ]) {
        assert.match(hardening, new RegExp(`'${command.replaceAll('.', '\\.')}'`));
    }
    assert.match(hardening, /PISI_ATOMIC_DOMAIN_COMMANDS\.add\(command\)/);
});

test('atomic hardening loads after the domain registry', () => {
    const main = read('main.mjs');
    const domainIndex = main.indexOf('./main/functions/domain-command-query');
    const hardeningIndex = main.indexOf('./main/functions/atomic-domain-hardening');
    assert.ok(domainIndex >= 0);
    assert.ok(hardeningIndex > domainIndex);
});

test('destructive commands are exposed only through canonical domain IPC after operation hooks', () => {
    assert.match(domain, /handle\('pisi:domain-command'/);
    for (const channel of [
        'project:rename-pisi-file',
        'project:move-pisi-item',
        'project:delete-pisi-file',
        'project:delete-node-from-map',
        'project:delete-path'
    ]) {
        assert.equal(domain.includes(channel), false, channel);
    }
    const main = read('main.mjs');
    assert.ok(main.indexOf('./main/functions/domain-command-query') > main.indexOf('./main/functions/task-reference-operation-hooks'));
});
