import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { registerMainModule } from '../module-registry.js';

const PISI_PROPERTY_TYPES = new Set(['text', 'number', 'multiselect', 'relation', 'rollup']);
const PISI_ROLLUP_AGGREGATES = new Set(['count', 'sum', 'average', 'min', 'max', 'unique', 'join']);

function normalizePisiPropertyId(value = '') {
    const normalized = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return normalized || `property-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizePisiPropertyReference(value = '') {
    return String(value || '').trim() ? normalizePisiPropertyId(value) : '';
}

function normalizePisiPropertyValue(type, value) {
    if (type === 'number') {
        if (value === null || value === undefined || String(value).trim() === '') {
            return null;
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
    if (type === 'multiselect' || type === 'relation') {
        const values = Array.isArray(value) ? value : [];
        return Array.from(new Set(values.map((item) => String(item).trim()).filter(Boolean)))
            .slice(0, type === 'relation' ? 500 : 100)
            .map((item) => item.slice(0, type === 'relation' ? 2048 : 240));
    }
    if (type === 'rollup') {
        const rollup = value && typeof value === 'object' ? value : {};
        return {
            relationProperty: normalizePisiPropertyReference(rollup.relationProperty || rollup.relationPropertyId || ''),
            targetProperty: normalizePisiPropertyReference(rollup.targetProperty || rollup.targetPropertyId || ''),
            aggregate: PISI_ROLLUP_AGGREGATES.has(String(rollup.aggregate || '')) ? String(rollup.aggregate) : 'count',
            separator: String(rollup.separator || ', ').slice(0, 20)
        };
    }
    return String(value ?? '')
        .trim()
        .slice(0, 10000);
}

function normalizePisiProperties(properties = {}) {
    const result = {};
    const entries = properties && typeof properties === 'object' && !Array.isArray(properties) ? Object.entries(properties) : [];
    for (const [rawId, raw] of entries.slice(0, 250)) {
        if (!raw || typeof raw !== 'object') continue;
        const name = String(raw.name || rawId || '')
            .trim()
            .slice(0, 120);
        if (!name) continue;
        const id = normalizePisiPropertyId(raw.id || rawId || name);
        const type = String(raw.type || '').toLowerCase();
        if (!PISI_PROPERTY_TYPES.has(type)) continue;
        result[id] = {
            id,
            name,
            type,
            value: normalizePisiPropertyValue(type, raw.value),
            ...(raw.system === true ? { system: true } : {})
        };
    }
    return result;
}

function savePisiNodeProperties(nodePath, properties = {}) {
    try {
        const nodeInfo = ensurePisiFileMetadata(nodePath);
        if (!nodeInfo.ok) return nodeInfo;
        if (nodeInfo.metadata.type !== 'node') {
            return { ok: false, error: 'Özellikler yalnızca node dosyasına kaydedilebilir.' };
        }
        if (typeof globalThis.snapshotPisiNodeVersion === 'function') {
            const snapshot = globalThis.snapshotPisiNodeVersion(nodePath, 'properties-save');
            if (!snapshot.ok) return snapshot;
        }
        nodeInfo.data.properties = normalizePisiProperties(properties);
        nodeInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(nodePath, nodeInfo.data);
        return {
            ok: true,
            fullPath: nodePath,
            metadata: nodeInfo.data.pisi,
            properties: nodeInfo.data.properties
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function getPisiViewsPath(projectFolder) {
    return path.join(projectFolder, '.pisi-views.json');
}

function readPisiSavedViews(projectFolder) {
    const filePath = getPisiViewsPath(projectFolder);
    if (!fs.existsSync(filePath)) return { ok: true, views: [] };
    const result = readJsonFileResult(filePath);
    if (!result.ok) return { ok: false, error: result.error, views: [] };
    const views = Array.isArray(result.data?.views) ? result.data.views.filter((item) => item?.id && item?.name).slice(0, 200) : [];
    return { ok: true, views };
}

function savePisiSavedView(projectFolder, view = {}) {
    try {
        const current = readPisiSavedViews(projectFolder);
        if (!current.ok) return current;
        const id = /^view_[A-Za-z0-9_-]+$/.test(String(view.id || '')) ? String(view.id) : `view_${crypto.randomUUID()}`;
        const clean = {
            id,
            name: String(view.name || '')
                .trim()
                .slice(0, 120),
            query: String(view.query || '')
                .trim()
                .slice(0, 2000),
            layout: ['table', 'cards'].includes(view.layout) ? view.layout : 'table',
            updatedAt: new Date().toISOString()
        };
        if (!clean.name) return { ok: false, error: 'Görünüm adı gerekli.' };
        const views = current.views.filter((item) => item.id !== id);
        views.push(clean);
        writeFileAtomic(getPisiViewsPath(projectFolder), JSON.stringify({ version: 1, views }, null, 2));
        return { ok: true, view: clean, views };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function deletePisiSavedView(projectFolder, viewId) {
    try {
        const current = readPisiSavedViews(projectFolder);
        if (!current.ok) return current;
        const views = current.views.filter((item) => item.id !== String(viewId || ''));
        writeFileAtomic(getPisiViewsPath(projectFolder), JSON.stringify({ version: 1, views }, null, 2));
        return { ok: true, views };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function getPisiTemplatesPath(projectFolder) {
    return path.join(projectFolder, '.pisi-templates.json');
}

function normalizePisiDatabaseTemplate(template = {}) {
    const id = /^template_[A-Za-z0-9_-]+$/.test(String(template.id || '')) ? String(template.id) : `template_${crypto.randomUUID()}`;
    const name = String(template.name || '')
        .trim()
        .slice(0, 120);
    if (!name) return null;
    return {
        id,
        name,
        nodeType: String(template.nodeType || 'note')
            .trim()
            .slice(0, 80),
        description: String(template.description || '')
            .trim()
            .slice(0, 500),
        content: String(template.content || '').slice(0, 2000000),
        properties: normalizePisiProperties(template.properties || {}),
        updatedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(template.updatedAt || '')) ? String(template.updatedAt) : new Date().toISOString()
    };
}

function readPisiDatabaseTemplates(projectFolder) {
    const filePath = getPisiTemplatesPath(projectFolder);
    if (!fs.existsSync(filePath)) return { ok: true, templates: [] };
    const result = readJsonFileResult(filePath);
    if (!result.ok) return { ok: false, error: result.error, templates: [] };
    const templates = (Array.isArray(result.data?.templates) ? result.data.templates : [])
        .map((template) => normalizePisiDatabaseTemplate(template))
        .filter(Boolean)
        .slice(0, 200);
    return { ok: true, templates };
}

function savePisiDatabaseTemplate(projectFolder, template = {}) {
    try {
        const current = readPisiDatabaseTemplates(projectFolder);
        if (!current.ok) return current;
        const clean = normalizePisiDatabaseTemplate(template);
        if (!clean) return { ok: false, error: 'Şablon adı gerekli.' };
        clean.updatedAt = new Date().toISOString();
        const templates = current.templates.filter((item) => item.id !== clean.id);
        templates.push(clean);
        writeFileAtomic(getPisiTemplatesPath(projectFolder), JSON.stringify({ version: 1, templates }, null, 2));
        return { ok: true, template: clean, templates };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function deletePisiDatabaseTemplate(projectFolder, templateId) {
    try {
        const current = readPisiDatabaseTemplates(projectFolder);
        if (!current.ok) return current;
        const templates = current.templates.filter((item) => {
            return item.id !== String(templateId || '');
        });
        writeFileAtomic(getPisiTemplatesPath(projectFolder), JSON.stringify({ version: 1, templates }, null, 2));
        return { ok: true, templates };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function applyPisiDatabaseTemplate(nodePath, templateId, options = {}) {
    try {
        const projectFolder = globalThis.activeProjectFolder || path.dirname(nodePath);
        const current = readPisiDatabaseTemplates(projectFolder);
        if (!current.ok) return current;
        const template = current.templates.find((item) => {
            return item.id === String(templateId || '');
        });
        if (!template) return { ok: false, error: 'Şablon bulunamadı.' };
        const nodeInfo = ensurePisiFileMetadata(nodePath);
        if (!nodeInfo.ok || nodeInfo.metadata.type !== 'node') {
            return { ok: false, error: 'Şablon yalnızca node dosyasına uygulanabilir.' };
        }
        if (typeof globalThis.snapshotPisiNodeVersion === 'function') {
            const snapshot = globalThis.snapshotPisiNodeVersion(nodePath, 'template-apply');
            if (!snapshot.ok) return snapshot;
        }
        const existing = normalizePisiProperties(nodeInfo.data.properties || {});
        nodeInfo.data.properties = options.replaceProperties === true ? template.properties : { ...existing, ...template.properties };
        if (options.applyContent === true && template.content) {
            const currentContent = String(nodeInfo.data.content || '');
            nodeInfo.data.content = options.contentMode === 'replace' ? template.content : `${currentContent}${currentContent ? '\n' : ''}${template.content}`;
        }
        nodeInfo.data.pisi.nodeType = template.nodeType || nodeInfo.data.pisi.nodeType || 'note';
        nodeInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(nodePath, nodeInfo.data);
        return {
            ok: true,
            fullPath: nodePath,
            template,
            metadata: nodeInfo.data.pisi,
            properties: nodeInfo.data.properties,
            content: nodeInfo.data.content || ''
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function makePisiRelativeReference(projectFolder, nodePath) {
    const relative = path.relative(projectFolder, nodePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join('/');
}

function createPisiPropertyMap(projectFolder, options = {}) {
    try {
        const references = [];
        const seen = new Set();
        for (const rawPath of Array.isArray(options.nodePaths) ? options.nodePaths : []) {
            const nodePath = path.resolve(String(rawPath || ''));
            const relativePath = makePisiRelativeReference(projectFolder, nodePath);
            if (!relativePath || seen.has(relativePath) || !fs.existsSync(nodePath)) continue;
            const info = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
            if (!info.ok || info.metadata.type !== 'node') continue;
            seen.add(relativePath);
            references.push({ id: info.metadata.id, path: relativePath });
        }
        if (!references.length) {
            return { ok: false, error: 'Map için eşleşen node bulunamadı.' };
        }

        const created = createUniquePisiFile(projectFolder, '.map');
        if (!created.ok) return created;
        const title = sanitizePisiBaseName(options.title || 'Özellik görünümü');
        const renamed = renamePisiFile(created.fullPath, title);
        const mapPath = renamed.ok ? renamed.fullPath : created.fullPath;
        const mapInfo = ensurePisiFileMetadata(mapPath);
        if (!mapInfo.ok) return mapInfo;
        mapInfo.data.map.references = references;
        mapInfo.data.map.generated = {
            kind: 'properties',
            query: String(options.query || '').slice(0, 2000),
            createdAt: new Date().toISOString()
        };
        mapInfo.data.map.nodes = references.map((reference, index) => ({
            id: reference.id,
            ...getDefaultNodeLayout(index)
        }));
        mapInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(mapPath, mapInfo.data);
        return {
            ok: true,
            fullPath: mapPath,
            fileName: path.basename(mapPath),
            metadata: mapInfo.data.pisi,
            referenceCount: references.length
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function resolvePisiMapReference(projectFolder, reference) {
    if (!reference?.path || !reference?.id) return null;
    const target = path.resolve(projectFolder, String(reference.path));
    const relative = path.relative(projectFolder, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (!fs.existsSync(target) || path.extname(target).toLowerCase() !== '.node') return null;
    return target;
}

function collectPisiMapReferenceNodes(mapInfo, seenNodeIds, startIndex = 0) {
    const projectFolder = globalThis.activeProjectFolder;
    if (!projectFolder || !Array.isArray(mapInfo?.data?.map?.references)) {
        return { nodes: [], changed: false };
    }
    const nodes = [];
    let changed = false;
    const validReferences = [];
    for (const reference of mapInfo.data.map.references.slice(0, 5000)) {
        const nodePath = resolvePisiMapReference(projectFolder, reference);
        if (!nodePath || seenNodeIds.has(reference.id)) {
            changed = true;
            continue;
        }
        const nodeInfo = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
        if (!nodeInfo.ok || nodeInfo.metadata.id !== reference.id) {
            changed = true;
            continue;
        }
        seenNodeIds.add(reference.id);
        validReferences.push(reference);
        const index = startIndex + nodes.length;
        let layout = mapInfo.data.map.nodes.find((item) => item.id === reference.id);
        if (!layout) {
            layout = { id: reference.id, ...getDefaultNodeLayout(index) };
            mapInfo.data.map.nodes.push(layout);
            changed = true;
        }
        const normalizedLayout = normalizePisiNodeLayout(layout, getDefaultNodeLayout(index));
        const normalizedCustomization = normalizePisiMapNodeCustomization(layout.customization);
        if (Object.keys(normalizedCustomization).length) {
            if (JSON.stringify(layout.customization || {}) !== JSON.stringify(normalizedCustomization)) {
                layout.customization = normalizedCustomization;
                changed = true;
            }
        } else if (Object.prototype.hasOwnProperty.call(layout, 'customization')) {
            delete layout.customization;
            changed = true;
        }
        nodes.push({
            id: reference.id,
            fullPath: nodePath,
            fileName: path.basename(nodePath),
            metadata: nodeInfo.metadata,
            properties: normalizePisiProperties(nodeInfo.data.properties),
            content: nodeInfo.data.content || '',
            preview: stripPreviewText(nodeInfo.data.content || ''),
            layout: normalizedLayout,
            customization: normalizedCustomization,
            isReference: true
        });
    }
    if (validReferences.length !== mapInfo.data.map.references.length) {
        mapInfo.data.map.references = validReferences;
    }
    return { nodes, changed };
}

function detachPisiMapReference(mapPath, nodeId) {
    try {
        const mapInfo = ensurePisiFileMetadata(mapPath);
        if (!mapInfo.ok) return mapInfo;
        const id = normalizePisiId(nodeId, '.node');
        const references = Array.isArray(mapInfo.data.map?.references) ? mapInfo.data.map.references : [];
        const reference = references.find((item) => item.id === id) || null;
        if (!reference) {
            return { ok: false, error: 'Map referansı bulunamadı.' };
        }
        const layout = (mapInfo.data.map.nodes || []).find((item) => item.id === id) || null;
        mapInfo.data.map.references = references.filter((item) => item.id !== id);
        mapInfo.data.map.nodes = (mapInfo.data.map.nodes || []).filter((item) => item.id !== id);
        mapInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(mapPath, mapInfo.data);
        // The removed reference and layout let map undo re-attach it unchanged.
        return { ok: true, detached: true, nodeId: id, reference: { ...reference }, layout: layout ? JSON.parse(JSON.stringify(layout)) : null };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Inverse of detachPisiMapReference: puts a standalone node back into a map as
 * a reference with its previous layout. The node must still exist inside the
 * project with the same id. Semantic relationships live in relationships.json
 * and were never removed, so the map projects them again.
 */
function attachPisiMapReference(mapPath, reference = {}, layout = null) {
    try {
        const projectFolder = globalThis.activeProjectFolder;
        const mapInfo = ensurePisiFileMetadata(mapPath);
        if (!mapInfo.ok) return mapInfo;
        const id = normalizePisiId(reference?.id, '.node');
        const nodePath = projectFolder ? resolvePisiMapReference(projectFolder, { id, path: reference?.path }) : null;
        if (!id || !nodePath) return { ok: false, code: 'MAP_REFERENCE_TARGET_MISSING', error: 'Referans verilen node bulunamadı.' };
        const nodeInfo = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
        if (!nodeInfo.ok || nodeInfo.metadata.id !== id) return { ok: false, code: 'MAP_REFERENCE_TARGET_MISSING', error: 'Referans verilen node bulunamadı.' };
        const map = mapInfo.data.map;
        map.references = Array.isArray(map.references) ? map.references : [];
        map.nodes = Array.isArray(map.nodes) ? map.nodes : [];
        if (map.references.some((item) => item.id === id) || map.nodes.some((item) => item.id === id)) {
            return { ok: false, code: 'MAP_REFERENCE_EXISTS', error: 'Node bu map içinde zaten var.' };
        }
        map.references.push({ id, path: makePisiRelativeReference(projectFolder, nodePath) });
        const fallback = getDefaultNodeLayout(map.nodes.length);
        map.nodes.push({
            ...normalizePisiNodeLayout(layout || fallback, fallback),
            ...(layout?.customization ? { customization: layout.customization } : {}),
            id
        });
        mapInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(mapPath, mapInfo.data);
        return { ok: true, attached: true, nodeId: id };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    normalizePisiPropertyId,
    normalizePisiPropertyReference,
    normalizePisiPropertyValue,
    normalizePisiProperties,
    savePisiNodeProperties,
    readPisiSavedViews,
    savePisiSavedView,
    deletePisiSavedView,
    normalizePisiDatabaseTemplate,
    readPisiDatabaseTemplates,
    savePisiDatabaseTemplate,
    deletePisiDatabaseTemplate,
    applyPisiDatabaseTemplate,
    createPisiPropertyMap,
    resolvePisiMapReference,
    collectPisiMapReferenceNodes,
    detachPisiMapReference,
    attachPisiMapReference
};

registerMainModule('main.structuredNodes', moduleApi);
