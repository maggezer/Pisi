// The sync turn of a Pisi device (docs/sync-plan.md §3.6, docs/sync-protocol.md
// §5–§7). Pull → scan → decide (shared/sync-reconcile.mjs) → apply → push, with
// STALE_BASE retried at most three times. Platform I/O comes in as adapters so
// the desktop (sync-client-desktop.js) and the tests run the same engine:
//
//   http   createPisiSyncHttp(…)              the server
//   store  createPisiSyncStateStore(…)        device state outside the project (SV2)
//   files  { list(), read(path), exists(path), apply(ops) → { skipped } }
//          project files by project-relative '/' paths; `apply` writes a turn at once (SV11)
//   isDirty(path)                            open document with unsaved edits (SV4)
//
// The engine never writes a file whose remote change failed verification (SV9),
// never sends or overwrites a corrupt local JSON file (SV10) and only advances
// the cursor after the turn's remote changes were applied or set aside.

import {
    computePisiSyncBlobId,
    computePisiSyncFid,
    formatPisiSyncRandomId,
    openPisiSyncEnvelope,
    openPisiSyncSpaceKeys,
    sealPisiSyncEnvelope,
    sha256Hex,
    getPisiSyncSealedSize
} from '../../shared/sync-crypto.mjs';
import { makePisiSyncChangeMeta, readPisiSyncChangeMeta, sealPisiSyncChangeMeta, verifyPisiSyncBlobContent } from '../../shared/sync-meta.mjs';
import { checkPisiSyncPath, getPisiSyncFileClass, getPisiSyncPathKey, isPisiSyncCompressedClass, isPisiSyncMergeableClass } from '../../shared/sync-paths.mjs';
import { checkPisiSyncRemoteOrder, makePisiSyncIndexEntry, planPisiSyncCommits, reconcilePisiSyncTurn } from '../../shared/sync-reconcile.mjs';
import { PisiSyncHttpError } from './sync-client-http.js';
import { parsePisiSyncJsonBytes, preparePisiSyncActions } from './sync-client-actions.js';

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

async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const pisiSyncGzip = (bytes) => pipeBytes(bytes, new CompressionStream('gzip'));
export const pisiSyncGunzip = (bytes) => pipeBytes(bytes, new DecompressionStream('gzip'));

const docIdOf = (path, bytes) => {
    const fileClass = getPisiSyncFileClass(path);
    if (fileClass !== 'node' && fileClass !== 'map') return null;
    const id = parsePisiSyncJsonBytes(bytes)?.pisi?.id;
    return typeof id === 'string' ? id : null;
};

/**
 * Creates the engine of one bound project. `random(n)` gives n random bytes,
 * `uuid()` a v4 uuid, `now()` a Date. `onApplied({ changed, added, removed })`
 * is called after a turn wrote files.
 */
export function createPisiSyncEngine({
    subtle = globalThis.crypto.subtle,
    http,
    store,
    files,
    isDirty = (_path) => false,
    random,
    uuid,
    now = () => new Date(),
    gzip = pisiSyncGzip,
    gunzip = pisiSyncGunzip,
    onApplied = null
}) {
    let running = null;

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

    /** Pull: the changes after the cursor, or every head on CURSOR_EXPIRED (§6.3). */
    async function pull(state, keys) {
        const limits = state.limits || DEFAULT_LIMITS;
        const { data: headData } = await http.get(`/v1/spaces/${state.spaceId}/head`);
        if (headData.head < state.cursor) return { ok: false, code: 'SERVER_ROLLBACK' };
        if (headData.head === state.cursor) return { ok: true, remote: [], cursor: state.cursor, lastDseq: state.lastDseq };
        let full = null;
        let later;
        try {
            later = await pageChanges(state.spaceId, state.cursor, limits.maxChangesPage);
        } catch (error) {
            if (error?.code !== 'CURSOR_EXPIRED') throw error;
            full = await pageHeads(state.spaceId, limits.maxHeadsPage);
            later = await pageChanges(state.spaceId, full.asOfSeq, limits.maxChangesPage);
        }
        const changes = await openRows(later.rows, keys);
        const order = checkPisiSyncRemoteOrder({ cursor: full ? full.asOfSeq : state.cursor, head: later.head, changes, lastDseq: state.lastDseq });
        if (!order.ok) return { ok: false, code: order.code };
        const rejected = new Set(order.rejected.map((entry) => entry.seq));
        const remote = changes.map((change) => (rejected.has(change.seq) ? { ...change, invalid: 'SERVER_REPLAY' } : change));
        if (full) {
            const heads = await openRows(full.rows, keys);
            const headCheck = checkPisiSyncRemoteOrder({ cursor: state.cursor, head: full.asOfSeq, changes: heads, heads: true });
            if (!headCheck.ok) return { ok: false, code: headCheck.code };
            remote.unshift(...heads);
        }
        return { ok: true, remote, cursor: later.head, lastDseq: order.lastDseq, full: Boolean(full) };
    }

    /** Scan of the project with the hash cache of the state. */
    async function scan(state, keys) {
        const limits = state.limits || DEFAULT_LIMITS;
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

    async function sizeOfExistingBlob(state, blob, known) {
        if (known.has(blob)) return known.get(blob);
        const response = await http.request('GET', `/v1/spaces/${state.spaceId}/blobs/${blob}`, { expect: 'bytes', headers: { Range: 'bytes=0-0' } });
        const total = Number(String(response.headers.get('Content-Range') || '').split('/')[1]);
        if (!Number.isSafeInteger(total)) throw new PisiSyncHttpError('SIZE_MISMATCH', { message: 'Blob boyutu öğrenilemedi.' });
        return total;
    }

    async function uploadBlob(state, blob, sealed) {
        const digest = await sha256Hex(subtle, sealed);
        const started = await http.post(`/v1/spaces/${state.spaceId}/blobs/${blob}/uploads`, { size: sealed.length, sha256: digest });
        if (started.status === 200 && started.data?.exists) return;
        const { uploadId, partBytes, parts } = started.data;
        for (let part = 1; part <= parts; part += 1) {
            const chunk = sealed.subarray((part - 1) * partBytes, part * partBytes);
            await http.request('PUT', `/v1/spaces/${state.spaceId}/uploads/${uploadId}/parts/${part}`, {
                bytes: chunk,
                idempotent: true,
                headers: { 'Pisi-Part-Sha256': await sha256Hex(subtle, chunk) }
            });
        }
        await http.post(`/v1/spaces/${state.spaceId}/uploads/${uploadId}/complete`, {}, { idempotent: true });
    }

    /** Seals, uploads and commits the pushes. Returns `{ ok, stale, code, pushed }`. */
    async function push(state, keys, pushes) {
        if (!pushes.length) return { ok: true, pushed: 0 };
        const limits = state.limits || DEFAULT_LIMITS;
        const known = new Map();
        for (const entry of Object.values(state.index)) if (entry.blob) known.set(entry.blob, entry.size);
        const items = [];
        for (const item of pushes) {
            const fid = item.fid || (await computePisiSyncFid(subtle, keys.fid, item.path));
            if (item.op === 'delete') {
                items.push({ ...item, fid, blob: null, size: 0 });
                continue;
            }
            const bytes = item.bytes || (await files.read(item.path));
            if (!bytes) continue;
            const fileClass = getPisiSyncFileClass(item.path);
            if (isPisiSyncMergeableClass(fileClass) && !parsePisiSyncJsonBytes(bytes)) continue;
            const blob = await computePisiSyncBlobId(subtle, keys.blob, bytes);
            const sealed = await sealPisiSyncEnvelope({
                subtle,
                key: keys.content,
                spaceId: state.spaceId,
                purpose: 'blob',
                binding: blob,
                plaintext: bytes,
                nonce: random(12),
                gzip: isPisiSyncCompressedClass(fileClass) ? gzip : null
            });
            if (sealed.length > limits.maxBlobBytes) continue;
            items.push({
                ...item,
                fid,
                blob,
                sealed,
                bytes,
                sha256: await sha256Hex(subtle, bytes),
                plainSize: bytes.length,
                docId: item.docId || docIdOf(item.path, bytes)
            });
        }
        // Missing blobs are uploaded; an existing one keeps the size the server stored.
        const puts = items.filter((item) => item.op === 'put');
        const blobs = [...new Set(puts.map((item) => item.blob))];
        const missing = new Set();
        for (let at = 0; at < blobs.length; at += limits.maxCheckBlobs) {
            const { data } = await http.post(
                `/v1/spaces/${state.spaceId}/blobs/check`,
                { blobs: blobs.slice(at, at + limits.maxCheckBlobs) },
                { idempotent: true }
            );
            data.missing.forEach((blob) => missing.add(blob));
        }
        const uploaded = new Set();
        for (const item of puts) {
            if (missing.has(item.blob) && !uploaded.has(item.blob)) {
                await uploadBlob(state, item.blob, item.sealed);
                uploaded.add(item.blob);
                known.set(item.blob, item.sealed.length);
            }
            item.size = uploaded.has(item.blob) ? known.get(item.blob) : await sizeOfExistingBlob(state, item.blob, known);
            known.set(item.blob, item.size);
        }

        let pushed = 0;
        const plans = planPisiSyncCommits(
            items.map((item) => ({ ...item, type: item.op === 'put' ? 'push-put' : 'push-delete' })),
            Math.min(limits.maxCommitChanges, 200)
        );
        for (const group of plans) {
            const changes = [];
            for (const item of group) {
                state.dseq += 1;
                const meta = makePisiSyncChangeMeta({
                    path: item.path,
                    op: item.op,
                    size: item.op === 'put' ? item.plainSize : null,
                    sha256: item.op === 'put' ? item.sha256 : null,
                    docId: item.op === 'put' ? item.docId : (state.index[item.fid]?.docId ?? null),
                    device: state.deviceId,
                    dseq: state.dseq,
                    at: now().toISOString(),
                    renamedFrom: item.renamedFrom || null,
                    conflictOf: item.conflictOf || null
                });
                const sealedMeta = await sealPisiSyncChangeMeta({ subtle, keys, fid: item.fid, blob: item.blob, meta, nonce: random(12) });
                changes.push(
                    item.op === 'put'
                        ? { fid: item.fid, op: 'put', blob: item.blob, size: item.size, baseSeq: item.baseSeq, meta: sealedMeta }
                        : { fid: item.fid, op: 'delete', baseSeq: item.baseSeq, meta: sealedMeta }
                );
            }
            const commitId = formatPisiSyncRandomId('cm_', random(16));
            state.pendingCommit = {
                commitId,
                body: { commitId, changes },
                items: group.map((item) => ({
                    fid: item.fid,
                    path: item.path,
                    op: item.op,
                    blob: item.blob,
                    size: item.size,
                    sha256: item.sha256 ?? null,
                    docId: item.docId ?? null
                }))
            };
            for (const item of group)
                if (item.op === 'put' && isPisiSyncMergeableClass(getPisiSyncFileClass(item.path))) await store.writeBase(`pending:${item.fid}`, item.bytes);
            await store.save(state);
            const result = await sendPendingCommit(state);
            if (!result.ok) return result;
            pushed += group.length;
        }
        return { ok: true, pushed };
    }

    /** Sends (or resends, with the same commitId and body) the commit saved in the state (§7.3). */
    async function sendPendingCommit(state) {
        const pending = state.pendingCommit;
        if (!pending) return { ok: true };
        let response;
        try {
            response = await http.post(`/v1/spaces/${state.spaceId}/commit`, pending.body, { idempotent: true });
        } catch (error) {
            if (error?.code === 'OFFLINE') return { ok: false, code: 'OFFLINE' };
            state.pendingCommit = null;
            for (const item of pending.items) await store.removeBase(`pending:${item.fid}`);
            await store.save(state);
            if (error?.code === 'STALE_BASE') return { ok: false, stale: true, code: 'STALE_BASE' };
            throw error;
        }
        const seqs = response.data.seqs;
        for (const [at, item] of pending.items.entries()) {
            const pendingKey = `pending:${item.fid}`;
            if (item.op === 'delete') {
                delete state.index[item.fid];
                await store.removeBase(item.fid);
            } else {
                state.index[item.fid] = makePisiSyncIndexEntry({
                    path: item.path,
                    seq: seqs[at],
                    blob: item.blob,
                    sha256: item.sha256,
                    size: item.size,
                    docId: item.docId
                });
                const base = await store.readBase(pendingKey);
                if (base) await store.writeBase(item.fid, base);
                else await store.removeBase(item.fid);
            }
            await store.removeBase(pendingKey);
        }
        state.pendingCommit = null;
        await store.save(state);
        return { ok: true };
    }

    function combineRemote(pending, pulled) {
        const byFid = new Map();
        for (const row of [...pending, ...pulled]) {
            const previous = byFid.get(row.fid);
            if (!previous || row.seq > previous.seq) byFid.set(row.fid, row);
        }
        return [...byFid.values()].sort((left, right) => left.seq - right.seq);
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
        const resent = await sendPendingCommit(state);
        if (!resent.ok && !resent.stale) return { ...summary, ok: false, code: resent.code };

        for (let round = 0; round < PISI_SYNC_MAX_STALE_ROUNDS; round += 1) {
            summary.rounds = round + 1;
            const pulled = await pull(state, keys);
            if (!pulled.ok) {
                state.stopped = pulled.code;
                await store.save(state);
                return { ...summary, ok: false, code: pulled.code };
            }
            const pending = await openRows(state.pendingRemote || [], keys);
            const remote = combineRemote(pending, pulled.remote);
            const remoteByFid = new Map(remote.map((row) => [row.fid, row]));
            const scanned = await scan(state, keys);
            const { actions } = reconcilePisiSyncTurn({ role: state.role, index: state.index, local: scanned.entries, remote });

            const localPaths = new Map(scanned.entries.map((entry) => [getPisiSyncPathKey(entry.path), entry.path]));
            const plainCache = new Map();
            const prepared = await preparePisiSyncActions(actions, {
                state,
                store,
                deviceName: state.deviceName,
                now,
                uuid,
                takenKeys: new Set(localPaths.keys()),
                remoteRow: (fid) => remoteByFid.get(fid)?.raw || null,
                remoteBytes: async (change) => {
                    if (!plainCache.has(change.blob)) plainCache.set(change.blob, await fetchPlain(state, keys, change));
                    return plainCache.get(change.blob);
                },
                localBytes: (path) => files.read(path),
                localExists: async (path) => localPaths.has(getPisiSyncPathKey(path)),
                baseBytes: (fid) => store.readBase(fid)
            });

            // Units are written together; a unit with a file that became dirty meanwhile is dropped (SV4).
            const writes = prepared.units.flatMap((unit) => unit.writes);
            let skipped = new Set();
            if (writes.length) {
                const applied = await files.apply(writes, { isDirty });
                skipped = new Set((applied?.skipped || []).map((path) => getPisiSyncPathKey(path)));
            }
            const deferred = [...prepared.deferred];
            const pushes = [];
            for (const unit of prepared.units) {
                if (unit.writes.some((write) => skipped.has(getPisiSyncPathKey(write.path)))) {
                    if (unit.row) deferred.push(unit.row.raw || unit.row);
                    summary.issues.push(...unit.writes.map((write) => ({ path: write.path, code: 'DEFERRED_DIRTY' })));
                    continue;
                }
                if (unit.commit) await unit.commit();
                pushes.push(...unit.pushes);
                for (const write of unit.writes) {
                    if (write.op === 'remove') summary.removed.push(write.path);
                    else if (write.added) summary.added.push(write.path);
                    else summary.changed.push(write.path);
                }
            }
            summary.issues.push(...prepared.issues);
            summary.conflicts.push(...prepared.conflicts);
            state.conflicts.push(...prepared.conflicts);
            state.hashCache = scanned.cache;
            state.pendingRemote = deferred.filter((row) => row && !UNVERIFIABLE.has(row.invalid)).map((row) => row.raw || row);
            state.cursor = pulled.cursor;
            state.lastDseq = pulled.lastDseq;
            await store.save(state);
            if (writes.length && onApplied && (summary.changed.length || summary.added.length || summary.removed.length)) {
                onApplied({ changed: [...summary.changed], added: [...summary.added], removed: [...summary.removed] });
            }

            // Written files changed on disk: their pushes read the bytes the plan wrote.
            const result = await push(state, keys, pushes);
            if (result.stale) continue;
            if (!result.ok) return { ...summary, ok: false, code: result.code };
            summary.pushed += result.pushed;
            break;
        }
        state.issues = summary.issues;
        state.lastRun = { at: now().toISOString(), ok: true, reason: options.reason || 'manual' };
        await store.save(state);
        return summary;
    }

    return {
        /** Runs one turn; concurrent calls share the running turn. */
        runTurn(options) {
            if (!running) running = turn(options).finally(() => (running = null));
            return running;
        },
        isRunning: () => Boolean(running),
        internals: { pull, scan, push, fetchPlain }
    };
}
