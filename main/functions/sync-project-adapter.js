'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storageLayer = require('./storage');
const syncCore = require('./sync-core');
const { modules, registerMainModule } = require('../module-registry');

const CONFIG_FILES = Object.freeze({
    propertySchema: '.pisi/properties.json',
    savedViews: '.pisi-views.json',
    templates: '.pisi-templates.json'
});

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getStorage(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder);
}

function comparePath(value) {
    return path.resolve(value).normalize('NFC').toLowerCase();
}

function isDriveSyncConflictPath(value) {
    return / \(conflict \d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\)(?: \(\d+\))?\.(?:node|map)$/i
        .test(String(value || ''));
}

function isSafeSidecarName(value) {
    const name = String(value || '').normalize('NFC');
    if (
        !name || name.length > 180 || path.basename(name) !== name ||
        /[<>:"|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
    ) return false;
    const stem = name.split('.')[0].toUpperCase();
    return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

function generatedSidecarName(title, extension, id) {
    const generated = modules['main.filesystemCore'].getPisiSidecarName(title, extension, id);
    if (isSafeSidecarName(generated)) return generated;
    const prefix = extension === '.map' ? 'nd_' : 'inv_';
    const maximum = Math.max(8, 180 - prefix.length - 2 - String(id).length);
    return `${prefix}${sanitizeTitle(title, 'Yeni Dosya', maximum)}__${id}`;
}

function readProjectDocuments(projectFolder) {
    const storage = getStorage(projectFolder);
    const walked = storage.walk('.', {
        ignore: ['.git', '.pisi', 'node_modules'],
        extensions: ['.node', '.map'],
        maxFiles: 100000
    });
    if (!walked.ok) throw new Error(walked.error || 'Sync proje taraması başarısız.');
    const documents = [];
    const byId = new Map();
    const byPath = new Map();
    const entries = [...walked.entries].sort((left, right) => (
        Number(isDriveSyncConflictPath(left.key)) - Number(isDriveSyncConflictPath(right.key)) ||
        String(left.key).localeCompare(String(right.key))
    ));
    const fileConflicts = [];
    for (const entry of entries) {
        const read = storage.readJson(entry.key);
        if (!read.ok || !read.data?.pisi?.id || !['node', 'map'].includes(read.data.pisi.type)) {
            continue;
        }
        let data = read.data;
        let id = String(data.pisi.id);
        const kind = data.pisi.type;
        const namedConflict = isDriveSyncConflictPath(entry.key);
        const duplicate = byId.get(id);
        const alreadyIsolated = Boolean(
            namedConflict && data.pisi.conflictOf &&
            new RegExp(`^${kind}_conflict_[A-Za-z0-9_-]+$`).test(id)
        );
        if ((namedConflict && !alreadyIsolated) || duplicate) {
            const originalId = id;
            const suffix = syncCore.hashString(`${entry.key}:${originalId}:${JSON.stringify(data)}`);
            id = `${kind}_conflict_${suffix}`;
            data = clone(data);
            data.pisi = {
                ...data.pisi,
                id,
                title: `${data.pisi.title || 'Başlıksız'} (DriveSync çakışma kopyası)`,
                conflictOf: originalId,
                conflictSourcePath: entry.key
            };
            fileConflicts.push({
                kind, originalId, conflictId: id,
                originalPath: duplicate?.key || null,
                conflictPath: entry.key,
                source: namedConflict ? 'drivesync-filename' : 'duplicate-pisi-id'
            });
        }
        if (byId.has(id)) {
            throw new Error(`Sync çakışma kimliği güvenle ayrılamadı: ${id}`);
        }
        const row = { id, kind, key: entry.key, path: entry.path, data };
        documents.push(row);
        byId.set(id, row);
        byPath.set(comparePath(entry.path), row);
    }
    return { documents, byId, byPath, fileConflicts };
}

function canonicalNodePayload(row, relationships) {
    const data = row.data;
    return {
        schema: 'pisi.node.v1',
        title: String(data.pisi.title || path.basename(row.path, '.node')),
        content: String(data.content || ''),
        blocks: Array.isArray(data.blocks) ? clone(data.blocks) : [],
        tags: Array.isArray(data.tags) ? clone(data.tags) : [],
        properties: data.properties && typeof data.properties === 'object' ? clone(data.properties) : {},
        relations: relationships.filter(({ sourceId }) => sourceId === row.id).map((item) => ({
            id: item.id,
            targetId: item.targetId,
            type: item.type,
            sourceRole: item.sourceRole,
            targetRole: item.targetRole,
            direction: item.direction,
            label: item.label,
            properties: item.properties,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        })),
        sources: Array.isArray(data.sources) ? clone(data.sources) : [],
        parentMap: data.pisi.parentMap || 'none',
        documentKind: data.documentKind || (data.dateKey ? 'journal' : 'note'),
        dateKey: data.dateKey || null,
        pinned: Boolean(data.pinned),
        drawing: data.drawing || null,
        sheet: data.sheet || null,
        view: data.view || null,
        createdAt: data.pisi.createdAt || null,
        updatedAt: data.pisi.updatedAt || null,
        relativePath: row.key,
        native: clone(data)
    };
}

function canonicalMapPayload(row) {
    const data = row.data;
    const map = data.map || {};
    return {
        schema: 'pisi.map.v1',
        title: String(data.pisi.title || path.basename(row.path, '.map')),
        map: {
            nodes: clone(Array.isArray(map.nodes) ? map.nodes : []),
            edges: clone(Array.isArray(map.edges) ? map.edges : []),
            camera: clone(map.camera || { x: 0, y: 0, zoom: 1 }),
            collapsedAnchors: clone(Array.isArray(map.collapsedAnchors) ? map.collapsedAnchors : [])
        },
        tags: Array.isArray(data.tags) ? clone(data.tags) : [],
        properties: data.properties && typeof data.properties === 'object' ? clone(data.properties) : {},
        createdAt: data.pisi.createdAt || null,
        updatedAt: data.pisi.updatedAt || null,
        relativePath: row.key,
        native: clone(data)
    };
}

function readConfig(storage, key, fallback) {
    const result = storage.readJson(key, { allowMissing: true });
    return result.ok && !result.missing ? result.data : fallback;
}

function resolveTaskSourceIds(projectFolder, task, byPath) {
    const source = task.source || {};
    const findId = (value, kind) => {
        if (!value) return null;
        const absolute = path.isAbsolute(value)
            ? path.resolve(value)
            : path.resolve(projectFolder, String(value).replace(/\//g, path.sep));
        const row = byPath.get(comparePath(absolute));
        return row?.kind === kind ? row.id : null;
    };
    return {
        documentId: findId(source.nodePath, 'node'),
        blockId: source.blockId || null,
        mapId: findId(source.mapPath, 'map'),
        nodeTitle: String(source.nodeTitle || ''),
        mapTitle: String(source.mapTitle || '')
    };
}

function exportPisiSyncEntities(projectFolder) {
    const inventory = readProjectDocuments(projectFolder);
    const relationshipsResult = modules['main.relationshipStore']
        .readPisiRelationshipStore(projectFolder);
    if (!relationshipsResult.ok) throw new Error(relationshipsResult.error);
    const taskStore = modules['main.taskStore'].readPisiTaskStore(projectFolder);
    const storage = getStorage(projectFolder);
    const entities = inventory.documents.map((row) => ({
        kind: row.kind,
        id: row.id,
        payload: row.kind === 'map'
            ? canonicalMapPayload(row)
            : canonicalNodePayload(row, relationshipsResult.relationships)
    }));
    for (const task of taskStore.tasks) {
        entities.push({
            kind: 'task',
            id: task.id,
            payload: {
                ...clone(task),
                source: resolveTaskSourceIds(projectFolder, task, inventory.byPath)
            }
        });
    }

    const propertySchema = readConfig(storage, CONFIG_FILES.propertySchema, { definitions: [] });
    const savedViews = readConfig(storage, CONFIG_FILES.savedViews, { views: [] });
    const templates = readConfig(storage, CONFIG_FILES.templates, { templates: [] });
    entities.push(
        { kind: 'config', id: 'propertySchema', payload: { value: clone(propertySchema.definitions || []) } },
        { kind: 'config', id: 'savedViews', payload: { value: (savedViews.views || []).map((view) => ({
            ...clone(view), type: view.type || view.layout || 'table', layout: view.layout || view.type || 'table'
        })) } },
        { kind: 'config', id: 'templates', payload: { value: (templates.templates || []).map((template) => ({
            ...clone(template), kind: template.kind || template.nodeType || 'note',
            nodeType: template.nodeType || template.kind || 'note'
        })) } }
    );
    return entities;
}

function sanitizeTitle(value, fallback, maximum = 100) {
    let title = String(value || fallback || 'Başlıksız')
        .normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, Math.max(8, maximum));
    const stem = title.split('.')[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) title = `_${title}`;
    return title || fallback || 'Başlıksız';
}

function uniqueFilePath(directory, title, extension, id, occupied) {
    const maximum = Math.max(8, 180 - 2 - String(id).length - extension.length);
    const clean = sanitizeTitle(
        title,
        extension === '.map' ? 'Senkronize Harita' : 'Senkronize Node',
        maximum
    );
    const candidates = [
        `${clean}${extension}`,
        `${clean}__${id}${extension}`
    ];
    let index = 1;
    while (true) {
        const name = candidates.shift() || `${clean}__${id}_${index++}${extension}`;
        const candidate = path.join(directory, name);
        const normalized = comparePath(candidate);
        if (!occupied.has(normalized) && !fs.existsSync(candidate)) {
            occupied.add(normalized);
            return candidate;
        }
    }
}

function makeDocumentData(record, existingData, parentMap = 'none') {
    const payload = record.payload || {};
    const extension = record.kind === 'map' ? '.map' : '.node';
    const expectedPrefix = record.kind === 'map' ? 'map_' : 'node_';
    if (
        !record.id.startsWith(expectedPrefix) ||
        record.id.length > 101 ||
        !/^(?:map|node)_[A-Za-z0-9_-]+$/.test(record.id)
    ) throw new Error(`Sync kaydı geçersiz Pisi kimliği taşıyor: ${record.id}`);
    const native = payload.native && typeof payload.native === 'object'
        ? clone(payload.native) : null;
    const data = native || modules['main.filesystemCore'].createPisiDocumentData({
        ext: extension,
        title: payload.title,
        id: record.id,
        parentMap
    });
    const now = new Date().toISOString();
    data.pisi = {
        ...(existingData?.pisi || {}),
        ...(data.pisi || {}),
        version: 1,
        type: record.kind,
        id: record.id,
        title: String(payload.title || data.pisi?.title || 'Başlıksız'),
        createdAt: payload.createdAt || data.pisi?.createdAt || now,
        updatedAt: payload.updatedAt || now
    };
    if (record.kind === 'node') {
        data.pisi.parentMap = parentMap || payload.parentMap || 'none';
        data.pisi.connectionTypes ||= modules['main.pathSecurity'].getDefaultNodeConnectionTypes();
        data.content = String(payload.content || '');
        data.blocks = clone(payload.blocks || []);
        data.tags = clone(payload.tags || []);
        data.properties = clone(payload.properties || {});
        data.sources = clone(payload.sources || []);
        data.documentKind = payload.documentKind || 'note';
        data.dateKey = payload.dateKey || null;
        data.pinned = Boolean(payload.pinned);
        if (payload.drawing != null) data.drawing = clone(payload.drawing);
        if (payload.sheet != null) data.sheet = clone(payload.sheet);
        if (payload.view != null) data.view = clone(payload.view);
    } else {
        data.map = clone(payload.map || { nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 } });
        data.tags = clone(payload.tags || []);
        data.properties = clone(payload.properties || {});
    }
    return data;
}

function moveToSyncTrash(projectFolder, targetPath, stamp) {
    if (!fs.existsSync(targetPath)) return null;
    const relative = path.relative(projectFolder, targetPath);
    if (!relative || relative.startsWith('..')) return null;
    const destination = path.join(projectFolder, '.pisi', 'sync-trash', stamp, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    let finalPath = destination;
    if (fs.existsSync(finalPath)) finalPath += `.${crypto.randomUUID()}`;
    fs.renameSync(targetPath, finalPath);
    return finalPath;
}

function makeConflictRecords(records, conflicts) {
    const live = records.filter((record) => !record.deleted).map(clone);
    const occupied = new Set(live.map(({ kind, id }) => `${kind}:${id}`));
    const log = [];
    for (const conflict of conflicts || []) {
        const loser = conflict?.loser;
        if (!loser || loser.deleted) continue;
        if (loser.kind === 'config' && Array.isArray(loser.payload?.value)) {
            const target = live.find((record) => record.kind === 'config' && record.id === loser.id);
            if (!target || !Array.isArray(target.payload?.value)) continue;
            const byId = new Map(target.payload.value.map((item) => [
                String(item?.id || syncCore.hashValue(item)), item
            ]));
            for (const item of loser.payload.value) {
                const itemId = String(item?.id || syncCore.hashValue(item));
                const current = byId.get(itemId);
                if (!current) {
                    target.payload.value.push(clone(item));
                    byId.set(itemId, item);
                } else if (syncCore.hashValue(current) !== syncCore.hashValue(item)) {
                    const copy = {
                        ...clone(item),
                        id: `${itemId}_conflict_${syncCore.hashValue(item)}`.slice(0, 80),
                        name: `${item?.name || itemId} (Sync çakışması)`
                    };
                    if (!byId.has(copy.id)) {
                        target.payload.value.push(copy);
                        byId.set(copy.id, copy);
                    }
                }
            }
            log.push({ originalKey: loser.key, conflictKey: loser.key });
            continue;
        }
        if (!['node', 'map', 'task'].includes(loser.kind)) continue;
        const suffix = syncCore.hashString(
            `${loser.kind}:${loser.id}:${loser.version?.deviceId}:${loser.hash}`
        );
        const prefix = loser.kind === 'map' ? 'map' : loser.kind === 'task' ? 'task' : 'node';
        const id = `${prefix}_conflict_${suffix}`;
        const key = `${loser.kind}:${id}`;
        if (occupied.has(key)) continue;
        live.push({
            ...clone(loser), key, id,
            payload: {
                ...clone(loser.payload),
                title: `${loser.payload?.title || 'Başlıksız'} (Sync çakışması - ${String(loser.version?.deviceId || 'cihaz').slice(0, 24)})`,
                parentMap: loser.kind === 'node' ? 'none' : loser.payload?.parentMap,
                relativePath: null,
                native: null
            }
        });
        occupied.add(key);
        log.push({ originalKey: loser.key, conflictKey: key });
    }
    return { live, log };
}

function applyPisiSyncRecords(projectFolder, records, conflicts = []) {
    const inventory = readProjectDocuments(projectFolder);
    const preserved = makeConflictRecords(records, conflicts);
    const liveDocuments = preserved.live.filter(({ kind }) => kind === 'node' || kind === 'map');
    const liveIds = new Set(liveDocuments.map(({ id }) => id));
    const occupied = new Set(inventory.documents.map(({ path: filePath }) => comparePath(filePath)));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mapPaths = new Map();
    const planned = [];

    for (const record of liveDocuments.filter(({ kind }) => kind === 'map')) {
        const existing = inventory.byId.get(record.id);
        const filePath = existing?.path || uniqueFilePath(
            projectFolder, record.payload?.title, '.map', record.id, occupied
        );
        const data = makeDocumentData(record, existing?.data);
        const expectedSidecar = generatedSidecarName(data.pisi.title, '.map', record.id);
        if (!isSafeSidecarName(data.pisi.sidecar)) data.pisi.sidecar = expectedSidecar;
        const sidecarPath = path.join(path.dirname(filePath), data.pisi.sidecar);
        fs.mkdirSync(sidecarPath, { recursive: true });
        mapPaths.set(record.id, { filePath, sidecarPath });
        planned.push({ filePath, data, oldPath: existing?.path || null });
    }
    for (const record of liveDocuments.filter(({ kind }) => kind === 'node')) {
        const existing = inventory.byId.get(record.id);
        const parentMap = record.payload?.parentMap || 'none';
        const desiredDirectory = mapPaths.get(parentMap)?.sidecarPath || projectFolder;
        let filePath = existing?.path || null;
        if (!filePath || path.resolve(path.dirname(filePath)) !== path.resolve(desiredDirectory)) {
            filePath = uniqueFilePath(
                desiredDirectory, record.payload?.title, '.node', record.id, occupied
            );
        }
        const data = makeDocumentData(record, existing?.data, parentMap);
        if (!isSafeSidecarName(data.pisi.sidecar)) {
            data.pisi.sidecar = generatedSidecarName(data.pisi.title, '.node', record.id);
        }
        const oldSidecar = existing?.data?.pisi?.sidecar;
        const oldSidecarPath = existing && isSafeSidecarName(oldSidecar)
            ? path.join(path.dirname(existing.path), oldSidecar) : null;
        const newSidecarPath = isSafeSidecarName(data.pisi.sidecar)
            ? path.join(path.dirname(filePath), data.pisi.sidecar) : null;
        planned.push({
            filePath, data, oldPath: existing?.path || null,
            oldSidecarPath, newSidecarPath
        });
    }

    for (const item of planned) {
        if (
            item.oldSidecarPath && item.newSidecarPath &&
            comparePath(item.oldSidecarPath) !== comparePath(item.newSidecarPath) &&
            fs.existsSync(item.oldSidecarPath) && fs.existsSync(item.newSidecarPath)
        ) {
            throw new Error(`Sync sidecar hedefi zaten var; ekler otomatik birleştirilmedi: ${item.newSidecarPath}`);
        }
    }
    modules['main.filesystemCore'].writePisiDocumentsTransaction(
        planned.map(({ filePath, data }) => ({ filePath, data }))
    );
    const trashPaths = new Set();
    for (const item of planned) {
        if (
            item.oldSidecarPath && item.newSidecarPath &&
            comparePath(item.oldSidecarPath) !== comparePath(item.newSidecarPath) &&
            fs.existsSync(item.oldSidecarPath)
        ) {
            fs.mkdirSync(path.dirname(item.newSidecarPath), { recursive: true });
            fs.renameSync(item.oldSidecarPath, item.newSidecarPath);
        }
        if (item.oldPath && comparePath(item.oldPath) !== comparePath(item.filePath)) {
            const moved = moveToSyncTrash(projectFolder, item.oldPath, stamp);
            if (moved) trashPaths.add(moved);
        }
    }
    const movedSidecarRoots = [];
    const deletions = inventory.documents
        .filter((row) => !liveIds.has(row.id))
        .sort((left, right) => Number(right.kind === 'map') - Number(left.kind === 'map'));
    for (const row of deletions) {
        if (movedSidecarRoots.some((root) => (
            comparePath(row.path) === root || comparePath(row.path).startsWith(`${root}${path.sep}`)
        ))) continue;
        const moved = moveToSyncTrash(projectFolder, row.path, stamp);
        if (moved) trashPaths.add(moved);
        const sidecar = row.data?.pisi?.sidecar;
        if (isSafeSidecarName(sidecar)) {
            const sidecarPath = path.join(path.dirname(row.path), sidecar);
            const normalizedSidecar = comparePath(sidecarPath);
            const movedSidecar = moveToSyncTrash(projectFolder, sidecarPath, stamp);
            if (movedSidecar) {
                trashPaths.add(movedSidecar);
                movedSidecarRoots.push(normalizedSidecar);
            }
        }
    }

    const finalInventory = readProjectDocuments(projectFolder);
    const tasks = preserved.live.filter(({ kind }) => kind === 'task').map(({ id, payload }) => {
        if (!/^task_[A-Za-z0-9._:-]{4,180}$/.test(String(id || ''))) {
            throw new Error(`Sync kaydı geçersiz görev kimliği taşıyor: ${id}`);
        }
        const node = finalInventory.byId.get(payload?.source?.documentId);
        const map = finalInventory.byId.get(payload?.source?.mapId);
        return {
            ...clone(payload), id,
            source: {
                nodePath: node?.path || null,
                blockId: payload?.source?.blockId || null,
                mapPath: map?.path || null,
                nodeTitle: payload?.source?.nodeTitle || node?.data?.pisi?.title || '',
                mapTitle: payload?.source?.mapTitle || map?.data?.pisi?.title || ''
            }
        };
    });
    modules['main.taskStore'].writePisiTaskStore(projectFolder, { tasks });

    const relationships = [];
    const liveNodeIds = new Set(
        preserved.live.filter(({ kind }) => kind === 'node').map(({ id }) => id)
    );
    for (const record of preserved.live.filter(({ kind }) => kind === 'node')) {
        for (const relation of record.payload?.relations || []) {
            if (!relation?.targetId || !liveNodeIds.has(relation.targetId)) continue;
            relationships.push({ ...clone(relation), sourceId: record.id });
        }
    }
    const relationshipResult = modules['main.relationshipStore']
        .writePisiRelationshipStore(projectFolder, relationships);
    if (!relationshipResult.ok) throw new Error(relationshipResult.error);

    const storage = getStorage(projectFolder);
    const configs = new Map(preserved.live.filter(({ kind }) => kind === 'config')
        .map((record) => [record.id, record.payload?.value]));
    const configWrites = [
        [CONFIG_FILES.propertySchema, { version: 1, definitions: clone(configs.get('propertySchema') || []) }],
        [CONFIG_FILES.savedViews, { version: 1, views: (configs.get('savedViews') || []).map((view) => ({
            ...clone(view), layout: view.layout || view.type || 'table', type: view.type || view.layout || 'table'
        })) }],
        [CONFIG_FILES.templates, { version: 1, templates: (configs.get('templates') || []).map((template) => ({
            ...clone(template), nodeType: template.nodeType || template.kind || 'note',
            kind: template.kind || template.nodeType || 'note'
        })) }]
    ];
    for (const [key, value] of configWrites) {
        const written = storage.writeJson(key, value, { backup: true, newline: true });
        if (!written.ok) throw new Error(written.error);
    }
    return {
        documents: liveDocuments.length,
        tasks: tasks.length,
        conflicts: preserved.log.length,
        recoveredToSyncTrash: trashPaths.size
    };
}

const moduleApi = {
    CONFIG_FILES,
    readProjectDocuments,
    exportPisiSyncEntities,
    applyPisiSyncRecords
};

registerMainModule('main.syncProjectAdapter', moduleApi);
