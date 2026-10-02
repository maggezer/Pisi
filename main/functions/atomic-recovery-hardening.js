import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { registerMainModule } from '../module-registry.js';
import * as core from './atomic-mutation-core.js';

const PISI_ATOMIC_RECOVERY_HARDENING_VERSION = 1;
const PISI_ATOMIC_CLEANUP_PREFIX = '.cleanup_atomic_';
const PISI_ATOMIC_CLEANUP_RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM', 'EACCES']);
const PISI_ATOMIC_CLEANUP_OPTIONS = Object.freeze({
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 120
});
const PISI_ATOMIC_RECOVERY_PATCH = Symbol.for('pisi.atomic.recovery-hardening');

function makePisiAtomicCleanupPathWritable(candidatePath, mutationRoot) {
    if (process.platform !== 'win32' || typeof candidatePath !== 'string') return;
    const resolved = path.resolve(candidatePath);
    const root = path.resolve(mutationRoot);
    if (!core.isSameOrInsideAtomicPath(resolved, root)) return;
    try {
        fs.chmodSync(resolved, 0o700);
    } catch {
        // A short-lived Windows lock can still be handled by rmSync retries.
    }
}

function removePisiAtomicCleanupPath(targetPath, mutationRoot) {
    if (!fs.existsSync(targetPath)) {
        return { ok: true };
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            fs.rmSync(targetPath, PISI_ATOMIC_CLEANUP_OPTIONS);
            return { ok: true };
        } catch (error) {
            lastError = error;
            if (!PISI_ATOMIC_CLEANUP_RETRY_CODES.has(error?.code)) break;
            makePisiAtomicCleanupPathWritable(targetPath, mutationRoot);
            if (typeof error?.path === 'string' && core.isSameOrInsideAtomicPath(error.path, mutationRoot)) {
                makePisiAtomicCleanupPathWritable(error.path, mutationRoot);
                makePisiAtomicCleanupPathWritable(path.dirname(error.path), mutationRoot);
            }
        }
    }

    return {
        ok: false,
        code: String(lastError?.code || 'ATOMIC_CLEANUP_FAILED'),
        error: lastError?.message || 'Atomic journal temizlenemedi.'
    };
}

function quarantinePisiAtomicTransactionDirectory(directoryPath, mutationRoot) {
    if (!fs.existsSync(directoryPath)) {
        return { cleanupPending: false, warning: null };
    }

    const quarantinePath = path.join(mutationRoot, `${PISI_ATOMIC_CLEANUP_PREFIX}${crypto.randomUUID()}`);
    let cleanupTarget = directoryPath;
    let renameError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            fs.renameSync(directoryPath, quarantinePath);
            cleanupTarget = quarantinePath;
            renameError = null;
            break;
        } catch (error) {
            renameError = error;
            if (!PISI_ATOMIC_CLEANUP_RETRY_CODES.has(error?.code)) break;
            makePisiAtomicCleanupPathWritable(directoryPath, mutationRoot);
        }
    }

    const removal = removePisiAtomicCleanupPath(cleanupTarget, mutationRoot);
    if (removal.ok) {
        return { cleanupPending: false, warning: null };
    }

    const detail = renameError && cleanupTarget === directoryPath ? `${renameError.message} | ${removal.error}` : removal.error;
    return {
        cleanupPending: true,
        warning: `Atomic journal temizliği ertelendi: ${detail}`
    };
}

function cleanupPisiAtomicQuarantines(mutationRoot) {
    let cleanupPending = 0;
    const warnings = [];
    let entries = [];
    try {
        entries = fs.readdirSync(mutationRoot, { withFileTypes: true });
    } catch (error) {
        return {
            cleanupPending: 1,
            warnings: [`Atomic cleanup klasörü okunamadı: ${error.message}`]
        };
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(PISI_ATOMIC_CLEANUP_PREFIX)) {
            continue;
        }
        const cleanupPath = path.join(mutationRoot, entry.name);
        const result = removePisiAtomicCleanupPath(cleanupPath, mutationRoot);
        if (!result.ok) {
            cleanupPending += 1;
            warnings.push(`${entry.name}: Atomic journal temizliği ertelendi: ${result.error}`);
        }
    }

    return { cleanupPending, warnings };
}

function recoverPisiAtomicMutationsHardened(projectFolder) {
    const projectRoot = path.resolve(String(projectFolder || ''));
    const mutationRoot = core.getAtomicMutationRoot(projectRoot);
    if (!fs.existsSync(mutationRoot)) {
        return {
            ok: true,
            recovered: 0,
            committedCleanups: 0,
            orphanCleanups: 0,
            cleanupPending: 0,
            warnings: []
        };
    }

    let recovered = 0;
    let committedCleanups = 0;
    let orphanCleanups = 0;
    let cleanupPending = 0;
    const warnings = [];
    const errors = [];

    const staleCleanup = cleanupPisiAtomicQuarantines(mutationRoot);
    cleanupPending += staleCleanup.cleanupPending;
    warnings.push(...staleCleanup.warnings);

    let entries = [];
    try {
        entries = fs.readdirSync(mutationRoot, { withFileTypes: true });
    } catch (error) {
        return {
            ok: false,
            recovered,
            committedCleanups,
            orphanCleanups,
            cleanupPending,
            warnings: [...warnings, `Atomic mutation klasörü okunamadı: ${error.message}`]
        };
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('mut_')) continue;
        const directoryPath = path.join(mutationRoot, entry.name);
        const manifestPath = path.join(directoryPath, 'manifest.json');

        // Standard mutation flow writes manifest before any project path can be
        // mutated. Therefore a mut_* directory without manifest is either an
        // interrupted initial journal creation or, more commonly on Windows,
        // an interrupted cleanup that already removed manifest.json.
        if (!fs.existsSync(manifestPath)) {
            const cleanup = quarantinePisiAtomicTransactionDirectory(directoryPath, mutationRoot);
            if (cleanup.cleanupPending) {
                cleanupPending += 1;
                if (cleanup.warning) warnings.push(`${entry.name}: ${cleanup.warning}`);
            } else {
                orphanCleanups += 1;
            }
            continue;
        }

        let manifest = null;
        try {
            manifest = core.readAtomicManifest(directoryPath);
        } catch (error) {
            // Existing but malformed manifests remain fatal: unlike a missing
            // manifest, their state cannot safely be classified as cleanup.
            errors.push(`${entry.name}: ${error.message}`);
            continue;
        }

        const transaction = {
            id: manifest.id,
            projectRoot,
            directoryPath,
            manifestPath,
            manifest
        };

        if (manifest.phase === 'committed') {
            const cleanup = quarantinePisiAtomicTransactionDirectory(directoryPath, mutationRoot);
            if (cleanup.cleanupPending) {
                cleanupPending += 1;
                if (cleanup.warning) warnings.push(`${manifest.id}: ${cleanup.warning}`);
            } else {
                committedCleanups += 1;
            }
            continue;
        }

        const result = core.rollbackAtomicMutation(transaction);
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
        orphanCleanups,
        cleanupPending,
        warnings: [...warnings, ...errors]
    };
}

function installPisiAtomicRecoveryHardening() {
    if (core[PISI_ATOMIC_RECOVERY_PATCH]) {
        return core[PISI_ATOMIC_RECOVERY_PATCH];
    }

    const originalCommit = core.commitAtomicMutation.bind(core);
    const originalRollback = core.rollbackAtomicMutation.bind(core);

    core.commitAtomicMutation = function pisiHardenedAtomicCommit(transaction, options = {}) {
        const result = originalCommit(transaction, { ...options, cleanup: false });
        if (options.cleanup === false) return result;
        const cleanup = quarantinePisiAtomicTransactionDirectory(transaction.directoryPath, core.getAtomicMutationRoot(transaction.projectRoot));
        return { ...result, ...cleanup };
    };

    core.rollbackAtomicMutation = function pisiHardenedAtomicRollback(transaction, options = {}) {
        const result = originalRollback(transaction, { ...options, cleanup: false });
        if (!result.ok || options.cleanup === false) return result;
        const cleanup = quarantinePisiAtomicTransactionDirectory(transaction.directoryPath, core.getAtomicMutationRoot(transaction.projectRoot));
        return { ...result, ...cleanup };
    };

    core.recoverAtomicMutations = recoverPisiAtomicMutationsHardened;

    const patch = Object.freeze({
        version: PISI_ATOMIC_RECOVERY_HARDENING_VERSION,
        originalCommit,
        originalRollback
    });
    Object.defineProperty(core, PISI_ATOMIC_RECOVERY_PATCH, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: patch
    });
    return patch;
}

const installedPatch = installPisiAtomicRecoveryHardening();

const moduleApi = {
    PISI_ATOMIC_RECOVERY_HARDENING_VERSION,
    removePisiAtomicCleanupPath,
    quarantinePisiAtomicTransactionDirectory,
    cleanupPisiAtomicQuarantines,
    recoverPisiAtomicMutationsHardened,
    installPisiAtomicRecoveryHardening,
    installedPatch
};

registerMainModule('main.atomicRecoveryHardening', moduleApi);
