'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');

const pisiTestUserDataPath = String(process.env.PISI_TEST_USER_DATA || '').trim();

if (!app.isPackaged && pisiTestUserDataPath) {
    const resolvedUserDataPath = path.resolve(pisiTestUserDataPath);
    const resolvedSessionDataPath = path.join(resolvedUserDataPath, 'session');

    fs.mkdirSync(resolvedUserDataPath, { recursive: true });
    fs.mkdirSync(resolvedSessionDataPath, { recursive: true });

    app.setPath('userData', resolvedUserDataPath);
    app.setPath('sessionData', resolvedSessionDataPath);
}

const PISI_WINDOWS_RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const PISI_WINDOWS_RENAME_MAX_ATTEMPTS = 8;
const PISI_WINDOWS_RENAME_RETRY_DELAY_MS = 35;
const PISI_INTERNAL_DIRECTORY_GRACE_MS = 1200;
const recentInternalDirectoryChanges = new Map();

function markInternalDirectoryChange(filePath) {
    if (!filePath) return;

    const directoryPath = normalizePathForCompare(path.dirname(path.resolve(filePath)));
    if (!directoryPath) return;

    recentInternalDirectoryChanges.set(directoryPath, Date.now() + PISI_INTERNAL_DIRECTORY_GRACE_MS);
}

function hasRecentInternalDirectoryChange(directoryPath) {
    const normalizedDirectory = normalizePathForCompare(directoryPath);
    if (!normalizedDirectory) return false;

    const now = Date.now();
    for (const [key, expiresAt] of recentInternalDirectoryChanges) {
        if (expiresAt <= now) {
            recentInternalDirectoryChanges.delete(key);
        }
    }

    return (recentInternalDirectoryChanges.get(normalizedDirectory) || 0) > now;
}

function getInternalFileChangeSignature(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return [stats.isDirectory() ? 'directory' : 'file', stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
    } catch (error) {
        return error?.code === 'ENOENT' ? 'missing' : null;
    }
}

function pruneExpiredInternalFileChanges(now = Date.now()) {
    for (const [key, entry] of recentInternalFileChanges) {
        if (!entry || entry.expiresAt <= now) {
            recentInternalFileChanges.delete(key);
        }
    }
}

function markInternalFileChange(...filePaths) {
    const expiresAt = Date.now() + PISI_INTERNAL_CHANGE_TTL_MS;

    for (const filePath of filePaths) {
        if (!filePath) continue;
        const normalizedPath = normalizePathForCompare(filePath);
        if (!normalizedPath) continue;
        recentInternalFileChanges.set(normalizedPath, {
            expiresAt,
            signature: null
        });
        markInternalDirectoryChange(filePath);
    }
}

function sealInternalFileChange(...filePaths) {
    const expiresAt = Date.now() + PISI_INTERNAL_CHANGE_TTL_MS;

    for (const filePath of filePaths) {
        if (!filePath) continue;
        const normalizedPath = normalizePathForCompare(filePath);
        if (!normalizedPath) continue;
        recentInternalFileChanges.set(normalizedPath, {
            expiresAt,
            signature: getInternalFileChangeSignature(filePath)
        });
        markInternalDirectoryChange(filePath);
    }
}

function isRecentInternalFileChange(filePath) {
    const now = Date.now();
    const normalizedPath = normalizePathForCompare(filePath);
    pruneExpiredInternalFileChanges(now);

    if (!normalizedPath) return false;

    const entry = recentInternalFileChanges.get(normalizedPath);
    if (!entry) return false;

    if (entry.signature === null) {
        return true;
    }

    const currentSignature = getInternalFileChangeSignature(filePath);
    if (currentSignature === entry.signature) {
        return true;
    }

    recentInternalFileChanges.delete(normalizedPath);
    return false;
}

function hasRecentInternalFileChangeInside(directoryPath) {
    const now = Date.now();
    const normalizedDirectory = normalizePathForCompare(directoryPath);
    pruneExpiredInternalFileChanges(now);

    if (!normalizedDirectory) return false;

    for (const [changedPath, entry] of recentInternalFileChanges) {
        if (!entry || !isSameOrInsidePath(changedPath, normalizedDirectory)) {
            continue;
        }

        if (entry.signature === null) {
            return true;
        }

        if (getInternalFileChangeSignature(changedPath) === entry.signature) {
            return true;
        }

        recentInternalFileChanges.delete(changedPath);
    }

    return false;
}

function waitForPisiWindowsRenameRetry(delayMs) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) return;

    try {
        const state = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(state, 0, 0, delayMs);
    } catch {
        const deadline = Date.now() + delayMs;
        while (Date.now() < deadline) {
            // Çok eski runtimelarda Atomics.wait kullanılamazsa kısa fallback.
        }
    }
}

function relaxPisiWindowsRenamePermissions(filePath) {
    if (process.platform !== 'win32' || !filePath || !fs.existsSync(filePath)) {
        return;
    }

    try {
        const stats = fs.statSync(filePath);
        fs.chmodSync(filePath, stats.isDirectory() ? 0o777 : 0o666);
    } catch {
        // Salt-okunur flag kaldırma best-effort; retry yine denenir.
    }
}

function renamePathInternal(oldPath, newPath) {
    markInternalFileChange(oldPath, newPath);

    const maxAttempts = process.platform === 'win32' ? PISI_WINDOWS_RENAME_MAX_ATTEMPTS : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            fs.renameSync(oldPath, newPath);
            sealInternalFileChange(oldPath, newPath);
            return;
        } catch (error) {
            lastError = error;

            const sourceExists = fs.existsSync(oldPath);
            const destinationExists = fs.existsSync(newPath);

            // Windows/AV yarışında syscall hata döndürse bile istenen durum
            // oluşmuş olabilir. Böyle bir durumda sahte hata göstermeyelim.
            if (!sourceExists && destinationExists) {
                sealInternalFileChange(oldPath, newPath);
                return;
            }

            const retryable = process.platform === 'win32' && PISI_WINDOWS_RENAME_RETRY_CODES.has(error?.code) && attempt + 1 < maxAttempts;

            if (!retryable) {
                sealInternalFileChange(oldPath, newPath);
                throw error;
            }

            relaxPisiWindowsRenamePermissions(oldPath);
            waitForPisiWindowsRenameRetry(PISI_WINDOWS_RENAME_RETRY_DELAY_MS * (attempt + 1));
        }
    }

    sealInternalFileChange(oldPath, newPath);
    throw lastError || new Error('Yeniden adlandırma tamamlanamadı.');
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'pisi-settings.json');
}

function readSettings() {
    const settingsPath = getSettingsPath();

    try {
        if (!fs.existsSync(settingsPath)) {
            return {};
        }

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw || '{}');
    } catch (error) {
        console.error('[PISI] Settings okunamadı:', error);
        return {};
    }
}

function writeSettings(settings) {
    const settingsPath = getSettingsPath();

    try {
        writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2), { backup: false });
    } catch (error) {
        console.error('[PISI] Settings yazılamadı:', error);
    }
}

function getDefaultWindowState() {
    return {
        width: 1400,
        height: 900,
        x: undefined,
        y: undefined,
        isMaximized: false,
        isFullScreen: false
    };
}

function getSavedWindowState() {
    const settings = readSettings();
    const saved = settings.windowState || {};
    const defaults = getDefaultWindowState();

    const width = Number(saved.width || defaults.width);
    const height = Number(saved.height || defaults.height);

    const state = {
        width: Number.isFinite(width) ? width : defaults.width,
        height: Number.isFinite(height) ? height : defaults.height,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : undefined,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : undefined,
        isMaximized: Boolean(saved.isMaximized),
        isFullScreen: Boolean(saved.isFullScreen)
    };

    return keepWindowStateInsideDisplay(state);
}

function keepWindowStateInsideDisplay(state) {
    const fallback = getDefaultWindowState();

    const width = Math.max(900, Number(state.width || fallback.width));
    const height = Math.max(600, Number(state.height || fallback.height));

    let x = state.x;
    let y = state.y;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
            ...state,
            width,
            height,
            x: undefined,
            y: undefined
        };
    }

    const displays = screen.getAllDisplays();
    const visibleOnSomeDisplay = displays.some((display) => {
        const area = display.workArea;

        return x < area.x + area.width && x + width > area.x && y < area.y + area.height && y + height > area.y;
    });

    if (!visibleOnSomeDisplay) {
        const primaryArea = screen.getPrimaryDisplay().workArea;

        x = Math.round(primaryArea.x + (primaryArea.width - width) / 2);
        y = Math.round(primaryArea.y + (primaryArea.height - height) / 2);
    }

    return {
        ...state,
        width,
        height,
        x,
        y
    };
}

function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const settings = readSettings();
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();

    const previousState = settings.windowState || {};
    const bounds =
        !isMaximized && !isFullScreen
            ? mainWindow.getBounds()
            : {
                  x: previousState.x,
                  y: previousState.y,
                  width: previousState.width,
                  height: previousState.height
              };

    settings.windowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width || 1400,
        height: bounds.height || 900,
        isMaximized,
        isFullScreen
    };

    writeSettings(settings);
}

function scheduleWindowStateSave() {
    if (scheduleWindowStateSave.timer) {
        clearTimeout(scheduleWindowStateSave.timer);
    }

    scheduleWindowStateSave.timer = setTimeout(() => {
        scheduleWindowStateSave.timer = null;
        saveWindowState();
    }, 350);
}

function isPisiVisibleFile(fileName) {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.map') || lower.endsWith('.node');
}

function isPisiManagedSidecarFolder(folderName) {
    if (!folderName) return false;

    return folderName === '.pisi.lock' || /^(?:inv|nd)_.+__(?:node|map)_[A-Za-z0-9_-]{1,96}$/.test(folderName);
}

function getPisiFileExt(fileNameOrPath) {
    const lower = fileNameOrPath.toLowerCase();

    if (lower.endsWith('.node')) return '.node';
    if (lower.endsWith('.map')) return '.map';

    return '';
}

function getPisiTypeFromExt(ext) {
    if (ext === '.node') return 'node';
    if (ext === '.map') return 'map';
    return '';
}

function getPisiSidecarPrefix(ext) {
    if (ext === '.node') return 'inv_';
    if (ext === '.map') return 'nd_';
    return '';
}

function sanitizePisiBaseName(name) {
    let cleaned = String(name || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .slice(0, 120);

    const windowsStem = cleaned.split('.')[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)) {
        cleaned = `_${cleaned}`;
    }

    return cleaned || 'Yeni Dosya';
}

function stripPisiIdSuffix(baseName, id) {
    if (!baseName || !id) return baseName;

    const suffix = `__${id}`;

    if (baseName.endsWith(suffix)) {
        return baseName.slice(0, -suffix.length);
    }

    return baseName;
}

function getVisibleTitleFromFilePath(filePath, ext, id = '') {
    const rawBaseName = path.basename(filePath, ext);
    return sanitizePisiBaseName(stripPisiIdSuffix(rawBaseName, id));
}

function getUniquePisiPhysicalPath(dir, wantedTitle, ext, id, currentPath = null) {
    const cleanTitle = sanitizePisiBaseName(wantedTitle);

    const plainPath = path.join(dir, cleanTitle + ext);

    if (!fs.existsSync(plainPath) || (currentPath && normalizePathForCompare(plainPath) === normalizePathForCompare(currentPath))) {
        return plainPath;
    }

    const hybridPath = path.join(dir, `${cleanTitle}__${id}${ext}`);

    if (!fs.existsSync(hybridPath) || (currentPath && normalizePathForCompare(hybridPath) === normalizePathForCompare(currentPath))) {
        return hybridPath;
    }

    let counter = 1;

    while (true) {
        const fallbackPath = path.join(dir, `${cleanTitle}__${id}_${counter}${ext}`);

        if (!fs.existsSync(fallbackPath) || (currentPath && normalizePathForCompare(fallbackPath) === normalizePathForCompare(currentPath))) {
            return fallbackPath;
        }

        counter++;
    }
}

function sanitizeForSidecarName(name) {
    return sanitizePisiBaseName(name).replace(/\s+/g, ' ').slice(0, 80);
}

function generatePisiId(ext) {
    const prefix = ext === '.map' ? 'map' : 'node';
    return `${prefix}_${crypto.randomUUID()}`;
}

function normalizePisiId(value, ext = '') {
    const id = String(value || '').trim();
    const expectedPrefix = ext === '.map' ? 'map_' : ext === '.node' ? 'node_' : '';

    if (!id || id.length > 101 || !/^(?:map|node)_[A-Za-z0-9_-]+$/.test(id) || (expectedPrefix && !id.startsWith(expectedPrefix))) {
        return null;
    }

    return id;
}

function getDefaultNodeConnectionTypes() {
    return {
        'up-hub': [],
        'down-hub': [],
        'co-level': [],
        upstream: [],
        downstream: []
    };
}

function normalizeNodeConnectionTypes(value) {
    const defaults = getDefaultNodeConnectionTypes();

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaults;
    }

    return {
        'up-hub': Array.isArray(value['up-hub']) ? value['up-hub'] : [],
        'down-hub': Array.isArray(value['down-hub']) ? value['down-hub'] : [],
        'co-level': Array.isArray(value['co-level']) ? value['co-level'] : [],
        upstream: Array.isArray(value['upstream']) ? value['upstream'] : [],
        downstream: Array.isArray(value['downstream']) ? value['downstream'] : []
    };
}

function normalizeConnectionRole(role) {
    const value = String(role || '').trim();

    if (PISI_CONNECTION_KEYS.includes(value)) {
        return value;
    }

    return null;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getInternalFileChangeSignature: {
        enumerable: true,
        get() {
            return getInternalFileChangeSignature;
        }
    },
    pruneExpiredInternalFileChanges: {
        enumerable: true,
        get() {
            return pruneExpiredInternalFileChanges;
        }
    },
    markInternalFileChange: {
        enumerable: true,
        get() {
            return markInternalFileChange;
        }
    },
    sealInternalFileChange: {
        enumerable: true,
        get() {
            return sealInternalFileChange;
        }
    },
    isRecentInternalFileChange: {
        enumerable: true,
        get() {
            return isRecentInternalFileChange;
        }
    },
    hasRecentInternalFileChangeInside: {
        enumerable: true,
        get() {
            return hasRecentInternalFileChangeInside;
        }
    },
    hasRecentInternalDirectoryChange: {
        enumerable: true,
        get() {
            return hasRecentInternalDirectoryChange;
        }
    },
    renamePathInternal: {
        enumerable: true,
        get() {
            return renamePathInternal;
        }
    },
    getSettingsPath: {
        enumerable: true,
        get() {
            return getSettingsPath;
        }
    },
    readSettings: {
        enumerable: true,
        get() {
            return readSettings;
        }
    },
    writeSettings: {
        enumerable: true,
        get() {
            return writeSettings;
        }
    },
    getDefaultWindowState: {
        enumerable: true,
        get() {
            return getDefaultWindowState;
        }
    },
    getSavedWindowState: {
        enumerable: true,
        get() {
            return getSavedWindowState;
        }
    },
    keepWindowStateInsideDisplay: {
        enumerable: true,
        get() {
            return keepWindowStateInsideDisplay;
        }
    },
    saveWindowState: {
        enumerable: true,
        get() {
            return saveWindowState;
        }
    },
    scheduleWindowStateSave: {
        enumerable: true,
        get() {
            return scheduleWindowStateSave;
        }
    },
    isPisiVisibleFile: {
        enumerable: true,
        get() {
            return isPisiVisibleFile;
        }
    },
    isPisiManagedSidecarFolder: {
        enumerable: true,
        get() {
            return isPisiManagedSidecarFolder;
        }
    },
    getPisiFileExt: {
        enumerable: true,
        get() {
            return getPisiFileExt;
        }
    },
    getPisiTypeFromExt: {
        enumerable: true,
        get() {
            return getPisiTypeFromExt;
        }
    },
    getPisiSidecarPrefix: {
        enumerable: true,
        get() {
            return getPisiSidecarPrefix;
        }
    },
    sanitizePisiBaseName: {
        enumerable: true,
        get() {
            return sanitizePisiBaseName;
        }
    },
    stripPisiIdSuffix: {
        enumerable: true,
        get() {
            return stripPisiIdSuffix;
        }
    },
    getVisibleTitleFromFilePath: {
        enumerable: true,
        get() {
            return getVisibleTitleFromFilePath;
        }
    },
    getUniquePisiPhysicalPath: {
        enumerable: true,
        get() {
            return getUniquePisiPhysicalPath;
        }
    },
    sanitizeForSidecarName: {
        enumerable: true,
        get() {
            return sanitizeForSidecarName;
        }
    },
    generatePisiId: {
        enumerable: true,
        get() {
            return generatePisiId;
        }
    },
    normalizePisiId: {
        enumerable: true,
        get() {
            return normalizePisiId;
        }
    },
    getDefaultNodeConnectionTypes: {
        enumerable: true,
        get() {
            return getDefaultNodeConnectionTypes;
        }
    },
    normalizeNodeConnectionTypes: {
        enumerable: true,
        get() {
            return normalizeNodeConnectionTypes;
        }
    },
    normalizeConnectionRole: {
        enumerable: true,
        get() {
            return normalizeConnectionRole;
        }
    }
});
registerMainModule('main.pathSecurity', moduleApi);
