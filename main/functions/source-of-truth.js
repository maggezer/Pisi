'use strict';

const { modules } = require('../module-registry');

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
            const operation = String(payload?.op || 'add')
                .trim()
                .toLowerCase();

            if (operation === 'sync-index') {
                const explicitProjectionWrite = payload.allowProjectionWrite === true || payload.complete === false;

                if (!explicitProjectionWrite) {
                    const canonical = listCanonicalPisiTasks(projectFolder, originalQuickAdd);
                    return canonical?.ok
                        ? {
                              ...canonical,
                              ignoredProjectionWrite: true
                          }
                        : canonical;
                }
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
    installPisiSingleSourceTaskGuard
};
