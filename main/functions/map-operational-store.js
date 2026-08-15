'use strict';

const crypto = require('crypto');
const { modules, registerMainModule } = require('../module-registry');

const documentStore = modules['main.documentStore'];
const filesystemCore = modules['main.filesystemCore'];

const PISI_OPERATIONAL_MAP_VERSION = 1;
const PISI_OPERATIONAL_SCOPE_MODES = new Set([
    'all',
    'active',
    'blocked',
    'overdue',
    'missing-next-action',
    'owner-missing',
    'neighbors',
    'manual'
]);
const PISI_OPERATIONAL_RELATIONSHIP_TYPES = new Set([
    'down-hub',
    'stream',
    'co-level'
]);

function normalizePisiOperationalScope(raw = {}) {
    const mode = PISI_OPERATIONAL_SCOPE_MODES.has(String(raw.mode || ''))
        ? String(raw.mode)
        : 'all';
    const relationshipTypes = Array.from(new Set(
        (Array.isArray(raw.relationshipTypes) ? raw.relationshipTypes : [])
            .map((value) => String(value || ''))
            .filter((value) => PISI_OPERATIONAL_RELATIONSHIP_TYPES.has(value))
    ));
    const includedNodeIds = Array.from(new Set(
        (Array.isArray(raw.includedNodeIds) ? raw.includedNodeIds : [])
            .map((value) => String(value || ''))
            .filter((value) => /^node_[A-Za-z0-9_-]+$/.test(value))
    )).slice(0, 5000);
    const focusRootNodeId = /^node_[A-Za-z0-9_-]+$/.test(
        String(raw.focusRootNodeId || '')
    )
        ? String(raw.focusRootNodeId)
        : null;
    const focusDepth = Math.min(3, Math.max(1, Number(raw.focusDepth) || 1));

    return {
        mode,
        query: String(raw.query || '').trim().slice(0, 240),
        relationshipTypes,
        includedNodeIds,
        focusRootNodeId,
        focusDepth
    };
}

function normalizePisiOperationalDisplay(raw = {}) {
    return {
        showTaskDependencies: raw.showTaskDependencies !== false,
        showRelationshipLabels: raw.showRelationshipLabels !== false,
        showWorkBadges: raw.showWorkBadges !== false,
        dimFiltered: raw.dimFiltered === true
    };
}

function normalizePisiOperationalLayoutNode(raw = {}) {
    const id = String(raw.id || '');
    if (!/^node_[A-Za-z0-9_-]+$/.test(id)) return null;
    return {
        id,
        x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 80,
        y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 80,
        width: Math.max(150, Number(raw.width) || 220),
        height: Math.max(74, Number(raw.height) || 92)
    };
}

function normalizePisiOperationalCamera(raw = {}) {
    return {
        x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
        y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
        zoom: Math.min(3, Math.max(0.1, Number(raw.zoom) || 1))
    };
}

function normalizePisiSavedOperationalLayout(raw = {}) {
    const id = /^layout_[A-Za-z0-9_-]+$/.test(String(raw.id || ''))
        ? String(raw.id)
        : `layout_${crypto.randomUUID()}`;
    const name = String(raw.name || '').trim().slice(0, 120);
    if (!name) return null;
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .map(normalizePisiOperationalLayoutNode)
        .filter(Boolean)
        .slice(0, 5000);
    const timestamp = /^\d{4}-\d{2}-\d{2}T/.test(String(raw.updatedAt || ''))
        ? String(raw.updatedAt)
        : new Date().toISOString();
    return {
        id,
        name,
        nodes,
        camera: normalizePisiOperationalCamera(raw.camera),
        scope: normalizePisiOperationalScope(raw.scope),
        display: normalizePisiOperationalDisplay(raw.display),
        updatedAt: timestamp
    };
}

function normalizePisiOperationalMapState(raw = {}) {
    const savedLayouts = (Array.isArray(raw.savedLayouts) ? raw.savedLayouts : [])
        .map(normalizePisiSavedOperationalLayout)
        .filter(Boolean)
        .slice(-20);
    return {
        version: PISI_OPERATIONAL_MAP_VERSION,
        scope: normalizePisiOperationalScope(raw.scope),
        display: normalizePisiOperationalDisplay(raw.display),
        savedLayouts
    };
}

function readPisiOperationalMapState(mapPath) {
    const mapInfo = documentStore.ensurePisiFileMetadata(mapPath);
    if (!mapInfo.ok) return mapInfo;
    if (mapInfo.metadata?.type !== 'map') {
        return { ok: false, error: 'Operational state yalnız map dosyasına aittir.' };
    }
    return {
        ok: true,
        state: normalizePisiOperationalMapState(mapInfo.data.map?.operational),
        mapInfo
    };
}

function writePisiOperationalMapState(mapPath, state, mapInfo = null) {
    const currentInfo = mapInfo || documentStore.ensurePisiFileMetadata(mapPath);
    if (!currentInfo.ok) return currentInfo;
    if (!currentInfo.data.map || typeof currentInfo.data.map !== 'object') {
        currentInfo.data.map = { nodes: [], camera: { x: 0, y: 0, zoom: 1 } };
    }
    currentInfo.data.map.operational = normalizePisiOperationalMapState(state);
    currentInfo.data.pisi.updatedAt = new Date().toISOString();
    filesystemCore.writePisiDocument(mapPath, currentInfo.data);
    return { ok: true, state: currentInfo.data.map.operational };
}

function savePisiOperationalMapState(mapPath, payload = {}) {
    try {
        const current = readPisiOperationalMapState(mapPath);
        if (!current.ok) return current;
        const state = current.state;
        const op = String(payload.op || 'update');

        if (op === 'update') {
            if (payload.scope) state.scope = normalizePisiOperationalScope(payload.scope);
            if (payload.display) state.display = normalizePisiOperationalDisplay(payload.display);
            return writePisiOperationalMapState(mapPath, state, current.mapInfo);
        }

        if (op === 'save-layout') {
            const layout = normalizePisiSavedOperationalLayout({
                ...payload.layout,
                id: payload.layout?.id || `layout_${crypto.randomUUID()}`,
                updatedAt: new Date().toISOString()
            });
            if (!layout) return { ok: false, error: 'Layout adı gerekli.' };
            state.savedLayouts = state.savedLayouts.filter((item) => item.id !== layout.id);
            state.savedLayouts.push(layout);
            state.savedLayouts = state.savedLayouts.slice(-20);
            const written = writePisiOperationalMapState(mapPath, state, current.mapInfo);
            return { ...written, layout };
        }

        if (op === 'delete-layout') {
            const layoutId = String(payload.layoutId || '');
            const before = state.savedLayouts.length;
            state.savedLayouts = state.savedLayouts.filter((item) => item.id !== layoutId);
            if (before === state.savedLayouts.length) {
                return { ok: false, error: 'Kaydedilmiş layout bulunamadı.' };
            }
            return writePisiOperationalMapState(mapPath, state, current.mapInfo);
        }

        return { ok: false, error: 'Bilinmeyen operational map işlemi.' };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    PISI_OPERATIONAL_MAP_VERSION,
    normalizePisiOperationalScope,
    normalizePisiOperationalDisplay,
    normalizePisiOperationalLayoutNode,
    normalizePisiOperationalCamera,
    normalizePisiSavedOperationalLayout,
    normalizePisiOperationalMapState,
    readPisiOperationalMapState,
    writePisiOperationalMapState,
    savePisiOperationalMapState
};

registerMainModule('main.mapOperationalStore', moduleApi);
