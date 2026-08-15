'use strict';

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { registerMainModule } = require('../module-registry');
const core = require('./atomic-mutation-core');

const pisiAtomicContext = new AsyncLocalStorage();
let pisiAtomicFsHooksInstalled = false;
const recoveredPisiAtomicProjects = new Set();
const pisiAtomicProjectQueues = new Map();

function getActivePisiAtomicMutation() {
    return pisiAtomicContext.getStore() || null;
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
    const transaction = getActivePisiAtomicMutation();
    if (!transaction || !targetPath) return null;
    return core.capturePathBeforeMutation(transaction, targetPath);
}

function capturePisiAtomicRenameBeforeChange(oldPath, newPath) {
    const transaction = getActivePisiAtomicMutation();
    if (!transaction || !oldPath || !newPath) return null;
    if (isPisiAtomicTransientPath(oldPath)) {
        return {
            source: null,
            destination: capturePisiAtomicPathBeforeChange(newPath)
        };
    }
    return core.captureRenameBeforeMutation(transaction, oldPath, newPath);
}

function capturePisiAtomicMkdirBeforeChange(targetPath) {
    const transaction = getActivePisiAtomicMutation();
    if (!transaction || !targetPath || fs.existsSync(targetPath)) return null;
    const projectRoot = transaction.projectRoot;
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

function recoverPisiAtomicMutations(projectFolder, options = {}) {
    const key = normalizePisiAtomicProjectKey(projectFolder);
    if (options.force !== true && recoveredPisiAtomicProjects.has(key)) {
        return { ok: true, recovered: 0, cached: true, warnings: [] };
    }
    const result = core.recoverAtomicMutations(projectFolder);
    if (result.ok) recoveredPisiAtomicProjects.add(key);
    else recoveredPisiAtomicProjects.delete(key);
    return result;
}

function ensurePisiAtomicRecovery(projectFolder) {
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

function getPisiAtomicProjectQueue(projectKey) {
    let queue = pisiAtomicProjectQueues.get(projectKey);
    if (!queue) {
        queue = { busy: false, pending: [] };
        pisiAtomicProjectQueues.set(projectKey, queue);
    }
    return queue;
}

function releasePisiAtomicProjectQueue(projectKey, queue) {
    const next = queue.pending.shift();
    if (!next) {
        queue.busy = false;
        pisiAtomicProjectQueues.delete(projectKey);
        return;
    }
    queueMicrotask(() => {
        let result;
        try {
            result = executePisiQueuedAtomicMutation(
                next.projectFolder,
                next.commandName,
                next.operation,
                projectKey,
                queue
            );
        } catch (error) {
            next.reject(error);
            return;
        }
        Promise.resolve(result).then(next.resolve, next.reject);
    });
}

function executePisiQueuedAtomicMutation(
    projectFolder,
    commandName,
    operation,
    projectKey,
    queue
) {
    const recovery = ensurePisiAtomicRecovery(projectFolder);
    if (!recovery.ok) {
        releasePisiAtomicProjectQueue(projectKey, queue);
        const error = new Error(
            `Yarım kalan atomic mutation kurtarılamadı: ${recovery.warnings.join(' | ')}`
        );
        error.code = 'ATOMIC_RECOVERY_REQUIRED';
        throw error;
    }

    let transaction = null;
    let result;
    try {
        transaction = core.beginAtomicMutation(projectFolder, commandName);
        result = pisiAtomicContext.run(transaction, operation);
    } catch (error) {
        try {
            if (transaction) return failPisiAtomicMutation(transaction, error);
            throw error;
        } finally {
            releasePisiAtomicProjectQueue(projectKey, queue);
        }
    }

    if (result && typeof result.then === 'function') {
        return result.then(
            (resolved) => finishPisiAtomicMutation(transaction, resolved),
            (error) => failPisiAtomicMutation(transaction, error)
        ).finally(() => {
            releasePisiAtomicProjectQueue(projectKey, queue);
        });
    }

    try {
        return finishPisiAtomicMutation(transaction, result);
    } finally {
        releasePisiAtomicProjectQueue(projectKey, queue);
    }
}

function runPisiAtomicMutation(projectFolder, commandName, operation) {
    if (typeof operation !== 'function') {
        throw new TypeError('Atomic mutation operation fonksiyon olmalı.');
    }
    const activeTransaction = getActivePisiAtomicMutation();
    if (activeTransaction) {
        if (
            core.isSameOrInsideAtomicPath(projectFolder, activeTransaction.projectRoot) &&
            core.isSameOrInsideAtomicPath(activeTransaction.projectRoot, projectFolder)
        ) {
            return operation();
        }
        throw new Error('Aynı async zincirde farklı projelerde nested atomic mutation çalıştırılamaz.');
    }

    const projectKey = normalizePisiAtomicProjectKey(projectFolder);
    const queue = getPisiAtomicProjectQueue(projectKey);
    if (queue.busy) {
        return new Promise((resolve, reject) => {
            queue.pending.push({
                projectFolder,
                commandName,
                operation,
                resolve,
                reject
            });
        });
    }
    queue.busy = true;
    return executePisiQueuedAtomicMutation(
        projectFolder,
        commandName,
        operation,
        projectKey,
        queue
    );
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