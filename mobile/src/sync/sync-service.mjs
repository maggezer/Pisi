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
//   state are removed, the project files stay and the user is told. TOKEN_INVALID
//   also means the desktop deleted the space when it left it (it was the last
//   desktop), so its notice says so.
// - SERVER_ROLLBACK: nothing is written until the user chooses "Sunucuyla yeniden
//   eşleş" (`rejoin()`): the next turn starts over from the server's heads
//   without losing the phone's files (shared/sync-recovery.mjs).
// - Remote changes that failed verification (SV9) are listed in the status
//   (`unapplied`) and tried again by the engine.
// - First pairing (S6 step 3): a phone with only a project skeleton takes the
//   server's project; otherwise the user chose `merge` (add the phone's files)
//   or `aside` (sync/initial-transfer.mjs) on the pairing screen.
// - The first download (S6 step 2) takes every head and writes in batches, the
//   authorities and today's diary first; `status.progress` tells how far it is.
// - Attachments (S6 step 4) are downloaded when a note shows them:
//   `fetchAttachment(path)`; one download per file at a time.
// - Nothing here imports Capacitor: storage, secrets, fetch and crypto come in.

import { createPisiSyncEngine } from '../../../shared/sync-engine.mjs';
import { createPisiSyncHttp } from '../../../shared/sync-http.mjs';
import { openPisiSyncSpaceKeys } from '../../../shared/sync-crypto.mjs';
import { claimPairing, getPairingServerUrl, PisiPairingError, waitForGrant } from './pairing.mjs';
import { createSyncProjectFiles, isLazySyncPath } from './project-files.mjs';
import { createSyncStateStore, makeMobileSyncState } from './state-store.mjs';
import { clearSkeleton, isSkeletonProject, listAsideProjects, setProjectAside } from './initial-transfer.mjs';
import { PISI_SYNC_APPLY_BATCH } from '../../../shared/sync-initial.mjs';

export const PISI_SYNC_WRITE_DELAY_MS = 3000;
const CLEAN_DELAY_MS = 1000;
const MAX_RETRY_AFTER_SECONDS = 300;
const REVOKED = new Set(['DEVICE_REVOKED', 'TOKEN_INVALID']);
const PROGRESS_MIN_FILES = 10;
const PROGRESS_INTERVAL_MS = 250;

/**
 * Status values: 'unpaired', 'idle' (paired, last turn fine), 'running',
 * 'offline', 'error' (`code` says why), 'stopped' (SERVER_ROLLBACK: nothing is
 * written until the phone is paired again) and 'unreadable' (the state file
 * could not be read).
 */
export function createSyncService({
    project,
    stateDriver,
    projectsDriver = null,
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
    let status = {
        state: 'unpaired',
        code: null,
        spaceName: '',
        serverUrl: '',
        deviceName: '',
        lastRun: null,
        conflicts: [],
        issues: [],
        unapplied: [],
        running: false,
        progress: null,
        aside: []
    };
    let engine = null;
    let http = null;
    let running = null;
    let again = false;
    let timer = null;
    let destroyed = false;
    let pairing = null;
    let progressShownAt = 0;
    // Attachment downloads under way: path → promise of the result.
    const fetching = new Map();

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
            issues: state.issues,
            unapplied: Object.values(state.unapplied || {}).sort((left, right) => left.seq - right.seq)
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
            gunzip: codec.gunzip,
            applyBatch: PISI_SYNC_APPLY_BATCH,
            // Only transfers worth following are shown: a turn that downloads or sends a few files is over before it could be read.
            onProgress: (value) => {
                if (value.files.total < PROGRESS_MIN_FILES) return;
                // Settings is drawn again for every status: a few times a second is enough to follow.
                const at = now().getTime();
                if (value.files.done < value.files.total && value.files.done > 0 && at - progressShownAt < PROGRESS_INTERVAL_MS) return;
                progressShownAt = at;
                setStatus({ progress: value });
            }
        });
    }

    /** `revoked` is the server's code (DEVICE_REVOKED, TOKEN_INVALID) when the server ended the pairing, else null. */
    async function forget({ revoked }) {
        engine = null;
        http = null;
        files.reset();
        await store.destroy();
        setStatus({ state: 'unpaired', code: revoked || null, spaceName: '', serverUrl: '', lastRun: null, conflicts: [], issues: [], unapplied: [] });
        if (revoked) emit({ type: 'revoked', code: revoked });
    }

    async function turn(reason) {
        await flushPending();
        let summary;
        try {
            summary = await engine.runTurn({ reason });
        } catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
            if (REVOKED.has(code)) return forget({ revoked: code });
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
                if (!destroyed) setStatus({ running: false, progress: null });
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

    /** Asks the server to forget a device that was granted but could not be bound here. */
    async function leaveSpace(result, serverUrl) {
        try {
            const leaveHttp = makeHttp(serverUrl);
            leaveHttp.setToken(result.token);
            await leaveHttp.request('DELETE', `/v1/spaces/${result.spaceId}/devices/me`);
        } catch {
            // The desktop can still revoke it.
        }
    }

    async function bindPairing({ result, serverUrl, deviceName, initial }) {
        // A skeleton holds nothing of the user: its files give way to the server's, byte for byte.
        if (initial === 'replace') await clearSkeleton(project, files);
        if (initial === 'aside') {
            try {
                const aside = await setProjectAside({ project, projectsDriver, now: now() });
                status = { ...status, aside: await listAsideProjects(projectsDriver) };
                emit({ type: 'set-aside', name: aside.name, left: aside.left.length });
            } catch (error) {
                await leaveSpace(result, serverUrl);
                throw new PisiPairingError(error?.code || 'SET_ASIDE_FAILED');
            }
        }
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
            status = { ...status, aside: await listAsideProjects(projectsDriver).catch(() => []) };
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

        /**
         * What the first pairing has to ask: `{ skeleton }` is true when the
         * project is only its skeleton, so the server's project comes down
         * without a question (S6 step 3).
         */
        async inspectProject() {
            await flushPending();
            try {
                return { skeleton: await isSkeletonProject(files) };
            } finally {
                files.reset();
            }
        },

        /**
         * Downloads an attachment the phone holds only as a remote head. Resolves
         * `{ ok, code }`; `code` is NOT_PAIRED, NOT_FOUND (the server has no such
         * file), OFFLINE or a verification code (SV9). Two calls for one file share the download.
         */
        fetchAttachment(path) {
            if (destroyed || !engine) return Promise.resolve({ ok: false, code: 'NOT_PAIRED' });
            if (fetching.has(path)) return fetching.get(path);
            const job = engine
                .fetchLazy(path)
                .then((result) => {
                    if (REVOKED.has(result.code)) void forget({ revoked: result.code });
                    else if (result.ok) emit({ type: 'attachment', path });
                    return result;
                })
                .catch((error) => {
                    onError(error);
                    return { ok: false, code: 'INTERNAL' };
                })
                .finally(() => fetching.delete(path));
            fetching.set(path, job);
            return job;
        },

        /** True when the server holds `path` for this phone to download (an attachment not downloaded yet). */
        async hasRemoteAttachment(path) {
            return Boolean(engine && (await engine.getRemoteOnly(path)));
        },
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
        async startPairing({ method, uri = '', serverUrl = '', code = '', deviceName, initial = 'merge' }) {
            this.cancelPairing();
            if (initial === 'aside' && !projectsDriver) throw new PisiPairingError('SET_ASIDE_FAILED');
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
                    await bindPairing({ result, serverUrl: base, deviceName, initial });
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
            await forget({ revoked: null });
            return { remote };
        },

        /**
         * "Sunucuyla yeniden eşleş" after SERVER_ROLLBACK (docs/sync-protocol.md §7.4):
         * the phone keeps its files and the pairing; the turn that follows takes every
         * head and merges without losing either side. Resolves the turn's summary, or
         * `{ ok: false, code }` (NOT_PAIRED, NOT_STOPPED).
         */
        async rejoin() {
            if (destroyed || !engine) return { ok: false, code: 'NOT_PAIRED' };
            if (running) await running;
            const started = await engine.rejoin();
            if (!started.ok) return started;
            const state = await store.load();
            if (state) setStatus(statusOf(state));
            return (await sync('manual')) ?? { ok: false, code: status.code || 'INTERNAL' };
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
