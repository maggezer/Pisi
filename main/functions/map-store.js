import { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } from '../electron-bridge.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { registerMainModule } from '../module-registry.js';
import * as editorAssets from './editor-asset-store.js';

function getUniqueDirectoryPath(destinationFolder, wantedName) {
    const cleanName = sanitizePisiBaseName(wantedName || translatePisiMain('Yeni Klasör'));
    let candidate = path.join(destinationFolder, cleanName);

    if (!fs.existsSync(candidate)) {
        return candidate;
    }

    let counter = 1;

    while (true) {
        candidate = path.join(destinationFolder, `${cleanName} ${counter}`);

        if (!fs.existsSync(candidate)) {
            return candidate;
        }

        counter++;
    }
}

function isPathInsideDirectory(childPath, parentPath) {
    const relative = path.relative(parentPath, childPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function movePisiItem(sourcePath, destinationFolderPath, options = {}) {
    let movedPath = null;
    let movedSidecarPath = null;
    let originalSidecarPath = null;
    let originalContent = null;
    let sourceWasDirectory = false;
    let fileMoved = false;
    let sidecarMoved = false;

    try {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return {
                ok: false,
                error: 'Taşınacak öğe bulunamadı.'
            };
        }

        if (!destinationFolderPath || !fs.existsSync(destinationFolderPath)) {
            return {
                ok: false,
                error: 'Hedef klasör bulunamadı.'
            };
        }

        const destinationStat = fs.statSync(destinationFolderPath);

        if (!destinationStat.isDirectory()) {
            return {
                ok: false,
                error: 'Hedef bir klasör olmalı.'
            };
        }

        const sourceStat = fs.statSync(sourcePath);
        const sourceDir = path.dirname(sourcePath);

        if (normalizePathForCompare(sourceDir) === normalizePathForCompare(destinationFolderPath)) {
            return {
                ok: true,
                unchanged: true,
                fullPath: sourcePath,
                fileName: path.basename(sourcePath)
            };
        }

        if (sourceStat.isDirectory()) {
            sourceWasDirectory = true;
            if (
                normalizePathForCompare(sourcePath) === normalizePathForCompare(destinationFolderPath) ||
                isPathInsideDirectory(destinationFolderPath, sourcePath)
            ) {
                return {
                    ok: false,
                    error: 'Bir klasör kendi içine taşınamaz.'
                };
            }

            const newDirPath = getUniqueDirectoryPath(destinationFolderPath, path.basename(sourcePath));
            renamePathInternal(sourcePath, newDirPath);
            movedPath = newDirPath;
            fileMoved = true;

            return {
                ok: true,
                type: 'folder',
                oldPath: sourcePath,
                fullPath: newDirPath,
                fileName: path.basename(newDirPath),
                pathChanges: [
                    {
                        oldPath: sourcePath,
                        newPath: newDirPath
                    }
                ],
                isDirectory: true,
                isFile: false
            };
        }

        const ext = getPisiFileExt(sourcePath);

        if (ext !== '.node' && ext !== '.map') {
            return {
                ok: false,
                error: 'Sadece .node, .map ve klasörler taşınabilir.'
            };
        }

        const info = ensurePisiFileMetadata(sourcePath);
        if (!info.ok) return info;
        originalContent = fs.readFileSync(sourcePath, 'utf-8');

        const id = info.metadata.id;
        const title = sanitizePisiBaseName(info.metadata.title || getVisibleTitleFromFilePath(sourcePath, ext, id));
        const newPath = getUniquePisiPhysicalPath(destinationFolderPath, title, ext, id);
        const oldSidecarPath = info.sidecarPath && fs.existsSync(info.sidecarPath) ? info.sidecarPath : null;
        originalSidecarPath = oldSidecarPath;
        const desiredSidecarName = getPisiSidecarName(title, ext, id);
        const desiredSidecarPath = desiredSidecarName ? path.join(destinationFolderPath, desiredSidecarName) : null;
        const oldParentMapPath = ext === '.node' ? findParentMapPathForNode(sourcePath, info) : null;

        if (
            oldSidecarPath &&
            desiredSidecarPath &&
            fs.existsSync(desiredSidecarPath) &&
            normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(desiredSidecarPath)
        ) {
            return {
                ok: false,
                error: 'Hedefte aynı PISI yan klasörü zaten var.'
            };
        }

        if (normalizePathForCompare(sourcePath) !== normalizePathForCompare(newPath)) {
            renamePathInternal(sourcePath, newPath);
            movedPath = newPath;
            fileMoved = true;
        }

        if (oldSidecarPath && desiredSidecarPath && normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(desiredSidecarPath)) {
            renamePathInternal(oldSidecarPath, desiredSidecarPath);
            movedSidecarPath = desiredSidecarPath;
            sidecarMoved = true;
        }

        const data = readJsonFileSafe(newPath) || info.data;

        if (!data.pisi) data.pisi = {};

        data.pisi.title = title;
        data.pisi.sidecar = desiredSidecarName;
        data.pisi.updatedAt = new Date().toISOString();

        if (ext === '.node') {
            data.pisi.parentMap = options.parentMapId || 'none';
        }

        if (ext === '.map') {
            delete data.pisi.parentMap;
            delete data.pisi.connectionTypes;
        }

        writePisiDocument(newPath, data);

        const ensuredAfter = ensurePisiFileMetadata(newPath);

        let cleanupResult = null;

        if (
            ext === '.node' &&
            oldParentMapPath &&
            (!options.parentMapPath || normalizePathForCompare(oldParentMapPath) !== normalizePathForCompare(options.parentMapPath))
        ) {
            cleanupResult = cleanupDeletedNodeFromParentMap(oldParentMapPath, id);
        }

        return {
            ok: true,
            type: getPisiTypeFromExt(ext),
            oldPath: sourcePath,
            fullPath: newPath,
            fileName: path.basename(newPath),
            displayName: ensuredAfter.metadata.title,
            metadata: ensuredAfter.metadata,
            sidecarPath: ensuredAfter.sidecarPath,
            oldSidecarPath,
            oldParentMapPath,
            parentMapPath: options.parentMapPath || null,
            oldParentMapEdges: cleanupResult?.edges || null,
            pathChanges: [
                {
                    oldPath: sourcePath,
                    newPath
                },
                ...(oldSidecarPath && ensuredAfter.sidecarPath
                    ? [
                          {
                              oldPath: oldSidecarPath,
                              newPath: ensuredAfter.sidecarPath
                          }
                      ]
                    : [])
            ],
            isDirectory: false,
            isFile: true
        };
    } catch (error) {
        const rollbackErrors = [];

        try {
            if (sidecarMoved && movedSidecarPath && originalSidecarPath && fs.existsSync(movedSidecarPath) && !fs.existsSync(originalSidecarPath)) {
                renamePathInternal(movedSidecarPath, originalSidecarPath);
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        try {
            if (fileMoved && movedPath && fs.existsSync(movedPath) && !fs.existsSync(sourcePath)) {
                renamePathInternal(movedPath, sourcePath);
            }

            if (!sourceWasDirectory && originalContent !== null && fs.existsSync(sourcePath)) {
                writeFileAtomic(sourcePath, originalContent, { backup: false });
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        return {
            ok: false,
            error: rollbackErrors.length ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}` : error.message,
            rolledBack: rollbackErrors.length === 0
        };
    }
}

function getPisiDocument(filePath, options = {}) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return {
                ok: false,
                error: 'Dosya bulunamadı.'
            };
        }

        const ensured = ensurePisiFileMetadata(filePath);

        if (!ensured.ok) return ensured;

        let data = ensured.data;

        if (options.hydrateEditorAssets === true && ensured.metadata?.type === 'node') {
            data = structuredClone(ensured.data);
            data.content = editorAssets.hydratePisiEditorAssets(data.content || '', { sidecarPath: ensured.sidecarPath });
        }

        return {
            ok: true,
            fullPath: filePath,
            fileName: path.basename(filePath),
            metadata: ensured.metadata,
            sidecarPath: ensured.sidecarPath,
            data
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function stripPreviewText(value = '') {
    return String(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
}

function getDefaultNodeLayout(index) {
    const col = index % 4;
    const row = Math.floor(index / 4);

    return {
        x: 80 + col * 240,
        y: 80 + row * 150,
        width: 220,
        height: 92
    };
}

function finiteNumberInRange(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizePisiNodeLayout(layout = {}, fallback = {}) {
    return {
        x: finiteNumberInRange(layout.x, fallback.x ?? 80, -1000000, 1000000),
        y: finiteNumberInRange(layout.y, fallback.y ?? 80, -1000000, 1000000),
        width: finiteNumberInRange(layout.width, fallback.width ?? 220, 150, 4000),
        height: finiteNumberInRange(layout.height, fallback.height ?? 92, 74, 4000)
    };
}

function normalizePisiMapCamera(camera = {}) {
    return {
        x: finiteNumberInRange(camera.x, 0, -1000000, 1000000),
        y: finiteNumberInRange(camera.y, 0, -1000000, 1000000),
        zoom: finiteNumberInRange(camera.zoom, 1, 0.1, 3)
    };
}

function listNodesForMap(mapPath) {
    try {
        const mapInfo = ensurePisiFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (mapInfo.metadata.type !== 'map') {
            return {
                ok: false,
                error: 'Bu dosya bir map değil.'
            };
        }

        const sidecarPath = mapInfo.sidecarPath;

        if (!sidecarPath || !fs.existsSync(sidecarPath)) {
            return {
                ok: true,
                map: mapInfo,
                nodes: []
            };
        }

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        if (!Array.isArray(mapInfo.data.map.nodes)) {
            mapInfo.data.map.nodes = [];
        }

        const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });
        const nodeFiles = entries
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.node'))
            .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
            .map((entry) => path.join(sidecarPath, entry.name));

        let changed = false;
        const seenNodeIds = new Set();

        const nodes = nodeFiles
            .map((nodePath, index) => {
                const nodeInfo = ensurePisiFileMetadata(nodePath);

                if (!nodeInfo.ok) {
                    return null;
                }

                const nodeId = nodeInfo.metadata.id;

                if (seenNodeIds.has(nodeId)) {
                    throw new Error(`Map içinde aynı PISI kimliğine sahip iki node bulundu: ${nodeId}`);
                }

                seenNodeIds.add(nodeId);

                let layout = mapInfo.data.map.nodes.find((item) => item.id === nodeId);

                if (!layout) {
                    layout = {
                        id: nodeId,
                        ...getDefaultNodeLayout(index)
                    };

                    mapInfo.data.map.nodes.push(layout);
                    changed = true;
                }

                const fallbackLayout = getDefaultNodeLayout(index);
                const normalizedLayout = normalizePisiNodeLayout(layout, fallbackLayout);
                const normalizedCustomization = normalizePisiMapNodeCustomization(layout.customization);

                if (
                    layout.x !== normalizedLayout.x ||
                    layout.y !== normalizedLayout.y ||
                    layout.width !== normalizedLayout.width ||
                    layout.height !== normalizedLayout.height
                ) {
                    Object.assign(layout, normalizedLayout);
                    changed = true;
                }

                if (Object.keys(normalizedCustomization).length) {
                    if (JSON.stringify(layout.customization || {}) !== JSON.stringify(normalizedCustomization)) {
                        layout.customization = normalizedCustomization;
                        changed = true;
                    }
                } else if (Object.prototype.hasOwnProperty.call(layout, 'customization')) {
                    delete layout.customization;
                    changed = true;
                }

                return {
                    id: nodeId,
                    fullPath: nodePath,
                    fileName: path.basename(nodePath),
                    metadata: nodeInfo.metadata,
                    properties: nodeInfo.data.properties || {},
                    content: nodeInfo.data.content || '',
                    preview: stripPreviewText(nodeInfo.data.content || ''),
                    layout: normalizedLayout,
                    customization: normalizedCustomization,
                    isReference: false
                };
            })
            .filter(Boolean);

        if (typeof globalThis.collectPisiMapReferenceNodes === 'function') {
            const referenceResult = globalThis.collectPisiMapReferenceNodes(mapInfo, seenNodeIds, nodes.length);
            nodes.push(...referenceResult.nodes);
            changed = changed || referenceResult.changed;
        }

        const previousLayouts = mapInfo.data.map.nodes;
        mapInfo.data.map.nodes = previousLayouts.filter((layout) => {
            return layout?.id && seenNodeIds.has(layout.id);
        });

        if (mapInfo.data.map.nodes.length !== previousLayouts.length) {
            changed = true;
        }

        const normalizedCamera = normalizePisiMapCamera(mapInfo.data.map.camera);
        if (JSON.stringify(normalizedCamera) !== JSON.stringify(mapInfo.data.map.camera)) {
            mapInfo.data.map.camera = normalizedCamera;
            changed = true;
        }

        if (changed) {
            mapInfo.data.pisi.updatedAt = new Date().toISOString();
            writePisiDocument(mapPath, mapInfo.data);
        }

        return {
            ok: true,
            map: mapInfo,
            nodes,
            edges: []
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveMapNodeLayout(mapPath, nodeLayouts = []) {
    try {
        const mapInfo = ensurePisiFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        if (!Array.isArray(mapInfo.data.map.nodes)) {
            mapInfo.data.map.nodes = [];
        }

        const knownNodeIds = new Set(mapInfo.data.map.nodes.map((item) => item?.id).filter(Boolean));

        for (const incoming of Array.isArray(nodeLayouts) ? nodeLayouts.slice(0, 5000) : []) {
            const incomingId = normalizePisiId(incoming?.id, '.node');
            if (!incomingId || !knownNodeIds.has(incomingId)) continue;

            let stored = mapInfo.data.map.nodes.find((item) => item.id === incomingId);

            if (!stored) {
                stored = { id: incomingId };
                mapInfo.data.map.nodes.push(stored);
            }

            Object.assign(stored, normalizePisiNodeLayout(incoming, stored));

            const customization = normalizePisiMapNodeCustomization(incoming.customization);
            if (Object.keys(customization).length) {
                stored.customization = customization;
            } else {
                delete stored.customization;
            }
        }

        mapInfo.data.pisi.updatedAt = new Date().toISOString();

        writePisiDocument(mapPath, mapInfo.data);

        return {
            ok: true
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveMapCamera(mapPath, camera = {}) {
    try {
        const mapInfo = ensurePisiFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        mapInfo.data.map.camera = normalizePisiMapCamera(camera);

        if (Array.isArray(camera.collapsedHubs)) {
            mapInfo.data.map.collapsedHubs = Array.from(
                new Set(
                    camera.collapsedHubs
                        .map((value) => String(value || ''))
                        .filter((value) => {
                            return /^(?:node_[A-Za-z0-9_-]+)::(?:top|right|bottom|left)$/.test(value);
                        })
                )
            ).slice(0, 10000);
        }

        mapInfo.data.pisi.updatedAt = new Date().toISOString();

        writePisiDocument(mapPath, mapInfo.data);

        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveNodeContent(nodePath, content = '') {
    try {
        const nodeInfo = ensurePisiFileMetadata(nodePath);

        if (!nodeInfo.ok) return nodeInfo;

        if (nodeInfo.metadata.type !== 'node') {
            return {
                ok: false,
                error: 'Bu dosya bir node değil.'
            };
        }

        const normalizedContent = editorAssets.normalizePisiEditorAssets(String(content || ''), {
            sidecarPath: nodeInfo.sidecarPath,
            writeAssets: true
        });

        nodeInfo.data.content = normalizedContent.content;
        nodeInfo.data.pisi.updatedAt = new Date().toISOString();

        writePisiDocument(nodePath, nodeInfo.data);

        return {
            ok: true,
            fullPath: nodePath,
            fileName: path.basename(nodePath),
            metadata: nodeInfo.data.pisi,
            content: nodeInfo.data.content,
            preview: stripPreviewText(nodeInfo.data.content)
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function getAllNodeDocsInMap(mapPath) {
    const mapInfo = ensurePisiFileMetadata(mapPath);

    if (!mapInfo.ok || !mapInfo.sidecarPath || !fs.existsSync(mapInfo.sidecarPath)) {
        return {
            ok: false,
            error: 'Map node klasörü bulunamadı.',
            mapInfo,
            nodesById: new Map()
        };
    }

    const nodesById = new Map();
    const entries = fs.readdirSync(mapInfo.sidecarPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
            continue;
        }

        const nodePath = path.join(mapInfo.sidecarPath, entry.name);
        const nodeInfo = ensurePisiFileMetadata(nodePath);

        if (nodeInfo.ok && nodeInfo.metadata?.id) {
            if (nodesById.has(nodeInfo.metadata.id)) {
                return {
                    ok: false,
                    error: `Map içinde aynı PISI kimliğine sahip iki node bulundu: ${nodeInfo.metadata.id}`,
                    mapInfo,
                    nodesById
                };
            }

            nodesById.set(nodeInfo.metadata.id, nodeInfo);
        }
    }

    return {
        ok: true,
        mapInfo,
        nodesById
    };
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getUniqueDirectoryPath: {
        enumerable: true,
        get() {
            return getUniqueDirectoryPath;
        }
    },
    isPathInsideDirectory: {
        enumerable: true,
        get() {
            return isPathInsideDirectory;
        }
    },
    movePisiItem: {
        enumerable: true,
        get() {
            return movePisiItem;
        }
    },
    getPisiDocument: {
        enumerable: true,
        get() {
            return getPisiDocument;
        }
    },
    stripPreviewText: {
        enumerable: true,
        get() {
            return stripPreviewText;
        }
    },
    getDefaultNodeLayout: {
        enumerable: true,
        get() {
            return getDefaultNodeLayout;
        }
    },
    finiteNumberInRange: {
        enumerable: true,
        get() {
            return finiteNumberInRange;
        }
    },
    normalizePisiNodeLayout: {
        enumerable: true,
        get() {
            return normalizePisiNodeLayout;
        }
    },
    normalizePisiMapCamera: {
        enumerable: true,
        get() {
            return normalizePisiMapCamera;
        }
    },
    listNodesForMap: {
        enumerable: true,
        get() {
            return listNodesForMap;
        }
    },
    saveMapNodeLayout: {
        enumerable: true,
        get() {
            return saveMapNodeLayout;
        }
    },
    saveMapCamera: {
        enumerable: true,
        get() {
            return saveMapCamera;
        }
    },
    saveNodeContent: {
        enumerable: true,
        get() {
            return saveNodeContent;
        }
    },
    getAllNodeDocsInMap: {
        enumerable: true,
        get() {
            return getAllNodeDocsInMap;
        }
    }
});
registerMainModule('main.mapStore', moduleApi);
