// The push half of the sync engine (shared/sync-engine.mjs; docs/sync-plan.md
// §3.6 step 5, S6 step 1): local changes go to the server as commits of at most
// 200 changes. A commit is planned first and then streamed: the blob ids of its
// files are computed, the server is asked which blobs it lacks, and each missing
// one is read, sealed and uploaded on its own, so only one file is held sealed
// at a time. The state is saved after every commit, so an interrupted push goes
// on where it stopped: committed files are in the index, uploaded blobs are
// skipped by `blobs/check` and a commit sent but not answered is sent again with
// the same commitId (§7.3).

import { computePisiSyncBlobId, computePisiSyncFid, formatPisiSyncRandomId, sealPisiSyncEnvelope, sha256Hex } from './sync-crypto.mjs';
import { makePisiSyncChangeMeta, sealPisiSyncChangeMeta } from './sync-meta.mjs';
import { getPisiSyncFileClass, isPisiSyncCompressedClass, isPisiSyncMergeableClass } from './sync-paths.mjs';
import { makePisiSyncIndexEntry, planPisiSyncCommits } from './sync-reconcile.mjs';
import { PisiSyncHttpError } from './sync-http.mjs';
import { parsePisiSyncJsonBytes } from './sync-actions.mjs';

/** Thrown at a checkpoint once a turn was cancelled (`engine.cancel()` or `runTurn({ signal })`). */
export class PisiSyncCancelledError extends Error {
    constructor() {
        super('Senkron durduruldu.');
        this.name = 'PisiSyncCancelledError';
        this.code = 'CANCELLED';
    }
}

const docIdOf = (path, bytes) => {
    const fileClass = getPisiSyncFileClass(path);
    if (fileClass !== 'node' && fileClass !== 'map') return null;
    const id = parsePisiSyncJsonBytes(bytes)?.pisi?.id;
    return typeof id === 'string' ? id : null;
};

/**
 * The push of an engine. `ctx` holds the engine's adapters and settings:
 * `{ subtle, http, store, files, random, now, gzip, isLazy, limitsOf }`.
 */
export function createPisiSyncPusher(ctx) {
    const { subtle, http, store, files, random, now, gzip, isLazy } = ctx;

    async function sizeOfExistingBlob(state, blob, known) {
        if (known.has(blob)) return known.get(blob);
        const response = await http.request('GET', `/v1/spaces/${state.spaceId}/blobs/${blob}`, { expect: 'bytes', headers: { Range: 'bytes=0-0' } });
        const total = Number(String(response.headers.get('Content-Range') || '').split('/')[1]);
        if (!Number.isSafeInteger(total)) throw new PisiSyncHttpError('SIZE_MISMATCH', { message: 'Blob boyutu öğrenilemedi.' });
        return total;
    }

    async function uploadBlob(state, blob, sealed, checkpoint) {
        const digest = await sha256Hex(subtle, sealed);
        const started = await http.post(`/v1/spaces/${state.spaceId}/blobs/${blob}/uploads`, { size: sealed.length, sha256: digest });
        if (started.status === 200 && started.data?.exists) return;
        const { uploadId, partBytes, parts } = started.data;
        for (let part = 1; part <= parts; part += 1) {
            checkpoint();
            const chunk = sealed.subarray((part - 1) * partBytes, part * partBytes);
            await http.request('PUT', `/v1/spaces/${state.spaceId}/uploads/${uploadId}/parts/${part}`, {
                bytes: chunk,
                idempotent: true,
                headers: { 'Pisi-Part-Sha256': await sha256Hex(subtle, chunk) }
            });
        }
        await http.post(`/v1/spaces/${state.spaceId}/uploads/${uploadId}/complete`, {}, { idempotent: true });
    }

    /** The bytes of a put that is not a reused blob, or null when it may not be sent (gone, corrupt JSON). */
    async function bytesOf(item) {
        const bytes = item.bytes || (await files.read(item.path));
        if (!bytes) return null;
        if (isPisiSyncMergeableClass(getPisiSyncFileClass(item.path)) && !parsePisiSyncJsonBytes(bytes)) return null;
        return bytes;
    }

    /**
     * Turns one planned commit into sendable items: blob ids, sizes, docIds.
     * Bytes are kept only where they are needed later (base copies of mergeable
     * files, content made in this turn); other files are read again to upload.
     */
    async function describe(group, keys) {
        const items = [];
        for (const item of group) {
            if (item.op === 'delete') {
                items.push({ ...item, blob: null, size: 0 });
                continue;
            }
            // A file this device knows only from the server travels as the blob that is already there.
            if (item.reuse) {
                items.push({ ...item, blob: item.reuse.blob, bytes: null, sha256: item.reuse.sha256, plainSize: item.reuse.plainSize, docId: null });
                continue;
            }
            const bytes = await bytesOf(item);
            if (!bytes) continue;
            const keep = Boolean(item.bytes) || isPisiSyncMergeableClass(getPisiSyncFileClass(item.path));
            items.push({
                ...item,
                blob: await computePisiSyncBlobId(subtle, keys.blob, bytes),
                bytes: keep ? bytes : null,
                sha256: await sha256Hex(subtle, bytes),
                plainSize: bytes.length,
                docId: item.docId || docIdOf(item.path, bytes)
            });
        }
        return items;
    }

    /**
     * Seals, uploads and commits the pushes. `progress(item, bytes)` is told
     * about every file sent; `checkpoint()` throws CANCELLED between files.
     * @param {any} state
     * @param {any} keys
     * @param {any[]} pushes
     * @param {{ progress?: (item: any, bytes: number) => void, checkpoint?: () => void }} [options]
     * @returns {Promise<{ ok: boolean, stale?: boolean, code?: string | null, pushed: number }>}
     */
    async function push(state, keys, pushes, { progress = () => {}, checkpoint = () => {} } = {}) {
        if (!pushes.length) return { ok: true, pushed: 0 };
        const limits = ctx.limitsOf(state);
        const known = new Map();
        for (const entry of Object.values(state.index)) if (entry.blob) known.set(entry.blob, entry.size);
        for (const entry of Object.values(state.remoteOnly || {})) if (entry.blob) known.set(entry.blob, entry.size);
        const planned = [];
        for (const item of pushes) planned.push({ ...item, fid: item.fid || (await computePisiSyncFid(subtle, keys.fid, item.path)) });
        const plans = planPisiSyncCommits(
            planned.map((item) => ({ ...item, type: item.op === 'put' ? 'push-put' : 'push-delete' })),
            Math.min(limits.maxCommitChanges, 200)
        );

        let pushed = 0;
        for (const group of plans) {
            checkpoint();
            let items = await describe(group, keys);
            const missing = new Set();
            const blobs = [...new Set(items.filter((item) => item.op === 'put').map((item) => item.blob))];
            for (let at = 0; at < blobs.length; at += limits.maxCheckBlobs) {
                const { data } = await http.post(
                    `/v1/spaces/${state.spaceId}/blobs/check`,
                    { blobs: blobs.slice(at, at + limits.maxCheckBlobs) },
                    { idempotent: true }
                );
                data.missing.forEach((blob) => missing.add(blob));
            }
            // A reused blob the server no longer has cannot be sent without its bytes.
            items = items.filter((item) => !(item.reuse && missing.has(item.blob)));

            const uploaded = new Set();
            const sendable = [];
            for (const item of items) {
                checkpoint();
                if (item.op === 'delete') {
                    sendable.push(item);
                    continue;
                }
                if (missing.has(item.blob) && !uploaded.has(item.blob)) {
                    const bytes = item.bytes || (await bytesOf(item));
                    // The file changed after it was described: it goes in the next turn.
                    if (!bytes || (!item.bytes && (await computePisiSyncBlobId(subtle, keys.blob, bytes)) !== item.blob)) continue;
                    const sealed = await sealPisiSyncEnvelope({
                        subtle,
                        key: keys.content,
                        spaceId: state.spaceId,
                        purpose: 'blob',
                        binding: item.blob,
                        plaintext: bytes,
                        nonce: random(12),
                        gzip: isPisiSyncCompressedClass(getPisiSyncFileClass(item.path)) ? gzip : null
                    });
                    if (sealed.length > limits.maxBlobBytes) continue;
                    await uploadBlob(state, item.blob, sealed, checkpoint);
                    uploaded.add(item.blob);
                    known.set(item.blob, sealed.length);
                }
                item.size = await sizeOfExistingBlob(state, item.blob, known);
                known.set(item.blob, item.size);
                if (!item.reuse) progress(item, item.plainSize);
                sendable.push(item);
            }
            // A rename travels as its delete and its put together, or not at all (§3.2).
            const putFids = new Set(sendable.filter((item) => item.op === 'put').map((item) => item.fid));
            const commitItems = sendable.filter(
                (item) => !(item.op === 'delete' && group.some((other) => other.renamedFrom === item.fid && !putFids.has(other.fid)))
            );
            if (!commitItems.length) continue;
            checkpoint();

            const changes = [];
            for (const item of commitItems) {
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
                items: commitItems.map((item) => ({
                    fid: item.fid,
                    path: item.path,
                    op: item.op,
                    blob: item.blob,
                    size: item.size,
                    sha256: item.sha256 ?? null,
                    docId: item.docId ?? null,
                    plainSize: item.plainSize ?? null,
                    reused: Boolean(item.reuse)
                }))
            };
            for (const item of commitItems)
                if (item.op === 'put' && item.bytes && isPisiSyncMergeableClass(getPisiSyncFileClass(item.path)))
                    await store.writeBase(`pending:${item.fid}`, item.bytes);
            await store.save(state);
            const result = await sendPendingCommit(state);
            if (!result.ok) return { ...result, pushed };
            pushed += commitItems.length;
        }
        return { ok: true, pushed };
    }

    /**
     * Sends (or resends, with the same commitId and body) the commit saved in the state (§7.3).
     * @returns {Promise<{ ok: boolean, stale?: boolean, code?: string | null }>}
     */
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
        // The highest seq this device knows the server gave out: a head below it later means the
        // server went back to an older state, even when the cursor has not passed the device's own
        // commit yet (docs/sync-protocol.md §7.4).
        state.knownSeq = Math.max(Number.isSafeInteger(state.knownSeq) ? state.knownSeq : 0, ...seqs.filter(Number.isSafeInteger));
        for (const [at, item] of pending.items.entries()) {
            const pendingKey = `pending:${item.fid}`;
            if (item.op === 'delete') {
                delete state.index[item.fid];
                await store.removeBase(item.fid);
            } else if (item.reused || isLazy(item.path)) {
                state.remoteOnly = state.remoteOnly || {};
                state.remoteOnly[item.fid] = {
                    path: item.path,
                    seq: seqs[at],
                    blob: item.blob,
                    size: item.size,
                    sha256: item.sha256,
                    plainSize: item.plainSize
                };
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

    return { push, sendPendingCommit };
}
