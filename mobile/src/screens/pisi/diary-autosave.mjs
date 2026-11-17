// Saves the diary text shortly after the user stops typing, and at once when
// the app asks for it (pause, day change, leaving the screen). Saves run one
// after another, so an older text never lands on top of a newer one. The
// timers come from outside so that tests control the clock.

export const PISI_DIARY_SAVE_DELAY_MS = 600;

/**
 * `save(isoDate, text)` writes one day; `onSaved(job, result)` and
 * `onError(error, job)` report how it went, `job` being `{ date, text }`.
 * `onBusy(busy)` says when text starts waiting and when everything is written.
 */
export function createDiaryAutosave({
    save,
    setTimer,
    clearTimer,
    delay = PISI_DIARY_SAVE_DELAY_MS,
    onSaved = () => {},
    onError = () => {},
    onBusy = () => {}
}) {
    let pending = null;
    let timer = null;
    let chain = Promise.resolve();
    let running = 0;

    function write() {
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (!pending) return chain;
        const job = pending;
        pending = null;
        running += 1;
        chain = chain
            .then(() => save(job.date, job.text))
            .then(
                (result) => onSaved(job, result),
                (error) => onError(error, job)
            )
            .finally(() => {
                running -= 1;
                if (!running && !pending) onBusy(false);
            });
        return chain;
    }

    return {
        /** The text of `date` changed. Text waiting for another day is written first. */
        edit(date, text) {
            if (pending && pending.date !== date) write();
            pending = { date, text };
            if (timer !== null) clearTimer(timer);
            timer = setTimer(write, delay);
            onBusy(true);
        },

        /** Writes what is waiting now. Resolves when every save so far has finished. */
        flush: () => write(),

        /** Text typed for `date` that is not on disk yet, or null. */
        getPending: (date) => (pending?.date === date ? pending.text : null),

        /** True while text waits or is being written. */
        isBusy: () => Boolean(pending) || running > 0,

        cancel() {
            if (timer !== null) clearTimer(timer);
            timer = null;
            pending = null;
            if (!running) onBusy(false);
        }
    };
}
