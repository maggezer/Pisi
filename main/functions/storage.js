'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./storage-core');

const pisiProjectStorageCache = new Map();

function canonicalizePisiStorageRoot(projectFolder) {
    const resolved = path.resolve(String(projectFolder || ''));
    if (!resolved || !fs.existsSync(resolved)) {
        throw new Error('Storage proje kökü bulunamadı.');
    }
    const real = fs.realpathSync.native(resolved);
    if (!fs.statSync(real).isDirectory()) {
        throw new Error('Storage proje kökü bir klasör olmalı.');
    }
    return real;
}

function assertPisiStoragePathSafe(projectRoot, targetPath, options = {}) {
    const root = path.resolve(projectRoot);
    const target = path.resolve(targetPath);
    if (!core.isSameOrInsidePisiStoragePath(target, root)) {
        throw new Error('Storage yolu proje kökünün dışına çıkıyor.');
    }

    const relative = path.relative(root, target);
    if (relative && relative !== '.') {
        let current = root;
        for (const segment of relative.split(path.sep)) {
            current = path.join(current, segment);
            if (!fs.existsSync(current)) break;
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) {
                throw new Error('Storage yolu symlink/junction üzerinden kullanılamaz.');
            }
        }
    }

    if (fs.existsSync(target)) {
        const realTarget = fs.realpathSync.native(target);
        if (!core.isSameOrInsidePisiStoragePath(realTarget, root)) {
            throw new Error('Storage yolu gerçek dosya sisteminde proje dışına çıkıyor.');
        }
    } else if (options.mustExist === true) {
        throw new Error('Storage yolu bulunamadı.');
    }
    return target;
}

function writePisiStorageFileFallback(filePath, content) {
    const directory = path.dirname(filePath);
    const temporary = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    let descriptor = null;
    try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, content, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        fs.renameSync(temporary, filePath);
    } finally {
        if (descriptor !== null) {
            try { fs.closeSync(descriptor); } catch {}
        }
        if (fs.existsSync(temporary)) {
            try { fs.unlinkSync(temporary); } catch {}
        }
    }
}

function createPisiFileStorageDriver(projectFolder) {
    const projectRoot = canonicalizePisiStorageRoot(projectFolder);

    return Object.freeze({
        projectRoot,

        exists(targetPath) {
            assertPisiStoragePathSafe(projectRoot, targetPath);
            return fs.existsSync(targetPath);
        },

        mkdir(targetPath, options = {}) {
            assertPisiStoragePathSafe(projectRoot, targetPath);
            fs.mkdirSync(targetPath, { recursive: options.recursive !== false });
            if (options.hidden === true) {
                try { globalThis.hideFileOnWindows?.(targetPath); } catch {}
            }
        },

        readText(targetPath) {
            assertPisiStoragePathSafe(projectRoot, targetPath, { mustExist: true });
            return fs.readFileSync(targetPath, 'utf8');
        },

        writeText(targetPath, content, options = {}) {
            assertPisiStoragePathSafe(projectRoot, targetPath);
            const atomicWriter = globalThis.writeFileAtomic;
            if (typeof atomicWriter === 'function') {
                atomicWriter(targetPath, content, {
                    backup: options.backup !== false
                });
                return;
            }
            writePisiStorageFileFallback(targetPath, content);
        },

        list(targetPath) {
            assertPisiStoragePathSafe(projectRoot, targetPath, { mustExist: true });
            return fs.readdirSync(targetPath, { withFileTypes: true }).map((entry) => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink?.() === true
            }));
        },

        stat(targetPath) {
            assertPisiStoragePathSafe(projectRoot, targetPath, { mustExist: true });
            return fs.statSync(targetPath);
        },

        rename(sourcePath, destinationPath) {
            assertPisiStoragePathSafe(projectRoot, sourcePath, { mustExist: true });
            assertPisiStoragePathSafe(projectRoot, destinationPath);
            if (typeof globalThis.renamePathInternal === 'function') {
                globalThis.renamePathInternal(sourcePath, destinationPath);
            } else {
                fs.renameSync(sourcePath, destinationPath);
            }
        },

        remove(targetPath, options = {}) {
            assertPisiStoragePathSafe(projectRoot, targetPath);
            if (!fs.existsSync(targetPath)) return;
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                fs.rmSync(targetPath, {
                    recursive: options.recursive === true,
                    force: options.force === true
                });
            } else {
                fs.unlinkSync(targetPath);
            }
        }
    });
}

function getPisiProjectStorage(projectFolder) {
    const root = canonicalizePisiStorageRoot(projectFolder);
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    let storage = pisiProjectStorageCache.get(key);
    if (!storage) {
        const driver = createPisiFileStorageDriver(root);
        storage = core.createPisiProjectStorage(root, driver);
        pisiProjectStorageCache.set(key, storage);
    }
    return storage;
}

function clearPisiProjectStorageCache(projectFolder = null) {
    if (!projectFolder) {
        pisiProjectStorageCache.clear();
        return;
    }
    const root = canonicalizePisiStorageRoot(projectFolder);
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    pisiProjectStorageCache.delete(key);
}

module.exports = {
    ...core,
    canonicalizePisiStorageRoot,
    assertPisiStoragePathSafe,
    createPisiFileStorageDriver,
    getPisiProjectStorage,
    clearPisiProjectStorageCache
};
