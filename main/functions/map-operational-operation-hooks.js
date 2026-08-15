'use strict';

const { ipcMain } = require('electron');
const { modules, registerMainModule } = require('../module-registry');

const electronIpc = modules['main.electronIpc'];
const operationalStore = modules['main.mapOperationalStore'];

function bindPisiMapOperationalOperationHooks() {
    ipcMain.removeHandler('project:save-map-operational-state');
    ipcMain.handle(
        'project:save-map-operational-state',
        (_event, mapPath, payload = {}) => electronIpc.projectOperation(() => {
            const safeMapPath = electronIpc.assertProjectPath(mapPath, {
                type: 'file',
                extensions: ['.map']
            });
            return operationalStore.savePisiOperationalMapState(
                safeMapPath,
                payload || {}
            );
        })
    );
}

bindPisiMapOperationalOperationHooks();

registerMainModule('main.mapOperationalOperationHooks', {
    bindPisiMapOperationalOperationHooks
});
