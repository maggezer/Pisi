'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');
const backupStorage = require('./backup-storage');
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
            throw new Error('İstenen yol bir klasör olmalı.');
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

function normalizeProjectLockPid(value) {
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProjectLockOwnedByCurrentInstance(lockData) {
    return Boolean(
        lockData &&
        lockData.instanceId === pisiInstanceId &&
        normalizeProjectLockPid(lockData.pid) === process.pid
    );
}

function isProjectLockHeldByAnotherProcess(lockData) {
    const lockPid = normalizeProjectLockPid(lockData?.pid);

    if (!lockPid || lockPid === process.pid) {
        return false;
    }

    return isProcessAlive(lockPid);
}

function removeProjectLockFile(lockPath) {
    markInternalFileChange(lockPath);

    try {
        fs.unlinkSync(lockPath);
    } catch (error) {
        if (!['EACCES', 'EPERM'].includes(error?.code)) {
            throw error;
        }

        fs.chmodSync(lockPath, 0o600);
        fs.unlinkSync(lockPath);
    }

    sealInternalFileChange(lockPath);
}

function inspectProjectFolder(folderPath) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return {
            ok: false,
            code: 'INVALID_PROJECT_FOLDER',
            error: 'Geçerli bir proje klasörü seçilmedi.'
        };
    }

    try {
        const realFolderPath = fs.realpathSync.native(folderPath);
        const stat = fs.statSync(realFolderPath);

        if (!stat.isDirectory()) {
            return {
                ok: false,
                code: 'NOT_A_DIRECTORY',
                error: 'Seçilen yol bir klasör değil.'
            };
        }

        // Kilidi almadan önce kökün gerçekten okunabildiğini doğrula.
        fs.readdirSync(realFolderPath);

        return {
            ok: true,
            folderPath: realFolderPath
        };
    } catch (error) {
        const code = String(error?.code || 'PROJECT_ACCESS_FAILED');
        let message = `Proje klasörü açılamadı: ${error.message}`;

        if (code === 'ENOENT') {
            message = 'Seçilen proje klasörü bulunamadı.';
        } else if (code === 'EACCES' || code === 'EPERM') {
            message = 'PISI bu klasöre erişemiyor. Klasörün okuma ve yazma izinlerini kontrol edin.';
        } else if (code === 'EBUSY') {
            message = 'Proje klasörü başka bir uygulama tarafından kullanılıyor.';
        }

        return {
            ok: false,
            code,
            error: message
        };
    }
}

function migrateLegacyProjectLock(folderPath) {
    const legacyLockPath = path.join(folderPath, '.kedi.lock');
    if (!fs.existsSync(legacyLockPath)) return { ok: true };

    let legacyLock = null;
    try {
        legacyLock = JSON.parse(fs.readFileSync(legacyLockPath, 'utf-8'));
    } catch {}

    if (isProjectLockHeldByAnotherProcess(legacyLock)) {
        return {
            ok: false,
            code: 'LEGACY_PROJECT_IN_USE',
            error: `Bu proje eski uygulamanın çalışan bir süreci tarafından kullanılıyor (PID ${legacyLock.pid}).`
        };
    }

    removeProjectLockFile(legacyLockPath);
    return { ok: true };
}

function acquireProjectLock(folderPath) {
    const lockPath = path.join(folderPath, '.pisi.lock');
    let lockCreated = false;

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

            if (isProjectLockOwnedByCurrentInstance(existingLock)) {
                return {
                    ok: true,
                    lockPath
                };
            }

            if (isProjectLockHeldByAnotherProcess(existingLock)) {
                return {
                    ok: false,
                    code: 'PROJECT_IN_USE',
                    error: `Bu proje başka bir PISI süreci tarafından kullanılıyor (PID ${existingLock.pid}).`
                };
            }

            // Aynı PID farklı instance kimliği taşıyorsa işletim sistemi PID'yi
            // yeniden kullanmıştır. Bu kilit çalışan sürece ait olamaz.
            removeProjectLockFile(lockPath);
        }

        let descriptor = null;

        try {
            markInternalFileChange(lockPath);
            descriptor = fs.openSync(lockPath, 'wx', 0o600);
            lockCreated = true;
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
        } finally {
            if (descriptor !== null) {
                fs.closeSync(descriptor);
            }

            if (lockCreated) {
                sealInternalFileChange(lockPath);
            }
        }

        hideFileOnWindows(lockPath);

        return {
            ok: true,
            lockPath
        };
    } catch (error) {
        if (lockCreated && fs.existsSync(lockPath)) {
            try {
                removeProjectLockFile(lockPath);
            } catch (cleanupError) {
                console.warn(
                    '[PISI] Yarım kalan proje kilidi temizlenemedi:',
                    cleanupError.message
                );
            }
        }

        return {
            ok: false,
            code: String(error?.code || 'PROJECT_LOCK_FAILED'),
            error: `Proje kilidi alınamadı: ${error.message}`
        };
    }
}

function tryLockProjectFolder(folderPath) {
    const inspected = inspectProjectFolder(folderPath);
    if (!inspected.ok) return inspected;

    const realFolderPath = inspected.folderPath;

    try {
        if (
            activeProjectFolder &&
            normalizePathForCompare(activeProjectFolder) ===
                normalizePathForCompare(realFolderPath)
        ) {
            let currentLock = null;

            try {
                currentLock = JSON.parse(
                    fs.readFileSync(activeProjectLockPath, 'utf-8')
                );
            } catch {}

            if (isProjectLockOwnedByCurrentInstance(currentLock)) {
                return {
                    ok: true,
                    folderPath: realFolderPath
                };
            }
        }

        const lockResult = acquireProjectLock(realFolderPath);
        if (!lockResult.ok) {
            console.error('[PISI]', lockResult.error);
            return lockResult;
        }

        const oldProjectFolder = activeProjectFolder;
        const oldLockPath = activeProjectLockPath;

        try {
            activeProjectFolder = realFolderPath;
            activeProjectLockPath = lockResult.lockPath;

            try {
                const backupMigration = backupStorage.migratePisiLegacyBackups(
                    realFolderPath,
                    { rename: renamePathInternal }
                );
                if (backupMigration.warnings.length) {
                    console.warn(
                        '[PISI] Bazı eski yedekler merkezi klasöre taşınamadı:',
                        backupMigration.warnings.join(' | ')
                    );
                }
            } catch (migrationError) {
                console.warn(
                    '[PISI] Eski yedek klasörü geçişi tamamlanamadı:',
                    migrationError.message
                );
            }

            startProjectWatcher(realFolderPath);
        } catch (error) {
            activeProjectFolder = oldProjectFolder;
            activeProjectLockPath = oldLockPath;

            try {
                removeProjectLockFile(lockResult.lockPath);
            } catch {}

            if (oldProjectFolder) {
                try {
                    startProjectWatcher(oldProjectFolder);
                } catch {}
            }

            throw error;
        }

        if (oldLockPath && oldLockPath !== activeProjectLockPath) {
            try {
                const oldLock = JSON.parse(fs.readFileSync(oldLockPath, 'utf-8'));
                if (isProjectLockOwnedByCurrentInstance(oldLock)) {
                    removeProjectLockFile(oldLockPath);
                }
            } catch {}
        }

        console.log('[PISI] Proje klasörü kilitlendi:', realFolderPath);
        return {
            ok: true,
            folderPath: realFolderPath
        };
    } catch (error) {
        console.error('[PISI] Proje klasörü kilitlenemedi:', error);
        return {
            ok: false,
            code: String(error?.code || 'PROJECT_LOCK_FAILED'),
            error: `Proje klasörü kilitlenemedi: ${error.message}`
        };
    }
}

function lockProjectFolder(folderPath) {
    return tryLockProjectFolder(folderPath).ok;
}

function unlockProjectFolder() {
    stopProjectWatcher();

    if (activeProjectLockPath && fs.existsSync(activeProjectLockPath)) {
        try {
            const lockData = JSON.parse(
                fs.readFileSync(activeProjectLockPath, 'utf-8')
            );

            if (isProjectLockOwnedByCurrentInstance(lockData)) {
                removeProjectLockFile(activeProjectLockPath);
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

    // Keep the Windows taskbar/window icon explicitly synchronized with the packaged app icon.
    if (process.platform === 'win32') {
        mainWindow.setIcon(appIconPath);
    }

    if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
        const key = String(input.key || '').toLowerCase();

        const isDevToolsShortcut =
            input.type === 'keyDown' &&
            (
                key === 'f12' ||
                (input.control && input.shift && key === 'i')
            );

        if (!isDevToolsShortcut) return;

        event.preventDefault();
        mainWindow.webContents.toggleDevTools();
    });
}

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
                title: translatePisiMain('PISI kapatılamadı'),
                message: translatePisiMain('Bekleyen kayıtların tamamlandığı doğrulanamadı.'),
                detail: translatePisiMain('Veri kaybını önlemek için pencere açık bırakıldı.')
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
    "tryLockProjectFolder": {
        enumerable: true,
        get() { return tryLockProjectFolder; }
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
