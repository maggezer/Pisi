// The tasks the app shows, read from `.pisi/tasks.json`, and the things the
// user does to them. The Pisi tab and the Tasks tab share one controller, so
// a task changed on one is already changed on the other. The list in memory
// is a copy for drawing (rule V1): every change goes to the task repo, which
// re-reads the file, and the list is read again afterwards.

import { limitTaskPatch } from './task-edit.mjs';

/**
 * `project` is the data layer (null in a bare shell); `snackbar` the app's
 * snackbar controller; `getT` returns the current translator.
 */
export function createTaskController({ project = null, platform, snackbar, now, getT, onError = () => {} }) {
    const state = { tasks: [], loaded: !project, readOnly: false };
    const listeners = new Set();
    let destroyed = false;

    const find = (id) => state.tasks.find((task) => task.id === id) ?? null;
    const canWrite = () => Boolean(project) && !state.readOnly;

    function emit() {
        if (destroyed) return;
        for (const listener of listeners) listener();
    }

    async function reload() {
        if (!project) return;
        try {
            const listed = await project.tasks.list();
            state.tasks = listed.tasks;
            state.readOnly = Boolean(listed.readOnly);
        } catch (error) {
            onError(error);
        }
        state.loaded = true;
        emit();
    }

    function failed(error) {
        onError(error);
        const t = getT();
        if (!destroyed) snackbar.show({ message: t('pisi.taskSaveFailed') });
        return reload();
    }

    async function complete(task) {
        const previous = task.status;
        // The row moves at once; the file follows.
        state.tasks = state.tasks.map((item) => (item.id === task.id ? { ...item, status: 'done', completedAt: now().toISOString() } : item));
        emit();
        platform.haptic();
        const result = await project.tasks.complete(task.id);
        if (destroyed || !result.ok) return result;
        const t = getT();
        snackbar.show({
            message: t('pisi.taskCompleted'),
            actionLabel: t('action.undo'),
            onUndo: () => void project.tasks.undoComplete(task.id, { status: previous, next: result.next }).then(reload, failed)
        });
        return result;
    }

    /** Runs one change and reads the tasks again; a failure is reported and never thrown. */
    async function run(change) {
        try {
            const result = await change();
            await reload();
            return result;
        } catch (error) {
            await failed(error);
            return null;
        }
    }

    return {
        getTasks: () => state.tasks,
        isLoaded: () => state.loaded,
        isReadOnly: () => state.readOnly,
        find,

        /** `listener()` runs after the task list changed. Returns the function that stops it. */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        reload,

        /** The checkbox: an open task is completed (with a five second undo), a finished one is opened again. */
        toggle(id) {
            const task = find(id);
            if (!task || !canWrite()) return Promise.resolve(null);
            return run(() => (task.status === 'done' ? project.tasks.setStatus(id, 'todo') : complete(task)));
        },

        /** Sets the status. "done" completes the task, so a repeating task gets its next occurrence. */
        setStatus(id, status) {
            const task = find(id);
            if (!task || !canWrite() || task.status === status) return Promise.resolve(null);
            return run(() => (status === 'done' ? complete(task) : project.tasks.setStatus(id, status)));
        },

        /** Adds a task from a repo payload. Resolves with the repo's result, or null when nothing was saved. */
        add(payload) {
            if (!canWrite()) return Promise.resolve(null);
            return run(() => project.tasks.upsert(payload));
        },

        /** Changes fields of a task. Fields this task may not change on mobile are left out (task-edit.mjs). */
        update(id, patch) {
            const task = find(id);
            const allowed = task ? limitTaskPatch(task, patch) : null;
            if (!allowed || !canWrite()) return Promise.resolve(null);
            return run(() => project.tasks.update(id, allowed));
        },

        destroy() {
            destroyed = true;
            listeners.clear();
        }
    };
}
