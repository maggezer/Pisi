// The tasks the app shows, read from `.pisi/tasks.json`, and the things the
// user does to them. The Pisi tab, the Tasks tab and the note screen share one
// controller, so a task changed on one is already changed on the others. The
// list in memory is a copy for drawing (rules V1, GV1): every change goes to
// the task repo, which re-reads the file, and the list is read again
// afterwards. Completing and reopening follow docs/task-plan.md §3.2.3.

import { getPisiTaskLocation } from '../../../../shared/task-model.mjs';
import { getPisiTaskStateOnDay } from '../../../../shared/task-diary.mjs';

/**
 * `project` is the data layer (null in a bare shell); `snackbar` the app's
 * snackbar controller; `getT` returns the current translator.
 */
export function createTaskController({ project = null, platform, snackbar, getT, onError = () => {} }) {
    const state = { tasks: [], loaded: !project, readOnly: false };
    const listeners = new Set();
    let destroyed = false;

    const find = (id) => state.tasks.find((task) => task.id === id) ?? null;
    const canWrite = () => Boolean(project) && !state.readOnly;

    function emit() {
        if (destroyed) return;
        for (const listener of listeners) listener();
    }

    // The note titles rows show come from the project index; when one of them changes (the index was built, a note renamed) rows are drawn again.
    const placeSignature = () =>
        state.tasks
            .filter((task) => task.noteId)
            .map((task) => `${task.noteId}:${project.index.findNoteById(task.noteId)?.title ?? ''}`)
            .join('|');
    let places = '';
    const stopIndex = project?.index?.subscribe?.(() => {
        const next = placeSignature();
        if (next === places) return;
        places = next;
        emit();
    });

    async function reload() {
        if (!project) return;
        try {
            const listed = await project.tasks.list();
            state.tasks = listed.tasks;
            state.readOnly = Boolean(listed.readOnly);
            places = placeSignature();
        } catch (error) {
            onError(error);
        }
        state.loaded = true;
        emit();
    }

    /** Shows the message `pick(t)` gives with the current translator. */
    function say(pick) {
        if (!destroyed) snackbar.show({ message: pick(getT()) });
    }

    function failed(error) {
        onError(error);
        say((t) => t('pisi.taskSaveFailed'));
        return reload();
    }

    /** Runs one repo command and reads the tasks again. A refused command is reported; nothing is thrown. */
    async function run(change, { refusal = (t) => t('pisi.taskSaveFailed') } = {}) {
        try {
            const result = await change();
            if (result && !result.ok) say(result.error === 'locked' ? (t) => t('pisi.completionLocked') : refusal);
            await reload();
            return result;
        } catch (error) {
            await failed(error);
            return null;
        }
    }

    async function complete(task) {
        // The row moves at once; the file follows.
        state.tasks = state.tasks.map((item) => (item.id === task.id && item.repeat === 'none' ? { ...item, status: 'done' } : item));
        emit();
        platform.haptic();
        const result = await project.tasks.complete(task.id);
        if (destroyed || !result?.ok || !result.changed) return result;
        const t = getT();
        snackbar.show({
            message: t('pisi.taskCompleted'),
            actionLabel: t('action.undo'),
            onUndo: () => void run(() => project.tasks.reopen(task.id, result.completion))
        });
        return result;
    }

    /** The completion a done row of `day` takes back: the one made on that day, or (no day) the latest. */
    function completionOn(task, day) {
        const onDay = day ? getPisiTaskStateOnDay(task, day) : null;
        if (task.repeat === 'none' || !onDay || onDay.state !== 'done') return null;
        const entry = task.completions.find((item) => item.date === day && item.at === onDay.at);
        return entry ? { ...entry } : null;
    }

    return {
        getTasks: () => state.tasks,
        isLoaded: () => state.loaded,
        isReadOnly: () => state.readOnly,
        find,

        /**
         * Where a task lives: `{ kind: 'note', noteId, key, title }` (key and
         * title once the project index knows the note) or `{ kind: 'diary', date }`;
         * null for a record without a place (an old one).
         */
        getPlace(task) {
            const place = getPisiTaskLocation(task);
            if (place?.kind !== 'note') return place;
            const note = project?.index.findNoteById(place.noteId) ?? null;
            return { ...place, key: note?.key ?? null, title: note?.title ?? null };
        },

        /** `listener()` runs after the task list changed. Returns the function that stops it. */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        reload,

        /**
         * The checkbox of a task, on the row of `day` when the row belongs to a
         * day (the Pisi tab, a diary). Open: the task is completed today, with
         * a five second undo. Done on that day: that completion is taken back,
         * which only works for the latest one (§3.2.3). Without a day a done
         * task opens again.
         */
        toggle(id, { day = null } = {}) {
            const task = find(id);
            if (!task || !canWrite()) return Promise.resolve(null);
            const onDay = day ? getPisiTaskStateOnDay(task, day) : null;
            const done = onDay ? onDay.state === 'done' || (onDay.state === 'dated' && onDay.status === 'done') : task.status === 'done';
            if (!done) return run(() => complete(task));
            if (onDay?.locked) {
                say((t) => t('pisi.completionLocked'));
                return Promise.resolve(null);
            }
            return run(() => project.tasks.reopen(id, completionOn(task, day)));
        },

        /** Sets the status. "done" completes the task, so a repeating task moves on to its next day. */
        setStatus(id, status) {
            const task = find(id);
            if (!task || !canWrite() || task.status === status) return Promise.resolve(null);
            if (status === 'done') return run(() => complete(task));
            // Leaving "done" clears the completion fields and its day's row: the record rule does it (shared/task-model.mjs).
            return run(() => project.tasks.update(id, { status }));
        },

        /**
         * Adds a task: `fields` are version 2 fields, `target` its place,
         * `{ diaryDate }` or `{ noteId }`. Resolves with the repo's result, or
         * null when nothing was saved.
         */
        add(fields, target) {
            if (!canWrite()) return Promise.resolve(null);
            return run(() => project.tasks.create(fields, target));
        },

        /** Changes fields of a task (every field but its place; docs/task-plan.md G8). */
        update(id, patch) {
            if (!find(id) || !patch || !canWrite()) return Promise.resolve(null);
            return run(() => project.tasks.update(id, patch), { refusal: (t) => t('task.invalid') });
        },

        destroy() {
            destroyed = true;
            stopIndex?.();
            listeners.clear();
        }
    };
}
