const { contextBridge, ipcRenderer } = require('electron');

function sync(scope, operation, args = {}) {
    const response = ipcRenderer.sendSync('kedi:sync', { scope, operation, args });
    if (!response || response.ok !== true) {
        throw new Error(response && response.error ? response.error : 'KEDI işlemi başarısız.');
    }
    return response.value;
}

contextBridge.exposeInMainWorld('kedi', {
    window: {
        minimize: () => ipcRenderer.send('window:minimize'),
        maximize: () => ipcRenderer.send('window:maximize'),
        close: () => ipcRenderer.send('window:close'),
        enterFullscreen: () => ipcRenderer.send('window:enterFullscreen'),
        exitFullscreen: () => ipcRenderer.send('window:exitFullscreen'),
        isFullscreen: () => ipcRenderer.invoke('window:isFullscreen')
    },
    workspace: {
        openDirectory: () => ipcRenderer.invoke('workspace:openDirectory')
    },
    fs: {
        exists: (filePath) => sync('fs', 'exists', { path: filePath }),
        readText: (filePath) => sync('fs', 'readText', { path: filePath }),
        readBase64: (filePath) => sync('fs', 'readBase64', { path: filePath }),
        writeText: (filePath, data) => sync('fs', 'writeText', { path: filePath, data }),
        writeBase64: (filePath, data) => sync('fs', 'writeBase64', { path: filePath, data }),
        mkdir: (dirPath) => sync('fs', 'mkdir', { path: dirPath }),
        rename: (oldPath, newPath) => sync('fs', 'rename', { oldPath, newPath }),
        removeFile: (filePath) => sync('fs', 'removeFile', { path: filePath }),
        listDirectory: (dirPath) => sync('fs', 'listDirectory', { path: dirPath })
    },
    path: {
        join: (...parts) => sync('path', 'join', { parts }),
        basename: (filePath) => sync('path', 'basename', { path: filePath }),
        dirname: (filePath) => sync('path', 'dirname', { path: filePath }),
        extname: (filePath) => sync('path', 'extname', { path: filePath })
    },
    calendar: {
        initialState: () => sync('calendar', 'initialState'),
        monthData: (type, state) => sync('calendar', 'monthData', { type, state }),
        shiftMonth: (type, state, delta) => sync('calendar', 'shiftMonth', { type, state, delta })
    }
});
