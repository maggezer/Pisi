import * as fs from 'node:fs';
import { ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import { normalizePisiTask, readPisiTask } from '../../shared/task-model.mjs';
import { diffPisiTaskMembership, listPisiTaskBlocks } from '../../shared/task-blocks.mjs';
import { listPisiDiaryTaskIds, replacePisiDiaryTaskSection } from '../../shared/task-diary.mjs';

// The task contracts (docs/task-plan.md §3.4) and the note save that keeps
// tasks and their blocks together (§3.3). Each command is one atomic mutation
// (GV8): the dispatcher runs it in the project's atomic queue.

const domain = modules['main.domainCommandQuery'];
const electronIpc = modules['main.electronIpc'];
const taskService = modules['main.taskService'];
const taskStore = modules['main.taskStore'];
const trashStore = modules['main.trashStore'];
const atomicMutation = modules['main.atomicMutation'];

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

// ---- Note save (§3.3) ------------------------------------------------------------

function saveNoteContent(nodePath, content) {
    return globalThis.saveNodeContentWithHistory(nodePath, content, { reason: 'editor-save' });
}

/**
 * The editor's save of a note. Task blocks are stored in their bare form
 * (GV2) and a diary's task section is the one the rule gives (GV15). When the
 * save takes task blocks out of the note or brings ids back, the tasks follow
 * in the same atomic mutation: a task whose place is this note and whose block
 * is gone goes to the Trash (one item for the save); an id that is in the
 * Trash comes back and lives in this note. A live task of another note is left
 * alone (Integrity reports it). Sync never runs this (it writes notes itself).
 */
function savePisiNoteWithTasks(projectFolder, nodePath, content, options = {}) {
    const documentStore = modules['main.documentStore'];
    const current = documentStore.ensurePisiFileMetadata(nodePath);
    if (!current.ok) return current;
    const before = String(current.data?.content || '');
    const next = taskService.canonicalizePisiTaskBlocks(String(content ?? ''));
    const diaryDate = taskService.getPisiNoteDiaryDate(projectFolder, nodePath, current.data);
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    const diff = state.readOnly ? null : diffPisiTaskMembership(before, next);
    const changesTasks = Boolean(diff && (diff.added.length || diff.removed.length));

    const normalizeSection = (html, tasks) => {
        if (!diaryDate || state.readOnly) return html;
        const ids = listPisiDiaryTaskIds(diaryDate, tasks.map(readPisiTask).filter(Boolean));
        return replacePisiDiaryTaskSection(html, diaryDate, ids) ?? html;
    };
    if (!changesTasks) return saveNoteContent(nodePath, normalizeSection(next, state.tasks));

    return atomicMutation.runPisiAtomicMutation(projectFolder, 'note.save-tasks', () => {
        const fresh = taskStore.readPisiTaskStore(projectFolder);
        const tasks = fresh.tasks.slice();
        const noteId = current.metadata?.id;
        const byId = new Map(tasks.map((task) => [task?.id, task]));
        const removedIds = diff.removed.filter((id) => byId.get(id)?.noteId === noteId);
        const comingBack = diff.added.filter((id) => !byId.has(id));

        const fromTrash = trashStore.takePisiTasksFromTrash(projectFolder, comingBack);
        const now = new Date();
        const restored = fromTrash.tasks.map((task) => {
            const placed = normalizePisiTask({ noteId }, task, { now, makeUuid: () => '' });
            return placed.ok ? placed.task : { ...task, noteId, diaryDate: null };
        });
        const out = taskService.takePisiTasksOut(tasks, removedIds);
        let nextTasks = [...out.remaining, ...restored];
        if (fromTrash.dependencyRefs.length) {
            const refs = new Map(fromTrash.dependencyRefs.map((ref) => [ref.taskId, ref.dependencies]));
            nextTasks = nextTasks.map((task) =>
                refs.has(task.id) ? { ...task, dependencies: Array.from(new Set([...(task.dependencies || []), ...refs.get(task.id)])) } : task
            );
        }

        let trashId = null;
        if (out.removed.length) {
            const oldBlocks = listPisiTaskBlocks(before) || [];
            const relative = nodePath.slice(projectFolder.length).replace(/^[\\/]+/, '').split(/[\\/]+/).join('/');
            const taskBlocks = out.removed.map((task) => {
                const block = oldBlocks.find((item) => item.taskId === task.id);
                const previous = block ? [...before.slice(0, block.start).matchAll(/data-pisi-block-id="([^"]+)"/g)].at(-1) : null;
                return { taskId: task.id, noteId, notePath: relative, blockId: block?.blockId || null, afterBlockId: previous ? previous[1] : null };
            });
            const label = out.removed.length === 1 ? readPisiTask(out.removed[0])?.title || out.removed[0].id : `${out.removed.length}`;
            const trash = trashStore.createPisiTaskTrashItem(projectFolder, {
                tasks: out.removed,
                taskDependencyRefs: out.dependencyRefs,
                taskBlocks,
                label
            });
            if (!trash.ok) return trash;
            trashId = trash.trashId;
        }
        if (out.removed.length || restored.length || fromTrash.dependencyRefs.length) taskStore.writePisiTaskStore(projectFolder, fresh, nextTasks, { now });

        const saved = saveNoteContent(nodePath, normalizeSection(next, nextTasks));
        if (!saved?.ok) return saved;
        const openPaths = [nodePath, ...normalizePisiTaskOpenPaths(options.openPaths)];
        const rewritten = taskService.rewritePisiDiarySectionsForTaskChange(projectFolder, tasks, nextTasks, { openPaths });
        const touched = new Set([...restored.map((task) => task.id), ...out.dependencyRefs.map((ref) => ref.taskId), ...fromTrash.dependencyRefs.map((ref) => ref.taskId)]);
        taskService.emitPisiTasksChanged(projectFolder, {
            changed: nextTasks.filter((task) => touched.has(task.id)),
            removedIds: out.removed.map((task) => task.id)
        });
        return {
            ...saved,
            tasks: { removed: out.removed.map((task) => task.id), restored: restored.map((task) => task.id), trashId },
            deferred: rewritten.context.deferred
        };
    });
}

/**
 * A diary opened (and so created) from the calendar gets the task section of
 * its day at once: the section belongs to the diary from its first byte (GV15).
 */
function getOrCreatePisiDiaryWithTasks(projectFolder, isoDate) {
    const documentStore = modules['main.documentStore'];
    const day = String(isoDate || '');
    const diaryPath = /^\d{4}-\d{2}-\d{2}$/.test(day) ? documentStore.getPisiDiaryNodePath(projectFolder, day) : null;
    const existed = diaryPath ? fs.existsSync(diaryPath) : true;
    const created = documentStore.getOrCreateDiaryNode(projectFolder, isoDate);
    if (!created.ok || existed) return created;
    const state = taskStore.readPisiTaskStoreState(projectFolder);
    if (state.readOnly) return created;
    const context = taskService.makePisiTaskCommandContext({});
    taskService.writePisiDiarySections(projectFolder, state.tasks.map(readPisiTask).filter(Boolean), [day], context, { create: [day] });
    return context.writtenDiaries.length ? documentStore.getOrCreateDiaryNode(projectFolder, isoDate) : created;
}

function bindPisiTaskIpc() {
    ipcMain.removeHandler('project:get-or-create-diary-node');
    ipcMain.handle('project:get-or-create-diary-node', (_event, projectFolder, isoDate) => {
        return electronIpc.projectOperation(() => getOrCreatePisiDiaryWithTasks(assertPisiTaskProjectRoot(projectFolder), isoDate));
    });

    ipcMain.removeHandler('project:save-node-content');
    ipcMain.handle('project:save-node-content', (_event, nodePath, content, options) => {
        return electronIpc.asyncProjectOperation(() => {
            const safeNodePath = electronIpc.assertProjectPath(nodePath, { type: 'file', extensions: ['.node'] });
            const projectFolder = globalThis.activeProjectFolder;
            if (!projectFolder) return saveNoteContent(safeNodePath, content);
            return savePisiNoteWithTasks(projectFolder, safeNodePath, content, { openPaths: options?.openPaths });
        });
    });
}

installPisiTaskDomainContracts();
bindPisiTaskIpc();

const moduleApi = {
    PISI_TASK_COMMANDS,
    installPisiTaskDomainContracts,
    savePisiNoteWithTasks,
    getOrCreatePisiDiaryWithTasks,
    bindPisiTaskIpc
};

registerMainModule('main.taskDomain', moduleApi);
