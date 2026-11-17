// Pisi Sync on the phone (docs/sync-plan.md S5, §3.6, §3.8). It binds the
// project to a space after pairing, runs the shared engine (shared/sync-engine.mjs)
// over the project's ProjectWriter and keeps the status that Settings shows.
//
// - One turn at a time; a trigger during a turn runs one more turn after it.
// - Before a turn the screens write what they hold (`flushPending`), so the
//   engine merges with what is on disk (SV4). A file still held dirty is
//   deferred and tried again once its screen lets go of it (`documents.onClean`).
// - Triggers: opening (after the Pisi tab is drawn), coming back to the app,
//   3 s after the last local write, a file becoming clean, and by hand.
// - The phone is a `member`: it never sends a delete (SV12).
// - DEVICE_REVOKED or TOKEN_INVALID: the engine stops, the secrets and the
//   state are removed, the project files stay and the user is told.
// - Nothing here imports Capacitor: storage, secrets, fetch and crypto come in.

import { createPisiSyncEngine } from '../../../shared/sync-engine.mjs';
import { createPisiSyncHttp } from '../../../shared/sync-http.mjs';
import { openPisiSyncSpaceKeys } from '../../../shared/sync-crypto.mjs';
import { claimPairing, getPairingServerUrl, PisiPairingError, waitForGrant } from './pairing.mjs';
import { createSyncProjectFiles, isLazySyncPath } from './project-files.mjs';
import { createSyncStateStore, makeMobileSyncState } from './state-store.mjs';

export const PISI_SYNC_WRITE_DELAY_MS = 3000;
const CLEAN_DELAY_MS = 1000;
const MAX_RETRY_AFTER_SECONDS = 300;
const REVOKED = new Set(['DEVICE_REVOKED', 'TOKEN_INVALID']);

/**
 * Status values: 'unpaired', 'idle' (paired, last turn fine), 'running',
 * 'offline', 'error' (`code` says why), 'stopped' (SERVER_ROLLBACK: nothing is
 * written until the phone is paired again) and 'unreadable' (the state file
 * could not be read).
 */
export function createSyncService({
    project,
    stateDriver,
    secrets,
    subtle,
    random,
    uuid,
    now = () => new Date(),
    fetchImpl,
    setTimer,
    clearTimer,
    AbortControllerImpl,
    codec,
    sleep = (ms) => new Promise((resolve) => setTimer(resolve, ms)),
    flushPending = async () => {},
    platformName = 'android',
    allowLoopbackHttp = false,
    onError = () => {}
}) {
    const store = createSyncStateStore({ driver: stateDriver, secrets, makeToken: uuid });
    const files = createSyncProjectFiles({ project, lazy: isLazySyncPath });
    const listeners = new Set();
    let status = { state: 'unpaired', code: null, spaceName: '', serverUrl: '', deviceName: '', lastRun: null, conflicts: [], issues: [], running: false };
    let engine = null;
    let http = null;
    let running = null;
    let again = false;
    let timer = null;
    let destroyed = false;
    let pairing = null;

    const emit = (event) => {
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (error) {
                onError(error);
            }
        }
    };
    const setStatus = (change) => {
        status = { ...status, ...change };
        emit({ type: 'status' });
    };

    const makeHttp = (baseUrl) =>
        createPisiSyncHttp({ baseUrl, fetchImpl, sleep, setTimer, clearTimer, AbortControllerImpl, allowLoopbackHttp, maxAttempts: 3 });

    function statusOf(state) {
        const stopped = state.stopped ? { state: 'stopped', code: state.stopped } : null;
        return {
            ...(stopped ?? { state: 'idle', code: null }),
            spaceName: state.spaceName,
            serverUrl: state.serverUrl,
            deviceName: state.deviceName,
            lastRun: state.lastRun,
            conflicts: [...state.conflicts].reverse(),
            issues: state.issues
        };
    }

    function connect(state) {
        http = makeHttp(state.serverUrl);
        engine = createPisiSyncEngine({
            subtle,
            http,
            store,
            files,
            isDirty: (path) => project.documents.isDirty(path),
            lazy: isLazySyncPath,
            random,
            uuid,
            now,
            gzip: codec.gzip,
            gunzip: codec.gunzip
        });
    }

    async function forget({ revoked }) {
        engine = null;
        http = null;
        files.reset();
        await store.destroy();
        setStatus({ state: 'unpaired', code: revoked ? 'DEVICE_REVOKED' : null, spaceName: '', serverUrl: '', lastRun: null, conflicts: [], issues: [] });
        if (revoked) emit({ type: 'revoked' });
    }

    async function turn(reason) {
        await flushPending();
        let summary;
        try {
            summary = await engine.runTurn({ reason });
        } catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
            if (REVOKED.has(code)) return forget({ revoked: true });
            if (code === 'RATE_LIMITED' && error.retryAfter) schedule('retry', Math.min(error.retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000);
            if (code !== 'OFFLINE') onError(error);
            setStatus({ state: code === 'OFFLINE' ? 'offline' : 'error', code });
            return null;
        }
        const state = await store.load();
        if (!state) return summary;
        setStatus(statusOf(state));
        if (!summary.ok) {
            if (summary.code === 'SERVER_ROLLBACK') emit({ type: 'rollback' });
            else setStatus({ state: summary.code === 'OFFLINE' ? 'offline' : 'error', code: summary.code });
            return summary;
        }
        const copies = summary.conflicts.filter((conflict) => conflict.kind === 'copy').length;
        if (copies) emit({ type: 'conflict-copy', count: copies });
        return summary;
    }

    /** Runs a turn now (or right after the running one). Resolves with the engine's summary, or null. */
    function sync(reason = 'manual') {
        if (destroyed || !engine) return Promise.resolve(null);
        if (running) {
            again = true;
            return running;
        }
        setStatus({ running: true });
        running = (async () => {
            let result = null;
            do {
                again = false;
                result = await turn(reason);
            } while (again && engine && !destroyed);
            return result;
        })()
            .catch((error) => {
                onError(error);
                setStatus({ state: 'error', code: 'INTERNAL' });
                return null;
            })
            .finally(() => {
                running = null;
                if (!destroyed) setStatus({ running: false });
            });
        return running;
    }

    function schedule(reason, delay) {
        if (destroyed || !engine) return;
        if (timer) clearTimer(timer);
        timer = setTimer(() => {
            timer = null;
            void sync(reason);
        }, delay);
    }

    const stops = [
        // Writes of the app (not the ones a turn made) are sent a few seconds after the last one.
        project.writer.onFileChanged((_key, info) => info?.source !== 'sync' && schedule('write', PISI_SYNC_WRITE_DELAY_MS)),
        // A deferred file is merged once the screen that held it has written it.
        project.documents.onClean(() => schedule('clean', CLEAN_DELAY_MS))
    ];

    async function bindPairing({ result, serverUrl, deviceName }) {
        const state = makeMobileSyncState({
            serverUrl,
            spaceId: result.spaceId,
            deviceId: result.deviceId,
            role: result.role === 'admin' ? 'admin' : 'member',
            spaceName: result.spaceName || '',
            deviceName,
            now: now()
        });
        await store.bind(state, { token: result.token, key: result.key });
        files.reset();
        connect(state);
        setStatus(statusOf(state));
        emit({ type: 'paired' });
        void sync('paired');
    }

    return {
        store,

        /** Reads the binding. Resolves with the status; never throws. */
        async init() {
            try {
                const state = await store.load();
                if (state && (await store.readSecrets())) {
                    connect(state);
                    setStatus(statusOf(state));
                }
            } catch (error) {
                setStatus({ state: 'unreadable', code: error?.code || 'STATE_UNREADABLE' });
            }
            return status;
        },

        getStatus: () => status,
        isPaired: () => Boolean(engine),
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        sync,
        schedule,
        /** Coming back to the app is a trigger. */
        handleResume: () => engine && void sync('resume'),

        /**
         * Starts a pairing. `method` 'code' takes `serverUrl` and `code`, 'qr' takes `uri`.
         * Resolves `{ sas, wait() }`: `sas` is the verification number of the code path;
         * `wait()` resolves once the desktop granted the device and the phone is bound.
         * Rejects with a PisiPairingError (`code`).
         */
        async startPairing({ method, uri = '', serverUrl = '', code = '', deviceName }) {
            this.cancelPairing();
            const base = getPairingServerUrl({ method, uri, serverUrl });
            if (!base) throw new PisiPairingError(method === 'qr' ? 'PAIRING_QR_INVALID' : 'BAD_SERVER_URL');
            const own = { cancelled: false };
            pairing = own;
            const pairingHttp = makeHttp(base);
            const claimed = await claimPairing({ subtle, http: pairingHttp, random, method, uri, code, deviceName, platform: platformName });
            if (own.cancelled) throw new PisiPairingError('PAIRING_CANCELLED');
            return {
                sas: claimed.sas,
                wait: async () => {
                    const result = await waitForGrant({
                        subtle,
                        http: pairingHttp,
                        session: claimed.session,
                        sleep,
                        now: () => now().getTime(),
                        isCancelled: () => own.cancelled || destroyed
                    });
                    if (own.cancelled) throw new PisiPairingError('PAIRING_CANCELLED');
                    // The space's keys must open before the phone is bound to it.
                    await openPisiSyncSpaceKeys(subtle, result.key, result.spaceId);
                    await bindPairing({ result, serverUrl: base, deviceName });
                    if (pairing === own) pairing = null;
                    return status;
                }
            };
        },

        /** Gives up a pairing on this phone; the desktop's pairing expires on its own. */
        cancelPairing() {
            if (pairing) pairing.cancelled = true;
            pairing = null;
        },

        /**
         * Removes this phone from the space: the server is told (`DELETE devices/me`),
         * then the secrets and the state are removed; project files stay.
         * Resolves `{ remote: 'ok' | 'offline' | 'failed' }`; the phone is unpaired in every case.
         */
        async unpair() {
            let remote = 'ok';
            try {
                if (running) await running;
                const state = await store.load();
                if (state && http) {
                    const secretsNow = await store.readSecrets();
                    http.setToken(secretsNow?.token ?? null);
                    await http.request('DELETE', `/v1/spaces/${state.spaceId}/devices/me`);
                }
            } catch (error) {
                const code = error?.code;
                remote = code === 'OFFLINE' ? 'offline' : REVOKED.has(code) ? 'ok' : 'failed';
            }
            await forget({ revoked: false });
            return { remote };
        },

        destroy() {
            destroyed = true;
            if (timer) clearTimer(timer);
            this.cancelPairing();
            files.destroy();
            for (const stop of stops) stop();
            listeners.clear();
        }
    };
}
