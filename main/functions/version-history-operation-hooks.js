import { ipcMain } from '../electron-bridge.js';
import * as history from './version-history-core.js';

function rebindPisiVersionHistoryIpc() {
    ipcMain.removeHandler('project:save-node-content');
    ipcMain.handle('project:save-node-content', (_event, nodePath, content) => {
        return projectOperation(() => {
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            return history.saveNodeContentWithBoundedHistory(safeNodePath, content, {
                projectFolder: globalThis.activeProjectFolder,
                reason: 'editor-save'
            });
        });
    });

    ipcMain.removeHandler('project:list-node-history');
    ipcMain.handle('project:list-node-history', (_event, nodePath) => {
        return projectOperation(() => {
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            return history.listPisiNodeHistoryBounded(safeNodePath, {
                projectFolder: globalThis.activeProjectFolder
            });
        });
    });

    ipcMain.removeHandler('project:get-node-history-version');
    ipcMain.handle('project:get-node-history-version', (_event, nodePath, historyId) => {
        return projectOperation(() => {
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            return history.getPisiNodeHistoryVersionBounded(safeNodePath, historyId, { projectFolder: globalThis.activeProjectFolder });
        });
    });

    ipcMain.removeHandler('project:restore-node-history');
    ipcMain.handle('project:restore-node-history', (_event, nodePath, historyId) => {
        return asyncProjectOperation(async () => {
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            const projectFolder = globalThis.activeProjectFolder;
            return await Promise.resolve(
                runPisiAtomicMutation(projectFolder, 'version-history.restore.v1', () =>
                    history.restorePisiNodeHistoryVersionBounded(safeNodePath, historyId, { projectFolder })
                )
            );
        });
    });

    // The History dialog is node-scoped. When no node is open, the old
    // implementation recursively walked the whole project looking for
    // .pisi-backup files. Avoid that O(project files) read cost.
    ipcMain.removeHandler('project:list-backups');
    ipcMain.handle('project:list-backups', (_event, projectFolder, filePath) => {
        return projectOperation(() => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            if (!filePath) {
                return {
                    ok: true,
                    backups: [],
                    scoped: true,
                    skippedProjectScan: true
                };
            }
            const safeFilePath = assertProjectPath(filePath, { type: 'file' });
            return listPisiAtomicBackups(safeProjectFolder, safeFilePath);
        });
    });
}

rebindPisiVersionHistoryIpc();

export { rebindPisiVersionHistoryIpc };
