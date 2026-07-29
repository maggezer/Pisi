const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronWindow', {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    focusRenderer: () => ipcRenderer.send('window:focus-renderer'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

    onMaximized: (callback) => {
        ipcRenderer.on('window:maximized', () => callback());
    },

    onUnmaximized: (callback) => {
        ipcRenderer.on('window:unmaximized', () => callback());
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

    deleteMapConnection: (mapPath, edgeId) => ipcRenderer.invoke('project:delete-map-connection', mapPath, edgeId),
    saveMapCamera: (mapPath, camera) => ipcRenderer.invoke('project:save-map-camera', mapPath, camera),

    deleteKediFile: (targetPath) => ipcRenderer.invoke('project:delete-kedi-file', targetPath),
    deleteNodeFromMap: (nodePath) => ipcRenderer.invoke('project:delete-node-from-map', nodePath),

    onFileSystemChanged: (callback) => {
        ipcRenderer.on('project:filesystem-changed', (_event, payload) => {
            callback(payload);
        });
    }
});