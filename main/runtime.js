'use strict';

const { registerMainModule } = require('./module-registry');

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');

const path = require('path');

const fs = require('fs');

const crypto = require('crypto');

let mainWindow = null;

const moduleApi1 = {};
Object.defineProperties(moduleApi1, {
    mainWindow: {
        enumerable: true,
        get() {
            return mainWindow;
        },
        set(value) {
            mainWindow = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi1);

let allowWindowClose = false;

const moduleApi2 = {};
Object.defineProperties(moduleApi2, {
    allowWindowClose: {
        enumerable: true,
        get() {
            return allowWindowClose;
        },
        set(value) {
            allowWindowClose = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi2);

let closeRequestInFlight = false;

const moduleApi3 = {};
Object.defineProperties(moduleApi3, {
    closeRequestInFlight: {
        enumerable: true,
        get() {
            return closeRequestInFlight;
        },
        set(value) {
            closeRequestInFlight = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi3);

let closeRequestTimer = null;

const moduleApi4 = {};
Object.defineProperties(moduleApi4, {
    closeRequestTimer: {
        enumerable: true,
        get() {
            return closeRequestTimer;
        },
        set(value) {
            closeRequestTimer = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi4);

const recentInternalFileChanges = new Map();

const moduleApi5 = {};
Object.defineProperties(moduleApi5, {
    recentInternalFileChanges: {
        enumerable: true,
        get() {
            return recentInternalFileChanges;
        }
    }
});
registerMainModule('main.runtime', moduleApi5);

const PISI_INTERNAL_CHANGE_TTL_MS = 6000;

const moduleApi6 = {};
Object.defineProperties(moduleApi6, {
    PISI_INTERNAL_CHANGE_TTL_MS: {
        enumerable: true,
        get() {
            return PISI_INTERNAL_CHANGE_TTL_MS;
        }
    }
});
registerMainModule('main.runtime', moduleApi6);

const appIconPath = path.join(app.getAppPath(), 'assets', 'pisi.png');

const moduleApi7 = {};
Object.defineProperties(moduleApi7, {
    appIconPath: {
        enumerable: true,
        get() {
            return appIconPath;
        }
    }
});
registerMainModule('main.runtime', moduleApi7);

if (process.platform === 'win32') {
    app.setAppUserModelId(require('./functions/windows-app-identity').getWindowsAppIdentity(app).appId);
}

scheduleWindowStateSave.timer = null;

const PISI_CONNECTION_KEYS = ['up-hub', 'down-hub', 'co-level', 'upstream', 'downstream'];

const moduleApi8 = {};
Object.defineProperties(moduleApi8, {
    PISI_CONNECTION_KEYS: {
        enumerable: true,
        get() {
            return PISI_CONNECTION_KEYS;
        }
    }
});
registerMainModule('main.runtime', moduleApi8);

const PISI_DIARY_MANAGED_START = '<!--PISI_DIARY_MANAGED_START-->';

const moduleApi9 = {};
Object.defineProperties(moduleApi9, {
    PISI_DIARY_MANAGED_START: {
        enumerable: true,
        get() {
            return PISI_DIARY_MANAGED_START;
        }
    }
});
registerMainModule('main.runtime', moduleApi9);

const PISI_DIARY_MANAGED_END = '<!--PISI_DIARY_MANAGED_END-->';

const moduleApi10 = {};
Object.defineProperties(moduleApi10, {
    PISI_DIARY_MANAGED_END: {
        enumerable: true,
        get() {
            return PISI_DIARY_MANAGED_END;
        }
    }
});
registerMainModule('main.runtime', moduleApi10);

let activeProjectFolder = null;

const moduleApi11 = {};
Object.defineProperties(moduleApi11, {
    activeProjectFolder: {
        enumerable: true,
        get() {
            return activeProjectFolder;
        },
        set(value) {
            activeProjectFolder = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi11);

let activeProjectLockPath = null;

const moduleApi12 = {};
Object.defineProperties(moduleApi12, {
    activeProjectLockPath: {
        enumerable: true,
        get() {
            return activeProjectLockPath;
        },
        set(value) {
            activeProjectLockPath = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi12);

const pisiInstanceId = crypto.randomUUID();

const moduleApi13 = {};
Object.defineProperties(moduleApi13, {
    pisiInstanceId: {
        enumerable: true,
        get() {
            return pisiInstanceId;
        }
    }
});
registerMainModule('main.runtime', moduleApi13);

const projectWatchers = new Map();

const moduleApi14 = {};
Object.defineProperties(moduleApi14, {
    projectWatchers: {
        enumerable: true,
        get() {
            return projectWatchers;
        }
    }
});
registerMainModule('main.runtime', moduleApi14);

let projectWatchTimer = null;

const moduleApi15 = {};
Object.defineProperties(moduleApi15, {
    projectWatchTimer: {
        enumerable: true,
        get() {
            return projectWatchTimer;
        },
        set(value) {
            projectWatchTimer = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi15);

let projectWatcherRescanTimer = null;

const moduleApi16 = {};
Object.defineProperties(moduleApi16, {
    projectWatcherRescanTimer: {
        enumerable: true,
        get() {
            return projectWatcherRescanTimer;
        },
        set(value) {
            projectWatcherRescanTimer = value;
        }
    }
});
registerMainModule('main.runtime', moduleApi16);

const pendingProjectChangedPaths = new Set();

const moduleApi17 = {};
Object.defineProperties(moduleApi17, {
    pendingProjectChangedPaths: {
        enumerable: true,
        get() {
            return pendingProjectChangedPaths;
        }
    }
});
registerMainModule('main.runtime', moduleApi17);

ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;

    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.on('window:close-ready', (_event, result) => {
    clearTimeout(closeRequestTimer);
    closeRequestTimer = null;
    closeRequestInFlight = false;

    if (!result?.ok || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    allowWindowClose = true;
    mainWindow.close();
});

ipcMain.on('window:focus-renderer', () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.focus();
    mainWindow.webContents?.focus?.();
});

ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('app:get-language', () => {
    return getPisiLanguage();
});

ipcMain.handle('app:set-language', (_event, language) => {
    return setPisiLanguage(language);
});

ipcMain.handle('project:get-pisi-document', (_event, filePath) => {
    return projectOperation(() => {
        const safeFilePath = assertProjectPath(filePath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return getPisiDocument(safeFilePath, {
            hydrateEditorAssets: true
        });
    });
});

ipcMain.handle('project:get-node-property-context', (_event, nodePath, preferredMapPath) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        const nodeInfo = getPisiDocument(safeNodePath);
        if (!nodeInfo?.ok) return nodeInfo;

        let mapPath = null;
        let mapResult = null;

        if (preferredMapPath) {
            const safePreferredMapPath = assertProjectPath(preferredMapPath, {
                type: 'file',
                extensions: ['.map']
            });
            const preferredResult = listNodesForMap(safePreferredMapPath);
            const belongsToPreferredMap =
                preferredResult?.ok &&
                preferredResult.nodes.some((node) => {
                    return node.id === nodeInfo.metadata?.id || normalizePathForCompare(node.fullPath) === normalizePathForCompare(safeNodePath);
                });
            if (belongsToPreferredMap) {
                mapPath = safePreferredMapPath;
                mapResult = preferredResult;
            }
        }

        if (!mapPath) {
            mapPath = findParentMapPathForNode(safeNodePath, nodeInfo);
            if (mapPath) mapResult = listNodesForMap(mapPath);
        }

        if (!mapPath) {
            return {
                ok: true,
                mapPath: null,
                nodes: []
            };
        }
        if (!mapResult?.ok) return mapResult;

        return {
            ...mapResult,
            mapPath
        };
    });
});

ipcMain.handle('project:save-node-content', (_event, nodePath, content) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return saveNodeContentWithHistory(safeNodePath, content, {
            reason: 'editor-save'
        });
    });
});

ipcMain.handle('project:quick-add-task', (_event, projectFolder, payload) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        const safePayload = { ...(payload || {}) };
        if (safePayload.nodePath) {
            safePayload.nodePath = assertProjectPath(safePayload.nodePath, {
                type: 'file',
                extensions: ['.node']
            });
        }
        return quickAddPisiTask(safeProjectFolder, safePayload);
    });
});

ipcMain.handle('project:save-node-properties', (_event, nodePath, properties) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return savePisiNodeProperties(safeNodePath, properties);
    });
});

ipcMain.handle('project:list-saved-views', (_event, projectFolder) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return readPisiSavedViews(safeProjectFolder);
    });
});

ipcMain.handle('project:save-view', (_event, projectFolder, view) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return savePisiSavedView(safeProjectFolder, view);
    });
});

ipcMain.handle('project:delete-view', (_event, projectFolder, viewId) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return deletePisiSavedView(safeProjectFolder, viewId);
    });
});

ipcMain.handle('project:list-database-templates', (_event, projectFolder) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return readPisiDatabaseTemplates(safeProjectFolder);
    });
});

ipcMain.handle('project:save-database-template', (_event, projectFolder, template) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return savePisiDatabaseTemplate(safeProjectFolder, template || {});
    });
});

ipcMain.handle('project:delete-database-template', (_event, projectFolder, templateId) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return deletePisiDatabaseTemplate(safeProjectFolder, templateId);
    });
});

ipcMain.handle('project:apply-database-template', (_event, nodePath, templateId, options) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return applyPisiDatabaseTemplate(safeNodePath, templateId, options || {});
    });
});

ipcMain.handle('project:create-property-map', (_event, projectFolder, options) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        const safeOptions = { ...(options || {}) };
        safeOptions.nodePaths = (Array.isArray(safeOptions.nodePaths) ? safeOptions.nodePaths : []).map((nodePath) =>
            assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            })
        );
        return createPisiPropertyMap(safeProjectFolder, safeOptions);
    });
});

ipcMain.handle('project:export-map', (_event, mapPath, payload) => {
    return asyncProjectOperation(async () => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return exportPisiMapGraphic(safeMapPath, payload || {});
    });
});

ipcMain.handle('project:export-node', (_event, nodePath, format) => {
    return asyncProjectOperation(async () => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return exportPisiNodeDocument(safeNodePath, format);
    });
});

ipcMain.handle('project:export-markdown', (_event, projectFolder) => {
    return asyncProjectOperation(async () => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return exportPisiProjectMarkdown(safeProjectFolder);
    });
});

ipcMain.handle('project:import-markdown', (_event, projectFolder) => {
    return asyncProjectOperation(async () => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return importPisiMarkdownFolder(safeProjectFolder);
    });
});

ipcMain.handle('project:list-node-history', (_event, nodePath) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return listPisiNodeHistory(safeNodePath);
    });
});

ipcMain.handle('project:get-node-history-version', (_event, nodePath, historyId) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return getPisiNodeHistoryVersion(safeNodePath, historyId);
    });
});

ipcMain.handle('project:restore-node-history', (_event, nodePath, historyId) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return restorePisiNodeHistoryVersion(safeNodePath, historyId);
    });
});

ipcMain.handle('project:audit-integrity', (_event, projectFolder) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return auditPisiProjectIntegrity(safeProjectFolder);
    });
});

ipcMain.handle('project:list-backups', (_event, projectFolder, filePath) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        const safeFilePath = filePath
            ? assertProjectPath(filePath, {
                  type: 'file',
                  extensions: ['.node', '.map']
              })
            : null;
        return listPisiAtomicBackups(safeProjectFolder, safeFilePath);
    });
});

ipcMain.handle('project:restore-backup', (_event, projectFolder, backupId) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return restorePisiAtomicBackup(safeProjectFolder, backupId);
    });
});

ipcMain.handle('project:delete-node-from-map', (_event, nodePath) => {
    return asyncProjectOperation(async () => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return deleteNodeFromMap(safeNodePath);
    });
});

ipcMain.handle('project:delete-pisi-file', (_event, targetPath) => {
    return asyncProjectOperation(async () => {
        const safeTargetPath = assertProjectPath(targetPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return deletePisiFile(safeTargetPath);
    });
});

ipcMain.handle('project:delete-path', (_event, targetPath) => {
    return asyncProjectOperation(async () => {
        const safeTargetPath = assertProjectPath(targetPath);

        if (normalizePathForCompare(safeTargetPath) === normalizePathForCompare(activeProjectFolder)) {
            throw new Error('Aktif proje kökü bu işlemle silinemez.');
        }

        return deleteProjectPath(safeTargetPath);
    });
});

ipcMain.handle('project:create-node-under-map', (_event, mapPath) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return createNodeUnderMap(safeMapPath);
    });
});

ipcMain.handle('project:get-or-create-diary-node', (_event, projectFolder, isoDate) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });

        if (normalizePathForCompare(safeProjectFolder) !== normalizePathForCompare(activeProjectFolder)) {
            throw new Error('Diary yalnızca aktif proje kökünde kullanılabilir.');
        }

        return getOrCreateDiaryNode(safeProjectFolder, isoDate);
    });
});

ipcMain.handle('project:list-diary-dates', (_event, projectFolder) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return listPisiDiaryDates(safeProjectFolder);
    });
});

ipcMain.handle('project:sync-diary-missions', (_event, projectFolder, payload) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return syncDiaryMissions(safeProjectFolder, payload);
    });
});

ipcMain.handle('project:rename-pisi-file', (_event, oldPath, newBaseName) => {
    return projectOperation(() => {
        const safeOldPath = assertProjectPath(oldPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return renamePisiFile(safeOldPath, newBaseName);
    });
});

ipcMain.handle('project:move-pisi-item', (_event, sourcePath, destinationFolderPath, options) => {
    return projectOperation(() => {
        const safeSourcePath = assertProjectPath(sourcePath);
        const safeDestinationPath = assertProjectPath(destinationFolderPath, {
            type: 'directory'
        });

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

        return movePisiItem(safeSourcePath, safeDestinationPath, safeOptions);
    });
});

ipcMain.handle('project:create-pisi-file', (_event, folderPath, ext) => {
    return projectOperation(() => {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return createUniquePisiFile(safeFolderPath, ext);
    });
});

ipcMain.handle('project:get-last-folder', () => {
    const settings = readSettings();
    const lastProjectFolder = settings.lastProjectFolder || null;

    if (!lastProjectFolder || !fs.existsSync(lastProjectFolder)) {
        return null;
    }

    const lockResult = tryLockProjectFolder(lastProjectFolder);

    if (!lockResult.ok) {
        console.error('[PISI] Son proje açılamadı:', lockResult.error);
        return null;
    }

    return lockResult.folderPath;
});

ipcMain.handle('project:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: translatePisiMain('PISI proje klasörü seç'),
        properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return {
            ok: false,
            cancelled: true
        };
    }

    const selectedFolder = result.filePaths[0];
    const lockResult = tryLockProjectFolder(selectedFolder);

    if (!lockResult.ok) {
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: translatePisiMain('Proje açılamadı'),
            message: translatePisiMain('Seçilen proje klasörü kilitlenemedi.'),
            detail: [lockResult.error, translatePisiMain('Klasör başka bir PISI sürecinde açık olabilir veya erişim izni olmayabilir.')]
                .filter(Boolean)
                .join('\n\n')
        });
        return {
            ok: false,
            code: lockResult.code || 'PROJECT_OPEN_FAILED',
            error: lockResult.error,
            reported: true
        };
    }

    const settings = readSettings();
    settings.lastProjectFolder = lockResult.folderPath;
    writeSettings(settings);

    return {
        ok: true,
        folderPath: lockResult.folderPath
    };
});

ipcMain.handle('project:set-last-folder', (_event, folderPath) => {
    return projectOperation(() => {
        if (folderPath) {
            const safeFolderPath = assertProjectPath(folderPath, {
                type: 'directory'
            });

            if (normalizePathForCompare(safeFolderPath) !== normalizePathForCompare(activeProjectFolder)) {
                throw new Error('Yalnızca aktif proje son proje olarak kaydedilebilir.');
            }
        }

        const settings = readSettings();
        settings.lastProjectFolder = folderPath || null;
        writeSettings(settings);
        return {
            ok: true
        };
    });
});

ipcMain.handle('project:list-folder', (_event, folderPath) => {
    return projectOperation(() => {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return safeListFolder(safeFolderPath);
    });
});

ipcMain.handle('project:folder-exists', (_event, folderPath) => {
    try {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return folderExistsAndIsDirectory(safeFolderPath);
    } catch {
        return false;
    }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

const moduleApi18 = {};
Object.defineProperties(moduleApi18, {
    hasSingleInstanceLock: {
        enumerable: true,
        get() {
            return hasSingleInstanceLock;
        }
    }
});
registerMainModule('main.runtime', moduleApi18);

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });

    app.whenReady().then(() => {
        createWindow();
        initializePisiAutoUpdate();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                allowWindowClose = false;
                createWindow();
            }
        });
    });
}

app.on('will-quit', () => {
    unlockProjectFolder();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
