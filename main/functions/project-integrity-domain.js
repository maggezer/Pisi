import { ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';

const domain = modules['main.domainCommandQuery'];
const projectIntegrity = modules['main.projectIntegrity'];
const electronIpc = modules['main.electronIpc'];

function assertIntegrityProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, {
        type: 'directory'
    });
    if (electronIpc.normalizePathForCompare(safeProjectFolder) !== electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)) {
        throw new Error('Project Integrity yalnız aktif proje kökünde çalışabilir.');
    }
    return safeProjectFolder;
}

function installPisiIntegrityDomainContracts() {
    domain.registerPisiDomainQuery('integrity.audit.v1', (payload) => {
        return projectIntegrity.auditPisiProjectIntegrity(assertIntegrityProjectRoot(payload.projectFolder));
    });

    domain.registerPisiDomainCommand('integrity.repair.v1', (payload) => {
        return projectIntegrity.repairPisiProjectIntegrity(
            assertIntegrityProjectRoot(payload.projectFolder),
            Array.isArray(payload.repairIds) ? payload.repairIds : []
        );
    });

    domain.registerPisiDomainCommand('integrity.rebuild-derived.v1', (payload) => {
        return projectIntegrity.rebuildPisiDerivedIntegrityState(assertIntegrityProjectRoot(payload.projectFolder));
    });

    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('integrity.repair.v1');
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('integrity.rebuild-derived.v1');
}

function normalizeIntegrityTransportRequest(raw) {
    if (typeof raw === 'string') {
        return { action: 'audit', projectFolder: raw, repairIds: [] };
    }
    if (!raw || typeof raw !== 'object') {
        return { action: 'audit', projectFolder: raw, repairIds: [] };
    }
    const action = ['audit', 'repair', 'rebuild-derived'].includes(raw.action) ? raw.action : 'audit';
    return {
        action,
        projectFolder: raw.projectFolder,
        repairIds: Array.isArray(raw.repairIds) ? raw.repairIds : []
    };
}

function bindPisiIntegrityCompatibilityIpc() {
    ipcMain.removeHandler('project:audit-integrity');
    ipcMain.handle('project:audit-integrity', (_event, rawRequest) => {
        const request = normalizeIntegrityTransportRequest(rawRequest);
        if (request.action === 'repair') {
            return electronIpc.asyncProjectOperation(() =>
                domain.executePisiDomainCommand('integrity.repair.v1', {
                    projectFolder: request.projectFolder,
                    repairIds: request.repairIds
                })
            );
        }
        if (request.action === 'rebuild-derived') {
            return electronIpc.asyncProjectOperation(() =>
                domain.executePisiDomainCommand('integrity.rebuild-derived.v1', { projectFolder: request.projectFolder })
            );
        }
        return electronIpc.projectOperation(() => domain.executePisiDomainQuery('integrity.audit.v1', { projectFolder: request.projectFolder }));
    });
}

installPisiIntegrityDomainContracts();
bindPisiIntegrityCompatibilityIpc();

const moduleApi = {
    assertIntegrityProjectRoot,
    normalizeIntegrityTransportRequest,
    installPisiIntegrityDomainContracts,
    bindPisiIntegrityCompatibilityIpc
};

registerMainModule('main.projectIntegrityDomain', moduleApi);
