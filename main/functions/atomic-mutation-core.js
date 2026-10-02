'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PISI_ATOMIC_MUTATION_VERSION = 1;
const PISI_ATOMIC_MUTATION_DIR = path.join('.pisi', 'mutations');

function normalizeAtomicPath(value) {
    return path.resolve(String(value || ''));
}

function isSameOrInsideAtomicPath(candidatePath, parentPath) {
    const candidate = normalizeAtomicPath(candidatePath);
    const parent = normalizeAtomicPath(parentPath);
    const relative = path.relative(parent, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertAtomicProjectPath(projectFolder, targetPath) {
    const projectRoot = normalizeAtomicPath(projectFolder);
    const target = normalizeAtomicPath(targetPath);
    if (!isSameOrInsideAtomicPath(target, projectRoot)) {
        throw new Error('Atomic mutation proje klasörünün dışına çıkamaz.');
    }
    return target;
}

function fsyncFileBestEffort(filePath) {
    let descriptor = null;
    try {
        descriptor = fs.openSync(filePath, 'r');
        fs.fsyncSync(descriptor);
    } catch {
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }
    }
}

function fsyncDirectoryBestEffort(directoryPath) {
    if (process.platform === 'win32') return;
    let descriptor = null;
    try {
        descriptor = fs.openSync(directoryPath, 'r');
        fs.fsyncSync(descriptor);
    } catch {
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }
    }
}

function writeJsonDurable(filePath, data) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor = null;
    try {
        descriptor = fs.openSync(tempPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        fs.renameSync(tempPath, filePath);
        fsyncDirectoryBestEffort(directory);
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }
        if (fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
            } catch {}
        }
    }
}

function copyPathRecursive(sourcePath, destinationPath) {
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
        throw new Error(`Atomic snapshot symlink içeremez: ${sourcePath}`);
    }
    if (stat.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) {
                throw new Error(`Atomic snapshot symlink içeremez: ${path.join(sourcePath, entry.name)}`);
            }
            copyPathRecursive(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
        }
        fsyncDirectoryBestEffort(destinationPath);
        return 'directory';
    }
    if (!stat.isFile()) {
        throw new Error(`Atomic snapshot desteklenmeyen yol türü: ${sourcePath}`);
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    fsyncFileBestEffort(destinationPath);
    return 'file';
}

function removePathIfExists(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function getAtomicMutationRoot(projectFolder) {
    return path.join(normalizeAtomicPath(projectFolder), PISI_ATOMIC_MUTATION_DIR);
}

function readAtomicManifest(transactionDirectory) {
    const manifestPath = path.join(transactionDirectory, 'manifest.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (manifest?.version !== PISI_ATOMIC_MUTATION_VERSION || !manifest?.id || !Array.isArray(manifest?.entries)) {
        throw new Error('Atomic mutation manifest geçersiz.');
    }
    return manifest;
}

function persistAtomicManifest(transaction) {
    transaction.manifest.updatedAt = new Date().toISOString();
    writeJsonDurable(transaction.manifestPath, transaction.manifest);
}

function beginAtomicMutation(projectFolder, commandName, options = {}) {
    const projectRoot = normalizeAtomicPath(projectFolder);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
        throw new Error('Atomic mutation için geçerli proje klasörü gerekli.');
    }
    const mutationRoot = getAtomicMutationRoot(projectRoot);
    fs.mkdirSync(mutationRoot, { recursive: true });
    const id = String(options.transactionId || `mut_${crypto.randomUUID()}`);
    if (!/^mut_[A-Za-z0-9._:-]{4,180}$/.test(id)) {
        throw new Error('Geçersiz atomic mutation kimliği.');
    }
    const directoryPath = path.join(mutationRoot, id);
    if (fs.existsSync(directoryPath)) {
        throw new Error(`Atomic mutation klasörü zaten var: ${id}`);
    }
    fs.mkdirSync(path.join(directoryPath, 'snapshots'), { recursive: true });
    const now = new Date().toISOString();
    const transaction = {
        id,
        projectRoot,
        directoryPath,
        manifestPath: path.join(directoryPath, 'manifest.json'),
        manifest: {
            version: PISI_ATOMIC_MUTATION_VERSION,
            id,
            command: String(commandName || 'unknown'),
            phase: 'prepared',
            createdAt: now,
            updatedAt: now,
            entries: []
        }
    };
    persistAtomicManifest(transaction);
    return transaction;
}

function isAtomicInternalPath(transaction, targetPath) {
    return (
        isSameOrInsideAtomicPath(targetPath, transaction.directoryPath) || isSameOrInsideAtomicPath(targetPath, getAtomicMutationRoot(transaction.projectRoot))
    );
}

function getAtomicEntryTarget(transaction, entry) {
    return normalizeAtomicPath(path.join(transaction.projectRoot, entry.path));
}

function findAtomicEntryCoveringPath(transaction, targetPath) {
    const normalized = normalizeAtomicPath(targetPath);
    return (
        transaction.manifest.entries.find((entry) => {
            const entryTarget = getAtomicEntryTarget(transaction, entry);
            return isSameOrInsideAtomicPath(normalized, entryTarget);
        }) || null
    );
}

function capturePathBeforeMutation(transaction, targetPath) {
    if (!transaction?.manifest || transaction.manifest.phase === 'committed') return null;
    const safeTarget = assertAtomicProjectPath(transaction.projectRoot, targetPath);
    if (isAtomicInternalPath(transaction, safeTarget)) return null;
    const mutationRoot = getAtomicMutationRoot(transaction.projectRoot);
    if (isSameOrInsideAtomicPath(mutationRoot, safeTarget)) {
        throw new Error('Atomic mutation kendi journal klasörünü kapsayan yolu değiştiremez.');
    }
    const coveringEntry = findAtomicEntryCoveringPath(transaction, safeTarget);
    if (coveringEntry) return coveringEntry;

    const relativePath = path.relative(transaction.projectRoot, safeTarget).replace(/\\/g, '/');
    const existed = fs.existsSync(safeTarget);
    const index = transaction.manifest.entries.length;
    const snapshotRelative = existed ? `snapshots/${String(index).padStart(5, '0')}` : null;
    const snapshotPath = snapshotRelative ? path.join(transaction.directoryPath, ...snapshotRelative.split('/')) : null;
    let type = 'missing';
    if (existed) {
        type = copyPathRecursive(safeTarget, snapshotPath);
    }
    const entry = {
        path: relativePath,
        existed,
        type,
        snapshot: snapshotRelative
    };
    transaction.manifest.entries.push(entry);
    transaction.manifest.phase = 'running';
    persistAtomicManifest(transaction);
    return entry;
}

function captureRenameBeforeMutation(transaction, oldPath, newPath) {
    const source = capturePathBeforeMutation(transaction, oldPath);
    const destination = capturePathBeforeMutation(transaction, newPath);
    return { source, destination };
}

function restoreAtomicEntries(transaction) {
    const errors = [];
    const entries = [...transaction.manifest.entries];
    const byDepthDesc = [...entries].sort((a, b) => {
        return b.path.split('/').length - a.path.split('/').length;
    });
    for (const entry of byDepthDesc) {
        const target = path.join(transaction.projectRoot, ...entry.path.split('/'));
        try {
            removePathIfExists(target);
        } catch (error) {
            errors.push(`${entry.path} temizlenemedi: ${error.message}`);
        }
    }
    const byDepthAsc = [...entries].sort((a, b) => {
        return a.path.split('/').length - b.path.split('/').length;
    });
    for (const entry of byDepthAsc) {
        if (!entry.existed) continue;
        const target = path.join(transaction.projectRoot, ...entry.path.split('/'));
        const snapshot = entry.snapshot ? path.join(transaction.directoryPath, ...entry.snapshot.split('/')) : null;
        if (!snapshot || !fs.existsSync(snapshot)) {
            errors.push(`${entry.path} snapshot bulunamadı.`);
            continue;
        }
        try {
            copyPathRecursive(snapshot, target);
        } catch (error) {
            errors.push(`${entry.path} geri yüklenemedi: ${error.message}`);
        }
    }
    return errors;
}

function cleanupKnownAtomicTemps(projectFolder) {
    const queue = [normalizeAtomicPath(projectFolder)];
    while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory() && /^\.pisi-delete-[A-Za-z0-9_-]+$/i.test(entry.name)) {
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } catch {}
                continue;
            }
            if (
                entry.isDirectory() &&
                entry.name !== '.git' &&
                entry.name !== 'node_modules' &&
                !isSameOrInsideAtomicPath(fullPath, getAtomicMutationRoot(projectFolder))
            ) {
                queue.push(fullPath);
            }
        }
    }
}

function cleanupAtomicTransactionDirectory(transaction) {
    try {
        fs.rmSync(transaction.directoryPath, { recursive: true, force: true });
        return { cleanupPending: false, warning: null };
    } catch (error) {
        return {
            cleanupPending: true,
            warning: `Atomic journal temizliği ertelendi: ${error.message}`
        };
    }
}

function rollbackAtomicMutation(transaction, options = {}) {
    transaction.manifest.phase = 'rolling-back';
    persistAtomicManifest(transaction);
    const errors = restoreAtomicEntries(transaction);
    if (errors.length) {
        transaction.manifest.phase = 'rollback-failed';
        transaction.manifest.rollbackErrors = errors;
        persistAtomicManifest(transaction);
        return { ok: false, id: transaction.id, errors };
    }
    transaction.manifest.phase = 'rolled-back';
    persistAtomicManifest(transaction);
    cleanupKnownAtomicTemps(transaction.projectRoot);
    const cleanup = options.cleanup === false ? { cleanupPending: true, warning: null } : cleanupAtomicTransactionDirectory(transaction);
    return {
        ok: true,
        id: transaction.id,
        rolledBack: true,
        ...cleanup
    };
}

function commitAtomicMutation(transaction, options = {}) {
    transaction.manifest.phase = 'committed';
    transaction.manifest.committedAt = new Date().toISOString();
    persistAtomicManifest(transaction);
    const cleanup = options.cleanup === false ? { cleanupPending: true, warning: null } : cleanupAtomicTransactionDirectory(transaction);
    return {
        ok: true,
        id: transaction.id,
        committed: true,
        ...cleanup
    };
}

function recoverAtomicMutations(projectFolder) {
    const projectRoot = normalizeAtomicPath(projectFolder);
    const mutationRoot = getAtomicMutationRoot(projectRoot);
    if (!fs.existsSync(mutationRoot)) {
        return {
            ok: true,
            recovered: 0,
            committedCleanups: 0,
            cleanupPending: 0,
            warnings: []
        };
    }
    let recovered = 0;
    let committedCleanups = 0;
    let cleanupPending = 0;
    const warnings = [];
    const errors = [];
    for (const entry of fs.readdirSync(mutationRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('mut_')) continue;
        const directoryPath = path.join(mutationRoot, entry.name);
        let manifest = null;
        try {
            manifest = readAtomicManifest(directoryPath);
        } catch (error) {
            errors.push(`${entry.name}: ${error.message}`);
            continue;
        }
        const transaction = {
            id: manifest.id,
            projectRoot,
            directoryPath,
            manifestPath: path.join(directoryPath, 'manifest.json'),
            manifest
        };
        if (manifest.phase === 'committed') {
            const cleanup = cleanupAtomicTransactionDirectory(transaction);
            if (cleanup.cleanupPending) {
                cleanupPending += 1;
                if (cleanup.warning) warnings.push(`${manifest.id}: ${cleanup.warning}`);
            } else {
                committedCleanups += 1;
            }
            continue;
        }
        const result = rollbackAtomicMutation(transaction);
        if (!result.ok) {
            errors.push(`${manifest.id}: ${result.errors.join(' | ')}`);
            continue;
        }
        if ('cleanupPending' in result && result.cleanupPending) {
            cleanupPending += 1;
            if ('warning' in result && result.warning) {
                warnings.push(`${manifest.id}: ${result.warning}`);
            }
        }
        recovered += 1;
    }
    return {
        ok: errors.length === 0,
        recovered,
        committedCleanups,
        cleanupPending,
        warnings: [...warnings, ...errors]
    };
}

module.exports = {
    PISI_ATOMIC_MUTATION_VERSION,
    PISI_ATOMIC_MUTATION_DIR,
    beginAtomicMutation,
    capturePathBeforeMutation,
    captureRenameBeforeMutation,
    commitAtomicMutation,
    rollbackAtomicMutation,
    recoverAtomicMutations,
    getAtomicMutationRoot,
    readAtomicManifest,
    isSameOrInsideAtomicPath
};
