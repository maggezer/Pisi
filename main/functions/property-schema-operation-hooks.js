'use strict';

const { ipcMain } = require('electron');
const { registerMainModule } = require('../module-registry');

function getActivePropertyProjectFolder() {
    const projectFolder = globalThis.activeProjectFolder;
    if (!projectFolder) {
        return { ok: false, code: 'NO_ACTIVE_PROJECT', error: 'Aktif proje klasörü yok.' };
    }
    return { ok: true, projectFolder };
}

function getPisiStableNodePropertyContext(nodePath, preferredMapPath) {
    const active = getActivePropertyProjectFolder();
    if (!active.ok) return active;
    const safeNodePath = assertProjectPath(nodePath, {
        type: 'file',
        extensions: ['.node']
    });
    const nodeInfo = getPisiDocument(safeNodePath);
    if (!nodeInfo?.ok) return nodeInfo;

    const finish = (schemaResult) => {
        if (!schemaResult?.ok) return schemaResult;
        let mapPath = null;
        let mapResult = null;

        if (preferredMapPath) {
            const safePreferredMapPath = assertProjectPath(preferredMapPath, {
                type: 'file',
                extensions: ['.map']
            });
            const preferredResult = listNodesForMap(safePreferredMapPath);
            const belongsToPreferredMap = preferredResult?.ok &&
                preferredResult.nodes.some((node) => {
                    return node.id === nodeInfo.metadata?.id ||
                        normalizePathForCompare(node.fullPath) === normalizePathForCompare(safeNodePath);
                });
            if (belongsToPreferredMap) {
                mapPath = safePreferredMapPath;
                mapResult = preferredResult;
            }
        }

        if (!mapPath) {
            mapPath = findParentMapPathForNode(safeNodePath, nodeInfo);
            if (mapPath) mapResult = listNodesForMap(mapPath);
        }

        if (!mapPath) {
            return {
                ok: true,
                mapPath: null,
                nodes: [],
                propertySchemaVersion: schemaResult.version,
                propertyDefinitions: schemaResult.definitions,
                propertySchemaConflicts: schemaResult.conflicts || []
            };
        }
        if (!mapResult?.ok) return mapResult;
        return {
            ...mapResult,
            mapPath,
            propertySchemaVersion: schemaResult.version,
            propertyDefinitions: schemaResult.definitions,
            propertySchemaConflicts: schemaResult.conflicts || []
        };
    };

    const schemaResult = getPisiPropertySchemaDefinitions(active.projectFolder);
    return schemaResult?.then ? schemaResult.then(finish) : finish(schemaResult);
}

function rebindPisiPropertySchemaIpc() {
    ipcMain.removeHandler('project:get-node-property-context');
    ipcMain.handle('project:get-node-property-context', (_event, nodePath, preferredMapPath) => {
        return asyncProjectOperation(() => getPisiStableNodePropertyContext(nodePath, preferredMapPath));
    });

    ipcMain.removeHandler('project:save-node-properties');
    ipcMain.handle('project:save-node-properties', (_event, nodePath, properties) => {
        return asyncProjectOperation(() => {
            const active = getActivePropertyProjectFolder();
            if (!active.ok) return active;
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            return savePisiNodePropertiesStable(
                active.projectFolder,
                safeNodePath,
                properties || {}
            );
        });
    });

    ipcMain.removeHandler('project:list-database-templates');
    ipcMain.handle('project:list-database-templates', (_event, projectFolder) => {
        return asyncProjectOperation(async () => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            const schema = await Promise.resolve(ensurePisiPropertySchema(safeProjectFolder));
            if (!schema?.ok) return schema;
            const result = readPisiDatabaseTemplates(safeProjectFolder);
            return result?.ok ? {
                ...result,
                propertyDefinitions: schema.schema.definitions,
                propertySchemaVersion: schema.schema.version
            } : result;
        });
    });

    ipcMain.removeHandler('project:save-database-template');
    ipcMain.handle('project:save-database-template', (_event, projectFolder, template) => {
        return asyncProjectOperation(() => {
            const safeProjectFolder = assertProjectPath(projectFolder, {
                type: 'directory'
            });
            return savePisiDatabaseTemplateStable(safeProjectFolder, template || {});
        });
    });

    ipcMain.removeHandler('project:apply-database-template');
    ipcMain.handle('project:apply-database-template', (_event, nodePath, templateId, options) => {
        return asyncProjectOperation(() => {
            const active = getActivePropertyProjectFolder();
            if (!active.ok) return active;
            const safeNodePath = assertProjectPath(nodePath, {
                type: 'file',
                extensions: ['.node']
            });
            return applyPisiDatabaseTemplateStable(
                active.projectFolder,
                safeNodePath,
                templateId,
                options || {}
            );
        });
    });
}

rebindPisiPropertySchemaIpc();

const moduleApi = {
    getPisiStableNodePropertyContext,
    rebindPisiPropertySchemaIpc
};
registerMainModule('main.propertySchemaOperationHooks', moduleApi);