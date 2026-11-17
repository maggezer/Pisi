// The files a screen has open for editing (docs/sync-plan.md S4 step 4). The
// note editor and the diary field hold a lease on the file they show and say
// whether it holds edits that are not on disk yet ("dirty"). A change coming
// from outside (sync) is never applied to a dirty file (SV4): the writer
// refuses it and the file is listed as deferred. The sync engine (S5) first
// asks the holder to write what is waiting (`flush`), merges with what is on
// disk then, and tries again once the file is clean (`onClean`).
// Nothing here is stored; it lives as long as the screens do.

import { normalizeKey } from './drivers/keys.mjs';

export function createOpenDocuments({ onError = () => {} } = {}) {
    // key → the leases on it (two screens can show the same file: a diary day on the Pisi tab and as a note).
    const leases = new Map();
    // key → why an outside change was not applied ('dirty', 'changed').
    const deferred = new Map();
    const cleanListeners = new Set();
    const deferredListeners = new Set();

    const call = (listeners, ...args) => {
        for (const listener of listeners) {
            try {
                listener(...args);
            } catch (error) {
                onError(error);
            }
        }
    };
    const isDirty = (key) => [...(leases.get(key) ?? [])].some((lease) => lease.dirty);

    function setDirty(lease, dirty) {
        const before = isDirty(lease.key);
        lease.dirty = Boolean(dirty);
        if (before && !isDirty(lease.key)) call(cleanListeners, lease.key);
    }

    return {
        /**
         * Takes a lease on `key`. `flush()` writes what the holder has waiting
         * for that file. The lease starts clean; `release()` gives it back.
         */
        hold(key, { flush = () => {} } = {}) {
            const clean = normalizeKey(key);
            const lease = { key: clean, dirty: false, flush };
            if (!leases.has(clean)) leases.set(clean, new Set());
            leases.get(clean).add(lease);
            return {
                key: clean,
                setDirty: (dirty) => leases.get(clean)?.has(lease) && setDirty(lease, dirty),
                isDirty: () => lease.dirty,
                release() {
                    const set = leases.get(clean);
                    if (!set?.has(lease)) return;
                    setDirty(lease, false);
                    set.delete(lease);
                    if (!set.size) leases.delete(clean);
                }
            };
        },

        /** True while a screen holds edits of `key` that are not on disk yet. */
        isDirty: (key) => isDirty(normalizeKey(key)),
        isOpen: (key) => leases.has(normalizeKey(key)),

        /** Asks every holder of `key` to write what it has waiting. Resolves when they are done. */
        async flush(key) {
            const set = leases.get(normalizeKey(key));
            await Promise.all([...(set ?? [])].map(async (lease) => lease.flush()));
        },

        /** `listener(key)` runs when the last dirty lease on `key` becomes clean. */
        onClean(listener) {
            cleanListeners.add(listener);
            return () => cleanListeners.delete(listener);
        },

        markDeferred(key, reason) {
            const clean = normalizeKey(key);
            if (deferred.get(clean) === reason) return;
            deferred.set(clean, reason);
            call(deferredListeners, clean);
        },
        clearDeferred(key) {
            const clean = normalizeKey(key);
            if (deferred.delete(clean)) call(deferredListeners, clean);
        },
        isDeferred: (key) => deferred.has(normalizeKey(key)),
        getDeferred: () => [...deferred].map(([key, reason]) => ({ key, reason })).sort((a, b) => (a.key < b.key ? -1 : 1)),

        /** `listener(key)` runs when `key` is listed as deferred or taken off the list. */
        subscribeDeferred(listener) {
            deferredListeners.add(listener);
            return () => deferredListeners.delete(listener);
        }
    };
}
