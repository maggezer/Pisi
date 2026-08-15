'use strict';

const fs = require('fs');
const path = require('path');
const { registerMainModule } = require('../module-registry');
const core = require('./atomic-mutation-core');

let activePisiAtomicMutation = null;
let pisiAtomicFsHooksInstalled = false;
const recoveredPisiAtomicProjects = new Set();

function getActivePisiAtomicMutation() {
    return activePisiAtomicMutation;
}

function normalizePisiAtomicProjectKey(projectFolder) {
    const resolved = path.resolve(String(projectFolder || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPisiAtomicTransientPath(targetPath) {
    const base = path.basename(String(targetPath || ''));
    return /\.tmp$/i.test(base) || /^\.pisi-delete-/i.test(base);
}

function capturePisiAtomicPathBeforeChange(targetPath) {
    if (!activePisiAtomicMutation || !targetPath) return null;
    return core.capturePathBeforeMutation(activePisiAtomicMutation, targetPath);
}

function capturePisiAtomicRenameBeforeChange(oldPath, newPath) {
    if (!activePisiAtomicMutation || !oldPath || !newPath) return null;
    if (isPisiAtomicTransientPath(oldPath)) {
        return {
            source: null,
            destination: capturePisiAtomicPathBeforeChange(newPath)
        };
    }
    return core.captureRenameBeforeMutation(
        activePisiAtomicMutation,
        oldPath,
        newPath
    );
}

function capturePisiAtomicMkdirBeforeChange(targetPath) {
    if (!activePisiAtomicMutation || !targetPath || fs.existsSync(targetPath)) return null;
    const projectRoot = activePisiAtomicMutation.projectRoot;
    let candidate = path.resolve(targetPath);
    let topMissing = candidate;
    while (
        core.isSameOrInsideAtomicPath(candidate, projectRoot) &&
        !fs.existsSync(path.dirname(candidate)) &&
        path.dirname(candidate) !== candidate
    ) {
        candidate = path.dirname(candidate);
        topMissing = candidate;
    }
    return capturePisiAtomicPathBeforeChange(topMissing);
}

function installPisiAtomicFilesystemHooks() {
    if (pisiAtomicFsHooksInstalled) return;
    pisiAtomicFsHooksInstalled = true;

    const originalRenameSync = fs.renameSync.bind(fs);
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const originalMkdirSync = fs.mkdirSync.bind(fs);
    const originalUnlinkSync = fs.unlinkSync.bind(fs);
    const originalRmSync = fs.rmSync.bind(fs);

    fs.renameSync = function pisiAtomicRenameSync(oldPath, newPath) {
        capturePisiAtomicRenameBeforeChange(oldPath, newPath);
        return originalRenameSync(oldPath, newPath);
    };

    fs.writeFileSync = function pisiAtomicWriteFileSync(file, data, options) {
        if (typeof file === 'string' || file instanceof URL) {
            capturePisiAtomicPathBeforeChange(file);
        }
        return originalWriteFileSync(file, data, options);
    };

    fs.mkdirSync = function pisiAtomicMkdirSync(targetPath, options) {
        capturePisiAtomicMkdirBeforeChange(targetPath);
        return originalMkdirSync(targetPath, options);
    };

    fs.unlinkSync = function pisiAtomicUnlinkSync(targetPath) {
        if (!isPisiAtomicTransientPath(targetPath)) {
            capturePisiAtomicPathBeforeChange(targetPath);
        }
        return originalUnlinkSync(targetPath);
    };

    fs.rmSync = function pisiAtomicRmSync(targetPath, options) {
        if (!isPisiAtomicTransientPath(targetPath)) {
            capturePisiAtomicPathBeforeChange(targetPath);
        }
        return originalRmSync(targetPath, options);
    };
}

function recoverPisiAtomicMutations(projectFolder) {
    const result = core.recoverAtomicMutations(projectFolder);
    const key = normalizePisiAtomicProjectKey(projectFolder);
    if (result.ok) recoveredPisiAtomicProjects.add(key);
    else recoveredPisiAtomicProjects.delete(key);
    return result;
}

function ensurePisiAtomicRecovery(projectFolder) {
    const key = normalizePisiAtomicProjectKey(projectFolder);
    if (recoveredPisiAtomicProjects.has(key)) {
        return { ok: true, recovered: 0, cached: true, warnings: [] };
    }
    return recoverPisiAtomicMutations(projectFolder);
}

function finishPisiAtomicMutation(transaction, result) {
    if (result?.ok === false) {
        const rollback = core.rollbackAtomicMutation(transaction);
        if (!rollback.ok) {
            recoveredPisiAtomicProjects.delete(
                normalizePisiAtomicProjectKey(transaction.projectRoot)
            );
            return {
                ...result,
                ok: false,
                code: result.code || 'ATOMIC_MUTATION_FAILED',
                atomic: {
                    transactionId: transaction.id,
                    rolledBack: false,
                    recoveryRequired: true,
                    errors: rollback.errors
                }
            };
        }
        return {
            ...result,
            atomic: {
                transactionId: transaction.id,
                rolledBack: true
            }
        };
    }

    try {
        core.commitAtomicMutation(transaction);
        if (result && typeof result === 'object') {
            return {
                ...result,
                atomic: {
                    transactionId: transaction.id,
                    committed: true
                }
            };
        }
        return result;
    } catch (commitError) {
        const rollback = core.rollbackAtomicMutation(transaction);
        if (!rollback.ok) {
            recoveredPisiAtomicProjects.delete(
                normalizePisiAtomicProjectKey(transaction.projectRoot)
            );
            const error = new Error(
                `${commitError.message} Atomic rollback başarısız: ${rollback.errors.join(' | ')}`
            );
            error.code = 'ATOMIC_ROLLBACK_FAILED';
            throw error;
        }
        throw commitError;
    }
}

function failPisiAtomicMutation(transaction, error) {
    const rollback = core.rollbackAtomicMutation(transaction);
    if (!rollback.ok) {
        recoveredPisiAtomicProjects.delete(
            normalizePisiAtomicProjectKey(transaction.projectRoot)
        );
        const wrapped = new Error(
            `${error.message} Atomic rollback başarısız: ${rollback.errors.join(' | ')}`
        );
        wrapped.code = 'ATOMIC_ROLLBACK_FAILED';
        throw wrapped;
    }
    throw error;
}

function runPisiAtomicMutation(projectFolder, commandName, operation) {
    if (typeof operation !== 'function') {
        throw new TypeError('Atomic mutation operation fonksiyon olmalı.');
    }
    if (activePisiAtomicMutation) {
        if (
            core.isSameOrInsideAtomicPath(
                projectFolder,
                activePisiAtomicMutation.projectRoot
            ) &&
            core.isSameOrInsideAtomicPath(
                activePisiAtomicMutation.projectRoot,
                projectFolder
            )
        ) {
            return operation();
        }
        throw new Error('Aynı anda farklı projelerde nested atomic mutation çalıştırılamaz.');
    }

    const recovery = ensurePisiAtomicRecovery(projectFolder);
    if (!recovery.ok) {
        const error = new Error(
            `Yarım kalan atomic mutation kurtarılamadı: ${recovery.warnings.join(' | ')}`
        );
        error.code = 'ATOMIC_RECOVERY_REQUIRED';
        throw error;
    }

    const transaction = core.beginAtomicMutation(projectFolder, commandName);
    activePisiAtomicMutation = transaction;

    let result;
    try {
        result = operation();
    } catch (error) {
        activePisiAtomicMutation = null;
        return failPisiAtomicMutation(transaction, error);
    }

    if (result && typeof result.then === 'function') {
        return result.then(
            (resolved) => {
                activePisiAtomicMutation = null;
                return finishPisiAtomicMutation(transaction, resolved);
            },
            (error) => {
                activePisiAtomicMutation = null;
                return failPisiAtomicMutation(transaction, error);
            }
        );
    }

    activePisiAtomicMutation = null;
    return finishPisiAtomicMutation(transaction, result);
}

installPisiAtomicFilesystemHooks();

const moduleApi = {
    PISI_ATOMIC_MUTATION_VERSION: core.PISI_ATOMIC_MUTATION_VERSION,
    getActivePisiAtomicMutation,
    capturePisiAtomicPathBeforeChange,
    capturePisiAtomicRenameBeforeChange,
    recoverPisiAtomicMutations,
    ensurePisiAtomicRecovery,
    runPisiAtomicMutation
};

registerMainModule('main.atomicMutation', moduleApi);