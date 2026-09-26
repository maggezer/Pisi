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
const electronIpcSource = fs.readFileSync(
    path.join(root, 'main/functions/electron-ipc.js'),
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




test('filesystem and backup IPC use only centralized backup storage', () => {
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
    assert.doesNotMatch(
        electronIpcSource,
        /migratePisiLegacy/
    );
    assert.doesNotMatch(
        backupIpcSource,
        /migratePisiLegacy/
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
