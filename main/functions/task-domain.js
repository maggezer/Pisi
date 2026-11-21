import { ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';

// The task contracts (docs/task-plan.md §3.4) and the IPC of the note save and
// of diary creation, which keep tasks, blocks and diary sections together
// (§3.3, task-service.js). Each command is one atomic mutation (GV8): the
// dispatcher runs it in the project's atomic queue.

const domain = modules['main.domainCommandQuery'];
const electronIpc = modules['main.electronIpc'];
const taskService = modules['main.taskService'];

const PISI_TASK_COMMANDS = Object.freeze([
    'task.create.v1',
    'task.update.v1',
    'task.complete.v1',
    'task.reopen.v1',
    'task.move.v1',
    'task.delete.v1',
    'task.batch.v1'
]);

function assertPisiTaskProjectRoot(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder, { type: 'directory' });
    if (electronIpc.normalizePathForCompare(safeProjectFolder) !== electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)) {
        throw new Error('Görev işlemi yalnız aktif proje kökünde çalışabilir.');
    }
    return safeProjectFolder;
}

function assertPisiTaskNotePath(notePath) {
    if (notePath === undefined || notePath === null || notePath === '') return null;
    return electronIpc.assertProjectPath(notePath, { type: 'file', extensions: ['.node'] });
}

/** Open documents are named by the renderer; only paths inside the project are kept. */
function normalizePisiTaskOpenPaths(openPaths) {
    const paths = [];
    for (const item of Array.isArray(openPaths) ? openPaths.slice(0, 64) : []) {
        try {
            paths.push(electronIpc.assertProjectPath(item));
        } catch {
            // A path that is not in the project (or no longer exists) is not open here.
        }
    }
    return paths;
}

function normalizePisiTaskTarget(target) {
    if (!target || typeof target !== 'object') return target;
    return { ...target, notePath: assertPisiTaskNotePath(target.notePath) };
}

function installPisiTaskDomainContracts() {
    domain.registerPisiDomainQuery('task.list.v1', (payload) => taskService.listPisiTasks(assertPisiTaskProjectRoot(payload.projectFolder)));

    domain.registerPisiDomainCommand('task.create.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.createPisiTask(projectFolder, {
            task: payload.task,
            target: normalizePisiTaskTarget(payload.target),
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.update.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.updatePisiTask(projectFolder, {
            taskId: String(payload.taskId || ''),
            patch: payload.patch || {},
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.complete.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.completePisiTaskCommand(projectFolder, {
            taskId: String(payload.taskId || ''),
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.reopen.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.reopenPisiTaskCommand(projectFolder, {
            taskId: String(payload.taskId || ''),
            completion: payload.completion || null,
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.move.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.movePisiTask(projectFolder, {
            taskId: String(payload.taskId || ''),
            target: normalizePisiTaskTarget(payload.target),
            fromNotePath: assertPisiTaskNotePath(payload.fromNotePath),
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.delete.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.deletePisiTask(projectFolder, {
            taskId: String(payload.taskId || ''),
            notePath: assertPisiTaskNotePath(payload.notePath),
            blockId: typeof payload.blockId === 'string' ? payload.blockId : null,
            afterBlockId: typeof payload.afterBlockId === 'string' ? payload.afterBlockId : null,
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    domain.registerPisiDomainCommand('task.batch.v1', (payload) => {
        const projectFolder = assertPisiTaskProjectRoot(payload.projectFolder);
        return taskService.batchUpdatePisiTasks(projectFolder, {
            updates: Array.isArray(payload.updates) ? payload.updates : [],
            openPaths: normalizePisiTaskOpenPaths(payload.openPaths)
        });
    });

    for (const command of PISI_TASK_COMMANDS) domain.PISI_ATOMIC_DOMAIN_COMMANDS.add(command);
}

function bindPisiTaskIpc() {
    ipcMain.removeHandler('project:get-or-create-diary-node');
    ipcMain.handle('project:get-or-create-diary-node', (_event, projectFolder, isoDate) => {
        return electronIpc.projectOperation(() => taskService.getOrCreatePisiDiaryWithTasks(assertPisiTaskProjectRoot(projectFolder), isoDate));
    });

    ipcMain.removeHandler('project:save-node-content');
    ipcMain.handle('project:save-node-content', (_event, nodePath, content, options) => {
        return electronIpc.asyncProjectOperation(() => {
            const safeNodePath = electronIpc.assertProjectPath(nodePath, { type: 'file', extensions: ['.node'] });
            const projectFolder = globalThis.activeProjectFolder;
            if (!projectFolder) return globalThis.saveNodeContentWithHistory(safeNodePath, content, { reason: 'editor-save' });
            return taskService.savePisiNoteWithTasks(projectFolder, safeNodePath, content, { openPaths: normalizePisiTaskOpenPaths(options?.openPaths) });
        });
    });
}

installPisiTaskDomainContracts();
bindPisiTaskIpc();

const moduleApi = {
    PISI_TASK_COMMANDS,
    installPisiTaskDomainContracts,
    bindPisiTaskIpc
};

registerMainModule('main.taskDomain', moduleApi);
