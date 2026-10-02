import { modules, registerMainModule } from '../module-registry.js';

const domain = modules['main.domainCommandQuery'];

const PISI_PERSISTENT_DOMAIN_MUTATIONS = [
    'task.capture.v1',
    'task.upsert.v1',
    'task.update.v1',
    'task.delete.v1',
    'task.sync-projection.v1',
    'map.relationship.upsert.v1',
    'map.relationship.delete.v1',
    'map.relationship.reparent.v1',
    'map.layout.save.v1',
    'map.operational.mutate.v1',
    'map.camera.save.v1',
    'map.reference.detach.v1',
    'map.node.create.v1',
    'project.item.rename.v1',
    'project.item.move.v1',
    'project.item.delete.v1',
    'project.path.delete.v1',
    'project.batch.v1'
];

if (!domain?.PISI_ATOMIC_DOMAIN_COMMANDS) {
    throw new Error('Domain command/query katmanı atomic hardening için hazır değil.');
}

for (const command of PISI_PERSISTENT_DOMAIN_MUTATIONS) {
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add(command);
}

const moduleApi = {
    PISI_PERSISTENT_DOMAIN_MUTATIONS
};

registerMainModule('main.atomicDomainHardening', moduleApi);
