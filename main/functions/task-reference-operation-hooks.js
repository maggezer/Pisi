import { ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';

function attachPisiTaskReferenceRewrite(result) {
    if (!result?.ok || !Array.isArray(result.pathChanges) || !result.pathChanges.length) {
        return result;
    }

    const rewrite = modules['main.taskReferenceIntegrity']?.rewritePisiTaskSourcePathsForPathChanges;
    const taskReferences =
        typeof rewrite === 'function' ? rewrite(result.pathChanges) : { ok: false, updated: 0, error: 'Task reference integrity modülü bulunamadı.' };

    if (!taskReferences?.ok) {
        console.warn('[PISI] Task source yolları işlem sonrasında güncellenemedi:', taskReferences?.error || 'Bilinmeyen hata');
    }

    return {
        ...result,
        taskReferences: taskReferences || { ok: false, updated: 0 }
    };
}

function bindPisiTaskReferenceOperationHooks() {
    ipcMain.removeHandler('project:rename-pisi-file');
    ipcMain.handle('project:rename-pisi-file', (_event, oldPath, newBaseName) => {
        return projectOperation(() => {
            const safeOldPath = assertProjectPath(oldPath, {
                type: 'file',
                extensions: ['.map', '.node']
            });
            return attachPisiTaskReferenceRewrite(renamePisiFile(safeOldPath, newBaseName));
        });
    });

    ipcMain.removeHandler('project:move-pisi-item');
    ipcMain.handle('project:move-pisi-item', (_event, sourcePath, destinationFolderPath, options) => {
        return projectOperation(() => {
            const safeSourcePath = assertProjectPath(sourcePath);
            const safeDestinationPath = assertProjectPath(destinationFolderPath, { type: 'directory' });

            if (normalizePathForCompare(safeSourcePath) === normalizePathForCompare(activeProjectFolder)) {
                throw new Error('Aktif proje kökü taşınamaz.');
            }

            const safeOptions = { ...(options || {}) };
            if (safeOptions.parentMapPath) {
                safeOptions.parentMapPath = assertProjectPath(safeOptions.parentMapPath, {
                    type: 'file',
                    extensions: ['.map']
                });
            }

            return attachPisiTaskReferenceRewrite(movePisiItem(safeSourcePath, safeDestinationPath, safeOptions));
        });
    });
}

bindPisiTaskReferenceOperationHooks();

const moduleApi = {
    attachPisiTaskReferenceRewrite,
    bindPisiTaskReferenceOperationHooks
};

registerMainModule('main.taskReferenceOperationHooks', moduleApi);
