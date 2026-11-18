// Two sides of a sync test: a "desktop" (the shared engine with the admin role
// over files kept in memory, paired with the desktop's own pairing code from
// main/functions/sync-client-pairing.js) and a phone (the app's data layer
// over the memory driver with the mobile sync service). Both talk to
// fake-sync-server.mjs, or to any `fetchImpl`.

import { webcrypto, randomBytes, randomUUID } from 'node:crypto';
import { createPisiSyncEngine } from '../../../shared/sync-engine.mjs';
import { createPisiSyncHttp } from '../../../shared/sync-http.mjs';
import { openPisiSyncSpaceKeys, utf8Decode, utf8Encode } from '../../../shared/sync-crypto.mjs';
import {
    createPisiSyncSpace,
    grantPisiSyncPairing,
    pollPisiSyncPairing,
    rejectPisiSyncPairing,
    startPisiSyncPairing
} from '../../../main/functions/sync-client-pairing.js';
import { createMemoryDriver } from '../../src/data/drivers/memory-driver.mjs';
import { createProject } from '../../src/data/project-repo.mjs';
import { createSyncCodec } from '../../src/sync/codec.mjs';
import { createSyncService } from '../../src/sync/sync-service.mjs';

export const subtle = webcrypto.subtle;
export const random = (n) => new Uint8Array(randomBytes(n));
export const codec = createSyncCodec({ CompressionStreamImpl: globalThis.CompressionStream, DecompressionStreamImpl: globalThis.DecompressionStream });
export const SERVER_URL = 'https://sync.test';
export const timers = { setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: (timer) => clearTimeout(timer) };

/** Secrets kept in memory, standing in for the Keystore plugin; `values` survives a "restart" when passed again. */
export function createMemorySecrets(values = new Map()) {
    return {
        values,
        get: async (name) => values.get(name) ?? null,
        put: async (name, value) => void values.set(name, String(value)),
        remove: async (name) => void values.delete(name)
    };
}

function memoryStore() {
    let state = null;
    let secrets = null;
    const bases = new Map();
    return {
        load: async () => (state ? structuredClone(state) : null),
        save: async (value) => void (state = structuredClone(value)),
        readSecrets: async () => secrets,
        writeSecrets: async (value) => void (secrets = value),
        readBase: async (fid) => bases.get(fid) ?? null,
        writeBase: async (fid, bytes) => void bases.set(fid, bytes),
        removeBase: async (fid) => void bases.delete(fid)
    };
}

/** The desktop: files as `path → text`, the admin of a new space. */
export async function createDesktop(server, { name = 'Masaüstü', spaceName = 'Pisi Projem', fetchImpl = (url, init) => server.fetch(url, init) } = {}) {
    const files = new Map();
    let version = 0;
    const http = createPisiSyncHttp({
        baseUrl: SERVER_URL,
        fetchImpl,
        sleep: async () => {},
        ...timers,
        AbortControllerImpl: AbortController
    });
    const created = await createPisiSyncSpace({ subtle, http, setupKey: server.setupKey, spaceName, deviceName: name, platform: 'linux', random });
    const store = memoryStore();
    await store.writeSecrets({ token: created.token, key: created.key });
    await store.save({
        serverUrl: SERVER_URL,
        spaceId: created.spaceId,
        deviceId: created.deviceId,
        role: 'admin',
        spaceName,
        deviceName: name,
        limits: null,
        cursor: 0,
        dseq: 0,
        lastDseq: {},
        index: {},
        hashCache: {},
        pendingRemote: [],
        pendingCommit: null,
        conflicts: [],
        issues: [],
        lastRun: null,
        stopped: null
    });
    http.setToken(created.token);
    const keys = await openPisiSyncSpaceKeys(subtle, created.key, created.spaceId);
    const adapter = {
        list: async () => [...files].map(([path, file]) => ({ path, size: file.bytes.length, mtimeMs: file.version })),
        read: async (path) => files.get(path)?.bytes ?? null,
        apply: async (writes) => {
            for (const write of writes) {
                if (write.op === 'remove') files.delete(write.path);
                else files.set(write.path, { bytes: write.bytes, version: (version += 1) });
            }
            return { skipped: [] };
        }
    };
    const makeEngine = () => createPisiSyncEngine({ subtle, http, store, files: adapter, random, uuid: randomUUID, gzip: codec.gzip, gunzip: codec.gunzip });
    let engine = makeEngine();
    return {
        ...created,
        http,
        keys,
        store,
        write(path, value) {
            files.set(path, { bytes: utf8Encode(typeof value === 'string' ? value : JSON.stringify(value, null, 2)), version: (version += 1) });
        },
        writeBytes(path, bytes) {
            files.set(path, { bytes, version: (version += 1) });
        },
        readBytes: (path) => files.get(path)?.bytes ?? null,
        read: (path) => (files.has(path) ? utf8Decode(files.get(path).bytes) : null),
        readJson: (path) => (files.has(path) ? JSON.parse(utf8Decode(files.get(path).bytes)) : null),
        remove: (path) => files.delete(path),
        paths: () => [...files.keys()].sort(),
        sync: (options = {}) => engine.runTurn({ reason: 'test', ...options }),
        cancel: () => engine.cancel(),
        /** "Sunucuyla yeniden eşleş" after SERVER_ROLLBACK; the next `sync()` starts over from the heads. */
        rejoin: () => engine.rejoin(),
        /** A new engine over the same state and files: the app started again after it was stopped. */
        restart() {
            engine = makeEngine();
        },
        async startPairing() {
            return startPisiSyncPairing({ subtle, http, serverUrl: SERVER_URL, spaceId: created.spaceId, random });
        },
        /** Waits until the pairing is claimed, then grants it (or rejects it with `{ reject: true }`). Resolves the desktop's view. */
        async answerPairing(started, { reject = false, timeoutMs = 10000 } = {}) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const view = await pollPisiSyncPairing({ subtle, http, session: started.session });
                if (view.state === 'claimed') {
                    if (reject) await rejectPisiSyncPairing({ http, session: started.session });
                    else await grantPisiSyncPairing({ subtle, http, session: started.session, keys, projectKey: created.key, spaceName, random });
                    return view;
                }
                if (Date.now() > deadline) throw new Error('eşleştirme talebi gelmedi');
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        }
    };
}

/**
 * The phone: the app's data layer and the sync service. Pass the same
 * `driver`, `stateDriver` and `secrets` again to "restart" the app.
 */
export function createPhone(
    server,
    {
        driver = createMemoryDriver(),
        stateDriver = createMemoryDriver(),
        projectsDriver = createMemoryDriver(),
        secrets = createMemorySecrets(),
        fetchImpl = (url, init) => server.fetch(url, init),
        flushPending = async () => {},
        allowLoopbackHttp = false,
        // Retries and the pairing poll wait a moment only.
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)))
    } = {}
) {
    const project = createProject({ driver, makeUuid: randomUUID });
    const service = createSyncService({
        project,
        stateDriver,
        projectsDriver,
        secrets,
        subtle,
        random,
        uuid: randomUUID,
        fetchImpl,
        ...timers,
        AbortControllerImpl: AbortController,
        codec,
        sleep,
        flushPending,
        platformName: 'android',
        allowLoopbackHttp
    });
    return { project, service, driver, stateDriver, projectsDriver, secrets };
}

/** Pairs `phone` with `desktop` on the code path; resolves when the phone is bound. */
export async function pairWithCode(desktop, phone, { deviceName = 'Pixel 7', initial = 'merge' } = {}) {
    const started = await desktop.startPairing();
    const claimed = await phone.service.startPairing({ method: 'code', serverUrl: SERVER_URL, code: started.view.code, deviceName, initial });
    const [view] = await Promise.all([desktop.answerPairing(started), claimed.wait()]);
    return { started, claimed, view };
}

export const nodeDoc = (id, title, blocks, extra = {}) => ({
    pisi: {
        version: 1,
        type: 'node',
        id,
        title,
        sidecar: `inv_${title}__${id}`,
        parentMap: 'none',
        createdAt: '2026-11-17T08:00:00.000Z',
        updatedAt: '2026-11-17T08:00:00.000Z',
        ...extra
    },
    content: blocks
        .map(([blockId, text]) => `<div class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="paragraph">${text}</div>`)
        .join('')
});
