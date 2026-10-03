import { registerModule } from '../core/module-registry.mjs';

const PISI_DOMAIN_CLIENT_VERSION = 1;

const PISI_MAIN_DOMAIN_QUERIES = new Set(['task.list.v1', 'document.read.v1', 'map.projection.v1', 'map.operational.v1']);
const PISI_MAIN_DOMAIN_COMMANDS = new Set([
    'task.capture.v1',
    'task.upsert.v1',
    'task.update.v1',
    'task.delete.v1',
    'task.sync-projection.v1',
    'map.relationship.upsert.v1',
    'map.relationship.delete.v1',
    'map.relationship.reparent.v1',
    'map.layout.save.v1',
    'map.camera.save.v1',
    'map.reference.detach.v1',
    'map.node.create.v1'
]);

function getPisiDomainApi() {
    const api = window.pisiDomain;
    if (!api?.query || !api?.command) {
        throw new Error('Pisi domain API hazır değil.');
    }
    return api;
}

function getPisiTrashApi() {
    const api = window.pisiTrash;
    if (!api) throw new Error('Pisi Trash API hazır değil.');
    return api;
}

async function queryPisiDomain(name, payload = {}) {
    const key = String(name || '');
    if (key === 'trash.list.v1') {
        return getPisiTrashApi().list(payload.projectFolder);
    }
    if (!PISI_MAIN_DOMAIN_QUERIES.has(key)) {
        return {
            ok: false,
            code: 'DOMAIN_QUERY_NOT_FOUND',
            error: `Bilinmeyen renderer domain query: ${key}`
        };
    }
    return getPisiDomainApi().query(key, payload);
}

async function commandPisiDomain(name, payload = {}) {
    const key = String(name || '');

    if (key === 'map.operational.mutate.v1') {
        return getPisiDomainApi().command('map.camera.save.v1', {
            mapPath: payload.mapPath,
            camera: {
                ...(payload.camera || window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
                collapsedHubs: Array.from(payload.collapsedHubs || window.collapsedHubPorts || []),
                operationalPayload: payload.operation || {}
            }
        });
    }

    if (key === 'map.node.create-linked.v1') {
        const created = await commandPisiDomain('map.node.create.v1', {
            mapPath: payload.mapPath
        });
        if (!created?.ok || !created.node?.id) return created;

        const layout = await commandPisiDomain('map.layout.save.v1', {
            mapPath: payload.mapPath,
            nodes: [
                {
                    id: created.node.id,
                    x: payload.x,
                    y: payload.y,
                    width: payload.width || created.node.layout?.width || 220,
                    height: payload.height || created.node.layout?.height || 92
                }
            ]
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
        return linked?.ok ? { ...linked, createdNode: created.node } : linked;
    }

    if (key === 'trash.restore.v1') {
        return getPisiTrashApi().restore(payload.projectFolder, payload.trashId);
    }
    if (key === 'trash.delete-permanently.v1') {
        return getPisiTrashApi().deletePermanently(payload.projectFolder, payload.trashId);
    }
    if (key === 'trash.empty.v1') {
        return getPisiTrashApi().empty(payload.projectFolder);
    }

    if (!PISI_MAIN_DOMAIN_COMMANDS.has(key)) {
        return {
            ok: false,
            code: 'DOMAIN_COMMAND_NOT_FOUND',
            error: `Bilinmeyen renderer domain command: ${key}`
        };
    }

    return getPisiDomainApi().command(key, payload);
}

const moduleApi = {
    PISI_DOMAIN_CLIENT_VERSION,
    query: queryPisiDomain,
    command: commandPisiDomain
};

registerModule('domain.client', moduleApi);

export { PISI_DOMAIN_CLIENT_VERSION, commandPisiDomain, queryPisiDomain };
