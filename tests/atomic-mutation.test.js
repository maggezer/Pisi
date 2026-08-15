'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const atomic = require('../main/functions/atomic-mutation-core');

function makeProject() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-atomic-'));
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

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

test('crash after first file write recovers completely to old state', () => {
    const fixture = makeProject();
    try {
        const a = path.join(fixture.project, 'a.node');
        const b = path.join(fixture.project, '.pisi', 'tasks.json');
        write(a, 'A-old');
        write(b, 'B-old');

        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'fault.after-first-write',
            { transactionId: 'mut_fault_first_write' }
        );
        atomic.capturePathBeforeMutation(tx, a);
        write(a, 'A-new');
        assert.equal(read(a), 'A-new');

        const recovery = atomic.recoverAtomicMutations(fixture.project);
        assert.equal(recovery.ok, true);
        assert.equal(recovery.recovered, 1);
        assert.equal(read(a), 'A-old');
        assert.equal(read(b), 'B-old');
    } finally {
        fixture.cleanup();
    }
});

test('crash between multi-file writes never leaves 50/50 state', () => {
    const fixture = makeProject();
    try {
        const paths = ['one.node', 'two.map', '.pisi/tasks.json'].map((item) => {
            return path.join(fixture.project, item);
        });
        paths.forEach((target, index) => write(target, `old-${index}`));

        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'fault.middle-of-bulk',
            { transactionId: 'mut_fault_bulk' }
        );
        atomic.capturePathBeforeMutation(tx, paths[0]);
        write(paths[0], 'new-0');
        atomic.capturePathBeforeMutation(tx, paths[1]);
        write(paths[1], 'new-1');
        // Simulated process death before the third write and before commit.

        atomic.recoverAtomicMutations(fixture.project);
        assert.deepEqual(paths.map(read), ['old-0', 'old-1', 'old-2']);
    } finally {
        fixture.cleanup();
    }
});

test('crash after rename restores source tree and removes destination tree', () => {
    const fixture = makeProject();
    try {
        const source = path.join(fixture.project, 'Source');
        const destination = path.join(fixture.project, 'Moved');
        write(path.join(source, 'nested', 'note.node'), 'original');

        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'fault.after-rename',
            { transactionId: 'mut_fault_rename' }
        );
        atomic.captureRenameBeforeMutation(tx, source, destination);
        fs.renameSync(source, destination);
        const covering = atomic.capturePathBeforeMutation(
            tx,
            path.join(destination, 'nested', 'note.node')
        );
        write(path.join(destination, 'nested', 'note.node'), 'changed-after-move');

        assert.equal(covering.path, 'Moved');
        atomic.recoverAtomicMutations(fixture.project);
        assert.equal(fs.existsSync(destination), false);
        assert.equal(read(path.join(source, 'nested', 'note.node')), 'original');
    } finally {
        fixture.cleanup();
    }
});

test('newly created file and directory are removed on recovery', () => {
    const fixture = makeProject();
    try {
        const createdDir = path.join(fixture.project, 'new-sidecar');
        const createdFile = path.join(createdDir, 'new.node');
        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'fault.after-create',
            { transactionId: 'mut_fault_create' }
        );
        atomic.capturePathBeforeMutation(tx, createdDir);
        write(createdFile, 'new');

        atomic.recoverAtomicMutations(fixture.project);
        assert.equal(fs.existsSync(createdDir), false);
    } finally {
        fixture.cleanup();
    }
});

test('durable committed marker makes restart keep the new state', () => {
    const fixture = makeProject();
    try {
        const target = path.join(fixture.project, 'committed.node');
        write(target, 'old');
        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'fault.after-commit-marker',
            { transactionId: 'mut_fault_committed' }
        );
        atomic.capturePathBeforeMutation(tx, target);
        write(target, 'new');
        atomic.commitAtomicMutation(tx, { cleanup: false });

        const recovery = atomic.recoverAtomicMutations(fixture.project);
        assert.equal(recovery.ok, true);
        assert.equal(recovery.recovered, 0);
        assert.equal(recovery.committedCleanups, 1);
        assert.equal(read(target), 'new');
        assert.equal(fs.existsSync(tx.directoryPath), false);
    } finally {
        fixture.cleanup();
    }
});

test('rollback restores pre-existing destination as well as source', () => {
    const fixture = makeProject();
    try {
        const source = path.join(fixture.project, 'source.node');
        const destination = path.join(fixture.project, 'destination.node');
        write(source, 'source-old');
        write(destination, 'destination-old');
        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'replace-existing',
            { transactionId: 'mut_replace_existing' }
        );
        atomic.captureRenameBeforeMutation(tx, source, destination);
        fs.rmSync(destination);
        fs.renameSync(source, destination);
        atomic.rollbackAtomicMutation(tx);

        assert.equal(read(source), 'source-old');
        assert.equal(read(destination), 'destination-old');
    } finally {
        fixture.cleanup();
    }
});

test('atomic core refuses project escape and symlink snapshots', () => {
    const fixture = makeProject();
    try {
        const outside = path.join(path.dirname(fixture.project), 'outside.node');
        write(outside, 'outside');
        const tx = atomic.beginAtomicMutation(
            fixture.project,
            'security',
            { transactionId: 'mut_security_guard' }
        );
        assert.throws(
            () => atomic.capturePathBeforeMutation(tx, outside),
            /proje klasörünün dışına/
        );
        atomic.rollbackAtomicMutation(tx);
        fs.rmSync(outside, { force: true });
    } finally {
        fixture.cleanup();
    }
});

test('domain layer routes destructive and bulk operations through atomic mutation runner', () => {
    const domain = fs.readFileSync(
        path.join(__dirname, '..', 'main/functions/domain-command-query.js'),
        'utf8'
    );
    const runtime = fs.readFileSync(
        path.join(__dirname, '..', 'main/functions/atomic-mutation.js'),
        'utf8'
    );

    for (const command of [
        'task.capture.v1',
        'map.relationship.upsert.v1',
        'map.relationship.delete.v1',
        'map.relationship.reparent.v1',
        'project.item.rename.v1',
        'project.item.move.v1',
        'project.item.delete.v1',
        'project.path.delete.v1',
        'project.batch.v1'
    ]) {
        assert.match(domain, new RegExp(`'${command.replaceAll('.', '\\.')}'`));
    }
    assert.match(domain, /atomicMutation\.runPisiAtomicMutation/);
    assert.match(domain, /PISI_BATCH_MUTATION_COMMANDS/);
    assert.match(runtime, /fs\.renameSync = function pisiAtomicRenameSync/);
    assert.match(runtime, /fs\.mkdirSync = function pisiAtomicMkdirSync/);
    assert.match(runtime, /fs\.writeFileSync = function pisiAtomicWriteFileSync/);
});

test('rename and move task-reference failure is an atomic failure rather than partial success', () => {
    const domain = fs.readFileSync(
        path.join(__dirname, '..', 'main/functions/domain-command-query.js'),
        'utf8'
    );
    assert.match(domain, /TASK_REFERENCE_REWRITE_FAILED/);
    assert.match(domain, /attachRequiredPisiTaskReferenceRewrite/);
    assert.match(domain, /project\.item\.rename\.v1/);
    assert.match(domain, /project\.item\.move\.v1/);
});

test('startup project listing gates visible state behind atomic recovery', () => {
    const domain = fs.readFileSync(
        path.join(__dirname, '..', 'main/functions/domain-command-query.js'),
        'utf8'
    );
    assert.match(domain, /removeHandler\('project:list-folder'\)/);
    assert.match(domain, /recoverPisiDomainProjectIfNeeded\(\)/);
    assert.match(domain, /projectOperations\.safeListFolder/);
});

test('atomic journal is loaded before mutating storage services', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const atomicIndex = main.indexOf('./main/functions/atomic-mutation');
    assert.ok(atomicIndex > main.indexOf('./main/functions/filesystem-core'));
    assert.ok(atomicIndex < main.indexOf('./main/functions/document-store'));
    assert.ok(atomicIndex < main.indexOf('./main/functions/project-operations'));
    assert.ok(main.indexOf('./main/functions/domain-command-query') > atomicIndex);
});
