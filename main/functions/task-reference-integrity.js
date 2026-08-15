'use strict';

const fs = require('fs');
const path = require('path');
const { modules, registerMainModule } = require('../module-registry');

function isPisiReferencePathInside(basePath, targetPath) {
    if (!basePath || !targetPath) return false;
    const base = path.resolve(basePath);
    const target = path.resolve(targetPath);
    const relative = path.relative(base, target);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function normalizePisiReferenceStoredPath(projectFolder, targetPath) {
    if (!targetPath) return null;
    const resolved = path.resolve(targetPath);
    if (!isPisiReferencePathInside(projectFolder, resolved)) {
        throw new Error('Görev source yolu proje klasörünün dışında olamaz.');
    }
    return path.relative(path.resolve(projectFolder), resolved).replace(/\\/g, '/');
}

function hydratePisiReferenceStoredPath(projectFolder, storedPath) {
    if (!storedPath) return null;
    const resolved = path.resolve(
        projectFolder,
        String(storedPath).replace(/\//g, path.sep)
    );
    return isPisiReferencePathInside(projectFolder, resolved) ? resolved : null;
}

function normalizePisiTaskPathChanges(projectFolder, pathChanges = []) {
    return (Array.isArray(pathChanges) ? pathChanges : [])
        .map((change) => {
            const oldPath = String(change?.oldPath || '').trim();
            const newPath = String(change?.newPath || '').trim();
            if (!oldPath || !newPath) return null;
            const oldResolved = path.resolve(oldPath);
            const newResolved = path.resolve(newPath);
            if (
                !isPisiReferencePathInside(projectFolder, oldResolved) ||
                !isPisiReferencePathInside(projectFolder, newResolved)
            ) {
                throw new Error('Görev source path değişimi proje sınırları içinde kalmalı.');
            }
            return { oldPath: oldResolved, newPath: newResolved };
        })
        .filter(Boolean)
        .sort((a, b) => b.oldPath.length - a.oldPath.length);
}

function rewritePisiTaskStoredReference(projectFolder, storedPath, pathChanges) {
    const hydrated = hydratePisiReferenceStoredPath(projectFolder, storedPath);
    if (!hydrated) return storedPath || null;

    for (const change of pathChanges) {
        if (!isPisiReferencePathInside(change.oldPath, hydrated)) continue;
        const suffix = path.relative(change.oldPath, hydrated);
        const rewritten = path.resolve(change.newPath, suffix);
        return normalizePisiReferenceStoredPath(projectFolder, rewritten);
    }

    return storedPath || null;
}

function rewritePisiTaskSourcePaths(projectFolder, pathChanges = []) {
    const taskStore = modules['main.taskStore'];
    if (!taskStore?.readPisiTaskStore || !taskStore?.writePisiTaskStore) {
        return { ok: false, error: 'Task store source-of-truth bulunamadı.' };
    }

    try {
        const changes = normalizePisiTaskPathChanges(projectFolder, pathChanges);
        if (!changes.length) return { ok: true, updated: 0, taskIds: [] };

        const store = taskStore.readPisiTaskStore(projectFolder);
        const taskIds = [];
        const now = new Date().toISOString();

        for (const task of store.tasks) {
            const source = task?.source || {};
            const nodePath = rewritePisiTaskStoredReference(
                projectFolder,
                source.nodePath,
                changes
            );
            const mapPath = rewritePisiTaskStoredReference(
                projectFolder,
                source.mapPath,
                changes
            );
            if (nodePath === source.nodePath && mapPath === source.mapPath) continue;

            task.source = {
                ...source,
                nodePath,
                mapPath
            };
            task.updatedAt = now;
            taskIds.push(task.id);
        }

        if (taskIds.length) {
            taskStore.writePisiTaskStore(projectFolder, store);
        }

        return {
            ok: true,
            updated: taskIds.length,
            taskIds
        };
    } catch (error) {
        return { ok: false, error: error.message, updated: 0, taskIds: [] };
    }
}

function findPisiTaskProjectFolderForPath(targetPath) {
    if (!targetPath) return null;
    let current = path.resolve(targetPath);

    try {
        if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
            current = path.dirname(current);
        }
    } catch {
        current = path.dirname(current);
    }

    while (true) {
        const taskStorePath = path.join(current, '.pisi', 'tasks.json');
        if (fs.existsSync(taskStorePath)) return current;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

function rewritePisiTaskSourcePathsForPathChanges(pathChanges = []) {
    try {
        const changes = Array.isArray(pathChanges) ? pathChanges : [];
        const projectFolders = new Set();
        for (const change of changes) {
            for (const candidate of [change?.newPath, change?.oldPath]) {
                const projectFolder = findPisiTaskProjectFolderForPath(candidate);
                if (projectFolder) projectFolders.add(projectFolder);
            }
        }

        let updated = 0;
        const taskIds = [];
        for (const projectFolder of projectFolders) {
            const result = rewritePisiTaskSourcePaths(projectFolder, changes);
            if (!result.ok) return result;
            updated += result.updated;
            taskIds.push(...result.taskIds);
        }

        return {
            ok: true,
            updated,
            taskIds: Array.from(new Set(taskIds)),
            projectCount: projectFolders.size
        };
    } catch (error) {
        return { ok: false, error: error.message, updated: 0, taskIds: [] };
    }
}

const moduleApi = {
    rewritePisiTaskSourcePaths,
    rewritePisiTaskSourcePathsForPathChanges,
    findPisiTaskProjectFolderForPath
};

registerMainModule('main.taskReferenceIntegrity', moduleApi);
