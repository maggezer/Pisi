'use strict';

const path = require('path');
const { ipcMain } = require('electron');
const { modules, registerMainModule } = require('../module-registry');

const electronIpc = modules['main.electronIpc'];
const taskCapture = modules['main.taskCapture'];
const taskStore = modules['main.taskStore'];
const mapStore = modules['main.mapStore'];
const documentStore = modules['main.documentStore'];
const structuredNodes = modules['main.structuredNodes'];
const mapOperationalStore = modules['main.mapOperationalStore'];
const mapSemanticOperations = modules['main.mapSemanticOperationHooks'];

const PISI_DOMAIN_CONTRACT_VERSION = 1;
const pisiDomainQueries = new Map();
const pisiDomainCommands = new Map();

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
        return handler(payload || {});
    } catch (error) {
        return {
            ok: false,
            code: 'DOMAIN_QUERY_FAILED',
            error: error.message
        };
    }
}

function executePisiDomainCommand(name, payload = {}) {
    const handler = pisiDomainCommands.get(String(name || ''));
    if (!handler) {
        return {
            ok: false,
            code: 'DOMAIN_COMMAND_NOT_FOUND',
            error: `Bilinmeyen domain command: ${String(name || '')}`
        };
    }
    try {
        return handler(payload || {});
    } catch (error) {
        return {
            ok: false,
            code: 'DOMAIN_COMMAND_FAILED',
            error: error.message
        };
    }
}

function assertPisiDomainProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, {
        type: 'directory'
    });
    const activeProjectFolder = globalThis.activeProjectFolder;
    if (
        !activeProjectFolder ||
        electronIpc.normalizePathForCompare(safeProjectFolder) !==
            electronIpc.normalizePathForCompare(activeProjectFolder)
    ) {
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

function installPisiDomainContracts() {
    registerPisiDomainQuery('task.list.v1', (payload) => {
        return taskStore.listPisiFirstClassTasks(
            assertPisiDomainProjectRoot(payload.projectFolder)
        );
    });

    registerPisiDomainQuery('document.read.v1', (payload) => {
        return mapStore.getPisiDocument(
            assertPisiDomainDocumentPath(payload.filePath)
        );
    });

    registerPisiDomainQuery('map.projection.v1', (payload) => {
        return mapSemanticOperations.getPisiMapSemanticProjection(
            assertPisiDomainMapPath(payload.mapPath)
        );
    });

    registerPisiDomainQuery('map.operational.v1', (payload) => {
        const result = mapOperationalStore.readPisiOperationalMapState(
            assertPisiDomainMapPath(payload.mapPath)
        );
        return result.ok
            ? { ok: true, operational: result.state }
            : result;
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
        return taskStore.updatePisiFirstClassTask(
            safeProjectFolder,
            String(payload.taskId || ''),
            payload.patch || {}
        );
    });

    registerPisiDomainCommand('task.delete.v1', (payload) => {
        return taskStore.deletePisiFirstClassTask(
            assertPisiDomainProjectRoot(payload.projectFolder),
            String(payload.taskId || '')
        );
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
        return mapSemanticOperations.upsertPisiMapSemanticConnection(
            assertPisiDomainMapPath(payload.mapPath),
            payload.relationship || payload.edge || {}
        );
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
        const migrated = mapSemanticOperations.migratePisiLegacyMapRelationships(safeMapPath);
        if (!migrated.ok) return migrated;
        return mapStore.saveMapNodeLayout(
            safeMapPath,
            Array.isArray(payload.nodes) ? payload.nodes : []
        );
    });

    registerPisiDomainCommand('map.operational.mutate.v1', (payload) => {
        return mapOperationalStore.savePisiOperationalMapState(
            assertPisiDomainMapPath(payload.mapPath),
            payload.operation || payload.operationalPayload || {}
        );
    });

    registerPisiDomainCommand('map.camera.save.v1', (payload) => {
        const safeMapPath = assertPisiDomainMapPath(payload.mapPath);
        const migrated = mapSemanticOperations.migratePisiLegacyMapRelationships(safeMapPath);
        if (!migrated.ok) return migrated;
        const camera = { ...(payload.camera || {}) };
        delete camera.operationalPayload;
        const cameraResult = mapStore.saveMapCamera(safeMapPath, camera);
        if (!cameraResult.ok) return cameraResult;
        const operation = payload.operationalPayload || payload.camera?.operationalPayload;
        if (!operation) return cameraResult;
        const operationalResult = executePisiDomainCommand(
            'map.operational.mutate.v1',
            { mapPath: safeMapPath, operation }
        );
        if (!operationalResult.ok) return operationalResult;
        return {
            ...cameraResult,
            operational: operationalResult.state
        };
    });

    registerPisiDomainCommand('map.reference.detach.v1', (payload) => {
        const safeMapPath = assertPisiDomainMapPath(payload.mapPath);
        const migrated = mapSemanticOperations.migratePisiLegacyMapRelationships(safeMapPath);
        if (!migrated.ok) return migrated;
        const detached = structuredNodes.detachPisiMapReference(
            safeMapPath,
            String(payload.nodeId || '')
        );
        if (!detached.ok) return detached;
        const refreshed = mapSemanticOperations.getPisiMapSemanticProjection(safeMapPath);
        return {
            ...detached,
            edges: refreshed.ok ? refreshed.edges : []
        };
    });

    registerPisiDomainCommand('map.node.create.v1', (payload) => {
        return documentStore.createNodeUnderMap(
            assertPisiDomainMapPath(payload.mapPath)
        );
    });
}

function bindPisiDomainCompatibilityIpc() {
    ipcMain.removeHandler('project:quick-add-task');
    ipcMain.handle('project:quick-add-task', (_event, projectFolder, payload = {}) => {
        return electronIpc.projectOperation(() => {
            const operation = String(payload?.op || 'add').toLowerCase();
            if (operation === 'list') {
                return executePisiDomainQuery('task.list.v1', { projectFolder });
            }
            if (operation === 'upsert') {
                return executePisiDomainCommand('task.upsert.v1', {
                    projectFolder,
                    task: payload.task || payload
                });
            }
            if (operation === 'update') {
                return executePisiDomainCommand('task.update.v1', {
                    projectFolder,
                    taskId: payload.taskId || payload.id,
                    patch: payload.patch || payload.task || {}
                });
            }
            if (operation === 'delete') {
                return executePisiDomainCommand('task.delete.v1', {
                    projectFolder,
                    taskId: payload.taskId || payload.id
                });
            }
            if (operation === 'sync-index') {
                return executePisiDomainCommand('task.sync-projection.v1', {
                    projectFolder,
                    complete: payload.complete,
                    pruneMissing: payload.pruneMissing,
                    tasks: payload.tasks
                });
            }
            return executePisiDomainCommand('task.capture.v1', {
                projectFolder,
                task: payload
            });
        });
    });

    ipcMain.removeHandler('project:get-pisi-document');
    ipcMain.handle('project:get-pisi-document', (_event, filePath) => {
        return electronIpc.projectOperation(() => {
            return executePisiDomainQuery('document.read.v1', { filePath });
        });
    });

    ipcMain.removeHandler('project:list-map-nodes');
    ipcMain.handle('project:list-map-nodes', (_event, mapPath) => {
        return electronIpc.projectOperation(() => {
            return executePisiDomainQuery('map.projection.v1', { mapPath });
        });
    });

    ipcMain.removeHandler('project:upsert-map-connection');
    ipcMain.handle('project:upsert-map-connection', (_event, mapPath, edge) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.relationship.upsert.v1',
            { mapPath, edge }
        ));
    });

    ipcMain.removeHandler('project:delete-map-connection');
    ipcMain.handle('project:delete-map-connection', (_event, mapPath, edgeId) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.relationship.delete.v1',
            { mapPath, edgeId }
        ));
    });

    ipcMain.removeHandler('project:reparent-map-node');
    ipcMain.handle('project:reparent-map-node', (_event, mapPath, childId, parentId) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.relationship.reparent.v1',
            { mapPath, childId, parentId }
        ));
    });

    ipcMain.removeHandler('project:save-map-layout');
    ipcMain.handle('project:save-map-layout', (_event, mapPath, nodeLayouts) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.layout.save.v1',
            { mapPath, nodes: nodeLayouts }
        ));
    });

    ipcMain.removeHandler('project:save-map-camera');
    ipcMain.handle('project:save-map-camera', (_event, mapPath, camera = {}) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.camera.save.v1',
            {
                mapPath,
                camera,
                operationalPayload: camera?.operationalPayload
            }
        ));
    });

    ipcMain.removeHandler('project:detach-map-reference');
    ipcMain.handle('project:detach-map-reference', (_event, mapPath, nodeId) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.reference.detach.v1',
            { mapPath, nodeId }
        ));
    });

    ipcMain.removeHandler('project:create-node-under-map');
    ipcMain.handle('project:create-node-under-map', (_event, mapPath) => {
        return electronIpc.projectOperation(() => executePisiDomainCommand(
            'map.node.create.v1',
            { mapPath }
        ));
    });
}

installPisiDomainContracts();
bindPisiDomainCompatibilityIpc();

const moduleApi = {
    PISI_DOMAIN_CONTRACT_VERSION,
    pisiDomainQueries,
    pisiDomainCommands,
    registerPisiDomainQuery,
    registerPisiDomainCommand,
    executePisiDomainQuery,
    executePisiDomainCommand,
    bindPisiDomainCompatibilityIpc
};

registerMainModule('main.domainCommandQuery', moduleApi);
