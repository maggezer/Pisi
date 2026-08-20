'use strict';

const fs = require('fs');
const path = require('path');

const PISI_BACKUP_SUFFIX = '.pisi-backup';
const PISI_BACKUP_ROOT_RELATIVE = path.join('.pisi', 'backups');
const PISI_ATOMIC_BACKUP_RELATIVE = path.join(PISI_BACKUP_ROOT_RELATIVE, 'atomic');
const PISI_CORRUPT_BACKUP_RELATIVE = path.join(PISI_BACKUP_ROOT_RELATIVE, 'corrupt');
const PISI_CORRUPT_BACKUP_PATTERN = /\.corrupt-([0-9a-f]{12})\.bak$/i;
const PISI_BACKUP_MIGRATION_SKIP_NAMES = new Set([
    '.git',
    'node_modules',
    '.pisi-history'
]);

function normalizePisiBackupPath(value) {
    return path.resolve(String(value || ''));
}

function isSameOrInsidePisiBackupPath(candidatePath, parentPath) {
    const candidate = normalizePisiBackupPath(candidatePath);
    const parent = normalizePisiBackupPath(parentPath);
    const relative = path.relative(parent, candidate);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function getPisiBackupRoot(projectFolder) {
    return path.join(
        normalizePisiBackupPath(projectFolder),
        PISI_BACKUP_ROOT_RELATIVE
    );
}

function getPisiAtomicBackupRoot(projectFolder) {
    return path.join(
        normalizePisiBackupPath(projectFolder),
        PISI_ATOMIC_BACKUP_RELATIVE
    );
}

function getPisiCorruptBackupRoot(projectFolder) {
    return path.join(
        normalizePisiBackupPath(projectFolder),
        PISI_CORRUPT_BACKUP_RELATIVE
    );
}

function isPisiProjectPath(projectFolder, targetPath) {
    if (!projectFolder || !targetPath) return false;
    return isSameOrInsidePisiBackupPath(targetPath, projectFolder);
}

function isPisiBackupStoragePath(projectFolder, targetPath) {
    if (!projectFolder || !targetPath) return false;
    return isSameOrInsidePisiBackupPath(
        targetPath,
        getPisiBackupRoot(projectFolder)
    );
}

function getPisiBackupRelativeTarget(projectFolder, targetPath) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const target = normalizePisiBackupPath(targetPath);
    if (!isPisiProjectPath(projectRoot, target)) return null;
    if (isPisiBackupStoragePath(projectRoot, target)) return null;

    const relative = path.relative(projectRoot, target);
    if (
        !relative ||
        relative === '.' ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    ) {
        return null;
    }
    return relative;
}

function getPisiAtomicBackupPath(projectFolder, targetPath) {
    const relative = getPisiBackupRelativeTarget(projectFolder, targetPath);
    if (!relative) return null;
    return path.join(
        getPisiAtomicBackupRoot(projectFolder),
        `${relative}${PISI_BACKUP_SUFFIX}`
    );
}

function getPisiCorruptBackupPath(projectFolder, targetPath, digest) {
    const relative = getPisiBackupRelativeTarget(projectFolder, targetPath);
    const safeDigest = String(digest || '').toLowerCase();
    if (!relative || !/^[0-9a-f]{12}$/.test(safeDigest)) return null;
    return path.join(
        getPisiCorruptBackupRoot(projectFolder),
        `${relative}.corrupt-${safeDigest}.bak`
    );
}

function getPisiAtomicBackupTargetPath(projectFolder, backupPath) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const candidate = normalizePisiBackupPath(backupPath);
    if (!isPisiProjectPath(projectRoot, candidate)) return null;
    if (!candidate.endsWith(PISI_BACKUP_SUFFIX)) return null;

    const atomicRoot = getPisiAtomicBackupRoot(projectRoot);
    let target = null;

    if (isSameOrInsidePisiBackupPath(candidate, atomicRoot)) {
        const relativeBackup = path.relative(atomicRoot, candidate);
        const relativeTarget = relativeBackup.slice(0, -PISI_BACKUP_SUFFIX.length);
        target = path.resolve(projectRoot, relativeTarget);
    } else if (!isPisiBackupStoragePath(projectRoot, candidate)) {
        // Geriye uyumluluk: eski yedekler hedef dosyanın yanında tutuluyordu.
        target = candidate.slice(0, -PISI_BACKUP_SUFFIX.length);
    }

    if (!target || !isPisiProjectPath(projectRoot, target)) return null;
    if (isPisiBackupStoragePath(projectRoot, target)) return null;
    return target;
}

function getPisiLegacyCorruptBackupTarget(backupPath) {
    const candidate = normalizePisiBackupPath(backupPath);
    const match = candidate.match(PISI_CORRUPT_BACKUP_PATTERN);
    if (!match) return null;
    return {
        targetPath: candidate.slice(0, -match[0].length),
        digest: match[1].toLowerCase()
    };
}

function ensurePisiBackupParent(backupPath) {
    if (!backupPath) return;
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
}

function movePisiBackupFile(sourcePath, destinationPath, options = {}) {
    if (!sourcePath || !destinationPath || sourcePath === destinationPath) {
        return false;
    }
    ensurePisiBackupParent(destinationPath);

    if (fs.existsSync(destinationPath)) {
        const sourceStat = fs.statSync(sourcePath);
        const destinationStat = fs.statSync(destinationPath);
        if (sourceStat.mtimeMs > destinationStat.mtimeMs) {
            fs.copyFileSync(sourcePath, destinationPath);
        }
        fs.unlinkSync(sourcePath);
        return true;
    }

    const rename = typeof options.rename === 'function'
        ? options.rename
        : fs.renameSync.bind(fs);
    rename(sourcePath, destinationPath);
    return true;
}

function migratePisiLegacyAtomicBackup(projectFolder, targetPath, options = {}) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const target = normalizePisiBackupPath(targetPath);
    const destinationPath = getPisiAtomicBackupPath(projectRoot, target);
    if (!destinationPath) {
        return { ok: true, migrated: false, backupPath: null };
    }

    const legacyPath = `${target}${PISI_BACKUP_SUFFIX}`;
    if (!fs.existsSync(legacyPath)) {
        return {
            ok: true,
            migrated: false,
            backupPath: fs.existsSync(destinationPath) ? destinationPath : null
        };
    }

    try {
        movePisiBackupFile(legacyPath, destinationPath, options);
        return { ok: true, migrated: true, backupPath: destinationPath };
    } catch (error) {
        return {
            ok: false,
            migrated: false,
            backupPath: fs.existsSync(destinationPath) ? destinationPath : legacyPath,
            error: error.message
        };
    }
}

function shouldSkipPisiBackupMigrationDirectory(projectFolder, directoryPath, name) {
    if (PISI_BACKUP_MIGRATION_SKIP_NAMES.has(name)) return true;
    if (isPisiBackupStoragePath(projectFolder, directoryPath)) return true;

    const pisiRoot = path.join(projectFolder, '.pisi');
    const mutationRoot = path.join(pisiRoot, 'mutations');
    const trashRoot = path.join(pisiRoot, 'trash');
    return (
        isSameOrInsidePisiBackupPath(directoryPath, mutationRoot) ||
        isSameOrInsidePisiBackupPath(directoryPath, trashRoot)
    );
}

function collectPisiLegacyBackupFiles(projectFolder, options = {}) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const maxFiles = Math.max(1, Number(options.maxFiles) || 5000);
    const atomic = [];
    const corrupt = [];
    const queue = [projectRoot];

    while (queue.length && atomic.length + corrupt.length < maxFiles) {
        const directory = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (atomic.length + corrupt.length >= maxFiles) break;
            if (entry.isSymbolicLink?.()) continue;
            const fullPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                if (
                    !shouldSkipPisiBackupMigrationDirectory(
                        projectRoot,
                        fullPath,
                        entry.name
                    )
                ) {
                    queue.push(fullPath);
                }
                continue;
            }

            if (!entry.isFile()) continue;
            if (entry.name.endsWith(PISI_BACKUP_SUFFIX)) {
                atomic.push(fullPath);
                continue;
            }
            if (PISI_CORRUPT_BACKUP_PATTERN.test(entry.name)) {
                corrupt.push(fullPath);
            }
        }
    }

    return { atomic, corrupt };
}

function migratePisiLegacyBackups(projectFolder, options = {}) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const files = collectPisiLegacyBackupFiles(projectRoot, options);
    const warnings = [];
    let atomicMigrated = 0;
    let corruptMigrated = 0;

    for (const legacyPath of files.atomic) {
        const targetPath = getPisiAtomicBackupTargetPath(projectRoot, legacyPath);
        const destinationPath = targetPath
            ? getPisiAtomicBackupPath(projectRoot, targetPath)
            : null;
        if (!targetPath || !destinationPath) continue;
        try {
            if (movePisiBackupFile(legacyPath, destinationPath, options)) {
                atomicMigrated += 1;
            }
        } catch (error) {
            warnings.push(`${legacyPath}: ${error.message}`);
        }
    }

    for (const legacyPath of files.corrupt) {
        const parsed = getPisiLegacyCorruptBackupTarget(legacyPath);
        if (
            !parsed ||
            !isPisiProjectPath(projectRoot, parsed.targetPath) ||
            isPisiBackupStoragePath(projectRoot, parsed.targetPath)
        ) {
            continue;
        }
        const destinationPath = getPisiCorruptBackupPath(
            projectRoot,
            parsed.targetPath,
            parsed.digest
        );
        if (!destinationPath) continue;
        try {
            if (movePisiBackupFile(legacyPath, destinationPath, options)) {
                corruptMigrated += 1;
            }
        } catch (error) {
            warnings.push(`${legacyPath}: ${error.message}`);
        }
    }

    return {
        ok: warnings.length === 0,
        atomicMigrated,
        corruptMigrated,
        migrated: atomicMigrated + corruptMigrated,
        warnings
    };
}

module.exports = {
    PISI_BACKUP_SUFFIX,
    PISI_BACKUP_ROOT_RELATIVE,
    PISI_ATOMIC_BACKUP_RELATIVE,
    PISI_CORRUPT_BACKUP_RELATIVE,
    getPisiBackupRoot,
    getPisiAtomicBackupRoot,
    getPisiCorruptBackupRoot,
    getPisiAtomicBackupPath,
    getPisiCorruptBackupPath,
    getPisiAtomicBackupTargetPath,
    getPisiLegacyCorruptBackupTarget,
    isPisiProjectPath,
    isPisiBackupStoragePath,
    ensurePisiBackupParent,
    movePisiBackupFile,
    migratePisiLegacyAtomicBackup,
    collectPisiLegacyBackupFiles,
    migratePisiLegacyBackups
};
