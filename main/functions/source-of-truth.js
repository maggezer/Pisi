'use strict';

const path = require('path');
const storageLayer = require('./storage');
const { modules } = require('../module-registry');

const PISI_TASK_MIGRATION_MARKER = 'task-store-migration.json';
const PISI_TASK_MIGRATION_KEY = `.pisi/${PISI_TASK_MIGRATION_MARKER}`;

function getPisiTaskMigrationMarkerPath(projectFolder) {
    return path.join(path.resolve(projectFolder), '.pisi', PISI_TASK_MIGRATION_MARKER);
}

function readPisiTaskMigrationStatus(projectFolder) {
    const storage = storageLayer.getPisiProjectStorage(projectFolder);
    const result = storage.readJson(PISI_TASK_MIGRATION_KEY, {
        allowMissing: true
    });
    if (result.missing) {
        return {
            ok: true,
            complete: false,
            legacyImportedAt: null
        };
    }
    if (!result.ok || !result.data) {
        return {
            ok: false,
            complete: false,
            legacyImportedAt: null,
            error: result.error || 'Task migration marker okunamadı.'
        };
    }

    return {
        ok: true,
        complete: Boolean(result.data.legacyImportedAt),
        legacyImportedAt: result.data.legacyImportedAt || null
    };
}

function completePisiTaskLegacyMigration(projectFolder) {
    const storage = storageLayer.getPisiProjectStorage(projectFolder);
    const ensured = storage.ensureDirectory('.pisi', { hidden: true });
    if (!ensured.ok) {
        return {
            ok: false,
            complete: false,
            legacyImportedAt: null,
            error: ensured.error || 'Task migration klasörü oluşturulamadı.'
        };
    }

    const legacyImportedAt = new Date().toISOString();
    const data = {
        version: 1,
        legacyImportedAt,
        authority: '.pisi/tasks.json',
        note: 'Legacy node task metadata is a projection after this migration.'
    };
    const written = storage.writeJson(PISI_TASK_MIGRATION_KEY, data, {
        backup: false,
        newline: true,
        hiddenParent: true
    });
    if (!written.ok) {
        return {
            ok: false,
            complete: false,
            legacyImportedAt: null,
            error: written.error || 'Task migration marker yazılamadı.'
        };
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

                const explicitProjectionWrite =
                    payload.allowProjectionWrite === true ||
                    payload.complete === false;

                // İlk geçişte legacy node kayıtlarının bir defa içeri alınmasına izin verilir.
                // Migration tamamlandıktan sonra tam proje taramaları canonical task store'u
                // geri yazamaz. Yalnız açık kullanıcı işlemleri ve canlı editor write-through
                // çağrıları task store'u değiştirebilir.
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
