'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const backupStorage = require('../main/functions/backup-storage');

const root = path.resolve(__dirname, '..');
const filesystemCoreSource = fs.readFileSync(
    path.join(root, 'main/functions/filesystem-core.js'),
    'utf8'
);
const backupIpcSource = fs.readFileSync(
    path.join(root, 'main/functions/backup-directory-ipc.js'),
    'utf8'
);
const bootstrapSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

test('project backups resolve under .pisi/backups instead of beside documents', () => {
    const project = path.join(os.tmpdir(), 'pisi-backup-layout-project');
    const nodePath = path.join(project, 'Research', 'Deney.node');

    assert.equal(
        backupStorage.getPisiAtomicBackupPath(project, nodePath),
        path.join(
            project,
            '.pisi',
            'backups',
            'atomic',
            'Research',
            'Deney.node.pisi-backup'
        )
    );
    assert.equal(
        backupStorage.getPisiCorruptBackupPath(
            project,
            nodePath,
            '0123456789ab'
        ),
        path.join(
            project,
            '.pisi',
            'backups',
            'corrupt',
            'Research',
            'Deney.node.corrupt-0123456789ab.bak'
        )
    );
});

test('backup storage never creates backups of files already inside backup storage', () => {
    const project = path.join(os.tmpdir(), 'pisi-backup-recursion-project');
    const managedBackup = path.join(
        project,
        '.pisi',
        'backups',
        'atomic',
        'Map.map.pisi-backup'
    );

    assert.equal(
        backupStorage.isPisiBackupStoragePath(project, managedBackup),
        true
    );
    assert.equal(
        backupStorage.getPisiAtomicBackupPath(project, managedBackup),
        null
    );
});

test('legacy beside-file atomic backup migrates to central storage and keeps target mapping', (t) => {
    const project = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-backup-migrate-')
    );
    t.after(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    const nodePath = path.join(project, 'Notes', 'Eski.node');
    const legacyBackup = `${nodePath}.pisi-backup`;
    const expectedBackup = path.join(
        project,
        '.pisi',
        'backups',
        'atomic',
        'Notes',
        'Eski.node.pisi-backup'
    );

    fs.mkdirSync(path.dirname(nodePath), { recursive: true });
    fs.writeFileSync(nodePath, '{"current":true}', 'utf8');
    fs.writeFileSync(legacyBackup, '{"backup":true}', 'utf8');

    const result = backupStorage.migratePisiLegacyAtomicBackup(
        project,
        nodePath
    );

    assert.equal(result.ok, true);
    assert.equal(result.migrated, true);
    assert.equal(result.backupPath, expectedBackup);
    assert.equal(fs.existsSync(legacyBackup), false);
    assert.equal(fs.readFileSync(expectedBackup, 'utf8'), '{"backup":true}');
    assert.equal(
        backupStorage.getPisiAtomicBackupTargetPath(project, expectedBackup),
        nodePath
    );
});

test('legacy backup target decoding remains supported for old projects', (t) => {
    const project = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-backup-legacy-read-')
    );
    t.after(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    const mapPath = path.join(project, 'Old.map');
    const legacyBackup = `${mapPath}.pisi-backup`;
    fs.writeFileSync(legacyBackup, '{}', 'utf8');

    assert.equal(
        backupStorage.getPisiAtomicBackupTargetPath(project, legacyBackup),
        mapPath
    );
});

test('filesystem and backup IPC use centralized storage and load after history bindings', () => {
    assert.match(
        filesystemCoreSource,
        /require\('\.\/backup-storage'\)/
    );
    assert.match(
        filesystemCoreSource,
        /backupStorage\.getPisiAtomicBackupPath\(projectFolder, targetPath\)/
    );
    assert.match(
        filesystemCoreSource,
        /backupStorage\.getPisiCorruptBackupPath/
    );
    assert.match(
        backupIpcSource,
        /migratePisiLegacyAtomicBackup/
    );
    assert.match(
        backupIpcSource,
        /getPisiAtomicBackupTargetPath/
    );

    const historyIndex = bootstrapSource.indexOf(
        'require("./main/functions/version-history-operation-hooks")'
    );
    const backupIndex = bootstrapSource.indexOf(
        'require("./main/functions/backup-directory-ipc")'
    );
    assert.ok(historyIndex >= 0);
    assert.ok(backupIndex > historyIndex);
});
