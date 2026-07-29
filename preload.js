const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kediEnvironment', {
    platform: process.platform
});

contextBridge.exposeInMainWorld('electronWindow', {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    focusRenderer: () => ipcRenderer.send('window:focus-renderer'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

    onMaximized: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('window:maximized', listener);
        return () => ipcRenderer.removeListener('window:maximized', listener);
    },

    onUnmaximized: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('window:unmaximized', listener);
        return () => ipcRenderer.removeListener('window:unmaximized', listener);
    },

    onCloseRequested: (callback) => {
        const listener = async () => {
            try {
                const result = await callback();
                ipcRenderer.send('window:close-ready', {
                    ok: result !== false
                });
            } catch (error) {
                ipcRenderer.send('window:close-ready', {
                    ok: false,
                    error: error.message
                });
            }
        };

        ipcRenderer.on('window:request-close', listener);
        return () => ipcRenderer.removeListener('window:request-close', listener);
    }
});

contextBridge.exposeInMainWorld('kediProject', {
    getLastFolder: () => ipcRenderer.invoke('project:get-last-folder'),
    chooseFolder: () => ipcRenderer.invoke('project:choose-folder'),
    setLastFolder: (folderPath) => ipcRenderer.invoke('project:set-last-folder', folderPath),
    listFolder: (folderPath) => ipcRenderer.invoke('project:list-folder', folderPath),
    deletePath: (targetPath) => ipcRenderer.invoke('project:delete-path', targetPath),
    folderExists: (folderPath) => ipcRenderer.invoke('project:folder-exists', folderPath),

    createKediFile: (folderPath, ext) => ipcRenderer.invoke('project:create-kedi-file', folderPath, ext),
    renameKediFile: (oldPath, newBaseName) => ipcRenderer.invoke('project:rename-kedi-file', oldPath, newBaseName),
    moveKediItem: (sourcePath, destinationFolderPath, options) => ipcRenderer.invoke('project:move-kedi-item', sourcePath, destinationFolderPath, options || {}),
    createNodeUnderMap: (mapPath) => ipcRenderer.invoke('project:create-node-under-map', mapPath),
    getOrCreateDiaryNode: (projectFolder, isoDate) => ipcRenderer.invoke('project:get-or-create-diary-node', projectFolder, isoDate),
    listDiaryDates: (projectFolder) => ipcRenderer.invoke('project:list-diary-dates', projectFolder),
    syncDiaryMissions: (projectFolder, entries) => ipcRenderer.invoke('project:sync-diary-missions', projectFolder, entries),


    listMapNodes: (mapPath) => ipcRenderer.invoke('project:list-map-nodes', mapPath),
    saveMapLayout: (mapPath, nodeLayouts) => ipcRenderer.invoke('project:save-map-layout', mapPath, nodeLayouts),   
    saveNodeContent: (nodePath, content) => ipcRenderer.invoke('project:save-node-content', nodePath, content),

    getKediDocument: (filePath) => ipcRenderer.invoke('project:get-kedi-document', filePath),
    deleteNodeFromMap: (nodePath) => ipcRenderer.invoke('project:delete-node-from-map', nodePath),

    upsertMapConnection: (mapPath, edge) => ipcRenderer.invoke('project:upsert-map-connection', mapPath, edge),
    reparentMapNode: (mapPath, childId, parentId) => ipcRenderer.invoke('project:reparent-map-node', mapPath, childId, parentId),

    deleteMapConnection: (mapPath, edgeId) => ipcRenderer.invoke('project:delete-map-connection', mapPath, edgeId),
    saveMapCamera: (mapPath, camera) => ipcRenderer.invoke('project:save-map-camera', mapPath, camera),

    deleteKediFile: (targetPath) => ipcRenderer.invoke('project:delete-kedi-file', targetPath),

    onFileSystemChanged: (callback) => {
        const listener = (_event, payload) => {
            callback(payload);
        };

        ipcRenderer.on('project:filesystem-changed', listener);
        return () => {
            ipcRenderer.removeListener('project:filesystem-changed', listener);
        };
    }
});
