'use strict';

const path = require('path');

const PISI_TRASH_VERSION = 1;
const PISI_TRASH_DIR = path.join('.pisi', 'trash');
const PISI_TRASH_ITEMS_DIR = 'items';

function normalizePisiTrashId(value) {
    const raw = String(value || '').trim();
    return /^trash_[A-Za-z0-9._:-]{4,180}$/.test(raw) ? raw : null;
}

function normalizePisiTrashRelativePath(value) {
    const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw || raw === '.' || raw.includes('\0')) return null;
    const parts = raw.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return null;
    return parts.join('/');
}

function normalizePisiTrashComparePath(value) {
    const normalized = String(value || '').replace(/[\\/]+/g, '/').replace(/^\.\//, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPisiTrashPathCovered(candidate, roots = []) {
    const cleanCandidate = normalizePisiTrashComparePath(candidate);
    if (!cleanCandidate) return false;
    return (Array.isArray(roots) ? roots : []).some((root) => {
        const cleanRoot = normalizePisiTrashComparePath(root);
        return cleanRoot && (
            cleanCandidate === cleanRoot ||
            cleanCandidate.startsWith(`${cleanRoot}/`)
        );
    });
}

function getPisiTrashItemKind(targetPath, stat = null) {
    const ext = path.extname(String(targetPath || '')).toLowerCase();
    if (ext === '.node') return 'node';
    if (ext === '.map') return 'map';
    if (stat?.isDirectory?.()) return 'folder';
    return 'file';
}

function isPisiTaskAffectedByTrash(task, roots = []) {
    const source = task?.source || {};
    return [source.nodePath, source.mapPath]
        .filter(Boolean)
        .some((storedPath) => isPisiTrashPathCovered(storedPath, roots));
}

function splitPisiTrashTaskStore(tasks = [], roots = []) {
    const archived = [];
    const remaining = [];
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (isPisiTaskAffectedByTrash(task, roots)) archived.push(task);
        else remaining.push(task);
    }
    const archivedIds = new Set(archived.map((task) => task.id).filter(Boolean));
    const dependencyRefs = [];
    for (const task of remaining) {
        const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
        const removed = dependencies.filter((id) => archivedIds.has(id));
        if (!removed.length) continue;
        dependencyRefs.push({ taskId: task.id, dependencies: removed });
        task.dependencies = dependencies.filter((id) => !archivedIds.has(id));
    }
    return { archived, remaining, dependencyRefs };
}

function mergePisiTrashTaskDependencies(tasks = [], dependencyRefs = [], restoredIds = new Set()) {
    const byId = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [task.id, task]));
    for (const ref of Array.isArray(dependencyRefs) ? dependencyRefs : []) {
        const task = byId.get(ref?.taskId);
        if (!task) continue;
        const current = Array.isArray(task.dependencies) ? task.dependencies : [];
        const additions = (Array.isArray(ref.dependencies) ? ref.dependencies : [])
            .filter((id) => restoredIds.has(id));
        task.dependencies = Array.from(new Set([...current, ...additions]));
    }
    return Array.from(byId.values());
}

function splitPisiTrashRelationships(relationships = [], nodeIds = new Set()) {
    const archived = [];
    const remaining = [];
    for (const relationship of Array.isArray(relationships) ? relationships : []) {
        if (
            nodeIds.has(relationship?.sourceId) ||
            nodeIds.has(relationship?.targetId)
        ) archived.push(relationship);
        else remaining.push(relationship);
    }
    return { archived, remaining };
}

function summarizePisiTrashManifest(manifest = {}) {
    const refs = manifest.references || {};
    return {
        id: manifest.id,
        version: manifest.version,
        kind: manifest.kind,
        label: manifest.label,
        deletedAt: manifest.deletedAt,
        originalTarget: manifest.originalTarget,
        parentMapPath: manifest.parentMapPath || null,
        entryCount: Array.isArray(manifest.entries) ? manifest.entries.length : 0,
        nodeCount: Array.isArray(manifest.nodeIds) ? manifest.nodeIds.length : 0,
        mapCount: Array.isArray(manifest.mapIds) ? manifest.mapIds.length : 0,
        taskCount: Array.isArray(refs.tasks) ? refs.tasks.length : 0,
        relationshipCount: Array.isArray(refs.relationships) ? refs.relationships.length : 0,
        mapReferenceCount: Array.isArray(refs.mapReferences) ? refs.mapReferences.length : 0
    };
}

module.exports = {
    PISI_TRASH_VERSION,
    PISI_TRASH_DIR,
    PISI_TRASH_ITEMS_DIR,
    normalizePisiTrashId,
    normalizePisiTrashRelativePath,
    normalizePisiTrashComparePath,
    isPisiTrashPathCovered,
    getPisiTrashItemKind,
    isPisiTaskAffectedByTrash,
    splitPisiTrashTaskStore,
    mergePisiTrashTaskDependencies,
    splitPisiTrashRelationships,
    summarizePisiTrashManifest
};