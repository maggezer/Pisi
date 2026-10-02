import * as fs from 'node:fs';
import * as path from 'node:path';

const PISI_BACKUP_SUFFIX = '.pisi-backup';
const PISI_BACKUP_ROOT_RELATIVE = path.join('.pisi', 'backups');
const PISI_ATOMIC_BACKUP_RELATIVE = path.join(PISI_BACKUP_ROOT_RELATIVE, 'atomic');
const PISI_CORRUPT_BACKUP_RELATIVE = path.join(PISI_BACKUP_ROOT_RELATIVE, 'corrupt');

function normalizePisiBackupPath(value) {
    return path.resolve(String(value || ''));
}

function isSameOrInsidePisiBackupPath(candidatePath, parentPath) {
    const candidate = normalizePisiBackupPath(candidatePath);
    const parent = normalizePisiBackupPath(parentPath);
    const relative = path.relative(parent, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function getPisiBackupRoot(projectFolder) {
    return path.join(normalizePisiBackupPath(projectFolder), PISI_BACKUP_ROOT_RELATIVE);
}

function getPisiAtomicBackupRoot(projectFolder) {
    return path.join(normalizePisiBackupPath(projectFolder), PISI_ATOMIC_BACKUP_RELATIVE);
}

function getPisiCorruptBackupRoot(projectFolder) {
    return path.join(normalizePisiBackupPath(projectFolder), PISI_CORRUPT_BACKUP_RELATIVE);
}

function isPisiProjectPath(projectFolder, targetPath) {
    if (!projectFolder || !targetPath) return false;
    return isSameOrInsidePisiBackupPath(targetPath, projectFolder);
}

function isPisiBackupStoragePath(projectFolder, targetPath) {
    if (!projectFolder || !targetPath) return false;
    return isSameOrInsidePisiBackupPath(targetPath, getPisiBackupRoot(projectFolder));
}

function getPisiBackupRelativeTarget(projectFolder, targetPath) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const target = normalizePisiBackupPath(targetPath);
    if (!isPisiProjectPath(projectRoot, target)) return null;
    if (isPisiBackupStoragePath(projectRoot, target)) return null;

    const relative = path.relative(projectRoot, target);
    if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return null;
    }
    return relative;
}

function getPisiAtomicBackupPath(projectFolder, targetPath) {
    const relative = getPisiBackupRelativeTarget(projectFolder, targetPath);
    if (!relative) return null;
    return path.join(getPisiAtomicBackupRoot(projectFolder), `${relative}${PISI_BACKUP_SUFFIX}`);
}

function getPisiCorruptBackupPath(projectFolder, targetPath, digest) {
    const relative = getPisiBackupRelativeTarget(projectFolder, targetPath);
    const safeDigest = String(digest || '').toLowerCase();
    if (!relative || !/^[0-9a-f]{12}$/.test(safeDigest)) return null;
    return path.join(getPisiCorruptBackupRoot(projectFolder), `${relative}.corrupt-${safeDigest}.bak`);
}

function getPisiAtomicBackupTargetPath(projectFolder, backupPath) {
    const projectRoot = normalizePisiBackupPath(projectFolder);
    const candidate = normalizePisiBackupPath(backupPath);
    const atomicRoot = getPisiAtomicBackupRoot(projectRoot);

    if (!isPisiProjectPath(projectRoot, candidate) || !isSameOrInsidePisiBackupPath(candidate, atomicRoot) || !candidate.endsWith(PISI_BACKUP_SUFFIX)) {
        return null;
    }

    const relativeBackup = path.relative(atomicRoot, candidate);
    const relativeTarget = relativeBackup.slice(0, -PISI_BACKUP_SUFFIX.length);
    const target = path.resolve(projectRoot, relativeTarget);

    if (!isPisiProjectPath(projectRoot, target)) return null;
    if (isPisiBackupStoragePath(projectRoot, target)) return null;
    return target;
}

function ensurePisiBackupParent(backupPath) {
    if (!backupPath) return;
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
}

export {
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
    isPisiProjectPath,
    isPisiBackupStoragePath,
    ensurePisiBackupParent
};
