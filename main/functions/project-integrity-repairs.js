import { modules } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';
import * as documents from './project-integrity-documents.js';

import * as path from 'node:path';
const documentStore = modules['main.documentStore'];
const mapSemanticCore = modules['main.mapSemanticCore'];
const mapOperationalStore = modules['main.mapOperationalStore'];
const filesystemCore = modules['main.filesystemCore'];

function normalizeDocumentMetadata(projectFolder, payload) {
    const filePath = shared.absolutePath(projectFolder, payload.path);
    const result = documentStore.ensurePisiFileMetadata(filePath, {
        persist: true,
        ensureSidecar: true
    });
    return result.ok ? { ok: true, path: payload.path, changed: result.changed || false } : result;
}

function ensureDocumentSidecar(projectFolder, payload) {
    const filePath = shared.absolutePath(projectFolder, payload.path);
    const result = documentStore.ensurePisiFileMetadata(filePath, {
        persist: true,
        ensureSidecar: true
    });
    return result.ok ? { ok: true, path: payload.path, sidecarPath: result.sidecarPath } : result;
}

function normalizeMapOperationalState(projectFolder, payload) {
    const filePath = shared.absolutePath(projectFolder, payload.path);
    const current = mapOperationalStore.readPisiOperationalMapState(filePath);
    if (!current.ok) return current;
    return mapOperationalStore.writePisiOperationalMapState(filePath, current.state, current.mapInfo);
}

function applySafeRepair(projectFolder, repair) {
    if (repair.action === 'normalize-document-metadata') {
        return normalizeDocumentMetadata(projectFolder, repair.payload || {});
    }
    if (repair.action === 'ensure-document-sidecar') {
        return ensureDocumentSidecar(projectFolder, repair.payload || {});
    }
    if (repair.action === 'normalize-map-operational-state') {
        return normalizeMapOperationalState(projectFolder, repair.payload || {});
    }
    return {
        ok: false,
        code: 'INTEGRITY_REPAIR_NOT_SAFE',
        error: `Safe repair uygulanamıyor: ${repair.action}`
    };
}

function rebuildDerivedState(projectFolder, auditAfter) {
    const projectRoot = path.resolve(projectFolder);
    const context = { issues: [] };
    const inventory = documents.collectDocumentInventory(projectRoot, context);
    let mapsUpdated = 0;

    for (const doc of inventory.docs.filter((item) => item.type === 'map')) {
        const info = documentStore.ensurePisiFileMetadata(doc.filePath, {
            persist: false,
            ensureSidecar: false
        });
        if (!info.ok || !info.data.map) continue;
        let changed = false;
        const views = mapSemanticCore.normalizePisiRelationshipViews(info.data.map.relationshipViews);
        if (JSON.stringify(views) !== JSON.stringify(info.data.map.relationshipViews || [])) {
            info.data.map.relationshipViews = views;
            info.data.map.relationshipViewVersion = mapSemanticCore.PISI_MAP_RELATIONSHIP_VIEW_VERSION;
            changed = true;
        }
        if (info.data.map.operational !== undefined) {
            const operational = mapOperationalStore.normalizePisiOperationalMapState(info.data.map.operational);
            if (JSON.stringify(operational) !== JSON.stringify(info.data.map.operational)) {
                info.data.map.operational = operational;
                changed = true;
            }
        }
        if (changed) {
            info.data.pisi.updatedAt = new Date().toISOString();
            filesystemCore.writePisiDocument(doc.filePath, info.data);
            mapsUpdated += 1;
        }
    }

    return {
        ok: true,
        nodesUpdated: 0,
        mapsUpdated,
        authorityChanged: false,
        preservedAuthorities: ['.pisi/tasks.json', '.pisi/relationships.json'],
        report: typeof auditAfter === 'function' ? auditAfter(projectRoot) : null
    };
}

export { normalizeDocumentMetadata, ensureDocumentSidecar, normalizeMapOperationalState, applySafeRepair, rebuildDerivedState };
