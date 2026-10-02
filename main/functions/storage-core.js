import * as path from 'node:path';

const PISI_STORAGE_CONTRACT_VERSION = 1;
const PISI_STORAGE_DRIVER_METHODS = Object.freeze(['exists', 'mkdir', 'readText', 'writeText', 'list', 'stat', 'rename', 'remove']);

function normalizePisiStorageKey(input = '.') {
    let raw = String(input ?? '')
        .trim()
        .replace(/\\/g, '/');
    if (!raw || raw === '.') return '.';
    if (/^[A-Za-z]:/.test(raw) || raw.startsWith('/')) {
        throw new Error('Storage anahtarı mutlak yol olamaz.');
    }
    raw = raw.replace(/^\.\/+/, '');
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        throw new Error('Storage anahtarı proje kökünün dışına çıkamaz.');
    }
    return normalized === '.' ? '.' : normalized;
}

function isSameOrInsidePisiStoragePath(candidatePath, rootPath) {
    const candidate = path.resolve(String(candidatePath || ''));
    const root = path.resolve(String(rootPath || ''));
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolvePisiStoragePath(projectRoot, key = '.') {
    const root = path.resolve(String(projectRoot || ''));
    if (!root) throw new Error('Storage için proje kökü gerekli.');
    const normalized = normalizePisiStorageKey(key);
    const target = normalized === '.' ? root : path.resolve(root, ...normalized.split('/'));
    if (!isSameOrInsidePisiStoragePath(target, root)) {
        throw new Error('Storage yolu proje kökünün dışına çıkamaz.');
    }
    return target;
}

function getPisiStorageKeyForPath(projectRoot, targetPath) {
    const root = path.resolve(String(projectRoot || ''));
    const target = path.resolve(String(targetPath || ''));
    if (!isSameOrInsidePisiStoragePath(target, root)) {
        throw new Error('Dosya proje storage kökünün dışında.');
    }
    const relative = path.relative(root, target);
    return relative ? normalizePisiStorageKey(relative.split(path.sep).join('/')) : '.';
}

function assertPisiStorageDriver(driver) {
    if (!driver || typeof driver !== 'object') {
        throw new TypeError('Storage driver nesnesi gerekli.');
    }
    for (const method of PISI_STORAGE_DRIVER_METHODS) {
        if (typeof driver[method] !== 'function') {
            throw new TypeError(`Storage driver metodu eksik: ${method}`);
        }
    }
    return driver;
}

function storageFailure(error, code, extra = {}) {
    return {
        ok: false,
        code,
        error: error?.message || String(error || 'Storage işlemi başarısız.'),
        ...extra
    };
}

function normalizeStorageExtensions(extensions) {
    if (!Array.isArray(extensions) || !extensions.length) return null;
    return new Set(
        extensions
            .map((value) => {
                const raw = String(value || '')
                    .trim()
                    .toLowerCase();
                if (!raw) return '';
                return raw.startsWith('.') ? raw : `.${raw}`;
            })
            .filter(Boolean)
    );
}

function createPisiProjectStorage(projectRoot, driver) {
    const root = path.resolve(String(projectRoot || ''));
    const safeDriver = assertPisiStorageDriver(driver);

    const resolvePath = (key = '.') => resolvePisiStoragePath(root, key);
    const keyForPath = (targetPath) => getPisiStorageKeyForPath(root, targetPath);

    function exists(key = '.') {
        return safeDriver.exists(resolvePath(key));
    }

    function ensureDirectory(key = '.', options = {}) {
        const normalized = normalizePisiStorageKey(key);
        const targetPath = resolvePath(normalized);
        try {
            safeDriver.mkdir(targetPath, {
                recursive: true,
                hidden: options.hidden === true
            });
            return { ok: true, key: normalized, path: targetPath };
        } catch (error) {
            return storageFailure(error, 'STORAGE_MKDIR_FAILED', {
                key: normalized,
                path: targetPath
            });
        }
    }

    function readText(key, options = {}) {
        const normalized = normalizePisiStorageKey(key);
        const targetPath = resolvePath(normalized);
        try {
            if (!safeDriver.exists(targetPath)) {
                if (options.allowMissing === true) {
                    return {
                        ok: true,
                        missing: true,
                        key: normalized,
                        path: targetPath,
                        text: null
                    };
                }
                return {
                    ok: false,
                    missing: true,
                    code: 'STORAGE_NOT_FOUND',
                    error: 'Storage kaydı bulunamadı.',
                    key: normalized,
                    path: targetPath
                };
            }
            return {
                ok: true,
                missing: false,
                key: normalized,
                path: targetPath,
                text: safeDriver.readText(targetPath, options)
            };
        } catch (error) {
            return storageFailure(error, 'STORAGE_READ_FAILED', {
                key: normalized,
                path: targetPath
            });
        }
    }

    function readJson(key, options = {}) {
        /** @type {any} */
        const read = readText(key, options);
        if (!read.ok || read.missing) {
            return {
                ...read,
                data: read.missing ? null : undefined
            };
        }
        try {
            return {
                ...read,
                data: JSON.parse(read.text)
            };
        } catch (error) {
            return storageFailure(error, 'STORAGE_JSON_INVALID', {
                key: read.key,
                path: read.path,
                text: read.text,
                data: null
            });
        }
    }

    function writeText(key, content, options = {}) {
        const normalized = normalizePisiStorageKey(key);
        const targetPath = resolvePath(normalized);
        const parentKey = normalizePisiStorageKey(path.posix.dirname(normalized));
        const ensured = ensureDirectory(parentKey, {
            hidden: options.hiddenParent === true
        });
        if (!ensured.ok) return ensured;
        try {
            safeDriver.writeText(targetPath, String(content ?? ''), options);
            return {
                ok: true,
                key: normalized,
                path: targetPath,
                bytes: Buffer.byteLength(String(content ?? ''), 'utf8')
            };
        } catch (error) {
            return storageFailure(error, 'STORAGE_WRITE_FAILED', {
                key: normalized,
                path: targetPath
            });
        }
    }

    function writeJson(key, value, options = {}) {
        const spacing = Number.isInteger(options.space) ? Math.max(0, Math.min(8, options.space)) : 2;
        let content = JSON.stringify(value, null, spacing);
        if (options.newline !== false) content += '\n';
        return writeText(key, content, options);
    }

    function list(key = '.', options = {}) {
        const normalized = normalizePisiStorageKey(key);
        const targetPath = resolvePath(normalized);
        try {
            if (!safeDriver.exists(targetPath)) {
                if (options.allowMissing === true) {
                    return { ok: true, missing: true, entries: [], key: normalized, path: targetPath };
                }
                return {
                    ok: false,
                    missing: true,
                    code: 'STORAGE_NOT_FOUND',
                    error: 'Storage klasörü bulunamadı.',
                    entries: [],
                    key: normalized,
                    path: targetPath
                };
            }
            const entries = safeDriver.list(targetPath, options).map((entry) => {
                const childKey = normalized === '.' ? normalizePisiStorageKey(entry.name) : normalizePisiStorageKey(`${normalized}/${entry.name}`);
                return {
                    name: entry.name,
                    key: childKey,
                    path: resolvePath(childKey),
                    isFile: entry.isFile === true,
                    isDirectory: entry.isDirectory === true,
                    isSymbolicLink: entry.isSymbolicLink === true
                };
            });
            return { ok: true, missing: false, entries, key: normalized, path: targetPath };
        } catch (error) {
            return storageFailure(error, 'STORAGE_LIST_FAILED', {
                entries: [],
                key: normalized,
                path: targetPath
            });
        }
    }

    function walk(key = '.', options = {}) {
        const extensions = normalizeStorageExtensions(options.extensions);
        const ignore = new Set((Array.isArray(options.ignore) ? options.ignore : []).map((value) => String(value || '').trim()).filter(Boolean));
        const maxFiles = Math.max(1, Math.min(100000, Number(options.maxFiles) || 100000));
        const files = [];
        const visit = (currentKey) => {
            if (files.length >= maxFiles) return;
            /** @type {any} */
            const current = list(currentKey, { allowMissing: options.allowMissing === true });
            if (!current.ok) throw new Error(current.error);
            for (const entry of current.entries) {
                if (files.length >= maxFiles) return;
                if (ignore.has(entry.name) || entry.isSymbolicLink) continue;
                if (entry.isDirectory) {
                    visit(entry.key);
                    continue;
                }
                if (!entry.isFile) continue;
                if (extensions) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (!extensions.has(ext)) continue;
                }
                files.push(entry);
            }
        };
        try {
            visit(normalizePisiStorageKey(key));
            return { ok: true, entries: files };
        } catch (error) {
            return storageFailure(error, 'STORAGE_WALK_FAILED', { entries: files });
        }
    }

    function stat(key) {
        const normalized = normalizePisiStorageKey(key);
        const targetPath = resolvePath(normalized);
        try {
            return { ok: true, key: normalized, path: targetPath, stat: safeDriver.stat(targetPath) };
        } catch (error) {
            return storageFailure(error, 'STORAGE_STAT_FAILED', {
                key: normalized,
                path: targetPath
            });
        }
    }

    function rename(sourceKey, destinationKey, options = {}) {
        const source = normalizePisiStorageKey(sourceKey);
        const destination = normalizePisiStorageKey(destinationKey);
        const sourcePath = resolvePath(source);
        const destinationPath = resolvePath(destination);
        const parentKey = normalizePisiStorageKey(path.posix.dirname(destination));
        const ensured = ensureDirectory(parentKey);
        if (!ensured.ok) return ensured;
        try {
            safeDriver.rename(sourcePath, destinationPath, options);
            return {
                ok: true,
                sourceKey: source,
                destinationKey: destination,
                sourcePath,
                destinationPath
            };
        } catch (error) {
            return storageFailure(error, 'STORAGE_RENAME_FAILED', {
                sourceKey: source,
                destinationKey: destination,
                sourcePath,
                destinationPath
            });
        }
    }

    function remove(key, options = {}) {
        const normalized = normalizePisiStorageKey(key);
        if (normalized === '.') {
            return {
                ok: false,
                code: 'STORAGE_ROOT_DELETE_FORBIDDEN',
                error: 'Proje storage kökü bu katmandan silinemez.',
                key: normalized,
                path: root
            };
        }
        const targetPath = resolvePath(normalized);
        try {
            safeDriver.remove(targetPath, options);
            return { ok: true, key: normalized, path: targetPath };
        } catch (error) {
            return storageFailure(error, 'STORAGE_REMOVE_FAILED', {
                key: normalized,
                path: targetPath
            });
        }
    }

    return Object.freeze({
        contractVersion: PISI_STORAGE_CONTRACT_VERSION,
        projectRoot: root,
        resolvePath,
        keyForPath,
        exists,
        ensureDirectory,
        readText,
        readJson,
        writeText,
        writeJson,
        list,
        walk,
        stat,
        rename,
        remove
    });
}

export {
PISI_STORAGE_CONTRACT_VERSION,
    PISI_STORAGE_DRIVER_METHODS,
    normalizePisiStorageKey,
    isSameOrInsidePisiStoragePath,
    resolvePisiStoragePath,
    getPisiStorageKeyForPath,
    assertPisiStorageDriver,
    createPisiProjectStorage
};
