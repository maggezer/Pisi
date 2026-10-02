import { buildPisiSearchAccelerator, pisiSearchPathKey } from './pisi-search-core.mjs';
import {
    removePisiSearchMapMemberships,
    replacePisiSearchMapRecord,
    replacePisiSearchNodeRecords,
    upsertPisiSearchMapMembership
} from './pisi-search-filesystem-delta-core.mjs';

function getPisiSearchFileName(path = '') {
    return (
        String(path || '')
            .split(/[\\/]/)
            .pop() || ''
    );
}

function getPisiSearchParentPath(filePath = '') {
    const value = String(filePath || '');
    const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return slash > 0 ? value.slice(0, slash) : '';
}

function createPisiSearchFilesystemDeltaController(options = {}) {
    const {
        getBaseIndex,
        setBaseIndex,
        getIndexGeneration,
        hasBuildPromise,
        getProjectFolder,
        invalidate,
        createDocumentRecord,
        createRecordsForDocument,
        makeMapRecord,
        makeMapSearchRecord,
        makeMembership,
        cacheDocument,
        deleteDocumentCache
    } = options;

    /** @type {Promise<any>} */
    let deltaPromise = Promise.resolve();
    let deltaActive = false;

    async function inspectPath(filePath) {
        const parentPath = getPisiSearchParentPath(filePath);
        if (!parentPath) {
            return { ok: false, exists: false, error: 'Parent path is unavailable.' };
        }
        const result = await window.pisiProject?.listFolder?.(parentPath);
        if (!result?.ok || !Array.isArray(result.items)) {
            return {
                ok: false,
                exists: false,
                error: result?.error || 'Parent folder could not be listed.'
            };
        }
        const targetKey = pisiSearchPathKey(filePath);
        const fileName = getPisiSearchFileName(filePath).toLocaleLowerCase('en-US');
        const item =
            result.items.find((candidate) => {
                if (pisiSearchPathKey(candidate?.fullPath) === targetKey) return true;
                const candidateName = String(candidate?.name || candidate?.fileName || '').toLocaleLowerCase('en-US');
                return candidateName === fileName;
            }) || null;
        return { ok: true, exists: Boolean(item), item };
    }

    function inferMemberships(maps, nodePath, nodeId) {
        const pathKey = pisiSearchPathKey(nodePath);
        const memberships = [];
        for (const map of maps || []) {
            const node = (map.nodes || []).find((candidate) => {
                return (nodeId && candidate?.id === nodeId) || pisiSearchPathKey(candidate?.path) === pathKey;
            });
            if (node) memberships.push(makeMembership(map, node));
        }
        return memberships;
    }

    function recacheDocument(documentRecord) {
        if (!documentRecord?.path) return;
        cacheDocument(
            {
                path: documentRecord.path,
                item: documentRecord.nodeItem,
                content: documentRecord.html,
                metadata: documentRecord.metadata,
                properties: documentRecord.properties,
                memberships: documentRecord.memberships
            },
            documentRecord
        );
    }

    async function applyMapDelta(state, mapPath) {
        const mapKey = pisiSearchPathKey(mapPath);
        const previousMap =
            state.maps.find((map) => {
                return pisiSearchPathKey(map?.path) === mapKey;
            }) || null;
        const probe = await inspectPath(mapPath);
        if (!probe.ok) return { ok: false, error: probe.error };

        const affectedNodePaths = new Set((previousMap?.nodes || []).map((node) => node.path).filter(Boolean));

        if (!probe.exists) {
            state.maps = state.maps.filter((map) => {
                return pisiSearchPathKey(map?.path) !== mapKey;
            });
            for (const nodePath of affectedNodePaths) {
                const nodeKey = pisiSearchPathKey(nodePath);
                const current = state.documents.get(nodeKey);
                if (!current) continue;
                const next = {
                    ...current,
                    memberships: removePisiSearchMapMemberships(current.memberships, mapPath)
                };
                state.documents.set(nodeKey, next);
                recacheDocument(next);
            }
            state.changedMapPaths.add(mapPath);
            for (const nodePath of affectedNodePaths) state.affectedNodePaths.add(nodePath);
            state.removedMapPaths.add(mapPath);
            return { ok: true };
        }

        const mapResult = await window.pisiProject?.listMapNodes?.(mapPath);
        if (!mapResult?.ok) {
            return { ok: false, error: mapResult?.error || 'Map could not be read.' };
        }
        const mapItem = {
            ...(probe.item || {}),
            fullPath: mapPath,
            name: probe.item?.name || getPisiSearchFileName(mapPath),
            fileName: probe.item?.fileName || probe.item?.name || getPisiSearchFileName(mapPath)
        };
        const nextMap = makeMapRecord(mapItem, mapResult);

        for (const node of nextMap.nodes) affectedNodePaths.add(node.path);
        for (const nodePath of affectedNodePaths) {
            const nodeKey = pisiSearchPathKey(nodePath);
            const current = state.documents.get(nodeKey);
            if (!current) continue;
            state.documents.set(nodeKey, {
                ...current,
                memberships: removePisiSearchMapMemberships(current.memberships, mapPath)
            });
        }

        for (const node of mapResult.nodes || []) {
            const nodeKey = pisiSearchPathKey(node.fullPath);
            const current = state.documents.get(nodeKey) || null;
            const membership = makeMembership(nextMap, node);
            const memberships = upsertPisiSearchMapMembership(current?.memberships || [], membership);
            const metadata = node.metadata || current?.metadata || {};
            const properties = node.properties || current?.properties || {};
            const rawNode = {
                path: node.fullPath,
                item: {
                    ...(current?.nodeItem || {}),
                    ...node,
                    name: node.fileName || getPisiSearchFileName(node.fullPath),
                    fileName: node.fileName || getPisiSearchFileName(node.fullPath),
                    fullPath: node.fullPath,
                    type: 'file',
                    isFile: true,
                    isDirectory: false,
                    metadata,
                    properties
                },
                content: node.content !== undefined ? String(node.content || '') : String(current?.html || ''),
                metadata,
                properties,
                memberships
            };
            const next = createDocumentRecord(rawNode, state.projectFolder);
            state.documents.set(nodeKey, next);
            cacheDocument(rawNode, next);
        }

        for (const nodePath of affectedNodePaths) {
            const current = state.documents.get(pisiSearchPathKey(nodePath));
            if (current) recacheDocument(current);
            state.affectedNodePaths.add(nodePath);
        }

        state.maps = [...state.maps.filter((map) => pisiSearchPathKey(map?.path) !== mapKey), nextMap];
        state.changedMapPaths.add(mapPath);
        return { ok: true };
    }

    async function resolveNodeDelta(state, nodePath) {
        const result = await window.pisiProject?.getPisiDocument?.(nodePath);
        if (result?.ok) return { mode: 'upsert', nodePath, result };

        const probe = await inspectPath(nodePath);
        if (!probe.ok) return { mode: 'ambiguous', nodePath, error: probe.error };
        if (probe.exists) {
            return {
                mode: 'ambiguous',
                nodePath,
                error: result?.error || 'Node exists but could not be read.'
            };
        }
        return { mode: 'remove', nodePath };
    }

    function applyNodeUpsert(state, resolved) {
        const { nodePath, result } = resolved;
        const nodeKey = pisiSearchPathKey(nodePath);
        const current = state.documents.get(nodeKey) || null;
        const metadata = result.metadata || result.data?.pisi || current?.metadata || {};
        const properties = result.data?.properties || current?.properties || {};
        let memberships = Array.isArray(current?.memberships) ? current.memberships : [];
        if (!memberships.length) {
            memberships = inferMemberships(state.maps, nodePath, metadata?.id);
        }
        const fileName = getPisiSearchFileName(nodePath);
        const rawNode = {
            path: nodePath,
            item: {
                ...(current?.nodeItem || {}),
                name: fileName,
                fileName,
                fullPath: nodePath,
                type: 'file',
                isFile: true,
                isDirectory: false,
                metadata,
                properties
            },
            content: String(result.data?.content || ''),
            metadata,
            properties,
            memberships
        };
        const next = createDocumentRecord(rawNode, state.projectFolder);
        state.documents.set(nodeKey, next);
        cacheDocument(rawNode, next);
        state.affectedNodePaths.add(nodePath);

        if (metadata?.id) {
            state.maps = state.maps.map((map) => ({
                ...map,
                nodes: (map.nodes || []).map((node) => {
                    if (node?.id !== metadata.id) return node;
                    return { ...node, path: nodePath, title: next.title };
                })
            }));
        }
    }

    function applyNodeRemove(state, nodePath) {
        const nodeKey = pisiSearchPathKey(nodePath);
        state.documents.delete(nodeKey);
        deleteDocumentCache(nodeKey);
        state.maps = state.maps.map((map) => ({
            ...map,
            nodes: (map.nodes || []).filter((node) => {
                return pisiSearchPathKey(node?.path) !== nodeKey;
            })
        }));
        state.affectedNodePaths.add(nodePath);
        state.removedNodePaths.add(nodePath);
    }

    function rebuildDeltaRecords(baseIndex, state) {
        let records = Array.isArray(baseIndex.records) ? baseIndex.records : [];
        for (const nodePath of state.affectedNodePaths) {
            const documentRecord = state.documents.get(pisiSearchPathKey(nodePath));
            records = replacePisiSearchNodeRecords(records, nodePath, documentRecord ? createRecordsForDocument(documentRecord) : []);
        }
        for (const mapPath of state.changedMapPaths) {
            const map =
                state.maps.find((candidate) => {
                    return pisiSearchPathKey(candidate?.path) === pisiSearchPathKey(mapPath);
                }) || null;
            records = replacePisiSearchMapRecord(records, mapPath, map ? makeMapSearchRecord(map, state.projectFolder) : null);
        }
        return records;
    }

    async function apply(classification) {
        const baseIndex = getBaseIndex();
        const startGeneration = getIndexGeneration();
        const projectFolder = getProjectFolder();
        const projectKey = pisiSearchPathKey(projectFolder);
        if (!baseIndex || baseIndex.projectKey !== projectKey || hasBuildPromise()) {
            return { ok: false, rebuild: true, reason: 'base-index-not-ready' };
        }

        const state = {
            projectFolder,
            maps: Array.isArray(baseIndex.maps)
                ? baseIndex.maps.map((map) => ({
                      ...map,
                      nodes: Array.isArray(map.nodes) ? map.nodes.map((node) => ({ ...node })) : []
                  }))
                : [],
            documents: new Map(baseIndex.documents || []),
            affectedNodePaths: new Set(),
            changedMapPaths: new Set(),
            removedNodePaths: new Set(),
            removedMapPaths: new Set()
        };

        for (const mapPath of classification.mapPaths) {
            const result = await applyMapDelta(state, mapPath);
            if (!result.ok) {
                return { ok: false, rebuild: true, reason: 'map-delta-ambiguous', error: result.error };
            }
        }

        const resolvedNodes = [];
        for (const nodePath of classification.nodePaths) {
            resolvedNodes.push(await resolveNodeDelta(state, nodePath));
        }
        const ambiguous = resolvedNodes.find((entry) => entry.mode === 'ambiguous');
        if (ambiguous) {
            return {
                ok: false,
                rebuild: true,
                reason: 'node-delta-ambiguous',
                error: ambiguous.error
            };
        }

        resolvedNodes.filter((entry) => entry.mode === 'upsert').forEach((entry) => applyNodeUpsert(state, entry));
        resolvedNodes.filter((entry) => entry.mode === 'remove').forEach((entry) => applyNodeRemove(state, entry.nodePath));

        if (getBaseIndex() !== baseIndex || getIndexGeneration() !== startGeneration || pisiSearchPathKey(getProjectFolder()) !== projectKey) {
            return { ok: false, superseded: true, reason: 'delta-superseded' };
        }

        const records = rebuildDeltaRecords(baseIndex, state);
        const accelerator = buildPisiSearchAccelerator(records);
        const index = {
            ...baseIndex,
            updatedAt: Date.now(),
            deltaGeneration: Number(baseIndex.deltaGeneration || 0) + 1,
            maps: state.maps,
            documents: state.documents,
            records,
            accelerator,
            performance: {
                ...(baseIndex.performance || {}),
                recordCount: records.length,
                gramCount: accelerator.gramCount,
                scopedDeltaCount: Number(baseIndex.performance?.scopedDeltaCount || 0) + 1,
                lastDeltaNodeCount: state.affectedNodePaths.size,
                lastDeltaMapCount: state.changedMapPaths.size
            }
        };
        setBaseIndex(index);

        const detail = {
            index,
            mode: 'delta',
            delta: {
                changedNodePaths: Array.from(state.affectedNodePaths),
                changedMapPaths: Array.from(state.changedMapPaths),
                removedNodePaths: Array.from(state.removedNodePaths),
                removedMapPaths: Array.from(state.removedMapPaths)
            }
        };
        document.dispatchEvent(new CustomEvent('pisi:search-index-delta-applied', { detail }));
        document.dispatchEvent(new CustomEvent('pisi:search-index-ready', { detail }));
        return { ok: true, ...detail };
    }

    function queue(classification) {
        const changedPaths = classification.uniquePaths;
        deltaPromise = deltaPromise
            .catch(() => null)
            .then(async () => {
                deltaActive = true;
                try {
                    const result = await apply(classification);
                    if (!result?.ok && !result?.superseded) {
                        invalidate(result?.reason || 'filesystem-delta-fallback', changedPaths);
                    }
                    return result;
                } catch (error) {
                    console.warn('[PISI] Scoped search delta failed; rebuilding:', error);
                    invalidate('filesystem-delta-error', changedPaths);
                    return { ok: false, rebuild: true, error: error.message };
                } finally {
                    deltaActive = false;
                }
            });
        return deltaPromise;
    }

    return {
        apply,
        queue,
        isActive() {
            return deltaActive;
        }
    };
}

export { createPisiSearchFilesystemDeltaController };
