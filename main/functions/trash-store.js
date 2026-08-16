'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modules, registerMainModule } = require('../module-registry');
const trashCore = require('./trash-core');

const filesystemCore = modules['main.filesystemCore'];
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const relationshipStore = modules['main.relationshipStore'];
const mapSemanticCore = modules['main.mapSemanticCore'];
const projectOperations = modules['main.projectOperations'];
const pathSecurity = modules['main.pathSecurity'];
const atomicMutation = modules['main.atomicMutation'];

const {
    PISI_TRASH_VERSION,
    PISI_TRASH_DIR,
    PISI_TRASH_ITEMS_DIR,
    normalizePisiTrashId,
    normalizePisiTrashRelativePath,
    isPisiTrashPathCovered,
    getPisiTrashItemKind,
    splitPisiTrashTaskStore,
    mergePisiTrashTaskDependencies,
    splitPisiTrashRelationships,
    summarizePisiTrashManifest
} = trashCore;

function deepClonePisiTrashValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function getPisiTrashRoot(projectFolder) {
    return path.join(path.resolve(projectFolder), PISI_TRASH_DIR);
}

function getPisiTrashItemsRoot(projectFolder) {
    return path.join(getPisiTrashRoot(projectFolder), PISI_TRASH_ITEMS_DIR);
}

function getPisiTrashItemDirectory(projectFolder, trashId) {
    const safeId = normalizePisiTrashId(trashId);
    if (!safeId) throw new Error('Geçersiz Trash kimliği.');
    return path.join(getPisiTrashItemsRoot(projectFolder), safeId);
}

function getPisiTrashManifestPath(projectFolder, trashId) {
    return path.join(getPisiTrashItemDirectory(projectFolder, trashId), 'manifest.json');
}

function isSameOrInsidePisiTrashPath(candidatePath, parentPath) {
    const candidate = path.resolve(candidatePath);
    const parent = path.resolve(parentPath);
    const relative = path.relative(parent, candidate);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function assertPisiTrashProjectPath(projectFolder, targetPath) {
    const projectRoot = path.resolve(projectFolder);
    const resolved = path.resolve(targetPath);
    if (!isSameOrInsidePisiTrashPath(resolved, projectRoot)) {
        throw new Error('Trash işlemi proje klasörünün dışına çıkamaz.');
    }
    if (resolved === projectRoot) {
        throw new Error('Aktif proje kökü Trash’e taşınamaz.');
    }
    const relative = path.relative(projectRoot, resolved).replace(/\\/g, '/');
    const first = relative.split('/')[0]?.toLowerCase();
    if (first === '.pisi' || first === '.git' || first === 'node_modules') {
        throw new Error('Pisi proje altyapısı Trash’e taşınamaz.');
    }
    return resolved;
}

function toPisiTrashRelativePath(projectFolder, targetPath) {
    const relative = path.relative(path.resolve(projectFolder), path.resolve(targetPath));
    const normalized = normalizePisiTrashRelativePath(relative);
    if (!normalized) throw new Error('Trash için geçersiz proje yolu.');
    return normalized;
}

function fromPisiTrashRelativePath(projectFolder, storedPath) {
    const normalized = normalizePisiTrashRelativePath(storedPath);
    if (!normalized) throw new Error('Trash manifest yolu geçersiz.');
    const resolved = path.resolve(projectFolder, ...normalized.split('/'));
    if (!isSameOrInsidePisiTrashPath(resolved, path.resolve(projectFolder))) {
        throw new Error('Trash manifest yolu proje dışına çıkıyor.');
    }
    return resolved;
}

function ensurePisiTrashDirectories(projectFolder) {
    const root = getPisiTrashItemsRoot(projectFolder);
    fs.mkdirSync(root, { recursive: true });
    try { globalThis.hideFileOnWindows?.(path.join(projectFolder, '.pisi')); } catch {}
    return root;
}

function writePisiTrashManifest(projectFolder, manifest) {
    const manifestPath = getPisiTrashManifestPath(projectFolder, manifest.id);
    filesystemCore.writeFileAtomic(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        { backup: false }
    );
    return manifestPath;
}

function readPisiTrashManifest(projectFolder, trashId) {
    const manifestPath = getPisiTrashManifestPath(projectFolder, trashId);
    const result = filesystemCore.readJsonFileResult(manifestPath);
    if (!result.ok || !result.data) {
        return {
            ok: false,
            code: 'TRASH_ITEM_INVALID',
            error: result.error || 'Trash manifest okunamadı.'
        };
    }
    const manifest = result.data;
    if (
        manifest.version !== PISI_TRASH_VERSION ||
        normalizePisiTrashId(manifest.id) !== normalizePisiTrashId(trashId) ||
        !Array.isArray(manifest.entries)
    ) {
        return { ok: false, code: 'TRASH_ITEM_INVALID', error: 'Trash manifest geçersiz.' };
    }
    return { ok: true, manifest, manifestPath };
}

function listPisiTrashItems(projectFolder) {
    const itemsRoot = getPisiTrashItemsRoot(projectFolder);
    if (!fs.existsSync(itemsRoot)) {
        return { ok: true, version: PISI_TRASH_VERSION, items: [], warnings: [] };
    }
    const items = [];
    const warnings = [];
    for (const entry of fs.readdirSync(itemsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !normalizePisiTrashId(entry.name)) continue;
        const result = readPisiTrashManifest(projectFolder, entry.name);
        if (!result.ok) {
            warnings.push(`${entry.name}: ${result.error}`);
            continue;
        }
        items.push(summarizePisiTrashManifest(result.manifest));
    }
    items.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
    return { ok: true, version: PISI_TRASH_VERSION, items, warnings };
}

function walkPisiTrashFiles(rootPath, callback) {
    if (!rootPath || !fs.existsSync(rootPath)) return;
    const stat = fs.lstatSync(rootPath);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
        callback(rootPath);
        return;
    }
    if (!stat.isDirectory()) return;
    const queue = [rootPath];
    while (queue.length) {
        const current = queue.shift();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.pisi') continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) queue.push(fullPath);
            else if (entry.isFile()) callback(fullPath);
        }
    }
}

function collectPisiTrashIdentity(projectFolder, roots) {
    const nodeIds = new Set();
    const mapIds = new Set();
    const nodePaths = [];
    const mapPaths = [];
    for (const root of roots) {
        walkPisiTrashFiles(root, (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== '.node' && ext !== '.map') return;
            const info = documentStore.ensurePisiFileMetadata(filePath);
            if (!info.ok) return;
            if (ext === '.node') {
                nodeIds.add(info.metadata.id);
                nodePaths.push(toPisiTrashRelativePath(projectFolder, filePath));
            } else {
                mapIds.add(info.metadata.id);
                mapPaths.push(toPisiTrashRelativePath(projectFolder, filePath));
            }
        });
    }
    return {
        nodeIds,
        mapIds,
        nodePaths: Array.from(new Set(nodePaths)),
        mapPaths: Array.from(new Set(mapPaths))
    };
}

function getPisiTrashRoots(projectFolder, targetPath) {
    const safeTarget = assertPisiTrashProjectPath(projectFolder, targetPath);
    if (!fs.existsSync(safeTarget)) {
        throw new Error('Trash’e taşınacak öğe bulunamadı.');
    }
    const stat = fs.lstatSync(safeTarget);
    const kind = getPisiTrashItemKind(safeTarget, stat);
    const roots = [safeTarget];
    let parentMapPath = null;
    let primaryInfo = null;

    if (kind === 'node' || kind === 'map') {
        primaryInfo = documentStore.ensurePisiFileMetadata(safeTarget);
        if (!primaryInfo.ok) throw new Error(primaryInfo.error || 'Pisi öğesi okunamadı.');
        const sidecarPath = primaryInfo.metadata.sidecar
            ? path.join(path.dirname(safeTarget), primaryInfo.metadata.sidecar)
            : null;
        if (sidecarPath && fs.existsSync(sidecarPath)) roots.push(sidecarPath);
        if (kind === 'node') {
            parentMapPath = projectOperations.findParentMapPathForNode(safeTarget, primaryInfo);
        }
    }

    const uniqueRoots = roots.filter((candidate, index, values) => {
        return !values.some((other, otherIndex) => {
            return otherIndex !== index && isSameOrInsidePisiTrashPath(candidate, other);
        });
    });
    return { safeTarget, kind, roots: uniqueRoots, parentMapPath, primaryInfo };
}

function collectPisiTrashMapReferences(projectFolder, coveredRoots, nodeIds, relationshipIds) {
    const references = [];
    const changes = [];
    const relationshipIdSet = new Set(relationshipIds);
    walkPisiTrashFiles(projectFolder, (filePath) => {
        if (path.extname(filePath).toLowerCase() !== '.map') return;
        const relative = toPisiTrashRelativePath(projectFolder, filePath);
        if (isPisiTrashPathCovered(relative, coveredRoots)) return;
        const info = documentStore.ensurePisiFileMetadata(filePath);
        if (!info.ok || !info.data?.map) return;
        const mapData = info.data.map;
        const nodes = (Array.isArray(mapData.nodes) ? mapData.nodes : [])
            .filter((node) => nodeIds.has(node?.id))
            .map(deepClonePisiTrashValue);
        const views = mapSemanticCore.normalizePisiRelationshipViews(mapData.relationshipViews)
            .filter((view) => relationshipIdSet.has(view.relationshipId))
            .map(deepClonePisiTrashValue);
        const legacyEdges = (Array.isArray(mapData.edges) ? mapData.edges : [])
            .filter((edge) => nodeIds.has(edge?.sourceId) || nodeIds.has(edge?.targetId))
            .map(deepClonePisiTrashValue);
        if (!nodes.length && !views.length && !legacyEdges.length) return;

        references.push({ mapPath: relative, nodes, relationshipViews: views, legacyEdges });
        mapData.nodes = (Array.isArray(mapData.nodes) ? mapData.nodes : [])
            .filter((node) => !nodeIds.has(node?.id));
        mapData.relationshipViews = mapSemanticCore.normalizePisiRelationshipViews(mapData.relationshipViews)
            .filter((view) => !relationshipIdSet.has(view.relationshipId));
        if (Array.isArray(mapData.edges)) {
            mapData.edges = mapData.edges.filter((edge) => {
                return !nodeIds.has(edge?.sourceId) && !nodeIds.has(edge?.targetId);
            });
        }
        info.data.pisi.updatedAt = new Date().toISOString();
        changes.push({ filePath, data: info.data });
    });
    if (changes.length) filesystemCore.writePisiDocumentsTransaction(changes);
    return references;
}

function archivePisiTrashReferences(projectFolder, coveredRoots, identity) {
    const taskState = taskStore.readPisiTaskStore(projectFolder);
    const taskSplit = splitPisiTrashTaskStore(
        deepClonePisiTrashValue(taskState.tasks),
        coveredRoots
    );
    if (taskSplit.archived.length || taskSplit.dependencyRefs.length) {
        taskStore.writePisiTaskStore(projectFolder, {
            ...taskState,
            tasks: taskSplit.remaining
        });
    }

    const relationshipState = relationshipStore.readPisiRelationshipStore(projectFolder);
    const relationshipSplit = splitPisiTrashRelationships(
        relationshipState.relationships,
        identity.nodeIds
    );
    if (relationshipSplit.archived.length) {
        relationshipStore.writePisiRelationshipStore(projectFolder, relationshipSplit.remaining);
    }

    const mapReferences = collectPisiTrashMapReferences(
        projectFolder,
        coveredRoots,
        identity.nodeIds,
        relationshipSplit.archived.map((item) => item.id)
    );

    return {
        tasks: taskSplit.archived,
        taskDependencyRefs: taskSplit.dependencyRefs,
        relationships: relationshipSplit.archived,
        mapReferences
    };
}

function movePisiPathToTrash(projectFolder, targetPath) {
    try {
        const projectRoot = path.resolve(projectFolder);
        const target = getPisiTrashRoots(projectRoot, targetPath);
        const coveredRoots = target.roots.map((root) => toPisiTrashRelativePath(projectRoot, root));
        const identity = collectPisiTrashIdentity(projectRoot, target.roots);
        const references = archivePisiTrashReferences(projectRoot, coveredRoots, identity);
        const trashId = `trash_${crypto.randomUUID()}`;
        ensurePisiTrashDirectories(projectRoot);
        const itemDirectory = getPisiTrashItemDirectory(projectRoot, trashId);
        const payloadDirectory = path.join(itemDirectory, 'payload');
        fs.mkdirSync(payloadDirectory, { recursive: true });

        const entries = target.roots.map((root, index) => {
            const payloadName = `${String(index).padStart(3, '0')}-${path.basename(root)}`;
            const payloadPath = path.join(payloadDirectory, payloadName);
            const originalPath = toPisiTrashRelativePath(projectRoot, root);
            pathSecurity.renamePathInternal(root, payloadPath);
            return {
                originalPath,
                payloadPath: `payload/${payloadName}`,
                type: fs.lstatSync(payloadPath).isDirectory() ? 'directory' : 'file'
            };
        });

        const deletedAt = new Date().toISOString();
        const manifest = {
            version: PISI_TRASH_VERSION,
            id: trashId,
            kind: target.kind,
            label: path.basename(target.safeTarget),
            deletedAt,
            originalTarget: toPisiTrashRelativePath(projectRoot, target.safeTarget),
            parentMapPath: target.parentMapPath
                ? toPisiTrashRelativePath(projectRoot, target.parentMapPath)
                : null,
            entries,
            nodeIds: Array.from(identity.nodeIds),
            mapIds: Array.from(identity.mapIds),
            nodePaths: identity.nodePaths,
            mapPaths: identity.mapPaths,
            references
        };
        writePisiTrashManifest(projectRoot, manifest);
        return {
            ok: true,
            trashId,
            kind: target.kind,
            deletedPath: target.safeTarget,
            movedToTrash: true,
            reversible: true,
            summary: summarizePisiTrashManifest(manifest)
        };
    } catch (error) {
        return { ok: false, code: error.code || 'TRASH_MOVE_FAILED', error: error.message };
    }
}

function getPisiTrashPayloadPath(itemDirectory, storedPath) {
    const normalized = normalizePisiTrashRelativePath(storedPath);
    if (!normalized || !normalized.startsWith('payload/')) {
        throw new Error('Trash payload yolu geçersiz.');
    }
    const resolved = path.resolve(itemDirectory, ...normalized.split('/'));
    if (!isSameOrInsidePisiTrashPath(resolved, itemDirectory)) {
        throw new Error('Trash payload yolu item dışına çıkıyor.');
    }
    return resolved;
}

function preflightPisiTrashRestore(projectFolder, manifest) {
    const conflicts = [];
    if (manifest.kind === 'node' && manifest.parentMapPath) {
        const parentMapPath = fromPisiTrashRelativePath(projectFolder, manifest.parentMapPath);
        if (!fs.existsSync(parentMapPath)) {
            conflicts.push({ type: 'parent-missing', path: manifest.parentMapPath });
        }
    }
    for (const entry of manifest.entries) {
        const destination = fromPisiTrashRelativePath(projectFolder, entry.originalPath);
        if (fs.existsSync(destination)) {
            conflicts.push({ type: 'path-exists', path: entry.originalPath });
        }
    }

    const activeIdentity = collectPisiTrashIdentity(projectFolder, [projectFolder]);
    for (const nodeId of Array.isArray(manifest.nodeIds) ? manifest.nodeIds : []) {
        if (activeIdentity.nodeIds.has(nodeId)) {
            conflicts.push({ type: 'node-id', id: nodeId });
        }
    }
    for (const mapId of Array.isArray(manifest.mapIds) ? manifest.mapIds : []) {
        if (activeIdentity.mapIds.has(mapId)) {
            conflicts.push({ type: 'map-id', id: mapId });
        }
    }

    const currentTasks = taskStore.readPisiTaskStore(projectFolder);
    const liveTaskIds = new Set(currentTasks.tasks.map((task) => task.id));
    for (const task of manifest.references?.tasks || []) {
        if (liveTaskIds.has(task.id)) conflicts.push({ type: 'task-id', id: task.id });
    }

    const restoredNodeIds = new Set(Array.isArray(manifest.nodeIds) ? manifest.nodeIds : []);
    const availableNodeIds = new Set([...activeIdentity.nodeIds, ...restoredNodeIds]);
    const currentRelationships = relationshipStore.readPisiRelationshipStore(projectFolder);
    let preparedRelationships = currentRelationships.relationships;
    for (const relationship of manifest.references?.relationships || []) {
        if (
            !availableNodeIds.has(relationship.sourceId) ||
            !availableNodeIds.has(relationship.targetId)
        ) {
            conflicts.push({
                type: 'relationship-endpoint-missing',
                id: relationship.id,
                sourceId: relationship.sourceId,
                targetId: relationship.targetId
            });
            continue;
        }
        if (preparedRelationships.some((item) => item.id === relationship.id)) {
            conflicts.push({ type: 'relationship-id', id: relationship.id });
            continue;
        }
        const prepared = relationshipStore.prepareSemanticRelationshipUpsert(
            preparedRelationships,
            relationship
        );
        if (!prepared.ok) {
            conflicts.push({
                type: prepared.code || 'relationship-conflict',
                id: relationship.id,
                error: prepared.error
            });
            continue;
        }
        preparedRelationships = prepared.relationships;
    }

    return {
        ok: conflicts.length === 0,
        conflicts,
        currentTasks,
        preparedRelationships
    };
}

function restorePisiTrashMapReferences(projectFolder, references, restoredRelationshipIds) {
    const warnings = [];
    const changes = [];
    const relationshipIds = new Set(restoredRelationshipIds);
    for (const reference of Array.isArray(references) ? references : []) {
        let mapPath;
        try {
            mapPath = fromPisiTrashRelativePath(projectFolder, reference.mapPath);
        } catch (error) {
            warnings.push(`${reference.mapPath}: ${error.message}`);
            continue;
        }
        if (!fs.existsSync(mapPath)) {
            warnings.push(`${reference.mapPath}: referans map artık mevcut değil.`);
            continue;
        }
        const info = documentStore.ensurePisiFileMetadata(mapPath);
        if (!info.ok || !info.data?.map) {
            warnings.push(`${reference.mapPath}: map okunamadı.`);
            continue;
        }
        const mapData = info.data.map;
        const currentNodeIds = new Set((Array.isArray(mapData.nodes) ? mapData.nodes : [])
            .map((node) => node?.id).filter(Boolean));
        mapData.nodes = [
            ...(Array.isArray(mapData.nodes) ? mapData.nodes : []),
            ...(reference.nodes || []).filter((node) => node?.id && !currentNodeIds.has(node.id))
        ];
        const currentViews = mapSemanticCore.normalizePisiRelationshipViews(mapData.relationshipViews);
        const currentViewIds = new Set(currentViews.map((view) => view.relationshipId));
        mapData.relationshipViews = [
            ...currentViews,
            ...(reference.relationshipViews || []).filter((view) => {
                return relationshipIds.has(view?.relationshipId) &&
                    !currentViewIds.has(view.relationshipId);
            })
        ];
        mapData.relationshipViewVersion = mapSemanticCore.PISI_MAP_RELATIONSHIP_VIEW_VERSION;
        if (Array.isArray(mapData.edges)) {
            const currentEdgeIds = new Set(mapData.edges.map((edge) => edge?.id).filter(Boolean));
            mapData.edges.push(...(reference.legacyEdges || []).filter((edge) => {
                return edge?.id && !currentEdgeIds.has(edge.id);
            }));
        }
        info.data.pisi.updatedAt = new Date().toISOString();
        changes.push({ filePath: mapPath, data: info.data });
    }
    if (changes.length) filesystemCore.writePisiDocumentsTransaction(changes);
    return warnings;
}

function restorePisiTrashItem(projectFolder, trashId) {
    try {
        const projectRoot = path.resolve(projectFolder);
        const result = readPisiTrashManifest(projectRoot, trashId);
        if (!result.ok) return result;
        const manifest = result.manifest;
        const preflight = preflightPisiTrashRestore(projectRoot, manifest);
        if (!preflight.ok) {
            return {
                ok: false,
                code: 'TRASH_RESTORE_CONFLICT',
                error: 'Trash öğesi güvenli biçimde geri yüklenemiyor.',
                conflicts: preflight.conflicts
            };
        }

        const itemDirectory = getPisiTrashItemDirectory(projectRoot, trashId);
        atomicMutation.capturePisiAtomicPathBeforeChange(itemDirectory);
        for (const entry of manifest.entries) {
            const source = getPisiTrashPayloadPath(itemDirectory, entry.payloadPath);
            const destination = fromPisiTrashRelativePath(projectRoot, entry.originalPath);
            if (!fs.existsSync(source)) {
                throw new Error(`Trash payload bulunamadı: ${entry.payloadPath}`);
            }
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            pathSecurity.renamePathInternal(source, destination);
        }

        const restoredTasks = deepClonePisiTrashValue(manifest.references?.tasks || []);
        const restoredTaskIds = new Set(restoredTasks.map((task) => task.id));
        const taskState = taskStore.readPisiTaskStore(projectRoot);
        let mergedTasks = [...taskState.tasks, ...restoredTasks];
        mergedTasks = mergePisiTrashTaskDependencies(
            mergedTasks,
            manifest.references?.taskDependencyRefs || [],
            restoredTaskIds
        );
        if (restoredTasks.length || (manifest.references?.taskDependencyRefs || []).length) {
            taskStore.writePisiTaskStore(projectRoot, { ...taskState, tasks: mergedTasks });
        }

        const restoredRelationships = manifest.references?.relationships || [];
        if (restoredRelationships.length) {
            relationshipStore.writePisiRelationshipStore(
                projectRoot,
                preflight.preparedRelationships
            );
        }
        const restoredRelationshipIds = restoredRelationships.map((item) => item.id);
        const warnings = restorePisiTrashMapReferences(
            projectRoot,
            manifest.references?.mapReferences || [],
            restoredRelationshipIds
        );

        fs.rmSync(itemDirectory, { recursive: true, force: true });
        return {
            ok: true,
            trashId: manifest.id,
            restoredPath: fromPisiTrashRelativePath(projectRoot, manifest.originalTarget),
            restoredTasks: restoredTasks.length,
            restoredRelationships: restoredRelationships.length,
            warnings
        };
    } catch (error) {
        return { ok: false, code: error.code || 'TRASH_RESTORE_FAILED', error: error.message };
    }
}

function permanentlyDeletePisiTrashItem(projectFolder, trashId) {
    try {
        const projectRoot = path.resolve(projectFolder);
        const result = readPisiTrashManifest(projectRoot, trashId);
        if (!result.ok) return result;
        const itemDirectory = getPisiTrashItemDirectory(projectRoot, trashId);
        const summary = summarizePisiTrashManifest(result.manifest);
        fs.rmSync(itemDirectory, { recursive: true, force: true });
        return { ok: true, trashId: result.manifest.id, permanentlyDeleted: true, summary };
    } catch (error) {
        return { ok: false, code: 'TRASH_PERMANENT_DELETE_FAILED', error: error.message };
    }
}

function emptyPisiTrash(projectFolder) {
    try {
        const itemsRoot = getPisiTrashItemsRoot(projectFolder);
        if (!fs.existsSync(itemsRoot)) {
            return { ok: true, permanentlyDeleted: 0 };
        }
        let permanentlyDeleted = 0;
        for (const entry of fs.readdirSync(itemsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || !normalizePisiTrashId(entry.name)) continue;
            fs.rmSync(path.join(itemsRoot, entry.name), { recursive: true, force: true });
            permanentlyDeleted += 1;
        }
        return { ok: true, permanentlyDeleted };
    } catch (error) {
        return { ok: false, code: 'TRASH_EMPTY_FAILED', error: error.message };
    }
}

const moduleApi = {
    PISI_TRASH_VERSION,
    getPisiTrashRoot,
    getPisiTrashItemsRoot,
    getPisiTrashItemDirectory,
    getPisiTrashManifestPath,
    listPisiTrashItems,
    readPisiTrashManifest,
    movePisiPathToTrash,
    restorePisiTrashItem,
    permanentlyDeletePisiTrashItem,
    emptyPisiTrash,
    preflightPisiTrashRestore
};

registerMainModule('main.trashStore', moduleApi);