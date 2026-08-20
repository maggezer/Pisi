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

        const migration = backupStorage.migratePisiLegacyAtomicBackup(
            projectFolder,
            filePath,
            {
                rename: typeof globalThis.renamePathInternal === 'function'
                    ? globalThis.renamePathInternal
                    : undefined
            }
        );

        const managedPath = backupStorage.getPisiAtomicBackupPath(
            projectFolder,
            filePath
        );
        const legacyPath = `${path.resolve(filePath)}${backupStorage.PISI_BACKUP_SUFFIX}`;
        const candidates = [managedPath, legacyPath]
            .filter(Boolean)
            .filter((candidate, index, all) => {
                return all.indexOf(candidate) === index && fs.existsSync(candidate);
            });

        const byTarget = new Map();
        for (const backupPath of candidates) {
            const targetPath = backupStorage.getPisiAtomicBackupTargetPath(
                projectFolder,
                backupPath
            );
            if (!targetPath) continue;
            const stat = fs.statSync(backupPath);
            const entry = {
                backupId: path.relative(projectFolder, backupPath)
                    .split(path.sep)
                    .join('/'),
                targetPath,
                updatedAt: stat.mtime.toISOString(),
                size: stat.size,
                centralized: backupStorage.isPisiBackupStoragePath(
                    projectFolder,
                    backupPath
                )
            };
            const key = normalizeBackupTargetKey(targetPath);
            const existing = byTarget.get(key);
            if (!existing || entry.updatedAt > existing.updatedAt) {
                byTarget.set(key, entry);
            }
        }

        return {
            ok: migration.ok !== false,
            backups: Array.from(byTarget.values())
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            migratedLegacyBackup: migration.migrated === true,
            warning: migration.ok === false ? migration.error : null
        };
    } catch (error) {
        return { ok: false, error: error.message, backups: [] };
    }
}

function restoreCentralizedPisiAtomicBackup(projectFolder, backupId) {
    try {
        const backupPath = path.resolve(projectFolder, String(backupId || ''));
        const relative = path.relative(projectFolder, backupPath);
        if (
            relative.startsWith('..') ||
            path.isAbsolute(relative) ||
            !fs.existsSync(backupPath)
        ) {
            return { ok: false, error: 'Geçersiz yedek yolu.' };
        }

        const targetPath = backupStorage.getPisiAtomicBackupTargetPath(
            projectFolder,
            backupPath
        );
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

        if (
            fs.existsSync(targetPath) &&
            path.extname(targetPath).toLowerCase() === '.node'
        ) {
            const snapshot = snapshotPisiNodeVersion(
                targetPath,
                'before-backup-restore'
            );
            if (!snapshot.ok) return snapshot;
        }

        const backupContent = fs.readFileSync(backupPath, 'utf8');
        writeFileAtomic(targetPath, backupContent);
        return {
            ok: true,
            targetPath,
            backupId: path.relative(projectFolder, backupStorage.getPisiAtomicBackupPath(
                projectFolder,
                targetPath
            ) || backupPath).split(path.sep).join('/')
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
                return listCentralizedPisiAtomicBackups(
                    safeProjectFolder,
                    null
                );
            }
            const safeFilePath = assertProjectPath(filePath, { type: 'file' });
            return listCentralizedPisiAtomicBackups(
                safeProjectFolder,
                safeFilePath
            );
        });
    });

    ipcMain.removeHandler('project:restore-backup');
    ipcMain.handle('project:restore-backup', (_event, projectFolder, backupId) => {
        return projectOperation(() => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            return restoreCentralizedPisiAtomicBackup(
                safeProjectFolder,
                backupId
            );
        });
    });
}

bindCentralizedPisiBackupIpc();

module.exports = {
    listCentralizedPisiAtomicBackups,
    restoreCentralizedPisiAtomicBackup,
    bindCentralizedPisiBackupIpc
};
