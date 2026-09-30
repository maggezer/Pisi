'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');

function findParentMapPathForNode(nodePath, nodeInfo = null) {
    const nodeDir = path.dirname(nodePath);
    const possibleMapDir = path.dirname(nodeDir);
    const nodeSidecarFolderName = path.basename(nodeDir);

    if (!fs.existsSync(possibleMapDir)) {
        return null;
    }

    const entries = fs.readdirSync(possibleMapDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.map')) {
            continue;
        }

        const mapPath = path.join(possibleMapDir, entry.name);
        const mapInfo = ensurePisiFileMetadata(mapPath);

        if (!mapInfo.ok) continue;

        const sameSidecar =
            mapInfo.metadata.sidecar === nodeSidecarFolderName;

        const sameParentId =
            nodeInfo?.metadata?.parentMap &&
            nodeInfo.metadata.parentMap !== 'none' &&
            mapInfo.metadata.id === nodeInfo.metadata.parentMap;

        if (sameSidecar || sameParentId) {
            return mapPath;
        }
    }

    return null;
}

function removeLegacyNodeRelationship(metadata, otherNodeId) {
    if (!metadata.connectionTypes) {
        metadata.connectionTypes = getDefaultNodeConnectionTypes();
    }

    for (const key of PISI_CONNECTION_KEYS) {
        metadata.connectionTypes[key] = Array.isArray(metadata.connectionTypes[key])
            ? metadata.connectionTypes[key].filter((id) => id !== otherNodeId)
            : [];
    }
}

function cleanupDeletedNodeFromParentMap(parentMapPath, deletedNodeId, deletionTransaction = null) {
    if (!parentMapPath || !deletedNodeId || !fs.existsSync(parentMapPath)) {
        return {
            parentMapPath: null,
            edges: []
        };
    }

    const mapInfo = ensurePisiFileMetadata(parentMapPath);

    if (!mapInfo.ok || !mapInfo.data.map) {
        return {
            parentMapPath,
            edges: []
        };
    }

    if (!Array.isArray(mapInfo.data.map.nodes)) {
        mapInfo.data.map.nodes = [];
    }

    if (!Array.isArray(mapInfo.data.map.edges)) {
        mapInfo.data.map.edges = [];
    }

    mapInfo.data.map.nodes = mapInfo.data.map.nodes.filter((node) => {
        return node.id !== deletedNodeId;
    });

    mapInfo.data.map.edges = mapInfo.data.map.edges.filter((edge) => {
        return edge.sourceId !== deletedNodeId && edge.targetId !== deletedNodeId;
    });

    const pendingDocumentChanges = [];
    mapInfo.data.pisi.updatedAt = new Date().toISOString();

    if (deletionTransaction) {
        writePisiDeletionMetadata(
            deletionTransaction,
            parentMapPath,
            mapInfo.data
        );
    } else {
        pendingDocumentChanges.push({
            filePath: parentMapPath,
            data: mapInfo.data
        });
    }

    // Kalan node dosyalarının connectionTypes alanından silinen node id'sini düş.
    const sidecarPath = mapInfo.sidecarPath;

    if (sidecarPath && fs.existsSync(sidecarPath)) {
        const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
                continue;
            }

            const nodePath = path.join(sidecarPath, entry.name);
            const nodeInfo = ensurePisiFileMetadata(nodePath);

            if (!nodeInfo.ok) continue;

            const before = JSON.stringify(nodeInfo.data.pisi.connectionTypes);

            removeLegacyNodeRelationship(nodeInfo.data.pisi, deletedNodeId);

            const after = JSON.stringify(nodeInfo.data.pisi.connectionTypes);

            if (before !== after) {
                nodeInfo.data.pisi.updatedAt = new Date().toISOString();

                if (deletionTransaction) {
                    writePisiDeletionMetadata(
                        deletionTransaction,
                        nodePath,
                        nodeInfo.data
                    );
                } else {
                    pendingDocumentChanges.push({
                        filePath: nodePath,
                        data: nodeInfo.data
                    });
                }
            }
        }
    }

    if (!deletionTransaction) {
        writePisiDocumentsTransaction(pendingDocumentChanges);
    }

    return {
        parentMapPath,
        edges: mapInfo.data.map.edges
    };
}

function writePisiDeletionMetadata(transaction, filePath, data) {
    if (!transaction) {
        writePisiDocument(filePath, data);
        return;
    }

    let backup = transaction.metadataBackups.find((entry) => {
        return normalizePathForCompare(entry.originalPath) ===
            normalizePathForCompare(filePath);
    });

    if (!backup) {
        const backupPath = path.join(
            transaction.directoryPath,
            `metadata-${transaction.metadataBackups.length}.bak`
        );

        fs.copyFileSync(filePath, backupPath);
        backup = {
            originalPath: filePath,
            backupPath
        };
        transaction.metadataBackups.push(backup);
    }

    writePisiDocument(filePath, data);
}

function createPisiDeletionTransaction(targetPath) {
    const directoryPath = fs.mkdtempSync(
        path.join(path.dirname(targetPath), '.pisi-delete-')
    );
    markInternalFileChange(directoryPath);

    return {
        directoryPath,
        stagedPaths: [],
        metadataBackups: []
    };
}

function stagePisiDeletionPath(transaction, originalPath) {
    if (!originalPath || !fs.existsSync(originalPath)) {
        return;
    }

    const stagedPath = path.join(
        transaction.directoryPath,
        path.basename(originalPath)
    );

    if (fs.existsSync(stagedPath)) {
        throw new Error(`Geçici silme hedefi zaten var: ${stagedPath}`);
    }

    renamePathInternal(originalPath, stagedPath);
    transaction.stagedPaths.push({
        originalPath,
        stagedPath
    });
}

function rollbackPisiDeletionTransaction(transaction) {
    const rollbackErrors = [];

    if (!fs.existsSync(transaction.directoryPath)) {
        return [
            'Geçici silme klasörü bulunamadığı için otomatik geri alma yapılamadı.'
        ];
    }

    for (const backup of [...transaction.metadataBackups].reverse()) {
        if (!fs.existsSync(backup.backupPath)) {
            rollbackErrors.push(
                `${backup.originalPath} için metadata yedeği bulunamadı.`
            );
            continue;
        }

        try {
            fs.copyFileSync(backup.backupPath, backup.originalPath);
            fs.unlinkSync(backup.backupPath);
        } catch (error) {
            rollbackErrors.push(
                `${backup.originalPath} metadata geri yüklenemedi: ${error.message}`
            );
        }
    }

    for (const staged of [...transaction.stagedPaths].reverse()) {
        if (!fs.existsSync(staged.stagedPath)) {
            if (!fs.existsSync(staged.originalPath)) {
                rollbackErrors.push(
                    `${staged.originalPath} için geçici yedek bulunamadı.`
                );
            }
            continue;
        }

        try {
            if (fs.existsSync(staged.originalPath)) {
                throw new Error('Orijinal yol yeniden oluşturulmuş.');
            }

            renamePathInternal(staged.stagedPath, staged.originalPath);
        } catch (error) {
            rollbackErrors.push(
                `${staged.originalPath} geri taşınamadı: ${error.message}`
            );
        }
    }

    try {
        if (
            fs.existsSync(transaction.directoryPath) &&
            fs.readdirSync(transaction.directoryPath).length === 0
        ) {
            fs.rmdirSync(transaction.directoryPath);
        }
    } catch (error) {
        rollbackErrors.push(
            `Geçici silme klasörü temizlenemedi: ${error.message}`
        );
    }

    return rollbackErrors;
}

async function deletePisiFile(targetPath) {
    let transaction = null;

    try {
        if (!targetPath || !fs.existsSync(targetPath)) {
            return {
                ok: false,
                error: 'Silinecek dosya bulunamadı.'
            };
        }

        const ext = getPisiFileExt(targetPath);

        if (ext !== '.map' && ext !== '.node') {
            return {
                ok: false,
                error: 'Sadece .map ve .node dosyaları silinebilir.'
            };
        }

        const info = ensurePisiFileMetadata(targetPath);

        if (!info.ok) {
            return info;
        }

        const dir = path.dirname(targetPath);
        const sidecarPath = info.metadata.sidecar
            ? path.join(dir, info.metadata.sidecar)
            : null;

        const deletedNodeId = ext === '.node'
            ? info.metadata.id
            : null;
        const parentMapPath = ext === '.node'
            ? findParentMapPathForNode(targetPath, info)
            : null;
        const childNodePaths = [];

        if (ext === '.map' && sidecarPath && fs.existsSync(sidecarPath)) {
            const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });
            for (const entry of entries) {
                if (
                    entry.isFile() &&
                    entry.name.toLowerCase().endsWith('.node')
                ) {
                    childNodePaths.push(path.join(sidecarPath, entry.name));
                }
            }
        }

        transaction = createPisiDeletionTransaction(targetPath);
        stagePisiDeletionPath(transaction, targetPath);
        stagePisiDeletionPath(transaction, sidecarPath);

        if (ext === '.map') {
            await shell.trashItem(path.resolve(transaction.directoryPath));

            return {
                ok: true,
                type: 'map',
                deletedPath: targetPath,
                deletedMapId: info.metadata.id,
                deletedSidecarPath: sidecarPath,
                childNodePaths,
                childNodeCount: childNodePaths.length,
                movedToTrash: true
            };
        }

        const cleanupResult = cleanupDeletedNodeFromParentMap(
            parentMapPath,
            deletedNodeId,
            transaction
        );

        await shell.trashItem(path.resolve(transaction.directoryPath));

        return {
            ok: true,
            type: 'node',
            deletedPath: targetPath,
            deletedNodeId,
            parentMapPath: cleanupResult.parentMapPath,
            edges: cleanupResult.edges,
            movedToTrash: true
        };
    } catch (error) {
        const rollbackErrors = transaction
            ? rollbackPisiDeletionTransaction(transaction)
            : [];

        return {
            ok: false,
            error: rollbackErrors.length > 0
                ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
                : error.message,
            rolledBack: Boolean(transaction) && rollbackErrors.length === 0
        };
    }
}

function deleteNodeFromMap(nodePath) {
    return deletePisiFile(nodePath);
}

async function deleteProjectPath(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
        return {
            ok: false,
            error: 'Silinecek yol bulunamadı.'
        };
    }

    await shell.trashItem(path.resolve(targetPath));

    return {
        ok: true,
        deletedPath: targetPath,
        movedToTrash: true
    };
}

function isPisiManagedDiaryFolder(folderPath) {
    if (!folderPath || path.basename(folderPath).toLowerCase() !== 'diary') {
        return false;
    }

    if (fs.existsSync(path.join(folderPath, '.pisi-diary'))) {
        return true;
    }

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        return entries.some((entry) => {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
                return false;
            }

            const result = readJsonFileResult(path.join(folderPath, entry.name));
            return Boolean(
                result.ok &&
                normalizePisiDiaryIsoDate(result.data?.pisi?.diaryDate)
            );
        });
    } catch {
        return false;
    }
}

function safeListFolder(folderPath) {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return {
                ok: false,
                error: 'Klasör bulunamadı.',
                items: []
            };
        }

        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        const items = entries
            .filter((entry) => {
                if (isPisiManagedSidecarFolder(entry.name)) return false;

                if (
                    entry.isDirectory() &&
                    entry.name.toLowerCase() === '.pisi-history'
                ) {
                    return false;
                }

                if (
                    entry.isDirectory() &&
                    (
                        entry.name.startsWith('.pisi-delete-') ||
                        entry.name.startsWith('.pisi-transaction-')
                    )
                ) {
                    return false;
                }

                const fullPath = path.join(folderPath, entry.name);
                if (entry.isDirectory() && isPisiManagedDiaryFolder(fullPath)) {
                    return false;
                }

                if (entry.isDirectory()) return true;
                return isPisiVisibleFile(entry.name);
            })
            .map((entry) => {
                const fullPath = path.join(folderPath, entry.name);
                let metadata = null;
                let sidecarPath = null;
                let itemError = null;
                let recoveryPath = null;

                if (entry.isFile() && isPisiVisibleFile(entry.name)) {
                    try {
                        const inspected = ensurePisiFileMetadata(fullPath, {
                            persist: false,
                            ensureSidecar: false
                        });

                        if (inspected?.ok) {
                            metadata = inspected.metadata;
                            sidecarPath = inspected.sidecarPath;
                        } else {
                            itemError = inspected?.error || 'Dosya okunamadı.';
                            recoveryPath = inspected?.backupPath || null;
                        }
                    } catch (error) {
                        itemError = error.message;
                    }
                }

                return {
                    name: entry.name,
                    fullPath,
                    type: entry.isDirectory() ? 'folder' : 'file',
                    isDirectory: entry.isDirectory(),
                    isFile: entry.isFile(),
                    metadata,
                    sidecarPath,
                    error: itemError,
                    recoveryPath
                };
            });

        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }

            return a.name.localeCompare(b.name, 'tr');
        });

        return {
            ok: true,
            items
        };
        } catch (error) {
        return {
            ok: false,
            error: error.message,
            items: []
        };
        }
}

function stopProjectWatcher() {
    for (const watcher of projectWatchers.values()) {
        try {
            watcher.close();
        } catch (error) {
            console.warn('[PISI] Watcher kapatılamadı:', error.message);
        }
    }

    projectWatchers.clear();
    clearTimeout(projectWatchTimer);
    projectWatchTimer = null;
    clearTimeout(projectWatcherRescanTimer);
    projectWatcherRescanTimer = null;
    pendingProjectChangedPaths.clear();
}

function notifyProjectChanged(reason = 'changed', changedPath = null) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (changedPath) {
        pendingProjectChangedPaths.add(path.resolve(changedPath));
    }

    clearTimeout(projectWatchTimer);

    projectWatchTimer = setTimeout(() => {
        mainWindow.webContents.send('project:filesystem-changed', {
            reason,
            folderPath: activeProjectFolder,
            changedPaths: Array.from(pendingProjectChangedPaths)
        });
        pendingProjectChangedPaths.clear();
    }, 250);
}

function shouldWatchProjectDirectory(directoryPath) {
    const name = path.basename(directoryPath).toLowerCase();
    return ![
        '.git',
        '.pisi-history',
        'node_modules',
        'dist',
        'coverage'
    ].includes(name);
}

function collectProjectDirectories(rootPath) {
    const directories = [];
    const queue = [rootPath];

    while (queue.length) {
        const directoryPath = queue.shift();
        if (!shouldWatchProjectDirectory(directoryPath)) continue;
        directories.push(directoryPath);

        let entries = [];
        try {
            entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            queue.push(path.join(directoryPath, entry.name));
        }
    }

    return directories;
}

function syncProjectWatchers(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) return;

    const wantedDirectories = new Set(
        collectProjectDirectories(folderPath).map(normalizePathForCompare)
    );

    for (const [directoryKey, watcher] of projectWatchers) {
        if (!wantedDirectories.has(directoryKey)) {
            try {
                watcher.close();
            } catch {}
            projectWatchers.delete(directoryKey);
        }
    }

    for (const directoryPath of collectProjectDirectories(folderPath)) {
        const directoryKey = normalizePathForCompare(directoryPath);
        if (projectWatchers.has(directoryKey)) continue;

        try {
            const watcher = fs.watch(
                directoryPath,
                { recursive: false },
                (eventType, fileName) => {
                    const changedPath = fileName
                        ? path.join(directoryPath, String(fileName))
                        : directoryPath;
                    const isInternalChange = fileName
                        ? (
                            isRecentInternalFileChange(changedPath) ||
                            hasRecentInternalDirectoryChange(directoryPath)
                        )
                        : (
                            hasRecentInternalDirectoryChange(directoryPath) ||
                            hasRecentInternalFileChangeInside(directoryPath)
                        );

                    if (!isInternalChange) {
                        notifyProjectChanged(
                            eventType || 'filesystem',
                            changedPath
                        );
                    }

                    if (
                        eventType === 'rename' ||
                        !fileName
                    ) {
                        clearTimeout(projectWatcherRescanTimer);
                        projectWatcherRescanTimer = setTimeout(() => {
                            if (activeProjectFolder) {
                                syncProjectWatchers(activeProjectFolder);
                            }
                        }, 450);
                    }
                }
            );

            watcher.on('error', (error) => {
                console.warn(
                    `[PISI] Watcher hatası (${directoryPath}):`,
                    error.message
                );
            });

            projectWatchers.set(directoryKey, watcher);
        } catch (error) {
            console.warn(
                `[PISI] Klasör izlenemedi (${directoryPath}):`,
                error.message
            );
        }
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "findParentMapPathForNode": {
        enumerable: true,
        get() { return findParentMapPathForNode; }
    },
    "cleanupDeletedNodeFromParentMap": {
        enumerable: true,
        get() { return cleanupDeletedNodeFromParentMap; }
    },
    "writePisiDeletionMetadata": {
        enumerable: true,
        get() { return writePisiDeletionMetadata; }
    },
    "createPisiDeletionTransaction": {
        enumerable: true,
        get() { return createPisiDeletionTransaction; }
    },
    "stagePisiDeletionPath": {
        enumerable: true,
        get() { return stagePisiDeletionPath; }
    },
    "rollbackPisiDeletionTransaction": {
        enumerable: true,
        get() { return rollbackPisiDeletionTransaction; }
    },
    "deletePisiFile": {
        enumerable: true,
        get() { return deletePisiFile; }
    },
    "deleteNodeFromMap": {
        enumerable: true,
        get() { return deleteNodeFromMap; }
    },
    "deleteProjectPath": {
        enumerable: true,
        get() { return deleteProjectPath; }
    },
    "isPisiManagedDiaryFolder": {
        enumerable: true,
        get() { return isPisiManagedDiaryFolder; }
    },
    "safeListFolder": {
        enumerable: true,
        get() { return safeListFolder; }
    },
    "stopProjectWatcher": {
        enumerable: true,
        get() { return stopProjectWatcher; }
    },
    "notifyProjectChanged": {
        enumerable: true,
        get() { return notifyProjectChanged; }
    },
    "shouldWatchProjectDirectory": {
        enumerable: true,
        get() { return shouldWatchProjectDirectory; }
    },
    "collectProjectDirectories": {
        enumerable: true,
        get() { return collectProjectDirectories; }
    },
    "syncProjectWatchers": {
        enumerable: true,
        get() { return syncProjectWatchers; }
    }
});
registerMainModule("main.projectOperations", moduleApi);
