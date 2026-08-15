import { registerModule } from '../core/module-registry.mjs';

const PISI_DOMAIN_CLIENT_VERSION = 1;

function getPisiDomainProjectApi() {
    const api = window.pisiProject;
    if (!api) throw new Error('Pisi project API hazır değil.');
    return api;
}

async function queryPisiDomain(name, payload = {}) {
    const api = getPisiDomainProjectApi();
    switch (String(name || '')) {
    case 'task.list.v1':
        return api.quickAddTask(payload.projectFolder, { op: 'list' });
    case 'document.read.v1':
        return api.getPisiDocument(payload.filePath);
    case 'map.projection.v1':
        return api.listMapNodes(payload.mapPath);
    case 'map.operational.v1': {
        const result = await api.listMapNodes(payload.mapPath);
        return result?.ok
            ? { ok: true, operational: result.operational || {} }
            : result;
    }
    default:
        return {
            ok: false,
            code: 'DOMAIN_QUERY_NOT_FOUND',
            error: `Bilinmeyen renderer domain query: ${String(name || '')}`
        };
    }
}

async function commandPisiDomain(name, payload = {}) {
    const api = getPisiDomainProjectApi();
    switch (String(name || '')) {
    case 'task.capture.v1':
        return api.quickAddTask(payload.projectFolder, payload.task || {});
    case 'task.upsert.v1':
        return api.quickAddTask(payload.projectFolder, {
            op: 'upsert',
            task: payload.task || {}
        });
    case 'task.update.v1':
        return api.quickAddTask(payload.projectFolder, {
            op: 'update',
            taskId: payload.taskId,
            patch: payload.patch || {}
        });
    case 'task.delete.v1':
        return api.quickAddTask(payload.projectFolder, {
            op: 'delete',
            taskId: payload.taskId
        });
    case 'task.sync-projection.v1':
        return api.quickAddTask(payload.projectFolder, {
            op: 'sync-index',
            complete: payload.complete === true,
            pruneMissing: payload.pruneMissing !== false,
            tasks: Array.isArray(payload.tasks) ? payload.tasks : []
        });
    case 'map.relationship.upsert.v1':
        return api.upsertMapConnection(
            payload.mapPath,
            payload.relationship || payload.edge || {}
        );
    case 'map.relationship.delete.v1':
        return api.deleteMapConnection(
            payload.mapPath,
            payload.relationshipId || payload.edgeId
        );
    case 'map.relationship.reparent.v1':
        return api.reparentMapNode(
            payload.mapPath,
            payload.childId,
            payload.parentId
        );
    case 'map.layout.save.v1':
        return api.saveMapLayout(
            payload.mapPath,
            Array.isArray(payload.nodes) ? payload.nodes : []
        );
    case 'map.camera.save.v1':
        return api.saveMapCamera(payload.mapPath, payload.camera || {});
    case 'map.operational.mutate.v1':
        return api.saveMapCamera(payload.mapPath, {
            ...(payload.camera || window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
            collapsedHubs: Array.from(
                payload.collapsedHubs || window.collapsedHubPorts || []
            ),
            operationalPayload: payload.operation || {}
        });
    case 'map.reference.detach.v1':
        return api.detachMapReference(payload.mapPath, payload.nodeId);
    case 'map.node.create.v1':
        return api.createNodeUnderMap(payload.mapPath);
    case 'map.node.create-linked.v1': {
        const created = await commandPisiDomain('map.node.create.v1', {
            mapPath: payload.mapPath
        });
        if (!created?.ok || !created.node?.id) return created;
        const layout = await commandPisiDomain('map.layout.save.v1', {
            mapPath: payload.mapPath,
            nodes: [{
                id: created.node.id,
                x: payload.x,
                y: payload.y,
                width: payload.width || created.node.layout?.width || 220,
                height: payload.height || created.node.layout?.height || 92
            }]
        });
        if (!layout?.ok) return layout;
        const linked = await commandPisiDomain('map.relationship.upsert.v1', {
            mapPath: payload.mapPath,
            relationship: {
                sourceId: payload.sourceId,
                targetId: created.node.id,
                sourcePort: payload.sourcePort || 'right',
                targetPort: payload.targetPort || 'left',
                type: payload.type || 'down-hub',
                sourceRole: payload.sourceRole || 'down-hub',
                targetRole: payload.targetRole || 'up-hub'
            }
        });
        return linked?.ok
            ? { ...linked, createdNode: created.node }
            : linked;
    }
    default:
        return {
            ok: false,
            code: 'DOMAIN_COMMAND_NOT_FOUND',
            error: `Bilinmeyen renderer domain command: ${String(name || '')}`
        };
    }
}

const moduleApi = {
    PISI_DOMAIN_CLIENT_VERSION,
    query: queryPisiDomain,
    command: commandPisiDomain
};

registerModule('domain.client', moduleApi);

export {
    PISI_DOMAIN_CLIENT_VERSION,
    commandPisiDomain,
    queryPisiDomain
};
