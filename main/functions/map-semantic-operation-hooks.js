'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { modules, registerMainModule } = require('../module-registry');

const documentStore = modules['main.documentStore'];
const mapStore = modules['main.mapStore'];
const structuredNodes = modules['main.structuredNodes'];
const relationshipStore = modules['main.relationshipStore'];
const mapSemanticCore = modules['main.mapSemanticCore'];
const mapOperationalStore = modules['main.mapOperationalStore'];
const electronIpc = modules['main.electronIpc'];

function getPisiSemanticProjectFolder(targetPath = null) {
    const projectFolder = globalThis.activeProjectFolder;
    if (!projectFolder) {
        throw new Error('Aktif proje klasörü yok.');
    }
    if (targetPath) {
        const relative = path.relative(projectFolder, targetPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Semantic relationship işlemi proje dışına çıkamaz.');
        }
    }
    fs.mkdirSync(path.join(projectFolder, '.pisi'), { recursive: true });
    return projectFolder;
}

function writePisiMapSemanticState(mapPath, mapInfo) {
    mapInfo.data.pisi.updatedAt = new Date().toISOString();
    modules['main.filesystemCore'].writePisiDocument(mapPath, mapInfo.data);
}

function getPisiMapSemanticProjection(mapPath, baseResult = null) {
    const base = baseResult || mapStore.listNodesForMap(mapPath);
    if (!base.ok) return base;

    const projectFolder = getPisiSemanticProjectFolder(mapPath);
    const nodeIds = new Set(
        (base.nodes || []).map((node) => node?.id).filter(Boolean)
    );
    const relationshipResult = relationshipStore.listPisiSemanticRelationships(
        projectFolder,
        { nodeIds }
    );
    if (!relationshipResult.ok) return relationshipResult;

    const freshMapInfo = documentStore.ensurePisiFileMetadata(mapPath);
    if (!freshMapInfo.ok) return freshMapInfo;
    const rawViews = freshMapInfo.data.map?.relationshipViews || [];
    const edges = mapSemanticCore.projectPisiRelationshipsForMap(
        relationshipResult.relationships,
        rawViews
    );

    mapSemanticCore.applyPisiDerivedConnectionTypes(
        base.nodes || [],
        relationshipResult.relationships
    );

    return {
        ...base,
        edges,
        operational: mapOperationalStore.normalizePisiOperationalMapState(
            freshMapInfo.data.map?.operational
        ),
        relationshipAuthority: relationshipResult.filePath,
        mapStateAuthority: mapPath,
        relationshipWarnings: relationshipResult.warnings || []
    };
}

function persistPisiRelationshipView(mapPath, relationship, presentation = {}) {
    const mapInfo = documentStore.ensurePisiFileMetadata(mapPath);
    if (!mapInfo.ok) return mapInfo;
    if (!mapInfo.data.map || typeof mapInfo.data.map !== 'object') {
        return { ok: false, error: 'Map state bulunamadı.' };
    }

    mapSemanticCore.upsertPisiRelationshipView(
        mapInfo.data.map,
        relationship,
        presentation
    );
    writePisiMapSemanticState(mapPath, mapInfo);
    return { ok: true };
}

function removePisiRelationshipViewFromMap(mapPath, relationshipId) {
    const mapInfo = documentStore.ensurePisiFileMetadata(mapPath);
    if (!mapInfo.ok) return mapInfo;
    if (!mapInfo.data.map || typeof mapInfo.data.map !== 'object') {
        return { ok: false, error: 'Map state bulunamadı.' };
    }
    mapSemanticCore.removePisiRelationshipView(
        mapInfo.data.map,
        relationshipId
    );
    if (Object.prototype.hasOwnProperty.call(mapInfo.data.map, 'edges')) {
        }
    writePisiMapSemanticState(mapPath, mapInfo);
    return { ok: true };
}

function upsertPisiMapSemanticConnection(mapPath, edge = {}) {
    const projection = getPisiMapSemanticProjection(mapPath);
    if (!projection.ok) return projection;

    const validNodeIds = new Set(
        (projection.nodes || []).map((node) => node?.id).filter(Boolean)
    );
    const normalized = modules['main.filesystemCore'].normalizeMapEdge(edge);
    if (!normalized) {
        return { ok: false, error: 'Bağlantı normalize edilemedi.' };
    }
    if (
        !validNodeIds.has(normalized.sourceId) ||
        !validNodeIds.has(normalized.targetId)
    ) {
        return {
            ok: false,
            error: 'Semantic ilişkinin source veya target node’u bu map görünümünde yok.'
        };
    }

    const projectFolder = getPisiSemanticProjectFolder(mapPath);
    const saved = relationshipStore.upsertPisiSemanticRelationship(
        projectFolder,
        normalized,
        {
            confirmSecondParentAsStream: edge.confirmSecondParentAsStream === true
        }
    );
    if (!saved.ok) {
        if (saved.suggestedRelationship) {
            return {
                ...saved,
                suggestedEdge: mapSemanticCore.projectPisiSemanticRelationshipToMapEdge(
                    saved.suggestedRelationship,
                    normalized
                )
            };
        }
        return saved;
    }

    const viewResult = persistPisiRelationshipView(
        mapPath,
        saved.relationship,
        normalized
    );
    if (!viewResult.ok) return viewResult;

    const refreshed = getPisiMapSemanticProjection(mapPath);
    return {
        ok: true,
        edge: mapSemanticCore.projectPisiSemanticRelationshipToMapEdge(
            saved.relationship,
            normalized
        ),
        edges: refreshed.ok ? refreshed.edges : [],
        relationship: saved.relationship
    };
}

function deletePisiMapSemanticConnection(mapPath, relationshipId) {
    const projectFolder = getPisiSemanticProjectFolder(mapPath);
    const deleted = relationshipStore.deletePisiSemanticRelationship(
        projectFolder,
        relationshipId
    );
    if (!deleted.ok) return deleted;

    const viewResult = removePisiRelationshipViewFromMap(
        mapPath,
        relationshipId
    );
    if (!viewResult.ok) return viewResult;

    const refreshed = getPisiMapSemanticProjection(mapPath);
    return {
        ok: true,
        deletedEdgeId: relationshipId,
        deletedRelationshipId: relationshipId,
        edges: refreshed.ok ? refreshed.edges : []
    };
}

function reparentPisiMapSemanticNode(mapPath, childId, parentId) {
    const projection = getPisiMapSemanticProjection(mapPath);
    if (!projection.ok) return projection;
    const validNodeIds = new Set(
        (projection.nodes || []).map((node) => node?.id).filter(Boolean)
    );
    if (!validNodeIds.has(childId) || !validNodeIds.has(parentId)) {
        return { ok: false, error: 'Parent veya child node map içinde bulunamadı.' };
    }

    const projectFolder = getPisiSemanticProjectFolder(mapPath);
    const before = relationshipStore.listPisiSemanticRelationships(projectFolder);
    const oldHierarchyIds = before.ok
        ? before.relationships
            .filter((relationship) => {
                return modules['main.filesystemCore'].isHierarchyEdge(relationship) &&
                    relationship.targetId === childId;
            })
            .map((relationship) => relationship.id)
        : [];

    const saved = relationshipStore.reparentPisiSemanticRelationship(
        projectFolder,
        childId,
        parentId
    );
    if (!saved.ok) return saved;

    const mapInfo = documentStore.ensurePisiFileMetadata(mapPath);
    if (!mapInfo.ok) return mapInfo;
    for (const oldId of oldHierarchyIds) {
        mapSemanticCore.removePisiRelationshipView(mapInfo.data.map, oldId);
    }
    mapSemanticCore.upsertPisiRelationshipView(
        mapInfo.data.map,
        saved.relationship,
        { sourcePort: 'bottom', targetPort: 'top' }
    );
    writePisiMapSemanticState(mapPath, mapInfo);

    const refreshed = getPisiMapSemanticProjection(mapPath);
    return {
        ok: true,
        edge: mapSemanticCore.projectPisiSemanticRelationshipToMapEdge(
            saved.relationship,
            { relationshipId: saved.relationship.id }
        ),
        edges: refreshed.ok ? refreshed.edges : []
    };
}

function savePisiOperationalPayload(mapPath, payload) {
    if (!payload || typeof payload !== 'object') return null;
    return mapOperationalStore.savePisiOperationalMapState(mapPath, payload);
}

function bindPisiMapSemanticOperationHooks() {
    const projectOperation = electronIpc.projectOperation;
    const assertProjectPath = electronIpc.assertProjectPath;

    ipcMain.handle('project:list-map-nodes', (_event, mapPath) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return getPisiMapSemanticProjection(safeMapPath);
        });
    });

    ipcMain.handle('project:upsert-map-connection', (_event, mapPath, edge) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return upsertPisiMapSemanticConnection(safeMapPath, edge || {});
        });
    });

    ipcMain.handle('project:delete-map-connection', (_event, mapPath, edgeId) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return deletePisiMapSemanticConnection(safeMapPath, String(edgeId || ''));
        });
    });

    ipcMain.handle('project:reparent-map-node', (_event, mapPath, childId, parentId) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return reparentPisiMapSemanticNode(safeMapPath, childId, parentId);
        });
    });

    ipcMain.handle('project:save-map-layout', (_event, mapPath, nodeLayouts) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return mapStore.saveMapNodeLayout(safeMapPath, nodeLayouts);
        });
    });

    ipcMain.handle('project:save-map-camera', (_event, mapPath, camera) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            const cameraResult = mapStore.saveMapCamera(safeMapPath, camera || {});
            if (!cameraResult.ok) return cameraResult;
            const operationalResult = savePisiOperationalPayload(
                safeMapPath,
                camera?.operationalPayload
            );
            if (operationalResult && !operationalResult.ok) {
                return operationalResult;
            }
            return {
                ...cameraResult,
                ...(operationalResult ? { operational: operationalResult.state } : {})
            };
        });
    });

    ipcMain.handle('project:detach-map-reference', (_event, mapPath, nodeId) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            const detached = structuredNodes.detachPisiMapReference(
                safeMapPath,
                nodeId
            );
            if (!detached.ok) return detached;
            const refreshed = getPisiMapSemanticProjection(safeMapPath);
            return {
                ...detached,
                edges: refreshed.ok ? refreshed.edges : []
            };
        });
    });
}

bindPisiMapSemanticOperationHooks();

const moduleApi = {
    getPisiSemanticProjectFolder,
    getPisiMapSemanticProjection,
    persistPisiRelationshipView,
    removePisiRelationshipViewFromMap,
    upsertPisiMapSemanticConnection,
    deletePisiMapSemanticConnection,
    reparentPisiMapSemanticNode,
    savePisiOperationalPayload,
    bindPisiMapSemanticOperationHooks
};

registerMainModule('main.mapSemanticOperationHooks', moduleApi);