'use strict';

const fs = require('fs');
const path = require('path');
const { modules } = require('../module-registry');

const PISI_TASK_MIGRATION_MARKER = 'task-store-migration.json';

function getPisiTaskMigrationMarkerPath(projectFolder) {
    return path.join(path.resolve(projectFolder), '.pisi', PISI_TASK_MIGRATION_MARKER);
}

function readPisiTaskMigrationStatus(projectFolder) {
    const markerPath = getPisiTaskMigrationMarkerPath(projectFolder);
    if (!fs.existsSync(markerPath)) {
        return {
            ok: true,
            complete: false,
            legacyImportedAt: null
        };
    }

    const result = globalThis.readJsonFileResult?.(markerPath);
    if (!result?.ok || !result.data) {
        return {
            ok: false,
            complete: false,
            legacyImportedAt: null,
            error: result?.error || 'Task migration marker okunamadı.'
        };
    }

    return {
        ok: true,
        complete: Boolean(result.data.legacyImportedAt),
        legacyImportedAt: result.data.legacyImportedAt || null
    };
}

function completePisiTaskLegacyMigration(projectFolder) {
    const directory = path.join(path.resolve(projectFolder), '.pisi');
    fs.mkdirSync(directory, { recursive: true });
    try {
        globalThis.hideFileOnWindows?.(directory);
    } catch {}

    const markerPath = getPisiTaskMigrationMarkerPath(projectFolder);
    const legacyImportedAt = new Date().toISOString();
    const data = {
        version: 1,
        legacyImportedAt,
        authority: '.pisi/tasks.json',
        note: 'Legacy node task metadata is a projection after this migration.'
    };
    const content = `${JSON.stringify(data, null, 2)}\n`;

    if (typeof globalThis.writeFileAtomic === 'function') {
        globalThis.writeFileAtomic(markerPath, content, { backup: false });
    } else {
        fs.writeFileSync(markerPath, content, 'utf-8');
    }

    return {
        ok: true,
        complete: true,
        legacyImportedAt
    };
}

function listCanonicalPisiTasks(projectFolder, originalQuickAdd) {
    const result = originalQuickAdd(projectFolder, { op: 'list' });
    return result?.ok
        ? {
            ...result,
            canonical: true,
            authority: '.pisi/tasks.json'
        }
        : result;
}

function installPisiSingleSourceTaskGuard() {
    const taskCapture = modules['main.taskCapture'];
    if (!taskCapture || typeof taskCapture.quickAddPisiTask !== 'function') {
        throw new Error('First-class task capture bridge bulunamadı.');
    }

    const originalQuickAdd = taskCapture.quickAddPisiTask;
    if (originalQuickAdd.__pisiSingleSourceGuard === true) return;

    const guardedQuickAdd = function singleSourceQuickAdd(projectFolder, payload = {}) {
        try {
            const operation = String(payload?.op || 'add').trim().toLowerCase();

            if (operation === 'migration-status') {
                return readPisiTaskMigrationStatus(projectFolder);
            }

            if (operation === 'complete-migration') {
                return completePisiTaskLegacyMigration(projectFolder);
            }

            if (operation === 'sync-index') {
                const migration = readPisiTaskMigrationStatus(projectFolder);
                if (!migration.ok) return migration;

                const explicitProjectionWrite = payload.allowProjectionWrite === true;

                // İlk geçişte legacy node kayıtlarının bir defa içeri alınmasına izin verilir.
                // Migration tamamlandıktan sonra tam proje taramaları canonical task store'u
                // geri yazamaz. Yalnız açıkça işaretlenmiş kullanıcı işlemleri write-through
                // yapabilir.
                if (migration.complete && !explicitProjectionWrite) {
                    const canonical = listCanonicalPisiTasks(projectFolder, originalQuickAdd);
                    return canonical?.ok
                        ? {
                            ...canonical,
                            ignoredProjectionWrite: true,
                            legacyImportedAt: migration.legacyImportedAt
                        }
                        : canonical;
                }

                return originalQuickAdd(projectFolder, payload);
            }

            return originalQuickAdd(projectFolder, payload);
        } catch (error) {
            return { ok: false, error: error.message };
        }
    };

    Object.defineProperty(guardedQuickAdd, '__pisiSingleSourceGuard', {
        value: true,
        enumerable: false
    });
    taskCapture.quickAddPisiTask = guardedQuickAdd;
}

installPisiSingleSourceTaskGuard();

module.exports = {
    getPisiTaskMigrationMarkerPath,
    readPisiTaskMigrationStatus,
    completePisiTaskLegacyMigration,
    installPisiSingleSourceTaskGuard
};
