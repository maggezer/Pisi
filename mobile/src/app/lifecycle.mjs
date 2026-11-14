// Pending saves are written before the app can lose them: when Android pauses
// the app, when the screen changes and on the back button (docs/mobile-plan.md
// §3.3). Screens register a flush function; M4 connects the ProjectWriter.

export function createLifecycle({ onError = () => {} } = {}) {
    const flushers = new Set();

    return {
        registerFlush(flush) {
            flushers.add(flush);
            return () => flushers.delete(flush);
        },

        /** Runs every registered flush. One failing flush does not stop the others. */
        async flush() {
            const results = await Promise.allSettled([...flushers].map(async (flush) => flush()));
            for (const result of results) {
                if (result.status === 'rejected') onError(result.reason);
            }
        }
    };
}
