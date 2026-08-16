'use strict';

const { ipcMain } = require('electron');
const { modules, registerMainModule } = require('../module-registry');

const domain = modules['main.domainCommandQuery'];
const trashStore = modules['main.trashStore'];
const electronIpc = modules['main.electronIpc'];

function assertTrashProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, {
        type: 'directory'
    });
    if (
        electronIpc.normalizePathForCompare(safeProjectFolder) !==
        electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)
    ) {
        throw new Error('Trash işlemi yalnız aktif projede çalışabilir.');
    }
    return safeProjectFolder;
}

function installPisiTrashDomainContracts() {
    domain.pisiDomainQueries.set('trash.list.v1', (payload) => {
        return trashStore.listPisiTrashItems(
            assertTrashProjectRoot(payload.projectFolder)
        );
    });

    domain.pisiDomainCommands.set('project.item.delete.v1', (payload) => {
        const safeTargetPath = electronIpc.assertProjectPath(payload.targetPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return trashStore.movePisiPathToTrash(
            globalThis.activeProjectFolder,
            safeTargetPath
        );
    });

    domain.pisiDomainCommands.set('project.path.delete.v1', (payload) => {
        const safeTargetPath = electronIpc.assertProjectPath(payload.targetPath);
        if (
            electronIpc.normalizePathForCompare(safeTargetPath) ===
            electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)
        ) {
            throw new Error('Aktif proje kökü Trash’e taşınamaz.');
        }
        return trashStore.movePisiPathToTrash(
            globalThis.activeProjectFolder,
            safeTargetPath
        );
    });

    domain.registerPisiDomainCommand('trash.restore.v1', (payload) => {
        return trashStore.restorePisiTrashItem(
            assertTrashProjectRoot(payload.projectFolder),
            String(payload.trashId || '')
        );
    });

    domain.registerPisiDomainCommand('trash.delete-permanently.v1', (payload) => {
        return trashStore.permanentlyDeletePisiTrashItem(
            assertTrashProjectRoot(payload.projectFolder),
            String(payload.trashId || '')
        );
    });

    domain.registerPisiDomainCommand('trash.empty.v1', (payload) => {
        return trashStore.emptyPisiTrash(
            assertTrashProjectRoot(payload.projectFolder)
        );
    });

    for (const command of [
        'trash.restore.v1',
        'trash.delete-permanently.v1',
        'trash.empty.v1'
    ]) {
        domain.PISI_ATOMIC_DOMAIN_COMMANDS.add(command);
    }
}

function bindPisiTrashIpc() {
    ipcMain.removeHandler('project:list-trash');
    ipcMain.handle('project:list-trash', (_event, projectFolder) => {
        return electronIpc.projectOperation(() => domain.executePisiDomainQuery(
            'trash.list.v1',
            { projectFolder }
        ));
    });

    ipcMain.removeHandler('project:restore-trash-item');
    ipcMain.handle('project:restore-trash-item', (_event, projectFolder, trashId) => {
        return electronIpc.asyncProjectOperation(() => domain.executePisiDomainCommand(
            'trash.restore.v1',
            { projectFolder, trashId }
        ));
    });

    ipcMain.removeHandler('project:delete-trash-item');
    ipcMain.handle('project:delete-trash-item', (_event, projectFolder, trashId) => {
        return electronIpc.asyncProjectOperation(() => domain.executePisiDomainCommand(
            'trash.delete-permanently.v1',
            { projectFolder, trashId }
        ));
    });

    ipcMain.removeHandler('project:empty-trash');
    ipcMain.handle('project:empty-trash', (_event, projectFolder) => {
        return electronIpc.asyncProjectOperation(() => domain.executePisiDomainCommand(
            'trash.empty.v1',
            { projectFolder }
        ));
    });
}

installPisiTrashDomainContracts();
bindPisiTrashIpc();

const moduleApi = {
    assertTrashProjectRoot,
    installPisiTrashDomainContracts,
    bindPisiTrashIpc
};

registerMainModule('main.trashDomain', moduleApi);