// HTTP client of Pisi Sync on the desktop (docs/sync-plan.md S3). The client
// itself is shared with the phone (shared/sync-http.mjs); here it gets Node's
// fetch, timers and AbortController.

import { createPisiSyncHttp as createSharedPisiSyncHttp } from '../../shared/sync-http.mjs';

export {
    PISI_SYNC_BLOB_TIMEOUT_MS,
    PISI_SYNC_JSON_TIMEOUT_MS,
    PisiSyncHttpError,
    getPisiSyncBackoffSeconds,
    parsePisiSyncRetryAfter,
    resolvePisiSyncTransportUrl
} from '../../shared/sync-http.mjs';

/**
 * See shared/sync-http.mjs; `fetchImpl` defaults to the global fetch, `sleep(ms)` to a timer.
 * @param {any} options
 */
export function createPisiSyncHttp(options) {
    const { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
    return createSharedPisiSyncHttp({
        ...options,
        fetchImpl,
        sleep,
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (timer) => clearTimeout(timer),
        AbortControllerImpl: AbortController
    });
}
