'use strict';

const { ipcMain } = require('electron');
const { modules, registerMainModule } = require('../module-registry');

const domain = modules['main.domainCommandQuery'];
const projectIntegrity = modules['main.projectIntegrity'];
const electronIpc = modules['main.electronIpc'];

function assertIntegrityProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, {
        type: 'directory'
    });
    if (
        electronIpc.normalizePathForCompare(safeProjectFolder) !==
        electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)
    ) {
        throw new Error('Project Integrity yalnız aktif proje kökünde çalışabilir.');
    }
    return safeProjectFolder;
}

function installPisiIntegrityDomainContracts() {
    domain.registerPisiDomainQuery('integrity.audit.v1', (payload) => {
        return projectIntegrity.auditPisiProjectIntegrity(
            assertIntegrityProjectRoot(payload.projectFolder)
        );
    });

    domain.registerPisiDomainCommand('integrity.repair.v1', (payload) => {
        return projectIntegrity.repairPisiProjectIntegrity(
            assertIntegrityProjectRoot(payload.projectFolder),
            Array.isArray(payload.repairIds) ? payload.repairIds : []
        );
    });

    domain.registerPisiDomainCommand('integrity.rebuild-derived.v1', (payload) => {
        return projectIntegrity.rebuildPisiDerivedIntegrityState(
            assertIntegrityProjectRoot(payload.projectFolder)
        );
    });

    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('integrity.repair.v1');
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('integrity.rebuild-derived.v1');
}

function bindPisiIntegrityCompatibilityIpc() {
    ipcMain.removeHandler('project:audit-integrity');
    ipcMain.handle('project:audit-integrity', (_event, projectFolder) => {
        return electronIpc.projectOperation(() => domain.executePisiDomainQuery(
            'integrity.audit.v1',
            { projectFolder }
        ));
    });

    ipcMain.removeHandler('project:repair-integrity');
    ipcMain.handle('project:repair-integrity', (_event, projectFolder, repairIds) => {
        return electronIpc.asyncProjectOperation(() => domain.executePisiDomainCommand(
            'integrity.repair.v1',
            { projectFolder, repairIds }
        ));
    });

    ipcMain.removeHandler('project:rebuild-integrity-derived');
    ipcMain.handle('project:rebuild-integrity-derived', (_event, projectFolder) => {
        return electronIpc.asyncProjectOperation(() => domain.executePisiDomainCommand(
            'integrity.rebuild-derived.v1',
            { projectFolder }
        ));
    });
}

installPisiIntegrityDomainContracts();
bindPisiIntegrityCompatibilityIpc();

const moduleApi = {
    assertIntegrityProjectRoot,
    installPisiIntegrityDomainContracts,
    bindPisiIntegrityCompatibilityIpc
};

registerMainModule('main.projectIntegrityDomain', moduleApi);