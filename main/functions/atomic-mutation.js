'use strict';

const { registerMainModule } = require('../module-registry');
const core = require('./atomic-mutation-core');

let activePisiAtomicMutation = null;

function getActivePisiAtomicMutation() {
    return activePisiAtomicMutation;
}

function capturePisiAtomicPathBeforeChange(targetPath) {
    if (!activePisiAtomicMutation || !targetPath) return null;
    return core.capturePathBeforeMutation(activePisiAtomicMutation, targetPath);
}

function capturePisiAtomicRenameBeforeChange(oldPath, newPath) {
    if (!activePisiAtomicMutation || !oldPath || !newPath) return null;
    return core.captureRenameBeforeMutation(
        activePisiAtomicMutation,
        oldPath,
        newPath
    );
}

function recoverPisiAtomicMutations(projectFolder) {
    return core.recoverAtomicMutations(projectFolder);
}

function finishPisiAtomicMutation(transaction, result) {
    if (result?.ok === false) {
        const rollback = core.rollbackAtomicMutation(transaction);
        if (!rollback.ok) {
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

const moduleApi = {
    PISI_ATOMIC_MUTATION_VERSION: core.PISI_ATOMIC_MUTATION_VERSION,
    getActivePisiAtomicMutation,
    capturePisiAtomicPathBeforeChange,
    capturePisiAtomicRenameBeforeChange,
    recoverPisiAtomicMutations,
    runPisiAtomicMutation
};

registerMainModule('main.atomicMutation', moduleApi);
