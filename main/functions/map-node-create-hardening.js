'use strict';

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { registerMainModule } = require('../module-registry');

const PISI_MAP_NODE_CREATE_HARDENING_VERSION = 1;

function ensurePisiMapDataForNodeCreate(mapInfo) {
    if (
        !mapInfo?.data?.map ||
        typeof mapInfo.data.map !== 'object' ||
        Array.isArray(mapInfo.data.map)
    ) {
        mapInfo.data.map = {
            nodes: [],
            edges: [],
            camera: { x: 0, y: 0, zoom: 1 }
        };
    }

    if (!Array.isArray(mapInfo.data.map.nodes)) {
        mapInfo.data.map.nodes = [];
    }

    if (!Array.isArray(mapInfo.data.map.edges)) {
        mapInfo.data.map.edges = [];
    }

    if (!mapInfo.data.map.camera || typeof mapInfo.data.map.camera !== 'object') {
        mapInfo.data.map.camera = { x: 0, y: 0, zoom: 1 };
    }

    return mapInfo.data.map;
}

function getPisiNewNodeLayoutIndex(layouts) {
    return layouts.reduce((count, layout) => {
        return normalizePisiId(layout?.id, '.node') ? count + 1 : count;
    }, 0);
}

function makePisiCreatedMapNode(mapPath, mapInfo, nodeInfo) {
    const nodeDocument = ensurePisiFileMetadata(nodeInfo.fullPath);
    if (!nodeDocument?.ok) return nodeDocument;

    const mapData = ensurePisiMapDataForNodeCreate(mapInfo);
    const nodeId = nodeDocument.metadata.id;
    const layoutIndex = getPisiNewNodeLayoutIndex(mapData.nodes);
    const fallbackLayout = getDefaultNodeLayout(layoutIndex);
    let storedLayout = mapData.nodes.find((item) => item?.id === nodeId);

    if (!storedLayout) {
        storedLayout = {
            id: nodeId,
            ...fallbackLayout
        };
        mapData.nodes.push(storedLayout);
    }

    const normalizedLayout = normalizePisiNodeLayout(
        storedLayout,
        fallbackLayout
    );
    Object.assign(storedLayout, normalizedLayout);

    const customization = normalizePisiMapNodeCustomization(
        storedLayout.customization
    );
    if (Object.keys(customization).length) {
        storedLayout.customization = customization;
    } else {
        delete storedLayout.customization;
    }

    mapInfo.data.pisi.updatedAt = new Date().toISOString();
    writePisiDocument(mapPath, mapInfo.data);

    const content = String(nodeDocument.data.content || '');
    return {
        ok: true,
        node: {
            id: nodeId,
            fullPath: nodeInfo.fullPath,
            fileName: nodeInfo.fileName || path.basename(nodeInfo.fullPath),
            metadata: nodeDocument.metadata,
            properties: nodeDocument.data.properties || {},
            content,
            preview: stripPreviewText(content),
            layout: normalizedLayout,
            customization,
            isReference: false
        }
    };
}

function createPisiMapNodeResilient(mapPath) {
    try {
        if (!mapPath || !fs.existsSync(mapPath)) {
            return {
                ok: false,
                error: 'Map dosyası bulunamadı.'
            };
        }

        if (getPisiFileExt(mapPath) !== '.map') {
            return {
                ok: false,
                error: 'Node sadece .map dosyası altında oluşturulabilir.'
            };
        }

        const mapInfo = ensurePisiFileMetadata(mapPath);
        if (!mapInfo?.ok) return mapInfo;
        if (mapInfo.metadata?.type !== 'map') {
            return {
                ok: false,
                error: 'Bu dosya bir map değil.'
            };
        }

        const mapSidecarPath = mapInfo.sidecarPath;
        if (!mapSidecarPath || !fs.existsSync(mapSidecarPath)) {
            return {
                ok: false,
                error: 'Map bağlantı klasörü bulunamadı.'
            };
        }

        const nodeInfo = createUniquePisiFile(mapSidecarPath, '.node', {
            parentMap: mapInfo.metadata.id
        });
        if (!nodeInfo?.ok) {
            return nodeInfo || {
                ok: false,
                error: 'Node oluşturulamadı.'
            };
        }

        const created = makePisiCreatedMapNode(mapPath, mapInfo, nodeInfo);
        if (!created?.ok) return created;

        return {
            ...nodeInfo,
            parentMap: mapInfo.metadata.id,
            mapPath,
            mapSidecarPath,
            node: created.node
        };
    } catch (error) {
        return {
            ok: false,
            code: String(error?.code || 'MAP_NODE_CREATE_FAILED'),
            error: error.message
        };
    }
}

function installPisiMapNodeCreateHardening() {
    ipcMain.removeHandler('project:create-node-under-map');
    ipcMain.handle('project:create-node-under-map', (_event, mapPath) => {
        return projectOperation(() => {
            const safeMapPath = assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return createPisiMapNodeResilient(safeMapPath);
        });
    });
}

const moduleApi = {
    PISI_MAP_NODE_CREATE_HARDENING_VERSION,
    createPisiMapNodeResilient,
    installPisiMapNodeCreateHardening
};

registerMainModule('main.mapNodeCreateHardening', moduleApi);
installPisiMapNodeCreateHardening();
