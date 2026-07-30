'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');
const PISI_APP_ROOT = path.resolve(__dirname, '..', '..');

function startProjectWatcher(folderPath) {
    stopProjectWatcher();

    if (!folderPath || !fs.existsSync(folderPath)) {
        return;
    }

    syncProjectWatchers(folderPath);
    console.log('[PISI] Proje klasörü izleniyor:', folderPath);
}

function folderExistsAndIsDirectory(folderPath) {
    try {
        return Boolean(
            folderPath &&
            fs.existsSync(folderPath) &&
            fs.statSync(folderPath).isDirectory()
        );
    } catch {
        return false;
    }
}

function normalizePathForCompare(targetPath) {
    if (!targetPath) return '';

    const normalized = path
        .resolve(targetPath)
        .replace(/[\\/]+/g, '/');

    return process.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
}

function isSameOrInsidePath(candidatePath, parentPath) {
    const candidate = normalizePathForCompare(candidatePath);
    const parent = normalizePathForCompare(parentPath);

    if (!candidate || !parent) return false;
    if (candidate === parent) return true;
    return candidate.startsWith(`${parent}/`);
}

function assertNoSymbolicLinksBetween(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    if (!relative || relative === '.') return;

    let current = rootPath;

    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;

        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw new Error('Proje işlemlerinde symlink/junction kullanılamaz.');
        }
    }
}

function assertProjectPath(inputPath, options = {}) {
    if (!activeProjectFolder) {
        throw new Error('Aktif proje klasörü yok.');
    }

    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        throw new Error('Geçerli bir proje yolu gerekli.');
    }

    const projectRoot = fs.realpathSync.native(activeProjectFolder);
    const resolvedPath = path.resolve(inputPath);

    if (!isSameOrInsidePath(resolvedPath, projectRoot)) {
        throw new Error('İstenen yol aktif proje klasörünün dışında.');
    }

    assertNoSymbolicLinksBetween(projectRoot, resolvedPath);

    const mustExist = options.mustExist !== false;
    if (mustExist && !fs.existsSync(resolvedPath)) {
        throw new Error('İstenen proje yolu bulunamadı.');
    }

    if (fs.existsSync(resolvedPath)) {
        const realPath = fs.realpathSync.native(resolvedPath);
        if (!isSameOrInsidePath(realPath, projectRoot)) {
            throw new Error('Yol bir bağlantı üzerinden proje dışına çıkıyor.');
        }

        const stat = fs.statSync(realPath);
        if (options.type === 'file' && !stat.isFile()) {
            throw new Error('İstenen yol bir dosya değil.');
        }
        if (options.type === 'directory' && !stat.isDirectory()) {
            throw new Error('İstenen yol bir klasör değil.');
        }
    } else {
        let ancestorPath = path.dirname(resolvedPath);

        while (
            !fs.existsSync(ancestorPath) &&
            isSameOrInsidePath(ancestorPath, projectRoot) &&
            ancestorPath !== path.dirname(ancestorPath)
        ) {
            ancestorPath = path.dirname(ancestorPath);
        }

        if (!fs.existsSync(ancestorPath)) {
            throw new Error('Hedef yolun üst klasörü bulunamadı.');
        }

        const realAncestor = fs.realpathSync.native(ancestorPath);
        if (!isSameOrInsidePath(realAncestor, projectRoot)) {
            throw new Error('Hedef yol bir bağlantı üzerinden proje dışına çıkıyor.');
        }
    }

    if (Array.isArray(options.extensions)) {
        const ext = getPisiFileExt(resolvedPath);
        if (!options.extensions.includes(ext)) {
            throw new Error('Bu işlem için geçersiz dosya türü.');
        }
    }

    return resolvedPath;
}

function projectOperation(operation) {
    try {
        return operation();
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

async function asyncProjectOperation(operation) {
    try {
        return await operation();
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function hideFileOnWindows(filePath) {
    if (process.platform !== 'win32') return;

    try {
        const { execFile } = require('child_process');
        execFile('attrib', ['+H', filePath], () => {});
    } catch (error) {
        console.warn('[PISI] Lock dosyası gizlenemedi:', error.message);
    }
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function migrateLegacyProjectLock(folderPath) {
    const legacyLockPath = path.join(folderPath, '.kedi.lock');
    if (!fs.existsSync(legacyLockPath)) return { ok: true };

    let legacyLock = null;
    try {
        legacyLock = JSON.parse(fs.readFileSync(legacyLockPath, 'utf-8'));
    } catch {}

    if (legacyLock?.pid && isProcessAlive(Number(legacyLock.pid))) {
        return {
            ok: false,
            error: `Bu proje eski uygulamanın çalışan bir süreci tarafından kullanılıyor (PID ${legacyLock.pid}).`
        };
    }

    markInternalFileChange(legacyLockPath);
    fs.unlinkSync(legacyLockPath);
    sealInternalFileChange(legacyLockPath);
    return { ok: true };
}

function acquireProjectLock(folderPath) {
    const lockPath = path.join(folderPath, '.pisi.lock');

    try {
        const legacyLockResult = migrateLegacyProjectLock(folderPath);
        if (!legacyLockResult.ok) return legacyLockResult;

        if (fs.existsSync(lockPath)) {
            let existingLock = null;

            try {
                existingLock = JSON.parse(
                    fs.readFileSync(lockPath, 'utf-8')
                );
            } catch {}

            if (
                existingLock?.instanceId === pisiInstanceId &&
                existingLock?.pid === process.pid
            ) {
                return {
                    ok: true,
                    lockPath
                };
            }

            if (existingLock?.pid && isProcessAlive(Number(existingLock.pid))) {
                return {
                    ok: false,
                    error: `Bu proje başka bir PISI süreci tarafından kullanılıyor (PID ${existingLock.pid}).`
                };
            }

            fs.unlinkSync(lockPath);
        }

        const descriptor = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeFileSync(
            descriptor,
            JSON.stringify({
                pid: process.pid,
                instanceId: pisiInstanceId,
                openedAt: new Date().toISOString()
            }, null, 2),
            'utf-8'
        );
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        hideFileOnWindows(lockPath);

        return {
            ok: true,
            lockPath
        };
    } catch (error) {
        return {
            ok: false,
            error: `Proje kilidi alınamadı: ${error.message}`
        };
    }
}

function lockProjectFolder(folderPath) {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return false;
        }

        const realFolderPath = fs.realpathSync.native(folderPath);
        const stat = fs.statSync(realFolderPath);
        if (!stat.isDirectory()) {
            return false;
        }

        if (
            activeProjectFolder &&
            normalizePathForCompare(activeProjectFolder) ===
                normalizePathForCompare(realFolderPath)
        ) {
            return true;
        }

        const lockResult = acquireProjectLock(realFolderPath);
        if (!lockResult.ok) {
            console.error('[PISI]', lockResult.error);
            return false;
        }

        const oldLockPath = activeProjectLockPath;

        activeProjectFolder = realFolderPath;
        activeProjectLockPath = lockResult.lockPath;
        startProjectWatcher(realFolderPath);

        if (oldLockPath && oldLockPath !== activeProjectLockPath) {
            try {
                const oldLock = JSON.parse(fs.readFileSync(oldLockPath, 'utf-8'));
                if (oldLock.instanceId === pisiInstanceId) {
                    fs.unlinkSync(oldLockPath);
                }
            } catch {}
        }

        console.log('[PISI] Proje klasörü kilitlendi:', realFolderPath);
        return true;
    } catch (error) {
        console.error('[PISI] Proje klasörü kilitlenemedi:', error);
        return false;
    }
}

function unlockProjectFolder() {
    stopProjectWatcher();

    if (activeProjectLockPath && fs.existsSync(activeProjectLockPath)) {
        try {
            const lockData = JSON.parse(
                fs.readFileSync(activeProjectLockPath, 'utf-8')
            );

            if (lockData.instanceId === pisiInstanceId) {
                fs.unlinkSync(activeProjectLockPath);
            }
        } catch (error) {
            console.warn('[PISI] Proje kilidi kaldırılamadı:', error.message);
        }
    }

    activeProjectFolder = null;
    activeProjectLockPath = null;
}

function createWindow() {

    const savedWindowState = getSavedWindowState();

    mainWindow = new BrowserWindow({
        
        width: savedWindowState.width,
        height: savedWindowState.height,
        x: savedWindowState.x,
        y: savedWindowState.y,

        minWidth: 900,
        minHeight: 600,

        title: 'PISI',
        icon: appIconPath,
        frame: false,
        backgroundColor: '#1e1e1e',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(PISI_APP_ROOT, 'preload.js')
        }
    });

    Menu.setApplicationMenu(null);

    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
    });

    mainWindow.webContents.session.setPermissionCheckHandler(() => false);
    mainWindow.webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false)
    );

    mainWindow.loadFile(path.join(PISI_APP_ROOT, 'index.html'));

    if (!app.isPackaged && process.env.PISI_OPEN_DEVTOOLS === '1') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('maximize', () => {
        saveWindowState();
        mainWindow.webContents.send('window:maximized');
    });

    mainWindow.on('unmaximize', () => {
        saveWindowState();
        mainWindow.webContents.send('window:unmaximized');
    });

    mainWindow.on('enter-full-screen', () => {
        saveWindowState();
    });

    mainWindow.on('leave-full-screen', () => {
        saveWindowState();
    });

    mainWindow.on('move', () => {
        scheduleWindowStateSave();
    });

    mainWindow.on('resize', () => {
        scheduleWindowStateSave();
    });

    mainWindow.on('close', (event) => {
        saveWindowState();

        if (allowWindowClose) return;

        event.preventDefault();
        if (closeRequestInFlight) return;

        closeRequestInFlight = true;
        mainWindow.webContents.send('window:request-close');

        clearTimeout(closeRequestTimer);
        closeRequestTimer = setTimeout(() => {
            closeRequestInFlight = false;
            closeRequestTimer = null;
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'PISI kapatılamadı',
                message: 'Bekleyen kayıtların tamamlandığı doğrulanamadı.',
                detail: 'Veri kaybını önlemek için pencere açık bırakıldı.'
            }).catch(() => {});
        }, 30000);
    });

    mainWindow.once('ready-to-show', () => {
        if (savedWindowState.isFullScreen) {
            mainWindow.setFullScreen(true);
        }

        else if (savedWindowState.isMaximized) {
            mainWindow.maximize();
        }

            mainWindow.show();
});
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "startProjectWatcher": {
        enumerable: true,
        get() { return startProjectWatcher; }
    },
    "folderExistsAndIsDirectory": {
        enumerable: true,
        get() { return folderExistsAndIsDirectory; }
    },
    "normalizePathForCompare": {
        enumerable: true,
        get() { return normalizePathForCompare; }
    },
    "isSameOrInsidePath": {
        enumerable: true,
        get() { return isSameOrInsidePath; }
    },
    "assertNoSymbolicLinksBetween": {
        enumerable: true,
        get() { return assertNoSymbolicLinksBetween; }
    },
    "assertProjectPath": {
        enumerable: true,
        get() { return assertProjectPath; }
    },
    "projectOperation": {
        enumerable: true,
        get() { return projectOperation; }
    },
    "asyncProjectOperation": {
        enumerable: true,
        get() { return asyncProjectOperation; }
    },
    "hideFileOnWindows": {
        enumerable: true,
        get() { return hideFileOnWindows; }
    },
    "isProcessAlive": {
        enumerable: true,
        get() { return isProcessAlive; }
    },
    "acquireProjectLock": {
        enumerable: true,
        get() { return acquireProjectLock; }
    },
    "lockProjectFolder": {
        enumerable: true,
        get() { return lockProjectFolder; }
    },
    "unlockProjectFolder": {
        enumerable: true,
        get() { return unlockProjectFolder; }
    },
    "createWindow": {
        enumerable: true,
        get() { return createWindow; }
    }
});
registerMainModule("main.electronIpc", moduleApi);
