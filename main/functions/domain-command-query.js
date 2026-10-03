import { ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';

const electronIpc = modules['main.electronIpc'];
const taskCapture = modules['main.taskCapture'];
const taskStore = modules['main.taskStore'];
const mapStore = modules['main.mapStore'];
const documentStore = modules['main.documentStore'];
const structuredNodes = modules['main.structuredNodes'];
const mapOperationalStore = modules['main.mapOperationalStore'];
const mapSemanticOperations = modules['main.mapSemanticOperationHooks'];
const projectOperations = modules['main.projectOperations'];
const taskReferenceHooks = modules['main.taskReferenceOperationHooks'];
const atomicMutation = modules['main.atomicMutation'];

const PISI_DOMAIN_CONTRACT_VERSION = 1;
const pisiDomainQueries = new Map();
const pisiDomainCommands = new Map();
const PISI_ATOMIC_DOMAIN_COMMANDS = new Set([
    'task.capture.v1',
    'map.relationship.upsert.v1',
    'map.relationship.delete.v1',
    'map.relationship.reparent.v1',
    'map.node.create.v1',
    'project.item.rename.v1',
    'project.item.move.v1',
    'project.item.delete.v1',
    'project.path.delete.v1',
    'project.batch.v1'
]);
const PISI_BATCH_MUTATION_COMMANDS = new Set([
    'task.capture.v1',
    'task.upsert.v1',
    'task.update.v1',
    'task.delete.v1',
    'map.relationship.upsert.v1',
    'map.relationship.delete.v1',
    'map.relationship.reparent.v1',
    'map.layout.save.v1',
    'map.operational.mutate.v1',
    'map.reference.detach.v1',
    'map.node.create.v1',
    'project.item.rename.v1',
    'project.item.move.v1',
    'project.item.delete.v1',
    'project.path.delete.v1'
]);

function registerPisiDomainQuery(name, handler) {
    const key = String(name || '').trim();
    if (!/^[-a-z0-9.]+\.v\d+$/.test(key) || typeof handler !== 'function') {
        throw new Error('Geçersiz domain query kaydı.');
    }
    if (pisiDomainQueries.has(key) || pisiDomainCommands.has(key)) {
        throw new Error(`Domain sözleşmesi iki kez kaydedildi: ${key}`);
    }
    pisiDomainQueries.set(key, handler);
}

function registerPisiDomainCommand(name, handler) {
    const key = String(name || '').trim();
    if (!/^[-a-z0-9.]+\.v\d+$/.test(key) || typeof handler !== 'function') {
        throw new Error('Geçersiz domain command kaydı.');
    }
    if (pisiDomainCommands.has(key) || pisiDomainQueries.has(key)) {
        throw new Error(`Domain sözleşmesi iki kez kaydedildi: ${key}`);
    }
    pisiDomainCommands.set(key, handler);
}

function recoverPisiDomainProjectIfNeeded() {
    const projectFolder = globalThis.activeProjectFolder;
    if (!projectFolder || !atomicMutation?.recoverPisiAtomicMutations) return;
    const recovery = atomicMutation.recoverPisiAtomicMutations(projectFolder);
    if (!recovery.ok) {
        throw new Error(`Yarım kalan atomic mutation kurtarılamadı: ${recovery.warnings.join(' | ')}`);
    }
}

function executePisiDomainQuery(name, payload = {}) {
    const handler = pisiDomainQueries.get(String(name || ''));
    if (!handler) {
        return {
            ok: false,
            code: 'DOMAIN_QUERY_NOT_FOUND',
            error: `Bilinmeyen domain query: ${String(name || '')}`
        };
    }
    try {
        recoverPisiDomainProjectIfNeeded();
        return handler(payload || {});
    } catch (error) {
        return {
            ok: false,
            code: 'DOMAIN_QUERY_FAILED',
            error: error.message
        };
    }
}

function shouldRunPisiCommandAtomically(name, payload = {}) {
    if (PISI_ATOMIC_DOMAIN_COMMANDS.has(name)) return true;
    if (name === 'map.camera.save.v1') {
        return Boolean(payload.operationalPayload || payload.camera?.operationalPayload);
    }
    return false;
}

function normalizePisiDomainCommandFailure(error) {
    return {
        ok: false,
        code: error?.code || 'DOMAIN_COMMAND_FAILED',
        error: error?.message || String(error || 'Domain command başarısız.')
    };
}

function executePisiDomainCommand(name, payload = {}) {
    const commandName = String(name || '');
    const handler = pisiDomainCommands.get(commandName);
    if (!handler) {
        return {
            ok: false,
            code: 'DOMAIN_COMMAND_NOT_FOUND',
            error: `Bilinmeyen domain command: ${commandName}`
        };
    }
    try {
        const invoke = () => handler(payload || {});
        const projectFolder = globalThis.activeProjectFolder;
        const result =
            shouldRunPisiCommandAtomically(commandName, payload) && projectFolder
                ? atomicMutation.runPisiAtomicMutation(projectFolder, commandName, invoke)
                : invoke();
        if (result && typeof result.then === 'function') {
            return result.catch((error) => normalizePisiDomainCommandFailure(error));
        }
        return result;
    } catch (error) {
        return normalizePisiDomainCommandFailure(error);
    }
}

function assertPisiDomainProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, {
        type: 'directory'
    });
    const activeProjectFolder = globalThis.activeProjectFolder;
    if (!activeProjectFolder || electronIpc.normalizePathForCompare(safeProjectFolder) !== electronIpc.normalizePathForCompare(activeProjectFolder)) {
        throw new Error('Domain işlemi yalnız aktif proje kökünde çalışabilir.');
    }
    return safeProjectFolder;
}

function assertPisiDomainMapPath(mapPath) {
    return electronIpc.assertProjectPath(mapPath, {
        type: 'file',
        extensions: ['.map']
    });
}

function assertPisiDomainDocumentPath(filePath) {
    return electronIpc.assertProjectPath(filePath, {
        type: 'file',
        extensions: ['.map', '.node']
    });
}

function assertPisiDomainNodePath(nodePath) {
    return electronIpc.assertProjectPath(nodePath, {
        type: 'file',
        extensions: ['.node']
    });
}

function normalizePisiDomainTaskPayload(payload = {}) {
    const safeProjectFolder = assertPisiDomainProjectRoot(payload.projectFolder);
    const task = { ...(payload.task || payload.payload || {}) };
    if (task.nodePath) task.nodePath = assertPisiDomainNodePath(task.nodePath);
    if (task.source?.nodePath) {
        task.source = {
            ...task.source,
            nodePath: assertPisiDomainNodePath(task.source.nodePath)
        };
    }
    if (task.mapPath) task.mapPath = assertPisiDomainMapPath(task.mapPath);
    if (task.source?.mapPath) {
        task.source = {
            ...task.source,
            mapPath: assertPisiDomainMapPath(task.source.mapPath)
        };
    }
    return { safeProjectFolder, task };
}

function attachRequiredPisiTaskReferenceRewrite(result) {
    const withReferences = taskReferenceHooks.attachPisiTaskReferenceRewrite(result);
    if (withReferences?.ok && withReferences.taskReferences?.ok === false) {
        return {
            ...withReferences,
            ok: false,
            code: 'TASK_REFERENCE_REWRITE_FAILED',
            error: withReferences.taskReferences.error || 'Task source referansları güncellenemedi.'
        };
    }
    return withReferences;
}

function installPisiDomainContracts() {
    registerPisiDomainQuery('task.list.v1', (payload) => {
        return taskStore.listPisiFirstClassTasks(assertPisiDomainProjectRoot(payload.projectFolder));
    });

    registerPisiDomainQuery('document.read.v1', (payload) => {
        return mapStore.getPisiDocument(assertPisiDomainDocumentPath(payload.filePath));
    });

    registerPisiDomainQuery('map.projection.v1', (payload) => {
        return mapSemanticOperations.getPisiMapSemanticProjection(assertPisiDomainMapPath(payload.mapPath));
    });

    registerPisiDomainQuery('map.operational.v1', (payload) => {
        const result = mapOperationalStore.readPisiOperationalMapState(assertPisiDomainMapPath(payload.mapPath));
        return result.ok ? { ok: true, operational: result.state } : result;
    });

    registerPisiDomainQuery('project.folder.list.v1', (payload) => {
        const safeFolderPath = electronIpc.assertProjectPath(payload.folderPath, {
            type: 'directory'
        });
        return projectOperations.safeListFolder(safeFolderPath);
    });

    registerPisiDomainCommand('task.capture.v1', (payload) => {
        const { safeProjectFolder, task } = normalizePisiDomainTaskPayload(payload);
        return taskCapture.quickAddPisiTask(safeProjectFolder, task);
    });

    registerPisiDomainCommand('task.upsert.v1', (payload) => {
        const { safeProjectFolder, task } = normalizePisiDomainTaskPayload(payload);
        return taskStore.upsertPisiFirstClassTask(safeProjectFolder, task);
    });

    registerPisiDomainCommand('task.update.v1', (payload) => {
        const safeProjectFolder = assertPisiDomainProjectRoot(payload.projectFolder);
        return taskStore.updatePisiFirstClassTask(safeProjectFolder, String(payload.taskId || ''), payload.patch || {});
    });

    registerPisiDomainCommand('task.delete.v1', (payload) => {
        return taskStore.deletePisiFirstClassTask(assertPisiDomainProjectRoot(payload.projectFolder), String(payload.taskId || ''));
    });

    registerPisiDomainCommand('task.sync-projection.v1', (payload) => {
        const safeProjectFolder = assertPisiDomainProjectRoot(payload.projectFolder);
        return taskStore.syncPisiFirstClassTaskIndex(safeProjectFolder, {
            complete: payload.complete === true,
            pruneMissing: payload.pruneMissing !== false,
            tasks: Array.isArray(payload.tasks) ? payload.tasks : []
        });
    });

    registerPisiDomainCommand('map.relationship.upsert.v1', (payload) => {
        return mapSemanticOperations.upsertPisiMapSemanticConnection(assertPisiDomainMapPath(payload.mapPath), payload.relationship || payload.edge || {});
    });

    registerPisiDomainCommand('map.relationship.delete.v1', (payload) => {
        return mapSemanticOperations.deletePisiMapSemanticConnection(
            assertPisiDomainMapPath(payload.mapPath),
            String(payload.relationshipId || payload.edgeId || '')
        );
    });

    registerPisiDomainCommand('map.relationship.reparent.v1', (payload) => {
        return mapSemanticOperations.reparentPisiMapSemanticNode(
            assertPisiDomainMapPath(payload.mapPath),
            String(payload.childId || ''),
            String(payload.parentId || '')
        );
    });

    registerPisiDomainCommand('map.layout.save.v1', (payload) => {
        const safeMapPath = assertPisiDomainMapPath(payload.mapPath);
        return mapStore.saveMapNodeLayout(safeMapPath, Array.isArray(payload.nodes) ? payload.nodes : []);
    });

    registerPisiDomainCommand('map.operational.mutate.v1', (payload) => {
        return mapOperationalStore.savePisiOperationalMapState(assertPisiDomainMapPath(payload.mapPath), payload.operation || payload.operationalPayload || {});
    });

    registerPisiDomainCommand('map.camera.save.v1', (payload) => {
        const safeMapPath = assertPisiDomainMapPath(payload.mapPath);
        const camera = { ...(payload.camera || {}) };
        delete camera.operationalPayload;
        const cameraResult = mapStore.saveMapCamera(safeMapPath, camera);
        if (!cameraResult.ok) return cameraResult;
        const operation = payload.operationalPayload || payload.camera?.operationalPayload;
        if (!operation) return cameraResult;
        const operationalResult = executePisiDomainCommand('map.operational.mutate.v1', { mapPath: safeMapPath, operation });
        if (!operationalResult.ok) return operationalResult;
        return {
            ...cameraResult,
            operational: operationalResult.state
        };
    });

    registerPisiDomainCommand('map.reference.detach.v1', (payload) => {
        const safeMapPath = assertPisiDomainMapPath(payload.mapPath);
        const detached = structuredNodes.detachPisiMapReference(safeMapPath, String(payload.nodeId || ''));
        if (!detached.ok) return detached;
        const refreshed = mapSemanticOperations.getPisiMapSemanticProjection(safeMapPath);
        return {
            ...detached,
            edges: refreshed.ok ? refreshed.edges : []
        };
    });

    registerPisiDomainCommand('map.node.create.v1', (payload) => {
        return documentStore.createNodeUnderMap(assertPisiDomainMapPath(payload.mapPath));
    });

    registerPisiDomainCommand('project.item.rename.v1', (payload) => {
        const safeOldPath = electronIpc.assertProjectPath(payload.oldPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return attachRequiredPisiTaskReferenceRewrite(documentStore.renamePisiFile(safeOldPath, payload.newBaseName));
    });

    registerPisiDomainCommand('project.item.move.v1', (payload) => {
        const safeSourcePath = electronIpc.assertProjectPath(payload.sourcePath);
        const safeDestinationPath = electronIpc.assertProjectPath(payload.destinationFolderPath, { type: 'directory' });
        if (electronIpc.normalizePathForCompare(safeSourcePath) === electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)) {
            throw new Error('Aktif proje kökü taşınamaz.');
        }
        const safeOptions = { ...(payload.options || {}) };
        if (safeOptions.parentMapPath) {
            safeOptions.parentMapPath = assertPisiDomainMapPath(safeOptions.parentMapPath);
        }
        return attachRequiredPisiTaskReferenceRewrite(mapStore.movePisiItem(safeSourcePath, safeDestinationPath, safeOptions));
    });

    registerPisiDomainCommand('project.item.delete.v1', async (payload) => {
        const safeTargetPath = electronIpc.assertProjectPath(payload.targetPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        const result = await projectOperations.deletePisiFile(safeTargetPath);
        if (!result?.ok || result.type !== 'node' || !result.parentMapPath) {
            return result;
        }

        const refreshed = mapSemanticOperations.getPisiMapSemanticProjection(result.parentMapPath);
        return {
            ...result,
            edges: refreshed.ok ? refreshed.edges : []
        };
    });

    registerPisiDomainCommand('project.path.delete.v1', async (payload) => {
        const safeTargetPath = electronIpc.assertProjectPath(payload.targetPath);
        if (electronIpc.normalizePathForCompare(safeTargetPath) === electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)) {
            throw new Error('Aktif proje kökü bu işlemle silinemez.');
        }
        atomicMutation.capturePisiAtomicPathBeforeChange(safeTargetPath);
        return projectOperations.deleteProjectPath(safeTargetPath);
    });

    registerPisiDomainCommand('project.batch.v1', async (payload) => {
        const safeProjectFolder = assertPisiDomainProjectRoot(payload.projectFolder);
        const operations = Array.isArray(payload.operations) ? payload.operations : [];
        if (!operations.length || operations.length > 100) {
            return {
                ok: false,
                code: 'INVALID_BATCH',
                error: 'Bulk mutation 1 ile 100 işlem içermeli.'
            };
        }
        const results = [];
        for (let index = 0; index < operations.length; index += 1) {
            const item = operations[index] || {};
            const command = String(item.command || '');
            if (!PISI_BATCH_MUTATION_COMMANDS.has(command)) {
                return {
                    ok: false,
                    code: 'BATCH_COMMAND_NOT_ALLOWED',
                    error: `Bulk mutation için izin verilmeyen command: ${command}`,
                    failedIndex: index,
                    results
                };
            }
            const result = await executePisiDomainCommand(command, {
                ...(item.payload || {}),
                projectFolder: item.payload?.projectFolder || safeProjectFolder
            });
            results.push(result);
            if (!result?.ok) {
                return {
                    ok: false,
                    code: result?.code || 'BATCH_OPERATION_FAILED',
                    error: result?.error || `Bulk mutation ${index}. adımda başarısız.`,
                    failedIndex: index,
                    results
                };
            }
        }
        return { ok: true, results };
    });
}

function bindPisiDomainIpc() {
    ipcMain.removeHandler('pisi:domain-query');
    ipcMain.handle('pisi:domain-query', (_event, name, payload = {}) => {
        return electronIpc.projectOperation(() => executePisiDomainQuery(name, payload));
    });

    ipcMain.removeHandler('pisi:domain-command');
    ipcMain.handle('pisi:domain-command', (_event, name, payload = {}) => {
        return electronIpc.asyncProjectOperation(() => executePisiDomainCommand(name, payload));
    });
}

installPisiDomainContracts();
bindPisiDomainIpc();

const moduleApi = {
    PISI_DOMAIN_CONTRACT_VERSION,
    PISI_ATOMIC_DOMAIN_COMMANDS,
    pisiDomainQueries,
    pisiDomainCommands,
    registerPisiDomainQuery,
    registerPisiDomainCommand,
    executePisiDomainQuery,
    executePisiDomainCommand
};

registerMainModule('main.domainCommandQuery', moduleApi);
