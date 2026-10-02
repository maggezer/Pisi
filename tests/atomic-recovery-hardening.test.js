'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { atomicMutationCore: atomic } = require('../main/functions/atomic-mutation-core');
require('../main/functions/atomic-recovery-hardening');

function makeProject() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-atomic-recovery-'));
    return {
        project,
        cleanup() {
            fs.rmSync(project, { recursive: true, force: true });
        }
    };
}

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

test('manifestless leftover mutation directory is cleanup residue, not fatal recovery', () => {
    const fixture = makeProject();
    try {
        const mutationRoot = atomic.getAtomicMutationRoot(fixture.project);
        const orphan = path.join(mutationRoot, 'mut_leftover_without_manifest');
        fs.mkdirSync(path.join(orphan, 'snapshots'), { recursive: true });
        write(path.join(orphan, 'snapshots', '00000'), 'cleanup residue');

        const recovery = atomic.recoverAtomicMutations(fixture.project);

        assert.equal(recovery.ok, true);
        assert.equal(recovery.recovered, 0);
        assert.equal(recovery.orphanCleanups, 1);
        assert.equal(fs.existsSync(orphan), false);
    } finally {
        fixture.cleanup();
    }
});

test('existing malformed manifest stays fatal instead of being silently deleted', () => {
    const fixture = makeProject();
    try {
        const mutationRoot = atomic.getAtomicMutationRoot(fixture.project);
        const broken = path.join(mutationRoot, 'mut_malformed_manifest');
        fs.mkdirSync(path.join(broken, 'snapshots'), { recursive: true });
        write(path.join(broken, 'manifest.json'), '{not-json');

        const recovery = atomic.recoverAtomicMutations(fixture.project);

        assert.equal(recovery.ok, false);
        assert.match(recovery.warnings.join(' | '), /mut_malformed_manifest/);
        assert.equal(fs.existsSync(broken), true);
    } finally {
        fixture.cleanup();
    }
});

test('normal commit exits mut namespace before journal deletion', () => {
    const fixture = makeProject();
    try {
        const target = path.join(fixture.project, 'note.node');
        write(target, 'old');
        const tx = atomic.beginAtomicMutation(fixture.project, 'cleanup-hardening', { transactionId: 'mut_cleanup_hardening' });
        atomic.capturePathBeforeMutation(tx, target);
        write(target, 'new');

        const result = atomic.commitAtomicMutation(tx);
        const mutationRoot = atomic.getAtomicMutationRoot(fixture.project);
        const leftovers = fs.readdirSync(mutationRoot);

        assert.equal(result.ok, true);
        assert.equal(result.cleanupPending, false);
        assert.equal(fs.existsSync(tx.directoryPath), false);
        assert.equal(
            leftovers.some((name) => name.startsWith('mut_')),
            false
        );
        assert.equal(
            leftovers.some((name) => name.startsWith('.cleanup_atomic_')),
            false
        );
        assert.equal(fs.readFileSync(target, 'utf8'), 'new');
    } finally {
        fixture.cleanup();
    }
});

test('hardening source keeps Windows transient cleanup retries', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main/functions/atomic-recovery-hardening.js'), 'utf8');

    assert.match(source, /'EPERM'/);
    assert.match(source, /'EACCES'/);
    assert.match(source, /maxRetries:\s*8/);
    assert.match(source, /retryDelay:\s*120/);
    assert.match(source, /PISI_ATOMIC_CLEANUP_PREFIX/);
    assert.match(source, /originalCommit\(transaction, \{ \.\.\.options, cleanup: false \}\)/);
    assert.match(source, /originalRollback\(transaction, \{ \.\.\.options, cleanup: false \}\)/);
});
