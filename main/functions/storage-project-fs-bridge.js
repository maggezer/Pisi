import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as storageLayer from './storage.js';

const PISI_STORAGE_FS_BRIDGE_VERSION = 1;
const PISI_STORAGE_FS_BRIDGE_SYMBOL = Symbol.for('pisi.storage.project-fs-bridge');
const pisiStorageBridgeContext = new AsyncLocalStorage();

const bridgeStats = Object.seal({
    exists: 0,
    read: 0,
    list: 0,
    stat: 0,
    mkdir: 0,
    rename: 0,
    remove: 0
});

function getPisiStorageBridgeProjectRoot() {
    const contextual = pisiStorageBridgeContext.getStore()?.projectRoot;
    if (contextual) return contextual;
    const active = globalThis.activeProjectFolder;
    return active ? path.resolve(String(active)) : null;
}

function runPisiStorageBridgeForProject(projectRoot, operation) {
    if (typeof operation !== 'function') {
        throw new TypeError('Storage bridge operation fonksiyon olmalı.');
    }
    const root = path.resolve(String(projectRoot || ''));
    if (!root) throw new Error('Storage bridge proje kökü gerekli.');
    return pisiStorageBridgeContext.run({ projectRoot: root }, operation);
}

function isPisiStorageBridgeInfrastructurePath(projectRoot, targetPath) {
    const relative = path.relative(projectRoot, targetPath);
    if (!relative || relative === '.') return false;
    const normalized = relative.split(path.sep).join('/');
    return (
        normalized === '.pisi.lock' ||
        normalized === '.git' ||
        normalized.startsWith('.git/') ||
        normalized === 'node_modules' ||
        normalized.startsWith('node_modules/') ||
        normalized === '.pisi/mutations' ||
        normalized.startsWith('.pisi/mutations/')
    );
}

function resolvePisiStorageBridgeTarget(targetPath) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return null;
    if (storageLayer.isPisiStorageDriverIoActive()) return null;

    const projectRoot = getPisiStorageBridgeProjectRoot();
    if (!projectRoot) return null;

    const resolved = path.resolve(targetPath);
    if (!storageLayer.isSameOrInsidePisiStoragePath(resolved, projectRoot)) {
        return null;
    }
    if (isPisiStorageBridgeInfrastructurePath(projectRoot, resolved)) {
        return null;
    }

    const storage = storageLayer.getPisiProjectStorage(projectRoot);
    return {
        projectRoot,
        storage,
        key: storage.keyForPath(resolved),
        path: resolved
    };
}

function makePisiStorageBridgeError(result, fallbackCode) {
    const error = new Error(result?.error || 'Project storage işlemi başarısız.');
    error.code = result?.code || fallbackCode || 'PISI_STORAGE_BRIDGE_FAILED';
    return error;
}

function normalizeReadEncoding(options) {
    if (typeof options === 'string') return options.toLowerCase();
    if (options && typeof options === 'object' && options.encoding) {
        return String(options.encoding).toLowerCase();
    }
    return null;
}

function makePisiStorageDirent(entry) {
    return Object.freeze({
        name: entry.name,
        parentPath: path.dirname(entry.path),
        path: path.dirname(entry.path),
        isFile: () => entry.isFile === true,
        isDirectory: () => entry.isDirectory === true,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => entry.isSymbolicLink === true,
        isFIFO: () => false,
        isSocket: () => false
    });
}

function getPisiStorageFsBridgeStats() {
    return { ...bridgeStats };
}

function resetPisiStorageFsBridgeStats() {
    for (const key of Object.keys(bridgeStats)) bridgeStats[key] = 0;
}

function installPisiStorageProjectFsBridge() {
    if (fs[PISI_STORAGE_FS_BRIDGE_SYMBOL]) {
        return fs[PISI_STORAGE_FS_BRIDGE_SYMBOL];
    }

    const original = {
        existsSync: fs.existsSync.bind(fs),
        readFileSync: fs.readFileSync.bind(fs),
        readdirSync: fs.readdirSync.bind(fs),
        statSync: fs.statSync.bind(fs),
        mkdirSync: fs.mkdirSync.bind(fs),
        renameSync: fs.renameSync.bind(fs),
        unlinkSync: fs.unlinkSync.bind(fs),
        rmSync: fs.rmSync.bind(fs)
    };

    fs.existsSync = function pisiStorageExistsSync(targetPath) {
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.existsSync(targetPath);
        try {
            bridgeStats.exists += 1;
            return target.storage.exists(target.key);
        } catch {
            return false;
        }
    };

    fs.readFileSync = function pisiStorageReadFileSync(targetPath, options) {
        const encoding = normalizeReadEncoding(options);
        if (!['utf8', 'utf-8'].includes(encoding || '')) {
            return original.readFileSync(targetPath, options);
        }
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.readFileSync(targetPath, options);
        bridgeStats.read += 1;
        const result = target.storage.readText(target.key);
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_READ_FAILED');
        return result.text;
    };

    fs.readdirSync = function pisiStorageReaddirSync(targetPath, options) {
        const encoding = typeof options === 'string' ? options : options?.encoding;
        if (String(encoding || 'utf8').toLowerCase() === 'buffer') {
            return original.readdirSync(targetPath, options);
        }
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.readdirSync(targetPath, options);
        bridgeStats.list += 1;
        const result = target.storage.list(target.key);
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_LIST_FAILED');
        if (options && typeof options === 'object' && options.withFileTypes === true) {
            return result.entries.map(makePisiStorageDirent);
        }
        return result.entries.map((entry) => entry.name);
    };

    // @ts-ignore Pisi intentionally patches Node's fs compatibility bridge at runtime.
    fs.statSync = function pisiStorageStatSync(targetPath, options) {
        if (options && typeof options === 'object' && options.bigint === true) {
            return original.statSync(targetPath, options);
        }
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.statSync(targetPath, options);
        bridgeStats.stat += 1;
        const result = target.storage.stat(target.key);
        if (!result.ok) {
            if (options?.throwIfNoEntry === false && result.code === 'STORAGE_STAT_FAILED') {
                return undefined;
            }
            throw makePisiStorageBridgeError(result, 'STORAGE_STAT_FAILED');
        }
        return result.stat;
    };

    fs.mkdirSync = function pisiStorageMkdirSync(targetPath, options) {
        const recursive = options && typeof options === 'object' ? options.recursive === true : false;
        if (!recursive) return original.mkdirSync(targetPath, options);
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.mkdirSync(targetPath, options);
        bridgeStats.mkdir += 1;
        const result = target.storage.ensureDirectory(target.key);
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_MKDIR_FAILED');
        return result.path;
    };

    fs.renameSync = function pisiStorageRenameSync(sourcePath, destinationPath) {
        const source = resolvePisiStorageBridgeTarget(sourcePath);
        const destination = resolvePisiStorageBridgeTarget(destinationPath);
        if (!source || !destination || source.projectRoot !== destination.projectRoot) {
            return original.renameSync(sourcePath, destinationPath);
        }
        bridgeStats.rename += 1;
        const result = source.storage.rename(source.key, destination.key);
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_RENAME_FAILED');
    };

    fs.unlinkSync = function pisiStorageUnlinkSync(targetPath) {
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.unlinkSync(targetPath);
        bridgeStats.remove += 1;
        const result = target.storage.remove(target.key, { force: false });
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_REMOVE_FAILED');
    };

    fs.rmSync = function pisiStorageRmSync(targetPath, options = {}) {
        const target = resolvePisiStorageBridgeTarget(targetPath);
        if (!target) return original.rmSync(targetPath, options);
        bridgeStats.remove += 1;
        const result = target.storage.remove(target.key, {
            recursive: options?.recursive === true,
            force: options?.force === true
        });
        if (!result.ok) throw makePisiStorageBridgeError(result, 'STORAGE_REMOVE_FAILED');
    };

    const api = Object.freeze({
        version: PISI_STORAGE_FS_BRIDGE_VERSION,
        original,
        runForProject: runPisiStorageBridgeForProject,
        getStats: getPisiStorageFsBridgeStats,
        resetStats: resetPisiStorageFsBridgeStats
    });

    Object.defineProperty(fs, PISI_STORAGE_FS_BRIDGE_SYMBOL, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: api
    });
    return api;
}

const installedBridge = installPisiStorageProjectFsBridge();

export {
PISI_STORAGE_FS_BRIDGE_VERSION,
    getPisiStorageBridgeProjectRoot,
    runPisiStorageBridgeForProject,
    isPisiStorageBridgeInfrastructurePath,
    resolvePisiStorageBridgeTarget,
    getPisiStorageFsBridgeStats,
    resetPisiStorageFsBridgeStats,
    installPisiStorageProjectFsBridge,
    installedBridge
};
