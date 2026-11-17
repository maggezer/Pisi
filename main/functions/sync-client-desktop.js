// Pisi Sync on the desktop (docs/sync-plan.md S3, §3.7): the engine of
// sync-client-engine.js wired to Electron. HTTP runs here in main; the token and
// the project key K are sealed with safeStorage in the user data folder and never
// reach the renderer. A turn writes all its files in one atomic mutation (SV11),
// marks them as Pisi's own writes (no watcher reload) and tells the renderer
// which paths changed (`pisi:sync-applied`), so only those surfaces update (SV5).
// Before every turn the renderer writes its pending saves and reports the open
// documents that still have unsaved edits; while the turn runs it keeps main
// informed (`pisi:sync-dirty`) and those files are deferred (SV4).
//
// Contracts (docs/domain-command-query.md): sync.status.v1, sync.conflicts.list.v1,
// sync.unsynced.list.v1, sync.devices.list.v1 (queries); sync.space.create.v1,
// sync.space.join.v1, sync.space.join-status.v1, sync.pairing.start.v1,
// sync.pairing.status.v1, sync.pairing.confirm.v1, sync.pairing.cancel.v1,
// sync.device.revoke.v1, sync.note.keep-disk-copy.v1, sync.run.v1,
// sync.disconnect.v1 (commands).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, ipcMain, safeStorage } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import { openPisiSyncSpaceKeys } from '../../shared/sync-crypto.mjs';
import { normalizePisiSyncServerUrl } from '../../shared/sync-meta.mjs';
import { makePisiSyncConflictCopy } from '../../shared/sync-conflict.mjs';
import { getPisiSyncFileClass, getPisiSyncPathKey } from '../../shared/sync-paths.mjs';
import { createPisiSyncEngine } from './sync-client-engine.js';
import { createPisiSyncProjectFiles } from './sync-client-files.js';
import { createPisiSyncHttp } from './sync-client-http.js';
import {
    cancelPisiSyncPairing,
    claimPisiSyncPairingWithCode,
    createPisiSyncSpace,
    getPisiSyncPlatform,
    grantPisiSyncPairing,
    listPisiSyncDevices,
    pollPisiSyncJoinResult,
    pollPisiSyncPairing,
    rejectPisiSyncPairing,
    startPisiSyncPairing
} from './sync-client-pairing.js';
import { createPisiSyncStateStore, makePisiSyncState } from './sync-client-state.js';

const domain = modules['main.domainCommandQuery'];
const atomicMutation = modules['main.atomicMutation'];
const filesystemCore = modules['main.filesystemCore'];

const subtle = globalThis.crypto.subtle;
const random = (length) => new Uint8Array(crypto.randomBytes(length));
const FLUSH_TIMEOUT_MS = 5000;
const AFTER_WRITE_DELAY_MS = 3000;
const FOCUSED_INTERVAL_MS = 60000;
const BACKGROUND_INTERVAL_MS = 5 * 60000;
const FOCUS_THROTTLE_MS = 10000;
const STOPPING_CODES = new Set(['DEVICE_REVOKED', 'TOKEN_INVALID', 'SERVER_ROLLBACK', 'STATE_UNREADABLE', 'SECRETS_UNREADABLE']);
const UNSYNCED_CODES = new Set(['FILE_TOO_LARGE', 'PATH_UNSAFE', 'PATH_COLLISION', 'LOCAL_CORRUPT']);

const runtime = {
    context: null,
    // SV13: per project root, tasks whose status a turn changed: { [taskId]: { stale, status } }.
    taskGuards: new Map(),
    taskGuardsSaveTimer: null,
    running: null,
    queued: null,
    lastTurnAt: 0,
    lastFocusAt: 0,
    lastResult: null,
    writeTimer: null,
    intervalTimer: null,
    applying: false,
    dirty: new Set(),
    flushWaiters: new Map(),
    pairings: new Map(),
    joins: new Map()
};

function isPisiSyncTestBuild() {
    return !app.isPackaged;
}

function getPisiSyncWindow() {
    const window = globalThis.mainWindow;
    return window && !window.isDestroyed() ? window : null;
}

function sendPisiSyncEvent(channel, payload) {
    getPisiSyncWindow()?.webContents.send(channel, payload);
}

function getPisiSyncStateRoot() {
    return path.join(app.getPath('userData'), 'pisi-sync');
}

/** safeStorage when it is available; `weak` when Linux falls back to its basic_text backend. */
// On Linux without a keyring (no Secret Service or KWallet) Electron only offers
// its built-in plain-text key; sync still works and Settings warns (S3 decision).
function getPisiSyncSecrets() {
    let weak = false;
    if (!safeStorage?.isEncryptionAvailable?.()) {
        if (process.platform !== 'linux' || typeof safeStorage?.setUsePlainTextEncryption !== 'function') {
            throw Object.assign(new Error('Bu sistemde güvenli anahtar deposu yok.'), { code: 'SECRET_STORAGE_UNAVAILABLE' });
        }
        safeStorage.setUsePlainTextEncryption(true);
        weak = true;
    }
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : null;
    return {
        weak: weak || backend === 'basic_text',
        seal: (text) => safeStorage.encryptString(String(text)).toString('base64'),
        open: (text) => safeStorage.decryptString(Buffer.from(String(text), 'base64'))
    };
}

function getPisiSyncDeviceName() {
    const host = os.hostname().replace(/\.local$/i, '');
    return host || 'Pisi';
}

function normalizeComparePath(value) {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

function isPisiSyncPathDirty(projectRoot, relative) {
    if (!runtime.dirty.size) return false;
    return runtime.dirty.has(normalizeComparePath(path.join(projectRoot, ...relative.split('/'))));
}

function makePisiSyncHttpFor(serverUrl) {
    return createPisiSyncHttp({ baseUrl: serverUrl, allowLoopbackHttp: isPisiSyncTestBuild() && process.env.PISI_SYNC_ALLOW_LOOPBACK_HTTP === '1' });
}

function makePisiSyncFaultHook() {
    if (!isPisiSyncTestBuild() || process.env.PISI_SYNC_TEST_FAULT !== 'apply-mid') return null;
    return (_op, index) => {
        if (index === 1) throw Object.assign(new Error('Test: senkron uygulaması yarıda kesildi.'), { code: 'TEST_FAULT' });
    };
}

/** The engine of the active project, rebuilt when the project changes. */
function getPisiSyncContext() {
    const projectRoot = globalThis.activeProjectFolder ? path.resolve(globalThis.activeProjectFolder) : null;
    if (!projectRoot) return null;
    if (runtime.context?.projectRoot === projectRoot) return runtime.context;
    const store = createPisiSyncStateStore({ root: getPisiSyncStateRoot(), projectPath: projectRoot, secrets: lazySecrets() });
    const files = createPisiSyncProjectFiles(projectRoot, {
        run: (operation) => {
            runtime.applying = true;
            try {
                return atomicMutation.runPisiAtomicMutation(projectRoot, 'sync.apply.v1', operation);
            } finally {
                runtime.applying = false;
            }
        },
        writeFile: (absolute, bytes) => {
            if (path.relative(projectRoot, absolute).split(path.sep).join('/') === '.pisi/tasks.json') recordPisiSyncTaskGuards(projectRoot, absolute, bytes);
            filesystemCore.writeFileAtomic(absolute, bytes, { backup: false });
        },
        beforeWrite: makePisiSyncFaultHook()
    });
    const context = { projectRoot, store, files, http: null, engine: null, serverUrl: null };
    runtime.context = context;
    void store
        .readTaskGuards()
        .then((guards) => {
            if (!runtime.taskGuards.has(projectRoot)) runtime.taskGuards.set(projectRoot, guards);
        })
        .catch(() => undefined);
    return context;
}

// ---- SV13: the note projection must not take a remote task status back ----------
// The desktop keeps a task's state in its source note block too (a projection). A
// turn that brings a new status in tasks.json — the phone completed the task —
// leaves the block's marker as it was, and the editor or the task panel would
// later write that old status back. While a guard is set and the canonical
// status is still the one the turn brought, a projection reporting the old
// (`stale`) status keeps the canonical one. A third status from the note, or a
// canonical change made here (task panel), clears the guard. Guards live with
// the device state (outside the project) and survive restarts.

function readPisiSyncTaskStatuses(bytes) {
    try {
        const tasks = JSON.parse(Buffer.from(bytes).toString('utf8'))?.tasks;
        return new Map((Array.isArray(tasks) ? tasks : []).filter((task) => task?.id).map((task) => [task.id, task]));
    } catch {
        return new Map();
    }
}

function recordPisiSyncTaskGuards(projectRoot, absolute, bytes) {
    let previous;
    try {
        previous = readPisiSyncTaskStatuses(fs.readFileSync(absolute));
    } catch {
        previous = new Map();
    }
    const next = readPisiSyncTaskStatuses(bytes);
    const guards = { ...(runtime.taskGuards.get(projectRoot) || {}) };
    for (const [id, task] of next) {
        const before = previous.get(id);
        if (!before || before.status === task.status || !task.source?.blockId) continue;
        guards[id] = { stale: guards[id]?.stale ?? before.status, status: task.status };
    }
    for (const id of Object.keys(guards)) if (!next.has(id)) delete guards[id];
    runtime.taskGuards.set(projectRoot, guards);
    schedulePisiSyncTaskGuardsSave(projectRoot);
}

function schedulePisiSyncTaskGuardsSave(projectRoot) {
    clearTimeout(runtime.taskGuardsSaveTimer);
    runtime.taskGuardsSaveTimer = setTimeout(() => {
        const context = runtime.context;
        if (context?.projectRoot !== projectRoot) return;
        void context.store.writeTaskGuards(runtime.taskGuards.get(projectRoot) || {}).catch(() => undefined);
    }, 200);
}

/**
 * The status a task projection write may set (task-store.js, sync-index): the
 * canonical one while the note still shows the status a turn replaced.
 */
function filterPisiSyncProjectedTaskStatus(projectFolder, taskId, incoming, canonical) {
    const projectRoot = path.resolve(String(projectFolder || ''));
    const guards = runtime.taskGuards.get(projectRoot);
    const guard = guards?.[taskId];
    if (!guard) return incoming;
    if (canonical === guard.status && (incoming === guard.stale || incoming === guard.status)) return canonical;
    delete guards[taskId];
    schedulePisiSyncTaskGuardsSave(projectRoot);
    return incoming;
}

/** Secrets resolved on first use, so a missing safeStorage only fails the sync calls. */
function lazySecrets() {
    let secrets = null;
    const get = () => (secrets ||= getPisiSyncSecrets());
    return { seal: (text) => get().seal(text), open: (text) => get().open(text) };
}

async function ensurePisiSyncEngine(context) {
    const state = await context.store.load();
    if (!state) return null;
    if (!context.engine || context.serverUrl !== state.serverUrl) {
        context.serverUrl = state.serverUrl;
        context.http = makePisiSyncHttpFor(state.serverUrl);
        context.engine = createPisiSyncEngine({
            subtle,
            http: context.http,
            store: context.store,
            files: context.files,
            isDirty: (relative) => isPisiSyncPathDirty(context.projectRoot, relative),
            random,
            uuid: () => crypto.randomUUID(),
            onApplied: (change) => notifyPisiSyncApplied(context, change)
        });
    }
    return state;
}

function notifyPisiSyncApplied(context, { changed, added, removed }) {
    const toAbsolute = (relative) => path.join(context.projectRoot, ...relative.split('/'));
    sendPisiSyncEvent('pisi:sync-applied', {
        folderPath: context.projectRoot,
        changedPaths: changed.map(toAbsolute),
        addedPaths: added.map(toAbsolute),
        removedPaths: removed.map(toAbsolute),
        authorities: [...changed, ...added, ...removed].filter((relative) => getPisiSyncFileClass(relative) === 'authority'),
        treeChanged: added.length > 0 || removed.length > 0
    });
}

// ---- Renderer handshake (SV4) ------------------------------------------------

/** Asks the renderer to write its pending saves; resolves `{ ok, dirtyPaths }`. Without a window: ok. */
function flushPisiSyncRenderer() {
    const window = getPisiSyncWindow();
    if (!window) return Promise.resolve({ ok: true, dirtyPaths: [] });
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            runtime.flushWaiters.delete(requestId);
            resolve({ ok: false, code: 'FLUSH_TIMEOUT', dirtyPaths: [] });
        }, FLUSH_TIMEOUT_MS);
        runtime.flushWaiters.set(requestId, (payload) => {
            clearTimeout(timer);
            resolve({ ok: payload?.ok !== false, dirtyPaths: Array.isArray(payload?.dirtyPaths) ? payload.dirtyPaths : [] });
        });
        window.webContents.send('pisi:sync-flush-request', { requestId });
    });
}

function setPisiSyncDirtyPaths(paths) {
    runtime.dirty = new Set((Array.isArray(paths) ? paths : []).filter((value) => typeof value === 'string' && value).map(normalizeComparePath));
}

// ---- Turns -------------------------------------------------------------------

function describePisiSyncError(error) {
    return { code: typeof error?.code === 'string' ? error.code : 'SYNC_FAILED', retryAfter: error?.retryAfter ?? null };
}

async function runPisiSyncTurnNow(reason) {
    const context = getPisiSyncContext();
    if (!context) return { ok: false, code: 'NO_PROJECT' };
    let state;
    try {
        state = await ensurePisiSyncEngine(context);
    } catch (error) {
        return finishPisiSyncTurn({ ok: false, ...describePisiSyncError(error) });
    }
    if (!state) return { ok: false, code: 'NOT_CONFIGURED' };
    if (state.stopped) return finishPisiSyncTurn({ ok: false, code: state.stopped });
    sendPisiSyncEvent('pisi:sync-status', { running: true, reason });
    const flush = await flushPisiSyncRenderer();
    if (!flush.ok) return finishPisiSyncTurn({ ok: false, code: flush.code || 'FLUSH_FAILED' });
    setPisiSyncDirtyPaths(flush.dirtyPaths);
    runtime.lastTurnAt = Date.now();
    try {
        const result = await context.engine.runTurn({ reason });
        return finishPisiSyncTurn(result);
    } catch (error) {
        const failure = describePisiSyncError(error);
        if (STOPPING_CODES.has(failure.code)) await stopPisiSync(context, failure.code);
        return finishPisiSyncTurn({ ok: false, ...failure });
    }
}

async function stopPisiSync(context, code) {
    const state = await context.store.load().catch(() => null);
    if (!state) return;
    state.stopped = code;
    await context.store.save(state);
}

function finishPisiSyncTurn(result) {
    runtime.lastResult = { ...result, at: new Date().toISOString() };
    sendPisiSyncEvent('pisi:sync-status', { running: false, result: summarizePisiSyncResult(result) });
    return summarizePisiSyncResult(result);
}

function summarizePisiSyncResult(result) {
    return {
        ok: result.ok !== false,
        code: result.code || null,
        changed: result.changed?.length || 0,
        added: result.added?.length || 0,
        removed: result.removed?.length || 0,
        pushed: result.pushed || 0,
        conflicts: result.conflicts?.length || 0,
        issues: result.issues?.length || 0,
        retryAfter: result.retryAfter ?? null
    };
}

/** Runs a turn now, or once more after the running one (triggers coalesce, §3.6). */
function requestPisiSyncClientTurn(reason = 'manual') {
    if (runtime.running) {
        runtime.queued = runtime.queued || reason;
        return runtime.running;
    }
    runtime.running = runPisiSyncTurnNow(reason).finally(() => {
        runtime.running = null;
        if (runtime.queued) {
            const next = runtime.queued;
            runtime.queued = null;
            setTimeout(() => void requestPisiSyncClientTurn(next), 0);
        }
    });
    return runtime.running;
}

async function isPisiSyncClientBound() {
    const context = getPisiSyncContext();
    return Boolean(context && (await context.store.exists()));
}

function schedulePisiSyncAfterWrite(targetPath) {
    if (runtime.applying || !globalThis.activeProjectFolder) return;
    const relative = path.relative(globalThis.activeProjectFolder, String(targetPath || ''));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    clearTimeout(runtime.writeTimer);
    runtime.writeTimer = setTimeout(async () => {
        runtime.writeTimer = null;
        if (await isPisiSyncClientBound()) void requestPisiSyncClientTurn('write');
    }, AFTER_WRITE_DELAY_MS);
}

function startPisiSyncTriggers() {
    filesystemCore.addPisiAtomicWriteListener?.(schedulePisiSyncAfterWrite);
    runtime.intervalTimer = setInterval(async () => {
        if (runtime.running || !(await isPisiSyncClientBound())) return;
        const focused = Boolean(getPisiSyncWindow()?.isFocused?.());
        if (Date.now() - runtime.lastTurnAt >= (focused ? FOCUSED_INTERVAL_MS : BACKGROUND_INTERVAL_MS)) void requestPisiSyncClientTurn('interval');
    }, 15000);
    runtime.intervalTimer.unref?.();
    app.on?.('browser-window-focus', async () => {
        if (Date.now() - runtime.lastFocusAt < FOCUS_THROTTLE_MS) return;
        runtime.lastFocusAt = Date.now();
        if (await isPisiSyncClientBound()) void requestPisiSyncClientTurn('focus');
    });
}

// ---- Status ------------------------------------------------------------------

async function getPisiSyncClientStatus() {
    const context = getPisiSyncContext();
    if (!context) return { ok: true, enabled: true, configured: false, project: false };
    let state;
    try {
        state = await context.store.load();
    } catch (error) {
        return { ok: true, enabled: true, configured: true, stopped: describePisiSyncError(error).code };
    }
    let weakSecrets = false;
    try {
        weakSecrets = getPisiSyncSecrets().weak;
    } catch {
        weakSecrets = false;
    }
    if (!state) return { ok: true, enabled: true, configured: false, project: true, weakSecrets, deviceName: getPisiSyncDeviceName() };
    return {
        ok: true,
        enabled: true,
        configured: true,
        project: true,
        serverUrl: state.serverUrl,
        spaceName: state.spaceName,
        deviceName: state.deviceName,
        role: state.role,
        lastRun: state.lastRun,
        lastResult: runtime.lastResult ? summarizePisiSyncResult(runtime.lastResult) : null,
        running: Boolean(runtime.running),
        stopped: state.stopped || null,
        conflicts: state.conflicts.length,
        unsynced: state.issues.filter((issue) => UNSYNCED_CODES.has(issue.code)).length,
        deferred: state.issues.filter((issue) => issue.code === 'DEFERRED_DIRTY').length,
        weakSecrets
    };
}

async function requireBoundPisiSync() {
    const context = getPisiSyncContext();
    if (!context) throw Object.assign(new Error('Açık proje yok.'), { code: 'NO_PROJECT' });
    const state = await ensurePisiSyncEngine(context);
    if (!state) throw Object.assign(new Error('Proje senkrona bağlı değil.'), { code: 'NOT_CONFIGURED' });
    const secrets = await context.store.readSecrets();
    context.http.setToken(secrets.token);
    const keys = await openPisiSyncSpaceKeys(subtle, secrets.key, state.spaceId);
    return { context, state, secrets, keys };
}

// ---- Space, joining, pairing --------------------------------------------------

function requireServerUrl(value) {
    const serverUrl = normalizePisiSyncServerUrl(value);
    if (!serverUrl) throw Object.assign(new Error('Sunucu adresi https:// ile başlamalı.'), { code: 'BAD_SERVER_URL' });
    return serverUrl;
}

async function bindPisiSyncProject(context, { serverUrl, spaceId, deviceId, token, key, role, spaceName, deviceName }) {
    await context.store.writeSecrets({ token, key });
    await context.store.save(makePisiSyncState({ projectPath: context.projectRoot, serverUrl, spaceId, deviceId, role, spaceName, deviceName }));
    context.engine = null;
}

async function createPisiSyncSpaceForProject(payload = {}) {
    const context = getPisiSyncContext();
    if (!context) throw Object.assign(new Error('Açık proje yok.'), { code: 'NO_PROJECT' });
    if (await context.store.exists()) throw Object.assign(new Error('Proje zaten bağlı.'), { code: 'ALREADY_CONFIGURED' });
    getPisiSyncSecrets();
    const serverUrl = requireServerUrl(payload.serverUrl);
    const http = makePisiSyncHttpFor(serverUrl);
    await http.get('/v1/info');
    const deviceName = String(payload.deviceName || getPisiSyncDeviceName()).trim() || getPisiSyncDeviceName();
    const spaceName = path.basename(context.projectRoot);
    const created = await createPisiSyncSpace({ subtle, http, setupKey: payload.setupKey, spaceName, deviceName, platform: getPisiSyncPlatform(), random });
    await bindPisiSyncProject(context, { serverUrl, ...created, spaceName, deviceName });
    void requestPisiSyncClientTurn('setup');
    return { ok: true, spaceName };
}

/** A project another desktop can join: no notes, maps or user files and no tasks or relationships (S3 step 8). */
async function isPisiSyncProjectEmpty(context) {
    for (const file of await context.files.list()) {
        const fileClass = getPisiSyncFileClass(file.path);
        if (fileClass === 'marker') continue;
        if (fileClass === 'authority' || fileClass === 'json') {
            const bytes = await context.files.read(file.path);
            let value = null;
            try {
                value = JSON.parse(Buffer.from(bytes || []).toString('utf8'));
            } catch {
                return false;
            }
            const records = ['tasks', 'relationships', 'definitions', 'views', 'templates'].flatMap((key) => (Array.isArray(value?.[key]) ? value[key] : []));
            if (records.length) return false;
            continue;
        }
        return false;
    }
    return true;
}

async function joinPisiSyncSpace(payload = {}) {
    const context = getPisiSyncContext();
    if (!context) throw Object.assign(new Error('Açık proje yok.'), { code: 'NO_PROJECT' });
    if (await context.store.exists()) throw Object.assign(new Error('Proje zaten bağlı.'), { code: 'ALREADY_CONFIGURED' });
    if (!(await isPisiSyncProjectEmpty(context))) throw Object.assign(new Error('Klasör boş değil.'), { code: 'SYNC_FOLDER_NOT_EMPTY' });
    getPisiSyncSecrets();
    const serverUrl = requireServerUrl(payload.serverUrl);
    const http = makePisiSyncHttpFor(serverUrl);
    const deviceName = String(payload.deviceName || getPisiSyncDeviceName()).trim() || getPisiSyncDeviceName();
    const claimed = await claimPisiSyncPairingWithCode({ subtle, http, code: payload.code, deviceName, platform: getPisiSyncPlatform(), random });
    const joinId = crypto.randomUUID();
    runtime.joins.set(joinId, { ...claimed.session, http, serverUrl, deviceName, projectRoot: context.projectRoot });
    return { ok: true, joinId, sas: claimed.view.sas, expiresAt: claimed.view.expiresAt };
}

async function pollPisiSyncJoin(payload = {}) {
    const join = runtime.joins.get(String(payload.joinId || ''));
    if (!join) throw Object.assign(new Error('Katılım bulunamadı.'), { code: 'PAIRING_NOT_FOUND' });
    let result;
    try {
        result = await pollPisiSyncJoinResult({ http: join.http, subtle, session: join });
    } catch (error) {
        runtime.joins.delete(String(payload.joinId));
        throw error;
    }
    if (result.state !== 'granted') return { ok: true, state: result.state };
    runtime.joins.delete(String(payload.joinId));
    const context = getPisiSyncContext();
    if (!context || context.projectRoot !== join.projectRoot) throw Object.assign(new Error('Proje değişti.'), { code: 'NO_PROJECT' });
    await bindPisiSyncProject(context, { serverUrl: join.serverUrl, ...result, deviceName: join.deviceName });
    void requestPisiSyncClientTurn('setup');
    return { ok: true, state: 'granted', spaceName: result.spaceName };
}

async function startPisiSyncPairingForProject() {
    const { context, state } = await requireBoundPisiSync();
    if (state.role !== 'admin') throw Object.assign(new Error('Bu cihaz eşleştirme başlatamaz.'), { code: 'FORBIDDEN_ROLE' });
    const started = await startPisiSyncPairing({ subtle, http: context.http, serverUrl: state.serverUrl, spaceId: state.spaceId, random });
    runtime.pairings.set(started.session.pairingId, started.session);
    return { ok: true, ...started.view };
}

function requirePisiSyncPairing(payload) {
    const session = runtime.pairings.get(String(payload?.pairingId || ''));
    if (!session) throw Object.assign(new Error('Eşleştirme bulunamadı.'), { code: 'PAIRING_NOT_FOUND' });
    return session;
}

async function pollPisiSyncPairingForProject(payload) {
    const session = requirePisiSyncPairing(payload);
    const { context } = await requireBoundPisiSync();
    const view = await pollPisiSyncPairing({ subtle, http: context.http, session });
    // A QR claim whose proof does not check out is never shown for approval (§6.6).
    if (view.state === 'claimed' && view.valid === false) {
        await rejectPisiSyncPairing({ http: context.http, session }).catch(() => undefined);
        runtime.pairings.delete(session.pairingId);
        return { ok: true, state: 'rejected', invalid: true };
    }
    if (!['open', 'claimed'].includes(view.state)) runtime.pairings.delete(session.pairingId);
    return { ok: true, ...view };
}

async function confirmPisiSyncPairingForProject(payload) {
    const session = requirePisiSyncPairing(payload);
    const { context, state, secrets, keys } = await requireBoundPisiSync();
    runtime.pairings.delete(session.pairingId);
    if (payload.accept !== true) return { ok: true, ...(await rejectPisiSyncPairing({ http: context.http, session })) };
    const granted = await grantPisiSyncPairing({ subtle, http: context.http, session, keys, projectKey: secrets.key, spaceName: state.spaceName, random });
    return { ok: true, ...granted };
}

async function cancelPisiSyncPairingForProject(payload) {
    const session = runtime.pairings.get(String(payload?.pairingId || ''));
    if (!session) return { ok: true, state: 'cancelled' };
    runtime.pairings.delete(session.pairingId);
    const { context } = await requireBoundPisiSync();
    await cancelPisiSyncPairing({ http: context.http, session }).catch(() => undefined);
    return { ok: true, state: 'cancelled' };
}

async function listPisiSyncDevicesForProject() {
    const { context, state, keys } = await requireBoundPisiSync();
    if (state.role !== 'admin') return { ok: true, devices: [] };
    return { ok: true, devices: await listPisiSyncDevices({ subtle, http: context.http, keys, selfDeviceId: state.deviceId }) };
}

async function revokePisiSyncDevice(payload = {}) {
    const { context, state } = await requireBoundPisiSync();
    const deviceId = String(payload.deviceId || '');
    if (!deviceId || deviceId === state.deviceId) throw Object.assign(new Error('Bu cihaz buradan iptal edilemez.'), { code: 'INVALID_FIELD' });
    await context.http.request('DELETE', `/v1/spaces/${state.spaceId}/devices/${deviceId}`);
    return { ok: true };
}

async function disconnectPisiSync() {
    const context = getPisiSyncContext();
    if (!context) return { ok: true };
    let left = false;
    try {
        const { state } = await requireBoundPisiSync();
        if (!state.stopped) {
            await context.http.request('DELETE', `/v1/spaces/${state.spaceId}/devices/me`);
            left = true;
        }
    } catch (error) {
        // LAST_ADMIN, an unreachable server or a revoked device: forget the binding here anyway.
        left = error?.code === 'DEVICE_REVOKED';
    }
    await context.store.destroy();
    context.engine = null;
    return { ok: true, left };
}

/**
 * The renderer found that a note it was editing was changed by a turn in the
 * moment between its last save and the write (a same-block conflict): the disk
 * version (the remote one) is kept as a conflict copy before the editor saves
 * its own text over it (SV3). The next turn sends the copy.
 */
async function keepPisiSyncDiskCopy(payload = {}) {
    const context = getPisiSyncContext();
    if (!context) throw Object.assign(new Error('Açık proje yok.'), { code: 'NO_PROJECT' });
    const relative = path
        .relative(context.projectRoot, path.resolve(String(payload.filePath || '')))
        .split(path.sep)
        .join('/');
    if (!relative || relative.startsWith('..') || getPisiSyncFileClass(relative) !== 'node')
        throw Object.assign(new Error('Geçersiz not.'), { code: 'PATH_UNSAFE' });
    const bytes = await context.files.read(relative);
    let document = null;
    try {
        document = JSON.parse(Buffer.from(bytes || []).toString('utf8'));
    } catch {
        document = null;
    }
    if (!document) throw Object.assign(new Error('Not okunamadı.'), { code: 'LOCAL_CORRUPT' });
    const taken = new Set((await context.files.list()).map((file) => getPisiSyncPathKey(file.path)));
    const state = await context.store.load();
    const copy = makePisiSyncConflictCopy({
        path: relative,
        document,
        deviceName: state?.deviceName || getPisiSyncDeviceName(),
        now: new Date(),
        makeUuid: () => crypto.randomUUID(),
        isTaken: (candidate) => taken.has(getPisiSyncPathKey(candidate))
    });
    const ops = [{ op: 'write', path: copy.path, bytes: Buffer.from(JSON.stringify(copy.document, null, 2), 'utf8') }];
    for (const asset of copy.assets) {
        const assetBytes = await context.files.read(asset.from);
        if (assetBytes) ops.push({ op: 'write', path: asset.to, bytes: assetBytes });
    }
    await context.files.apply(ops);
    if (state) {
        state.conflicts.push({ at: new Date().toISOString(), path: relative, kind: 'copy', copyPath: copy.path, reason: 'editing' });
        await context.store.save(state);
    }
    notifyPisiSyncApplied(context, { changed: [], added: ops.map((op) => op.path), removed: [] });
    return { ok: true, copyPath: path.join(context.projectRoot, ...copy.path.split('/')) };
}

async function listPisiSyncConflicts() {
    const context = getPisiSyncContext();
    const state = context ? await context.store.load().catch(() => null) : null;
    return { ok: true, conflicts: state ? [...state.conflicts].reverse() : [] };
}

async function listPisiSyncUnsynced() {
    const context = getPisiSyncContext();
    const state = context ? await context.store.load().catch(() => null) : null;
    return { ok: true, files: state ? state.issues.filter((issue) => UNSYNCED_CODES.has(issue.code) || issue.code === 'DEFERRED_DIRTY') : [] };
}

// ---- Contracts and IPC --------------------------------------------------------

function wrapPisiSyncOperation(operation) {
    return async (payload) => {
        try {
            return await operation(payload || {});
        } catch (error) {
            return { ok: false, ...describePisiSyncError(error), error: error?.message || String(error) };
        }
    };
}

function installPisiSyncClientContracts() {
    const queries = {
        'sync.status.v1': getPisiSyncClientStatus,
        'sync.conflicts.list.v1': listPisiSyncConflicts,
        'sync.unsynced.list.v1': listPisiSyncUnsynced,
        'sync.devices.list.v1': listPisiSyncDevicesForProject
    };
    const commands = {
        'sync.space.create.v1': createPisiSyncSpaceForProject,
        'sync.space.join.v1': joinPisiSyncSpace,
        'sync.space.join-status.v1': pollPisiSyncJoin,
        'sync.pairing.start.v1': startPisiSyncPairingForProject,
        'sync.pairing.status.v1': pollPisiSyncPairingForProject,
        'sync.pairing.confirm.v1': confirmPisiSyncPairingForProject,
        'sync.pairing.cancel.v1': cancelPisiSyncPairingForProject,
        'sync.device.revoke.v1': revokePisiSyncDevice,
        'sync.note.keep-disk-copy.v1': keepPisiSyncDiskCopy,
        'sync.run.v1': async (payload) => {
            if (!(await isPisiSyncClientBound())) return { ok: false, code: 'NOT_CONFIGURED' };
            return requestPisiSyncClientTurn(String(payload.reason || 'manual'));
        },
        'sync.disconnect.v1': disconnectPisiSync
    };
    for (const [name, handler] of Object.entries(queries)) domain.registerPisiDomainQuery(name, wrapPisiSyncOperation(handler));
    for (const [name, handler] of Object.entries(commands)) domain.registerPisiDomainCommand(name, wrapPisiSyncOperation(handler));
}

function bindPisiSyncClientIpc() {
    ipcMain.removeAllListeners?.('pisi:sync-flush-response');
    ipcMain.on('pisi:sync-flush-response', (_event, payload = {}) => {
        const waiter = runtime.flushWaiters.get(String(payload?.requestId || ''));
        if (!waiter) return;
        runtime.flushWaiters.delete(String(payload.requestId));
        waiter(payload);
    });
    ipcMain.removeAllListeners?.('pisi:sync-dirty');
    ipcMain.on('pisi:sync-dirty', (_event, payload = {}) => setPisiSyncDirtyPaths(payload?.paths));
}

installPisiSyncClientContracts();
bindPisiSyncClientIpc();
startPisiSyncTriggers();

const moduleApi = {
    filterPisiSyncProjectedTaskStatus,
    getPisiSyncClientStatus,
    requestPisiSyncClientTurn,
    isPisiSyncClientBound
};

registerMainModule('main.syncClient', moduleApi);
