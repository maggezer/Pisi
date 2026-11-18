// The sync turn of a Pisi device (docs/sync-plan.md §3.6, docs/sync-protocol.md
// §5–§7). Pull → scan → decide (sync-reconcile.mjs) → apply → push, with
// STALE_BASE retried at most three times. The desktop (main/functions/sync-client-*.js)
// and the phone (mobile/src/sync/) run this same engine; platform I/O comes in as adapters:
//
//   http   createPisiSyncHttp(…) (sync-http.mjs)  the server
//   store  { load, save, readSecrets, readBase, writeBase, removeBase }
//          device state outside the project (SV2)
//   files  { list() → [{ path, size, mtimeMs }], read(path), apply(writes, { isDirty }) → { skipped } }
//          project files by project-relative '/' paths; `apply` writes a turn at once (SV11)
//   isDirty(path)                            open document with unsaved edits (SV4)
//   lazy(path)                               files this device does not hold until they are
//                                            opened (the phone's attachments, S6): not scanned,
//                                            not downloaded; their remote heads wait in `state.remoteOnly`
//   gzip, gunzip                             (bytes) → bytes, CompressionStream('gzip') on both platforms
//
// The engine never writes a file whose remote change failed verification (SV9),
// never sends or overwrites a corrupt local JSON file (SV10) and only advances
// the cursor after the turn's remote changes were applied or set aside. A change
// that failed verification is kept in `state.unapplied` and tried again with a
// full compare; `rejoin()` starts over after SERVER_ROLLBACK (sync-recovery.mjs).

import { computePisiSyncFid, openPisiSyncEnvelope, openPisiSyncSpaceKeys, sha256Hex, getPisiSyncSealedSize } from './sync-crypto.mjs';
import { readPisiSyncChangeMeta, verifyPisiSyncBlobContent } from './sync-meta.mjs';
import { checkPisiSyncPath, getPisiSyncFileClass, getPisiSyncPathKey, isPisiSyncMergeableClass } from './sync-paths.mjs';
import { checkPisiSyncRemoteOrder, reconcilePisiSyncTurn } from './sync-reconcile.mjs';
import { parsePisiSyncJsonBytes, preparePisiSyncActions } from './sync-actions.mjs';
import { createPisiSyncPusher, PisiSyncCancelledError } from './sync-engine-push.mjs';
import {
    isPisiSyncRollbackInHeads,
    markPisiSyncKnownReplays,
    preparePisiSyncRejoin,
    settlePisiSyncRejoin,
    shouldMakePisiSyncFullCheck,
    shouldRetryPisiSyncUnapplied,
    updatePisiSyncUnapplied
} from './sync-recovery.mjs';
import {
    getPisiSyncActionDownloadSize,
    getPisiSyncLocalDate,
    isPisiSyncFetchingAction,
    isPisiSyncFirstPriorityPath,
    splitPisiSyncApplyBatches
} from './sync-initial.mjs';

export { PisiSyncCancelledError } from './sync-engine-push.mjs';

export const PISI_SYNC_MAX_STALE_ROUNDS = 3;
const DEFAULT_LIMITS = Object.freeze({
    maxBlobBytes: 64 * 1024 * 1024,
    partBytes: 4 * 1024 * 1024,
    maxCommitChanges: 200,
    maxChangesPage: 1000,
    maxHeadsPage: 1000,
    maxCheckBlobs: 500
});
// A file modified this close to the scan is hashed again even when size and mtime look the same.
const RACY_MTIME_MS = 2000;
const UNVERIFIABLE = new Set(['DECRYPT_FAILED', 'HASH_MISMATCH_LOCAL', 'META_INVALID', 'PATH_UNSAFE', 'PROTOCOL_UNSUPPORTED', 'SERVER_REPLAY']);

/** The entry `state.remoteOnly` keeps for a lazy file: what a later download or a reuse of its blob needs. */
function remoteOnlyEntry(change) {
    return { path: change.meta.path, seq: change.seq, blob: change.blob, size: change.size, sha256: change.meta.sha256, plainSize: change.meta.size };
}

/**
 * Creates the engine of one bound project. `random(n)` gives n random bytes,
 * `uuid()` a v4 uuid, `now()` a Date. `onApplied({ changed, added, removed })`
 * is called after a turn wrote files, once per written batch.
 * `onProgress({ phase, files, bytes, reason })` tells how far a turn's
 * downloads (`phase: 'download'`) and uploads (`'upload'`) are; `files` and
 * `bytes` are `{ done, total }`.
 * `applyBatch` (the phone) writes a turn's downloads in batches of at most
 * `{ files, bytes }`, the first download of a project starting with the
 * files of `isPisiSyncFirstPriorityPath` (S6 step 2); the cursor still moves
 * only once the whole turn is written (SV11). Without it (the desktop) a turn
 * is written in one `files.apply` call, one atomic mutation.
 */
export function createPisiSyncEngine({
    subtle,
    http,
    store,
    files,
    isDirty = (_path) => false,
    lazy = null,
    random,
    uuid,
    now = () => new Date(),
    gzip,
    gunzip,
    onApplied = null,
    onProgress = null,
    applyBatch = null
}) {
    const isLazy = (path) => Boolean(lazy && path && lazy(path));
    const limitsOf = (state) => state.limits || DEFAULT_LIMITS;
    const pusher = createPisiSyncPusher({ subtle, http, store, files, random, now, gzip, isLazy, limitsOf });
    let running = null;
    let cancelled = false;

    async function pageChanges(spaceId, after, limit) {
        const rows = [];
        let cursor = after;
        let head = after;
        for (;;) {
            const { data } = await http.get(`/v1/spaces/${spaceId}/changes?after=${cursor}&limit=${limit}`);
            rows.push(...data.changes);
            head = data.head;
            if (data.changes.length) cursor = data.changes.at(-1).seq;
            if (!data.more || !data.changes.length) break;
        }
        return { rows, head: Math.max(head, cursor) };
    }

    async function pageHeads(spaceId, limit) {
        const rows = [];
        let after = '';
        let asOfSeq = null;
        for (;;) {
            const { data } = await http.get(`/v1/spaces/${spaceId}/heads?limit=${limit}${after ? `&after=${after}` : ''}`);
            if (asOfSeq === null) asOfSeq = data.asOfSeq;
            rows.push(...data.heads);
            if (!data.next) break;
            after = data.next;
        }
        return { rows, asOfSeq: asOfSeq ?? 0 };
    }

    async function openRows(rows, keys) {
        const opened = [];
        for (const row of rows) {
            const result = await readPisiSyncChangeMeta({ subtle, keys, change: row });
            opened.push(result.ok ? { ...row, meta: result.meta, raw: row } : { ...row, meta: null, invalid: result.code, raw: row });
        }
        return opened;
    }

    /** The largest dseq of every device among heads: a later change of that device must be above it (§7.4). */
    function headDseqs(heads, lastDseq) {
        const seen = { ...lastDseq };
        for (const row of heads) {
            const dseq = row.meta?.dseq;
            if (row.invalid || !Number.isSafeInteger(dseq) || row.meta.dev !== row.device) continue;
            if (dseq > (seen[row.device] ?? 0)) seen[row.device] = dseq;
        }
        return seen;
    }

    /**
     * Pull: the changes after the cursor (§6.3). A device that has applied
     * nothing yet (cursor 0) and one whose cursor was pruned (CURSOR_EXPIRED)
     * take every head instead, then the changes after the heads' `asOfSeq`.
     */
    async function pull(state, keys, { full: wantFull = false } = {}) {
        const limits = limitsOf(state);
        const { data: headData } = await http.get(`/v1/spaces/${state.spaceId}/head`);
        // Below the cursor, or below a seq the server gave this device's own commit (§7.4).
        const known = Math.max(state.cursor, Number.isSafeInteger(state.knownSeq) ? state.knownSeq : 0);
        if (headData.head < known) return { ok: false, code: 'SERVER_ROLLBACK' };
        if (headData.head === state.cursor && !wantFull) return { ok: true, remote: [], cursor: state.cursor, lastDseq: state.lastDseq, full: false };
        let full = null;
        let later = null;
        if (state.cursor === 0 || wantFull) full = await pageHeads(state.spaceId, limits.maxHeadsPage);
        else {
            try {
                later = await pageChanges(state.spaceId, state.cursor, limits.maxChangesPage);
            } catch (error) {
                if (error?.code !== 'CURSOR_EXPIRED') throw error;
                full = await pageHeads(state.spaceId, limits.maxHeadsPage);
            }
        }
        let heads = [];
        let lastDseq = state.lastDseq;
        if (full) {
            // A head below what this device synced: the server went back further than the cursor shows (§7.4).
            if (isPisiSyncRollbackInHeads({ index: state.index, heads: full.rows })) return { ok: false, code: 'SERVER_ROLLBACK' };
            heads = await openRows(full.rows, keys);
            const headCheck = checkPisiSyncRemoteOrder({ cursor: state.cursor, head: full.asOfSeq, changes: heads, heads: true });
            if (!headCheck.ok) return { ok: false, code: headCheck.code };
            lastDseq = headDseqs(heads, lastDseq);
            later = await pageChanges(state.spaceId, full.asOfSeq, limits.maxChangesPage);
        }
        const changes = await openRows(later.rows, keys);
        const order = checkPisiSyncRemoteOrder({ cursor: full ? full.asOfSeq : state.cursor, head: later.head, changes, lastDseq });
        if (!order.ok) return { ok: false, code: order.code };
        const rejected = new Set(order.rejected.map((entry) => entry.seq));
        const remote = changes.map((change) => (rejected.has(change.seq) ? { ...change, invalid: 'SERVER_REPLAY' } : change));
        remote.unshift(...heads);
        // A full compare does not check dseq: replays refused before stay refused.
        return {
            ok: true,
            remote: full ? markPisiSyncKnownReplays(remote, state.unapplied) : remote,
            cursor: later.head,
            lastDseq: order.lastDseq,
            full: Boolean(full)
        };
    }

    /** Scan of the project with the hash cache of the state. */
    async function scan(state, keys) {
        const limits = limitsOf(state);
        const listed = await files.list();
        const cache = {};
        const entries = [];
        const scanAt = now().getTime();
        for (const file of listed) {
            const checked = checkPisiSyncPath(file.path);
            if (!checked.ok) {
                if (checked.reason !== 'excluded') entries.push({ path: file.path, fid: null });
                continue;
            }
            const path = checked.path;
            if (isLazy(path)) continue;
            const fileClass = getPisiSyncFileClass(path);
            const tooLarge = getPisiSyncSealedSize(file.size) > limits.maxBlobBytes;
            let cached = state.hashCache?.[path];
            const fresh = cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs && scanAt - file.mtimeMs > RACY_MTIME_MS;
            if (!fresh && !tooLarge) {
                const bytes = await files.read(path);
                if (!bytes) continue;
                const mergeable = isPisiSyncMergeableClass(fileClass);
                const parsed = mergeable ? parsePisiSyncJsonBytes(bytes) : null;
                cached = {
                    size: file.size,
                    mtimeMs: file.mtimeMs,
                    sha256: await sha256Hex(subtle, bytes),
                    fid: cached?.fid || (await computePisiSyncFid(subtle, keys.fid, path)),
                    docId: parsed ? (typeof parsed.pisi?.id === 'string' && (fileClass === 'node' || fileClass === 'map') ? parsed.pisi.id : null) : null,
                    corrupt: mergeable && !parsed
                };
            } else if (!cached) {
                cached = {
                    size: file.size,
                    mtimeMs: file.mtimeMs,
                    sha256: null,
                    fid: await computePisiSyncFid(subtle, keys.fid, path),
                    docId: null,
                    corrupt: false
                };
            }
            cache[path] = cached;
            entries.push({
                path,
                fid: cached.fid,
                sha256: cached.sha256,
                size: file.size,
                docId: cached.docId,
                corrupt: cached.corrupt,
                tooLarge,
                dirty: isDirty(path)
            });
        }
        return { entries, cache };
    }

    async function downloadBlob(spaceId, blob) {
        const { bytes } = await http.request('GET', `/v1/spaces/${spaceId}/blobs/${blob}`, { expect: 'bytes', timeoutMs: 120000 });
        return bytes;
    }

    /** Opens a blob and checks it against its id, the metadata and an attachment's digest (§4.3). */
    async function fetchPlain(state, keys, change) {
        let sealed;
        try {
            sealed = await downloadBlob(state.spaceId, change.blob);
        } catch (error) {
            if (error?.code === 'BLOB_NOT_FOUND') throw Object.assign(new Error('blob yok'), { code: 'BLOB_NOT_FOUND' });
            throw error;
        }
        let plain;
        try {
            plain = await openPisiSyncEnvelope({
                subtle,
                key: keys.content,
                spaceId: state.spaceId,
                purpose: 'blob',
                binding: change.blob,
                envelope: sealed,
                gunzip
            });
        } catch {
            throw Object.assign(new Error('çözülemedi'), { code: 'DECRYPT_FAILED' });
        }
        const verified = await verifyPisiSyncBlobContent({ subtle, keys, blob: change.blob, bytes: plain, meta: change.meta });
        if (!verified.ok) throw Object.assign(new Error('özet tutmuyor'), { code: verified.code });
        return plain;
    }

    function combineRemote(pending, pulled) {
        const byFid = new Map();
        for (const row of [...pending, ...pulled]) {
            const previous = byFid.get(row.fid);
            if (!previous || row.seq > previous.seq) byFid.set(row.fid, row);
        }
        return [...byFid.values()].sort((left, right) => left.seq - right.seq);
    }

    /** The progress of a turn, told to `onProgress` and to the caller's `runTurn({ onProgress })`. */
    function makeProgress(reason, listener) {
        const phases = {
            download: { files: { done: 0, total: 0 }, bytes: { done: 0, total: 0 } },
            upload: { files: { done: 0, total: 0 }, bytes: { done: 0, total: 0 } }
        };
        const tell = (phase) => {
            const value = { phase, reason, files: { ...phases[phase].files }, bytes: { ...phases[phase].bytes } };
            for (const target of [onProgress, listener]) {
                try {
                    target?.(value);
                } catch {
                    // A listener's error must not stop the turn.
                }
            }
        };
        return {
            plan(phase, files, bytes) {
                phases[phase] = { files: { done: 0, total: files }, bytes: { done: 0, total: bytes } };
                if (files) tell(phase);
            },
            step(phase, bytes) {
                const current = phases[phase];
                current.files.done = Math.min(current.files.total, current.files.done + 1);
                current.bytes.done = Math.min(current.bytes.total, current.bytes.done + (bytes || 0));
                tell(phase);
            }
        };
    }

    async function turn(options = {}) {
        const state = await store.load();
        if (!state) return { ok: false, code: 'NOT_CONFIGURED' };
        if (state.stopped) return { ok: false, code: state.stopped };
        const secrets = await store.readSecrets();
        http.setToken(secrets.token);
        const keys = await openPisiSyncSpaceKeys(subtle, secrets.key, state.spaceId);
        if (!state.limits) state.limits = { ...DEFAULT_LIMITS, ...((await http.get('/v1/info')).data?.limits || {}) };

        const summary = { ok: true, code: null, changed: [], added: [], removed: [], pushed: 0, issues: [], conflicts: [], rounds: 0 };
        const checkpoint = () => {
            if (cancelled || options.signal?.aborted) throw new PisiSyncCancelledError();
        };
        const progress = makeProgress(options.reason || 'manual', options.onProgress);
        // Unapplied changes (SV9) are looked for again in every head, now and then.
        let retryUnapplied = shouldRetryPisiSyncUnapplied({ unapplied: state.unapplied, triedAt: state.unappliedTriedAt, now: now(), reason: options.reason });
        // …and every head is compared with the index at least once a day (sync-recovery.mjs).
        let fullCheck = shouldMakePisiSyncFullCheck({ cursor: state.cursor, checkedAt: state.fullCheckAt, now: now() });
        try {
            const resent = await pusher.sendPendingCommit(state);
            if (!resent.ok && !resent.stale) return { ...summary, ok: false, code: resent.code };

            for (let round = 0; round < PISI_SYNC_MAX_STALE_ROUNDS; round += 1) {
                summary.rounds = round + 1;
                checkpoint();
                const firstDownload = state.cursor === 0 && !Object.keys(state.index).length;
                const pulled = await pull(state, keys, { full: retryUnapplied || fullCheck });
                if (!pulled.ok) {
                    state.stopped = pulled.code;
                    await store.save(state);
                    return { ...summary, ok: false, code: pulled.code };
                }
                if (retryUnapplied) {
                    state.unappliedTriedAt = now().toISOString();
                    retryUnapplied = false;
                }
                if (pulled.full) {
                    state.fullCheckAt = now().toISOString();
                    fullCheck = false;
                }
                // "Sunucuyla yeniden eşleş": what the device synced before is settled against the heads (sync-recovery.mjs).
                if (state.rejoin && pulled.full) {
                    const settled = settlePisiSyncRejoin({ rejoin: state.rejoin, deviceId: state.deviceId, remote: pulled.remote });
                    for (const fid of settled.dropBases) await store.removeBase(fid);
                    state.index = settled.index;
                    delete state.rejoin;
                }
                const pending = await openRows(state.pendingRemote || [], keys);
                const combined = combineRemote(pending, pulled.remote);
                // Lazy files (the phone's attachments) are not downloaded here: their latest head is kept for later.
                const remote = [];
                const lazyRemoved = [];
                for (const row of combined) {
                    if (!row.invalid && row.meta && isLazy(row.meta.path)) {
                        state.remoteOnly = state.remoteOnly || {};
                        if (row.op === 'put') state.remoteOnly[row.fid] = remoteOnlyEntry(row);
                        else {
                            delete state.remoteOnly[row.fid];
                            lazyRemoved.push(row.meta.path);
                        }
                        continue;
                    }
                    remote.push(row);
                }
                // A deleted attachment the phone had downloaded goes too.
                for (const path of lazyRemoved) if (files.removeLazy && (await files.removeLazy(path))) summary.removed.push(path);

                const remoteByFid = new Map(remote.map((row) => [row.fid, row]));
                const scanned = await scan(state, keys);
                const { actions } = reconcilePisiSyncTurn({ role: state.role, index: state.index, local: scanned.entries, remote });

                const localPaths = new Map(scanned.entries.map((entry) => [getPisiSyncPathKey(entry.path), entry.path]));
                const fetching = actions.filter(isPisiSyncFetchingAction);
                progress.plan(
                    'download',
                    fetching.length,
                    fetching.reduce((total, action) => total + getPisiSyncActionDownloadSize(action), 0)
                );
                const today = getPisiSyncLocalDate(now());
                const batches = applyBatch
                    ? splitPisiSyncApplyBatches(actions, { ...applyBatch, priority: firstDownload ? (path) => isPisiSyncFirstPriorityPath(path, today) : null })
                    : [actions];
                const takenKeys = new Set(localPaths.keys());
                const deferred = [];
                const pushes = [];
                const roundIssues = [];
                for (const batch of batches) {
                    checkpoint();
                    const plainCache = new Map();
                    const prepared = await preparePisiSyncActions(batch, {
                        state,
                        store,
                        deviceName: state.deviceName,
                        now,
                        uuid,
                        takenKeys,
                        remoteRow: (fid) => remoteByFid.get(fid)?.raw || null,
                        remoteBytes: async (change) => {
                            if (!plainCache.has(change.blob)) {
                                checkpoint();
                                const plain = await fetchPlain(state, keys, change);
                                plainCache.set(change.blob, plain);
                                progress.step('download', plain.length);
                            }
                            return plainCache.get(change.blob);
                        },
                        localBytes: (path) => files.read(path),
                        localExists: async (path) => localPaths.has(getPisiSyncPathKey(path)),
                        baseBytes: (fid) => store.readBase(fid),
                        knownBlob: (path) => {
                            const wanted = getPisiSyncPathKey(path);
                            return Object.values(state.remoteOnly || {}).find((entry) => getPisiSyncPathKey(entry.path) === wanted) || null;
                        }
                    });
                    // A batch cancelled while it was prepared is not written.
                    checkpoint();

                    // Units are written together; a unit with a file that became dirty meanwhile is dropped (SV4).
                    const writes = prepared.units.flatMap((unit) => unit.writes);
                    let skipped = new Set();
                    if (writes.length) {
                        const applied = await files.apply(writes, { isDirty });
                        skipped = new Set((applied?.skipped || []).map((path) => getPisiSyncPathKey(path)));
                    }
                    const batchChanged = { changed: [], added: [], removed: [] };
                    deferred.push(...prepared.deferred);
                    for (const unit of prepared.units) {
                        if (unit.writes.some((write) => skipped.has(getPisiSyncPathKey(write.path)))) {
                            if (unit.row) deferred.push(unit.row.raw || unit.row);
                            summary.issues.push(...unit.writes.map((write) => ({ path: write.path, code: 'DEFERRED_DIRTY' })));
                            continue;
                        }
                        if (unit.commit) await unit.commit();
                        pushes.push(...unit.pushes);
                        for (const write of unit.writes) {
                            const list = write.op === 'remove' ? 'removed' : write.added ? 'added' : 'changed';
                            summary[list].push(write.path);
                            batchChanged[list].push(write.path);
                            // A later batch sees what this one wrote.
                            if (write.op === 'remove') localPaths.delete(getPisiSyncPathKey(write.path));
                            else localPaths.set(getPisiSyncPathKey(write.path), write.path);
                        }
                    }
                    summary.issues.push(...prepared.issues);
                    roundIssues.push(...prepared.issues);
                    summary.conflicts.push(...prepared.conflicts);
                    state.conflicts.push(...prepared.conflicts);
                    // What a batch wrote is in the index before the next one, so an interrupted turn does not fetch it again.
                    if (batches.length > 1) await store.save(state);
                    if (writes.length && onApplied && (batchChanged.changed.length || batchChanged.added.length || batchChanged.removed.length)) {
                        onApplied(batchChanged);
                    }
                }
                state.hashCache = scanned.cache;
                state.pendingRemote = deferred.filter((row) => row && !UNVERIFIABLE.has(row.invalid)).map((row) => row.raw || row);
                const hadUnapplied = Object.keys(state.unapplied || {}).length > 0;
                state.unapplied = updatePisiSyncUnapplied({
                    previous: state.unapplied,
                    full: pulled.full,
                    remote,
                    issues: roundIssues,
                    at: now().toISOString()
                });
                // The first automatic retry waits its interval too.
                if (!hadUnapplied && Object.keys(state.unapplied).length) state.unappliedTriedAt = now().toISOString();
                state.cursor = pulled.cursor;
                state.lastDseq = pulled.lastDseq;
                await store.save(state);

                // Written files changed on disk: their pushes read the bytes the plan wrote.
                const sizes = new Map(scanned.entries.map((entry) => [entry.path, entry.size]));
                const puts = pushes.filter((item) => item.op === 'put' && !item.reuse);
                progress.plan(
                    'upload',
                    puts.length,
                    puts.reduce((total, item) => total + (item.bytes?.length ?? sizes.get(item.path) ?? 0), 0)
                );
                const result = await pusher.push(state, keys, pushes, { checkpoint, progress: (_item, bytes) => progress.step('upload', bytes) });
                summary.pushed += result.pushed || 0;
                if (result.stale) continue;
                if (!result.ok) return { ...summary, ok: false, code: result.code };
                break;
            }
        } catch (error) {
            if (error?.code !== 'CANCELLED') throw error;
            state.issues = summary.issues;
            await store.save(state);
            return { ...summary, ok: false, code: 'CANCELLED' };
        }
        state.issues = summary.issues;
        state.lastRun = { at: now().toISOString(), ok: true, reason: options.reason || 'manual' };
        await store.save(state);
        return summary;
    }

    /**
     * Downloads a lazy file the device holds only as a remote head (an
     * attachment opened on the phone, S6 step 4), checks it against its blob id
     * and its name's digest (SV9) and writes it with `files.writeLazy(path, bytes)`.
     * Resolves `{ ok, code }`: NOT_CONFIGURED, NOT_FOUND (no such head), OFFLINE,
     * DECRYPT_FAILED, HASH_MISMATCH_LOCAL, BLOB_NOT_FOUND, WRITE_FAILED or the server's code.
     */
    async function fetchLazy(path) {
        const state = await store.load();
        if (!state) return { ok: false, code: 'NOT_CONFIGURED' };
        if (state.stopped) return { ok: false, code: state.stopped };
        const wanted = getPisiSyncPathKey(path);
        const found = Object.entries(state.remoteOnly || {}).find(([, entry]) => getPisiSyncPathKey(entry.path) === wanted);
        if (!found) return { ok: false, code: 'NOT_FOUND' };
        const [fid, entry] = found;
        try {
            const secrets = await store.readSecrets();
            http.setToken(secrets.token);
            const keys = await openPisiSyncSpaceKeys(subtle, secrets.key, state.spaceId);
            if ((await computePisiSyncFid(subtle, keys.fid, entry.path)) !== fid) return { ok: false, code: 'META_INVALID' };
            const meta = { path: entry.path, class: getPisiSyncFileClass(entry.path), size: entry.plainSize, sha256: entry.sha256 };
            const plain = await fetchPlain(state, keys, { blob: entry.blob, meta });
            if (!(await files.writeLazy(entry.path, plain))) return { ok: false, code: 'WRITE_FAILED' };
            return { ok: true, code: null, path: entry.path, size: plain.length };
        } catch (error) {
            return { ok: false, code: typeof error?.code === 'string' ? error.code : 'INTERNAL' };
        }
    }

    /**
     * "Sunucuyla yeniden eşleş" (docs/sync-protocol.md §7.4): a state stopped by
     * SERVER_ROLLBACK starts over from the server's heads on its next turn; what
     * the device synced before decides how each file merges (sync-recovery.mjs).
     * Resolves `{ ok, code }`; NOT_CONFIGURED or NOT_STOPPED (no rollback to recover from).
     */
    async function rejoin() {
        if (running) await running.catch(() => null);
        const state = await store.load();
        if (!state) return { ok: false, code: 'NOT_CONFIGURED' };
        if (state.stopped !== 'SERVER_ROLLBACK') return { ok: false, code: 'NOT_STOPPED' };
        const prepared = preparePisiSyncRejoin(state, { at: now().toISOString() });
        for (const key of prepared.pendingBases) await store.removeBase(key);
        await store.save(prepared.state);
        return { ok: true, code: null };
    }

    return {
        rejoin,
        /** Runs one turn; concurrent calls share the running turn. `options`: `{ reason, signal, onProgress }`. */
        runTurn(options) {
            if (!running) {
                cancelled = false;
                running = turn(options).finally(() => (running = null));
            }
            return running;
        },
        /** Stops the running turn at its next checkpoint (between files and upload parts); it resolves with CANCELLED. */
        cancel() {
            if (running) cancelled = true;
        },
        isRunning: () => Boolean(running),
        fetchLazy,
        /** The remote head of a lazy file, or null: `{ path, blob, size, sha256, plainSize }`. */
        async getRemoteOnly(path) {
            const state = await store.load().catch(() => null);
            const wanted = getPisiSyncPathKey(path);
            return Object.values(state?.remoteOnly || {}).find((entry) => getPisiSyncPathKey(entry.path) === wanted) || null;
        },
        internals: { pull, scan, push: pusher.push, fetchPlain }
    };
}
