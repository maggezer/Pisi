'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');
const backupStorage = require('./backup-storage');

function normalizePisiCustomizationColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

function normalizePisiMapNodeCustomization(customization = {}) {
    const normalized = {};
    const cardColor = normalizePisiCustomizationColor(customization.cardColor);
    const titleColor = normalizePisiCustomizationColor(customization.titleColor);

    if (cardColor) normalized.cardColor = cardColor;
    if (titleColor) normalized.titleColor = titleColor;
    return normalized;
}

function normalizePisiMapEdgeCustomization(customization = {}) {
    const color = normalizePisiCustomizationColor(customization.color);
    return color ? { color } : {};
}

function normalizeMapEdge(edge) {
    const sourceId = normalizePisiId(edge?.sourceId, '.node');
    const targetId = normalizePisiId(edge?.targetId, '.node');

    if (!sourceId || !targetId || sourceId === targetId) {
        return null;
    }

    let type = String(edge.type || 'down-hub');

    if (type === 'colevel') {
        type = 'co-level';
    }

    if (!['down-hub', 'stream', 'co-level'].includes(type)) {
        type = 'down-hub';
    }

    let sourceRole = normalizeConnectionRole(edge.sourceRole);
    let targetRole = normalizeConnectionRole(edge.targetRole);

    // Portlar yalnızca geometriyi belirler. İlişki türü ile rollerin
    // çelişmesine izin vermeyerek elle düzenlenmiş eski dosyaları onar.
    if (type === 'co-level') {
        sourceRole = 'co-level';
        targetRole = 'co-level';
    } else if (type === 'stream') {
        sourceRole = 'downstream';
        targetRole = 'upstream';
    } else {
        type = 'down-hub';
        sourceRole = 'down-hub';
        targetRole = 'up-hub';
    }

    const ports = new Set(['top', 'right', 'bottom', 'left']);
    const sourcePort = ports.has(edge.sourcePort) ? edge.sourcePort : 'bottom';
    const targetPort = ports.has(edge.targetPort) ? edge.targetPort : 'top';

    const normalizedEdge = {
        id: /^edge_[A-Za-z0-9_-]{1,101}$/.test(String(edge.id || ''))
            ? String(edge.id)
            : `edge_${crypto.randomUUID()}`,
        sourceId,
        targetId,

        // Bunlar sadece çizgi geometrisi.
        sourcePort,
        targetPort,

        // Bunlar semantik ilişki.
        type,
        sourceRole,
        targetRole
    };

    const customization = normalizePisiMapEdgeCustomization(
        edge.customization
    );
    if (Object.keys(customization).length) {
        normalizedEdge.customization = customization;
    }

    return normalizedEdge;
}

function isHierarchyEdge(edge) {
    return (
        edge?.type === 'down-hub' &&
        edge?.sourceRole === 'down-hub' &&
        edge?.targetRole === 'up-hub'
    );
}

function convertEdgeToStream(edge) {
    return {
        ...edge,
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    };
}

function enforceSingleParentForTargetInMap(newEdge, existingEdges = []) {
    if (!isHierarchyEdge(newEdge)) {
        return newEdge;
    }

    const targetAlreadyHasParent = existingEdges.some((existingEdge) => {
        const normalizedExisting = normalizeMapEdge(existingEdge);

        if (!normalizedExisting) return false;
        if (!isHierarchyEdge(normalizedExisting)) return false;

        // Burada kritik nokta targetId kontrolü.
        // Aynı child node ikinci parent alamaz.
        if (normalizedExisting.targetId !== newEdge.targetId) return false;

        // Aynı source-target bağlantısını güncelliyorsak engel sayma.
        if (normalizedExisting.sourceId === newEdge.sourceId) return false;

        return true;
    });

    if (!targetAlreadyHasParent) {
        return newEdge;
    }

    return convertEdgeToStream(newEdge);
}

function getPisiEdgeSemanticKey(edge) {
    const normalized = normalizeMapEdge(edge);
    if (!normalized) return '';

    if (normalized.type === 'co-level') {
        const pair = [normalized.sourceId, normalized.targetId].sort();
        return `co-level:${pair[0]}:${pair[1]}`;
    }

    return [
        normalized.type,
        normalized.sourceId,
        normalized.targetId,
        normalized.sourceRole,
        normalized.targetRole
    ].join(':');
}

function wouldCreatePisiHierarchyCycle(parentByChild, parentId, childId) {
    let current = parentId;
    const visited = new Set();

    while (current && !visited.has(current)) {
        if (current === childId) return true;
        visited.add(current);
        current = parentByChild.get(current) || null;
    }

    return false;
}

function normalizePisiMapEdges(rawEdges = [], validNodeIds = null) {
    const cleanEdges = [];
    const seenSemanticEdges = new Set();
    const parentByChild = new Map();
    const warnings = [];

    for (const rawEdge of Array.isArray(rawEdges) ? rawEdges : []) {
        let edge = normalizeMapEdge(rawEdge);
        if (!edge) {
            warnings.push('Geçersiz veya self-loop bağlantı atlandı.');
            continue;
        }

        if (
            validNodeIds &&
            (
                !validNodeIds.has(edge.sourceId) ||
                !validNodeIds.has(edge.targetId)
            )
        ) {
            warnings.push(`Eksik node referanslı bağlantı atlandı: ${edge.id}`);
            continue;
        }

        if (isHierarchyEdge(edge)) {
            const existingParentId = parentByChild.get(edge.targetId);

            if (
                existingParentId &&
                existingParentId !== edge.sourceId
            ) {
                edge = convertEdgeToStream(edge);
                warnings.push(
                    `İkinci parent bağlantısı stream olarak kurtarıldı: ${edge.id}`
                );
            } else if (
                !existingParentId &&
                wouldCreatePisiHierarchyCycle(
                    parentByChild,
                    edge.sourceId,
                    edge.targetId
                )
            ) {
                edge = convertEdgeToStream(edge);
                warnings.push(
                    `Döngü oluşturan bağlantı stream olarak kurtarıldı: ${edge.id}`
                );
            } else if (!existingParentId) {
                parentByChild.set(edge.targetId, edge.sourceId);
            }
        }

        const semanticKey = getPisiEdgeSemanticKey(edge);
        if (!semanticKey || seenSemanticEdges.has(semanticKey)) {
            warnings.push(`Tekrarlanan bağlantı atlandı: ${edge.id}`);
            continue;
        }

        seenSemanticEdges.add(semanticKey);
        cleanEdges.push(edge);
    }

    return {
        edges: cleanEdges,
        warnings
    };
}

function resetNodeConnectionTypes(metadata) {
    metadata.connectionTypes = getDefaultNodeConnectionTypes();
}

function getPisiSidecarName(title, ext, id) {
    const prefix = getPisiSidecarPrefix(ext);
    const safeId = normalizePisiId(id, ext);
    if (!prefix || !safeId) return null;

    const safeTitle = sanitizeForSidecarName(title);
    return `${prefix}${safeTitle}__${safeId}`;
}

function createPisiDocumentData({ ext, title, id, parentMap = 'none' }) {
    const now = new Date().toISOString();
    const type = getPisiTypeFromExt(ext);
    const sidecar = getPisiSidecarName(title, ext, id);

    const base = {
        pisi: {
            version: 1,
            type,
            id,
            title,
            sidecar,
            createdAt: now,
            updatedAt: now
        }
    };

    if (ext === '.node') {
        base.pisi.parentMap = parentMap || 'none';
        base.pisi.connectionTypes = getDefaultNodeConnectionTypes();

        return {
            ...base,
            content: ''
        };
    }

    if (ext === '.map') {
        return {
            ...base,
            map: {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            }
        };
    }

    return base;
}

function readJsonFileResult(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');

        if (!raw || !raw.trim()) {
            return {
                ok: false,
                raw,
                error: 'Dosya boş.'
            };
        }

        return {
            ok: true,
            raw,
            data: JSON.parse(raw)
        };
    } catch (error) {
        return {
            ok: false,
            raw: null,
            error: error.message
        };
    }
}

function readJsonFileSafe(filePath) {
    const result = readJsonFileResult(filePath);
    return result.ok ? result.data : null;
}

function fsyncDirectoryBestEffort(directoryPath) {
    if (process.platform === 'win32') return;

    let descriptor = null;

    try {
        descriptor = fs.openSync(directoryPath, 'r');
        fs.fsyncSync(descriptor);
    } catch {
        // Bazı dosya sistemleri klasör fsync işlemini desteklemez.
    } finally {
        if (descriptor !== null) {
            fs.closeSync(descriptor);
        }
    }
}

function resolvePisiAtomicBackupPath(targetPath, options = {}) {
    if (options.backup === false) return null;

    const projectFolder = globalThis.activeProjectFolder;
    if (
        projectFolder &&
        backupStorage.isPisiProjectPath(projectFolder, targetPath)
    ) {
        if (backupStorage.isPisiBackupStoragePath(projectFolder, targetPath)) {
            return null;
        }
        return backupStorage.getPisiAtomicBackupPath(projectFolder, targetPath);
    }

    return `${targetPath}${backupStorage.PISI_BACKUP_SUFFIX}`;
}

function removeLegacyPisiAtomicBackup(targetPath, backupPath) {
    const legacyPath = `${targetPath}${backupStorage.PISI_BACKUP_SUFFIX}`;
    if (
        !backupPath ||
        path.resolve(legacyPath) === path.resolve(backupPath) ||
        !fs.existsSync(legacyPath)
    ) {
        return;
    }

    try {
        fs.unlinkSync(legacyPath);
    } catch {
        // Yeni merkezi yedek başarıyla oluştuysa eski kopya temizliği best-effort'tur.
    }
}

function writeFileAtomic(filePath, content, options = {}) {
    const targetPath = path.resolve(filePath);
    const directoryPath = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const tempPath = path.join(
        directoryPath,
        `.${baseName}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    const backupPath = resolvePisiAtomicBackupPath(targetPath, options);
    let backupTempPath = null;
    let descriptor = null;
    markInternalFileChange(
        targetPath,
        tempPath,
        ...(backupPath ? [backupPath] : [])
    );

    try {
        descriptor = fs.openSync(tempPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, content, 'utf-8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;

        if (backupPath && fs.existsSync(targetPath)) {
            backupStorage.ensurePisiBackupParent(backupPath);
            backupTempPath = `${backupPath}.${crypto.randomUUID()}.tmp`;
            markInternalFileChange(backupTempPath);
            fs.copyFileSync(targetPath, backupTempPath);
            renamePathInternal(backupTempPath, backupPath);
            backupTempPath = null;
            removeLegacyPisiAtomicBackup(targetPath, backupPath);
        }

        renamePathInternal(tempPath, targetPath);
        fsyncDirectoryBestEffort(directoryPath);
        sealInternalFileChange(
            targetPath,
            tempPath,
            ...(backupPath ? [backupPath] : [])
        );
    } catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }

        for (const cleanupPath of [tempPath, backupTempPath].filter(Boolean)) {
            try {
                if (fs.existsSync(cleanupPath)) {
                    fs.unlinkSync(cleanupPath);
                }
            } catch {}
        }
        sealInternalFileChange(
            tempPath,
            ...(backupTempPath ? [backupTempPath] : [])
        );

        throw error;
    }
}

function writePisiDocument(filePath, data) {
    writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

function writePisiDocumentsTransaction(changes = []) {
    const uniqueChanges = [];
    const seenPaths = new Set();

    for (const change of changes) {
        if (!change?.filePath || !change.data) continue;
        const normalizedPath = normalizePathForCompare(change.filePath);
        if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);
        uniqueChanges.push(change);
    }

    const originals = uniqueChanges.map((change) => ({
        filePath: change.filePath,
        existed: fs.existsSync(change.filePath),
        content: fs.existsSync(change.filePath)
            ? fs.readFileSync(change.filePath, 'utf-8')
            : null
    }));
    const written = [];

    try {
        for (const change of uniqueChanges) {
            writePisiDocument(change.filePath, change.data);
            written.push(change.filePath);
        }
    } catch (error) {
        const rollbackErrors = [];

        for (const original of originals.reverse()) {
            if (!written.some((writtenPath) => {
                return normalizePathForCompare(writtenPath) ===
                    normalizePathForCompare(original.filePath);
            })) {
                continue;
            }

            try {
                if (original.existed) {
                    writeFileAtomic(
                        original.filePath,
                        original.content,
                        { backup: false }
                    );
                } else if (fs.existsSync(original.filePath)) {
                    fs.unlinkSync(original.filePath);
                }
            } catch (rollbackError) {
                rollbackErrors.push(
                    `${original.filePath}: ${rollbackError.message}`
                );
            }
        }

        if (rollbackErrors.length) {
            throw new Error(
                `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
            );
        }

        throw error;
    }
}

function backupCorruptPisiFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath);
        const digest = crypto
            .createHash('sha256')
            .update(raw)
            .digest('hex')
            .slice(0, 12);
        const projectFolder = globalThis.activeProjectFolder;
        const managedBackupPath = projectFolder
            ? backupStorage.getPisiCorruptBackupPath(
                projectFolder,
                filePath,
                digest
            )
            : null;
        const backupPath = managedBackupPath ||
            `${filePath}.corrupt-${digest}.bak`;

        backupStorage.ensurePisiBackupParent(backupPath);
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
        }

        if (managedBackupPath) {
            const legacyPath = `${filePath}.corrupt-${digest}.bak`;
            if (
                path.resolve(legacyPath) !== path.resolve(backupPath) &&
                fs.existsSync(legacyPath)
            ) {
                try { fs.unlinkSync(legacyPath); } catch {}
            }
        }

        return backupPath;
    } catch {
        return null;
    }
}

function findExistingSidecarById(dir, ext, id) {
    const safeId = normalizePisiId(id, ext);
    if (!safeId || !fs.existsSync(dir)) return null;

    const prefix = getPisiSidecarPrefix(ext);
    if (!prefix) return null;

    const suffix = `__${safeId}`;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const matches = entries.filter((entry) => {
            return (
                entry.isDirectory() &&
                entry.name.startsWith(prefix) &&
                entry.name.endsWith(suffix)
            );
        });

        if (matches.length > 1) {
            throw new Error(
                `Aynı kimliğe bağlı birden fazla yan klasör bulundu: ${safeId}`
            );
        }

        return matches.length === 1
            ? path.join(dir, matches[0].name)
            : null;
    } catch (error) {
        if (String(error.message || '').includes('birden fazla yan klasör')) {
            throw error;
        }
        return null;
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "normalizePisiCustomizationColor": {
        enumerable: true,
        get() { return normalizePisiCustomizationColor; }
    },
    "normalizePisiMapNodeCustomization": {
        enumerable: true,
        get() { return normalizePisiMapNodeCustomization; }
    },
    "normalizePisiMapEdgeCustomization": {
        enumerable: true,
        get() { return normalizePisiMapEdgeCustomization; }
    },
    "normalizeMapEdge": {
        enumerable: true,
        get() { return normalizeMapEdge; }
    },
    "isHierarchyEdge": {
        enumerable: true,
        get() { return isHierarchyEdge; }
    },
    "convertEdgeToStream": {
        enumerable: true,
        get() { return convertEdgeToStream; }
    },
    "enforceSingleParentForTargetInMap": {
        enumerable: true,
        get() { return enforceSingleParentForTargetInMap; }
    },
    "getPisiEdgeSemanticKey": {
        enumerable: true,
        get() { return getPisiEdgeSemanticKey; }
    },
    "wouldCreatePisiHierarchyCycle": {
        enumerable: true,
        get() { return wouldCreatePisiHierarchyCycle; }
    },
    "normalizePisiMapEdges": {
        enumerable: true,
        get() { return normalizePisiMapEdges; }
    },
    "resetNodeConnectionTypes": {
        enumerable: true,
        get() { return resetNodeConnectionTypes; }
    },
    "getPisiSidecarName": {
        enumerable: true,
        get() { return getPisiSidecarName; }
    },
    "createPisiDocumentData": {
        enumerable: true,
        get() { return createPisiDocumentData; }
    },
    "readJsonFileResult": {
        enumerable: true,
        get() { return readJsonFileResult; }
    },
    "readJsonFileSafe": {
        enumerable: true,
        get() { return readJsonFileSafe; }
    },
    "fsyncDirectoryBestEffort": {
        enumerable: true,
        get() { return fsyncDirectoryBestEffort; }
    },
    "writeFileAtomic": {
        enumerable: true,
        get() { return writeFileAtomic; }
    },
    "writePisiDocument": {
        enumerable: true,
        get() { return writePisiDocument; }
    },
    "writePisiDocumentsTransaction": {
        enumerable: true,
        get() { return writePisiDocumentsTransaction; }
    },
    "backupCorruptPisiFile": {
        enumerable: true,
        get() { return backupCorruptPisiFile; }
    },
    "findExistingSidecarById": {
        enumerable: true,
        get() { return findExistingSidecarById; }
    }
});
registerMainModule("main.filesystemCore", moduleApi);
