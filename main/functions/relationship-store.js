'use strict';

const path = require('path');
const crypto = require('crypto');
const storageLayer = require('./storage');
const { modules, registerMainModule } = require('../module-registry');

const filesystemCore = modules['main.filesystemCore'];
const pathSecurity = modules['main.pathSecurity'];

const PISI_RELATIONSHIP_STORE_VERSION = 1;
const PISI_RELATIONSHIP_STORE_KEY = '.pisi/relationships.json';

function getPisiRelationshipStorage(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder);
}

function getPisiRelationshipStorePath(projectFolder) {
    return path.join(projectFolder, '.pisi', 'relationships.json');
}

function normalizeRelationshipProperties(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const clean = {};
    for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
        const key = String(rawKey || '').trim().slice(0, 120);
        if (!key) continue;

        if (
            rawValue === null ||
            typeof rawValue === 'string' ||
            typeof rawValue === 'number' ||
            typeof rawValue === 'boolean'
        ) {
            clean[key] = typeof rawValue === 'string'
                ? rawValue.slice(0, 4000)
                : rawValue;
        }
    }
    return clean;
}

function normalizePisiSemanticRelationship(raw = {}, options = {}) {
    const edge = filesystemCore.normalizeMapEdge(raw);
    if (!edge) return null;

    const now = new Date().toISOString();
    const id = /^edge_[A-Za-z0-9_-]{1,101}$/.test(String(raw.id || ''))
        ? String(raw.id)
        : `edge_${crypto.randomUUID()}`;
    const createdAt = /^\d{4}-\d{2}-\d{2}T/.test(String(raw.createdAt || ''))
        ? String(raw.createdAt)
        : (options.createdAt || now);
    const relationship = {
        id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        sourceRole: edge.sourceRole,
        targetRole: edge.targetRole,
        direction: edge.type === 'co-level' ? 'undirected' : 'directed',
        createdAt,
        updatedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(raw.updatedAt || ''))
            ? String(raw.updatedAt)
            : now
    };

    const label = String(raw.label || '').trim().slice(0, 500);
    if (label) relationship.label = label;

    const properties = normalizeRelationshipProperties(raw.properties);
    if (Object.keys(properties).length) {
        relationship.properties = properties;
    }

    return relationship;
}

function getPisiRelationshipSemanticKey(relationship) {
    return filesystemCore.getPisiEdgeSemanticKey(relationship);
}

function normalizeRelationshipCollection(rawRelationships = []) {
    const relationships = [];
    const seenIds = new Set();
    const seenSemanticKeys = new Set();
    const parentByChild = new Map();
    const warnings = [];

    for (const raw of Array.isArray(rawRelationships) ? rawRelationships : []) {
        let relationship = normalizePisiSemanticRelationship(raw);
        if (!relationship) {
            warnings.push('Geçersiz semantic relationship atlandı.');
            continue;
        }

        if (seenIds.has(relationship.id)) {
            warnings.push(`Tekrarlanan relationship id atlandı: ${relationship.id}`);
            continue;
        }

        if (filesystemCore.isHierarchyEdge(relationship)) {
            const existingParent = parentByChild.get(relationship.targetId);
            if (existingParent && existingParent !== relationship.sourceId) {
                relationship = normalizePisiSemanticRelationship({
                    ...relationship,
                    type: 'stream',
                    sourceRole: 'downstream',
                    targetRole: 'upstream'
                });
                warnings.push(
                    `İkinci semantic parent stream olarak kurtarıldı: ${relationship.id}`
                );
            } else if (
                !existingParent &&
                filesystemCore.wouldCreatePisiHierarchyCycle(
                    parentByChild,
                    relationship.sourceId,
                    relationship.targetId
                )
            ) {
                relationship = normalizePisiSemanticRelationship({
                    ...relationship,
                    type: 'stream',
                    sourceRole: 'downstream',
                    targetRole: 'upstream'
                });
                warnings.push(
                    `Döngü oluşturan semantic relationship stream olarak kurtarıldı: ${relationship.id}`
                );
            } else if (!existingParent) {
                parentByChild.set(relationship.targetId, relationship.sourceId);
            }
        }

        const semanticKey = getPisiRelationshipSemanticKey(relationship);
        if (!semanticKey || seenSemanticKeys.has(semanticKey)) {
            warnings.push(`Tekrarlanan semantic relationship atlandı: ${relationship.id}`);
            continue;
        }

        seenIds.add(relationship.id);
        seenSemanticKeys.add(semanticKey);
        relationships.push(relationship);
    }

    return { relationships, warnings };
}

function readPisiRelationshipStore(projectFolder) {
    const storage = getPisiRelationshipStorage(projectFolder);
    const filePath = storage.resolvePath(PISI_RELATIONSHIP_STORE_KEY);
    const result = storage.readJson(PISI_RELATIONSHIP_STORE_KEY, {
        allowMissing: true
    });

    if (result.missing) {
        return {
            ok: true,
            version: PISI_RELATIONSHIP_STORE_VERSION,
            relationships: [],
            warnings: [],
            missing: true,
            filePath
        };
    }
    if (!result.ok) {
        return {
            ok: false,
            version: PISI_RELATIONSHIP_STORE_VERSION,
            relationships: [],
            warnings: [],
            filePath,
            error: result.error || 'Relationship store okunamadı.'
        };
    }

    const normalized = normalizeRelationshipCollection(result.data?.relationships);
    return {
        ok: true,
        version: PISI_RELATIONSHIP_STORE_VERSION,
        relationships: normalized.relationships,
        warnings: normalized.warnings,
        filePath
    };
}

function writePisiRelationshipStore(projectFolder, relationships = []) {
    const normalized = normalizeRelationshipCollection(relationships);
    const storage = getPisiRelationshipStorage(projectFolder);
    const filePath = storage.resolvePath(PISI_RELATIONSHIP_STORE_KEY);
    const written = storage.writeJson(PISI_RELATIONSHIP_STORE_KEY, {
        version: PISI_RELATIONSHIP_STORE_VERSION,
        relationships: normalized.relationships
    }, {
        backup: true,
        newline: false,
        hiddenParent: true
    });
    if (!written.ok) {
        return {
            ok: false,
            relationships: normalized.relationships,
            warnings: normalized.warnings,
            filePath,
            error: written.error || 'Relationship store yazılamadı.'
        };
    }
    return {
        ok: true,
        relationships: normalized.relationships,
        warnings: normalized.warnings,
        filePath
    };
}

function listPisiSemanticRelationships(projectFolder, options = {}) {
    const current = readPisiRelationshipStore(projectFolder);
    if (!current.ok) return current;

    const wantedNodeIds = options.nodeIds instanceof Set
        ? options.nodeIds
        : new Set(Array.isArray(options.nodeIds) ? options.nodeIds : []);
    const relationships = wantedNodeIds.size
        ? current.relationships.filter((relationship) => {
            return wantedNodeIds.has(relationship.sourceId) &&
                wantedNodeIds.has(relationship.targetId);
        })
        : current.relationships;

    return {
        ...current,
        relationships
    };
}

function convertSemanticRelationshipToStream(relationship) {
    return normalizePisiSemanticRelationship({
        ...relationship,
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream',
        updatedAt: new Date().toISOString()
    });
}

function prepareSemanticRelationshipUpsert(currentRelationships, raw, options = {}) {
    let incoming = normalizePisiSemanticRelationship(raw);
    if (!incoming) {
        return { ok: false, error: 'Semantic relationship normalize edilemedi.' };
    }

    const incomingKey = getPisiRelationshipSemanticKey(incoming);
    const sameSemantic = currentRelationships.find((relationship) => {
        return getPisiRelationshipSemanticKey(relationship) === incomingKey;
    });
    const sameId = currentRelationships.find((relationship) => {
        return relationship.id === incoming.id;
    });
    const existing = sameId || sameSemantic || null;

    if (sameSemantic && !sameId) {
        incoming.id = sameSemantic.id;
    }
    if (existing?.createdAt) {
        incoming.createdAt = existing.createdAt;
    }
    incoming.updatedAt = new Date().toISOString();

    const withoutCurrent = currentRelationships.filter((relationship) => {
        return relationship.id !== incoming.id &&
            getPisiRelationshipSemanticKey(relationship) !== incomingKey;
    });

    if (filesystemCore.isHierarchyEdge(incoming)) {
        const existingParent = withoutCurrent.find((relationship) => {
            return filesystemCore.isHierarchyEdge(relationship) &&
                relationship.targetId === incoming.targetId &&
                relationship.sourceId !== incoming.sourceId;
        });

        if (existingParent) {
            if (options.confirmSecondParentAsStream !== true && options.migration !== true) {
                return {
                    ok: false,
                    code: 'SECOND_PARENT_CONFIRM_REQUIRED',
                    requiresConfirmation: true,
                    error: 'Hedef node zaten semantic bir parent ilişkisine sahip.',
                    suggestedRelationship: convertSemanticRelationshipToStream(incoming)
                };
            }
            incoming = convertSemanticRelationshipToStream(incoming);
        } else {
            const parentByChild = new Map();
            withoutCurrent
                .filter((relationship) => filesystemCore.isHierarchyEdge(relationship))
                .forEach((relationship) => {
                    parentByChild.set(relationship.targetId, relationship.sourceId);
                });

            if (
                filesystemCore.wouldCreatePisiHierarchyCycle(
                    parentByChild,
                    incoming.sourceId,
                    incoming.targetId
                )
            ) {
                if (options.migration === true) {
                    incoming = convertSemanticRelationshipToStream(incoming);
                } else {
                    return {
                        ok: false,
                        code: 'HIERARCHY_CYCLE',
                        error: 'Bu semantic ilişki hiyerarşide döngü oluşturur.'
                    };
                }
            }
        }
    }

    return {
        ok: true,
        relationship: incoming,
        relationships: [...withoutCurrent, incoming]
    };
}

function upsertPisiSemanticRelationship(projectFolder, raw, options = {}) {
    try {
        const current = readPisiRelationshipStore(projectFolder);
        if (!current.ok) return current;

        const prepared = prepareSemanticRelationshipUpsert(
            current.relationships,
            raw,
            options
        );
        if (!prepared.ok) return prepared;

        const written = writePisiRelationshipStore(
            projectFolder,
            prepared.relationships
        );
        return {
            ...written,
            relationship: prepared.relationship
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function deletePisiSemanticRelationship(projectFolder, relationshipId) {
    try {
        const current = readPisiRelationshipStore(projectFolder);
        if (!current.ok) return current;
        const id = String(relationshipId || '');
        const relationships = current.relationships.filter((relationship) => {
            return relationship.id !== id;
        });
        if (relationships.length === current.relationships.length) {
            return { ok: false, error: 'Semantic relationship bulunamadı.' };
        }
        const written = writePisiRelationshipStore(projectFolder, relationships);
        return {
            ...written,
            deletedRelationshipId: id
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function deletePisiSemanticRelationshipsForNode(projectFolder, nodeId) {
    try {
        const safeNodeId = pathSecurity.normalizePisiId(nodeId, '.node');
        if (!safeNodeId) return { ok: false, error: 'Geçersiz node kimliği.' };
        const current = readPisiRelationshipStore(projectFolder);
        if (!current.ok) return current;
        const removed = current.relationships.filter((relationship) => {
            return relationship.sourceId === safeNodeId ||
                relationship.targetId === safeNodeId;
        });
        if (!removed.length) {
            return { ok: true, removed: 0, relationships: current.relationships };
        }
        const remaining = current.relationships.filter((relationship) => {
            return relationship.sourceId !== safeNodeId &&
                relationship.targetId !== safeNodeId;
        });
        const written = writePisiRelationshipStore(projectFolder, remaining);
        return { ...written, removed: removed.length };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function reparentPisiSemanticRelationship(projectFolder, childId, parentId) {
    try {
        const safeChildId = pathSecurity.normalizePisiId(childId, '.node');
        const safeParentId = pathSecurity.normalizePisiId(parentId, '.node');
        if (!safeChildId || !safeParentId || safeChildId === safeParentId) {
            return { ok: false, error: 'Geçersiz semantic parent veya child kimliği.' };
        }

        const current = readPisiRelationshipStore(projectFolder);
        if (!current.ok) return current;
        const withoutOldParent = current.relationships.filter((relationship) => {
            return !(
                filesystemCore.isHierarchyEdge(relationship) &&
                relationship.targetId === safeChildId
            );
        });
        const replacement = normalizePisiSemanticRelationship({
            sourceId: safeParentId,
            targetId: safeChildId,
            sourcePort: 'bottom',
            targetPort: 'top',
            type: 'down-hub',
            sourceRole: 'down-hub',
            targetRole: 'up-hub'
        });
        const prepared = prepareSemanticRelationshipUpsert(
            withoutOldParent,
            replacement
        );
        if (!prepared.ok) return prepared;
        const written = writePisiRelationshipStore(projectFolder, prepared.relationships);
        return { ...written, relationship: prepared.relationship };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    PISI_RELATIONSHIP_STORE_VERSION,
    getPisiRelationshipStorePath,
    normalizeRelationshipProperties,
    normalizePisiSemanticRelationship,
    getPisiRelationshipSemanticKey,
    normalizeRelationshipCollection,
    readPisiRelationshipStore,
    writePisiRelationshipStore,
    listPisiSemanticRelationships,
    prepareSemanticRelationshipUpsert,
    upsertPisiSemanticRelationship,
    deletePisiSemanticRelationship,
    deletePisiSemanticRelationshipsForNode,
    reparentPisiSemanticRelationship
};

registerMainModule('main.relationshipStore', moduleApi);
