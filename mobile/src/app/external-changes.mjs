// Changes that came from outside the app (sync; docs/sync-plan.md S4) are
// handed to the screens that show them. Only events with `source: 'sync'`
// count: what the app wrote itself is already on screen. The project index is
// brought up to date first, so the lists a screen reads include the change.
// A screen updates in place (its `handleExternal`); nothing here writes, so a
// change from outside is written exactly once (V4).

import { PISI_TASK_STORE_KEY } from '../data/task-repo.mjs';

/**
 * `handlers` run with `(key, info)` for every change from outside, one change
 * at a time, in the order they were written; `tasks` is the task controller,
 * read again when `.pisi/tasks.json` changed. Returns the function that stops
 * it, with `settled()` to wait for the changes seen so far.
 */
export function watchExternalChanges({ project, tasks, handlers = [], onError = () => {} }) {
    let chain = Promise.resolve();

    async function deliver(key, info) {
        await project.index.settled();
        if (key === PISI_TASK_STORE_KEY) await tasks.reload();
        for (const handler of handlers) {
            try {
                await handler(key, info);
            } catch (error) {
                onError(error);
            }
        }
    }

    const stop = project.writer.onFileChanged((key, info) => {
        if (info?.source !== 'sync') return;
        chain = chain.then(() => deliver(key, info)).catch(onError);
    });

    return Object.assign(() => stop(), { settled: () => chain });
}
