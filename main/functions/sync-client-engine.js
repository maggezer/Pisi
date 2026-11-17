// The sync turn on the desktop (docs/sync-plan.md §3.6). The engine is shared
// with the phone (shared/sync-engine.mjs); here it gets Node's Web Crypto and
// gzip streams. See shared/sync-engine.mjs for the adapters.

import { PISI_SYNC_MAX_STALE_ROUNDS, createPisiSyncEngine as createSharedPisiSyncEngine } from '../../shared/sync-engine.mjs';

export { PISI_SYNC_MAX_STALE_ROUNDS };

async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const pisiSyncGzip = (bytes) => pipeBytes(bytes, new CompressionStream('gzip'));
export const pisiSyncGunzip = (bytes) => pipeBytes(bytes, new DecompressionStream('gzip'));

/**
 * See shared/sync-engine.mjs; `subtle` defaults to Node's Web Crypto, gzip to CompressionStream.
 * @param {any} options
 */
export function createPisiSyncEngine(options) {
    const { subtle = globalThis.crypto.subtle, gzip = pisiSyncGzip, gunzip = pisiSyncGunzip } = options;
    return createSharedPisiSyncEngine({ ...options, subtle, gzip, gunzip });
}
