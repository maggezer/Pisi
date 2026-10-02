'use strict';

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const backupStorage = require('./backup-storage');

function normalizeBackupTargetKey(targetPath) {
    const resolved = path.resolve(String(targetPath || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function listCentralizedPisiAtomicBackups(projectFolder, filePath = null) {
    try {
        if (!filePath) {
            return {
                ok: true,
                backups: [],
                scoped: true,
                skippedProjectScan: true
            };
        }

        const backupPath = backupStorage.getPisiAtomicBackupPath(projectFolder, filePath);
        if (!backupPath || !fs.existsSync(backupPath)) {
            return { ok: true, backups: [] };
        }

        const targetPath = backupStorage.getPisiAtomicBackupTargetPath(projectFolder, backupPath);
        if (!targetPath) return { ok: true, backups: [] };

        const stat = fs.statSync(backupPath);
        return {
            ok: true,
            backups: [
                {
                    backupId: path.relative(projectFolder, backupPath).split(path.sep).join('/'),
                    targetPath,
                    updatedAt: stat.mtime.toISOString(),
                    size: stat.size,
                    centralized: true
                }
            ]
        };
    } catch (error) {
        return { ok: false, error: error.message, backups: [] };
    }
}

function restoreCentralizedPisiAtomicBackup(projectFolder, backupId) {
    try {
        const backupPath = path.resolve(projectFolder, String(backupId || ''));
        const relative = path.relative(projectFolder, backupPath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(backupPath)) {
            return { ok: false, error: 'Geçersiz yedek yolu.' };
        }

        const targetPath = backupStorage.getPisiAtomicBackupTargetPath(projectFolder, backupPath);
        if (!targetPath) {
            return { ok: false, error: 'Geçersiz yedek yolu.' };
        }

        const backup = readJsonFileResult(backupPath);
        if (!backup.ok || !backup.data?.pisi?.id) {
            return {
                ok: false,
                error: 'Yedek geçerli bir Pisi belgesi değil.'
            };
        }

        if (fs.existsSync(targetPath) && path.extname(targetPath).toLowerCase() === '.node') {
            const snapshot = snapshotPisiNodeVersion(targetPath, 'before-backup-restore');
            if (!snapshot.ok) return snapshot;
        }

        const backupContent = fs.readFileSync(backupPath, 'utf8');
        writeFileAtomic(targetPath, backupContent);
        return {
            ok: true,
            targetPath,
            backupId: path
                .relative(projectFolder, backupStorage.getPisiAtomicBackupPath(projectFolder, targetPath) || backupPath)
                .split(path.sep)
                .join('/')
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function bindCentralizedPisiBackupIpc() {
    ipcMain.removeHandler('project:list-backups');
    ipcMain.handle('project:list-backups', (_event, projectFolder, filePath) => {
        return projectOperation(() => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            if (!filePath) {
                return listCentralizedPisiAtomicBackups(safeProjectFolder, null);
            }
            const safeFilePath = assertProjectPath(filePath, { type: 'file' });
            return listCentralizedPisiAtomicBackups(safeProjectFolder, safeFilePath);
        });
    });

    ipcMain.removeHandler('project:restore-backup');
    ipcMain.handle('project:restore-backup', (_event, projectFolder, backupId) => {
        return projectOperation(() => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            return restoreCentralizedPisiAtomicBackup(safeProjectFolder, backupId);
        });
    });
}

bindCentralizedPisiBackupIpc();

module.exports = {
    listCentralizedPisiAtomicBackups,
    restoreCentralizedPisiAtomicBackup,
    bindCentralizedPisiBackupIpc
};
