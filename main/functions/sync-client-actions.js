// Turns the decisions of the sync engine (shared/sync-reconcile.mjs) into
// planned file writes, index updates and pushes (docs/sync-plan.md §3.4, §3.6,
// rules SV3, SV6, SV9, SV10). Nothing is written here: every action becomes a
// unit `{ writes, pushes, commit, row }`. The engine writes all units of a turn
// at once (one atomic mutation on the desktop), runs `commit` of the units
// that were written and pushes their changes. A unit whose file became dirty
// while it was prepared is dropped and its remote change waits for the next turn.
//
// Rule of the index: an action that consumes a remote change makes that change
// the new base (index entry + base copy) even when the local file differs. The
// merged result on disk then reads as a local change and is pushed with
// baseSeq = the remote seq — in this turn, or in the next one if the push fails.

import { utf8Decode, utf8Encode } from '../../shared/sync-crypto.mjs';
import { makePisiSyncConflictCopy, makePisiSyncOtherConflictPath } from '../../shared/sync-conflict.mjs';
import { mergePisiSyncAuthority } from '../../shared/sync-merge-authority.mjs';
import { mergePisiSyncGenericJson, mergePisiSyncMap, pisiSyncJsonEqual, serializePisiSyncJson } from '../../shared/sync-merge-json.mjs';
import { mergePisiSyncNode } from '../../shared/sync-merge-node.mjs';
import { getPisiSyncDiaryDate, getPisiSyncFileClass, getPisiSyncPathKey, isPisiSyncMergeableClass } from '../../shared/sync-paths.mjs';
import { makePisiSyncIndexEntry } from '../../shared/sync-reconcile.mjs';

export class PisiSyncActionError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiSyncActionError';
        this.code = code;
    }
}

/** Parses a JSON file of a mergeable class; null when it is not JSON (SV10). */
export function parsePisiSyncJsonBytes(bytes) {
    if (!bytes) return null;
    try {
        const value = JSON.parse(utf8Decode(bytes));
        return value !== null && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

const encodeJson = (value) => utf8Encode(serializePisiSyncJson(value));

function indexEntryFor(path, change) {
    return makePisiSyncIndexEntry({
        path,
        seq: change.seq,
        blob: change.blob,
        sha256: change.meta.sha256,
        size: change.size,
        docId: change.meta.docId ?? null
    });
}

/**
 * Three-way merge of one mergeable file. Returns `{ bytes, pushLocal, conflicts, copy }`:
 * `bytes` the content to write (null: keep the local file), `pushLocal` whether
 * the result differs from the remote and must be pushed, `copy` the local
 * document to keep as a conflict copy (notes only).
 */
export function mergePisiSyncFile({ path, base, local, remote }) {
    const fileClass = getPisiSyncFileClass(path);
    const remoteDoc = parsePisiSyncJsonBytes(remote);
    if (!remoteDoc) throw new PisiSyncActionError('META_INVALID', 'Uzak içerik JSON değil.');
    const localDoc = parsePisiSyncJsonBytes(local);
    if (!localDoc) throw new PisiSyncActionError('LOCAL_CORRUPT', 'Yerel içerik JSON değil.');
    const baseDoc = parsePisiSyncJsonBytes(base);
    let value;
    let conflicts = [];
    let copy = null;
    if (fileClass === 'node') {
        const result = mergePisiSyncNode({ base: baseDoc, local: localDoc, remote: remoteDoc, diary: Boolean(getPisiSyncDiaryDate(path)) });
        value = result.value;
        conflicts = result.conflicts.map((conflict) => ({ kind: 'node', ...conflict }));
        if (result.status === 'conflict') copy = localDoc;
    } else if (fileClass === 'authority') {
        const result = mergePisiSyncAuthority(path, baseDoc, localDoc, remoteDoc);
        value = result.value;
        conflicts = result.conflicts.map((conflict) => ({ kind: 'authority', ...conflict }));
    } else {
        const result = (fileClass === 'map' ? mergePisiSyncMap : mergePisiSyncGenericJson)(baseDoc ?? undefined, localDoc, remoteDoc);
        value = result.value;
        conflicts = result.conflicts.map((conflict) => ({ kind: fileClass, field: conflict.path, kept: conflict.kept }));
    }
    if (pisiSyncJsonEqual(value, remoteDoc)) return { bytes: remote, pushLocal: false, conflicts, copy };
    if (pisiSyncJsonEqual(value, localDoc)) return { bytes: null, pushLocal: true, conflicts, copy };
    return { bytes: encodeJson(value), pushLocal: true, conflicts, copy };
}

/**
 * Prepares the units of a turn. `ctx` gives the I/O:
 * `remoteBytes(change)`, `localBytes(path)`, `baseBytes(fid)`, `now()`, `uuid()`,
 * `deviceName`, `takenKeys` (a Set of path keys in use), `state`, `store`.
 */
export async function preparePisiSyncActions(actions, ctx) {
    /** @type {any[]} */
    const units = [];
    const issues = [];
    const conflicts = [];
    const deferred = [];
    const log = (entry) => conflicts.push({ at: ctx.now().toISOString(), ...entry });
    const isTaken = (path) => ctx.takenKeys.has(getPisiSyncPathKey(path));
    const take = (path) => ctx.takenKeys.add(getPisiSyncPathKey(path));
    const { state, store } = ctx;

    const setIndex = (fid, path, change, bytes) => async () => {
        state.index[fid] = indexEntryFor(path, change);
        if (isPisiSyncMergeableClass(getPisiSyncFileClass(path)) && bytes) await store.writeBase(fid, bytes);
        else await store.removeBase(fid);
    };
    const dropIndex = (fid) => async () => {
        delete state.index[fid];
        await store.removeBase(fid);
    };

    /** A conflict copy of `bytes` at a new path, with copied attachments, pushed as new files. */
    async function makeCopy(path, bytes, { conflictOf }) {
        const fileClass = getPisiSyncFileClass(path);
        const writes = [];
        const pushes = [];
        if (fileClass === 'node') {
            const document = parsePisiSyncJsonBytes(bytes);
            if (!document) throw new PisiSyncActionError('LOCAL_CORRUPT', 'Çakışma kopyası okunamadı.');
            const copy = makePisiSyncConflictCopy({ path, document, deviceName: ctx.deviceName, now: ctx.now(), makeUuid: ctx.uuid, isTaken });
            take(copy.path);
            const copyBytes = encodeJson(copy.document);
            writes.push({ op: 'write', path: copy.path, bytes: copyBytes, added: true });
            pushes.push({ op: 'put', path: copy.path, baseSeq: 0, docId: copy.document.pisi.id, conflictOf, bytes: copyBytes });
            for (const asset of copy.assets) {
                const assetBytes = await ctx.localBytes(asset.from);
                if (!assetBytes) continue;
                take(asset.to);
                writes.push({ op: 'write', path: asset.to, bytes: assetBytes, added: true });
                pushes.push({ op: 'put', path: asset.to, baseSeq: 0, docId: null, conflictOf: null, bytes: assetBytes });
            }
            return { path: copy.path, writes, pushes };
        }
        const copyPath = makePisiSyncOtherConflictPath({ path, deviceName: ctx.deviceName, now: ctx.now(), isTaken });
        take(copyPath);
        writes.push({ op: 'write', path: copyPath, bytes, added: true });
        const docId = fileClass === 'map' ? (parsePisiSyncJsonBytes(bytes)?.pisi?.id ?? null) : null;
        pushes.push({ op: 'put', path: copyPath, baseSeq: 0, docId, conflictOf, bytes });
        return { path: copyPath, writes, pushes };
    }

    for (const action of actions) {
        const { fid, path } = action;
        try {
            switch (action.type) {
                case 'skip':
                    issues.push({ path, fid, code: action.code });
                    break;
                case 'defer':
                    issues.push({ path, fid, code: 'DEFERRED_DIRTY' });
                    if (action.fid && ctx.remoteRow(action.fid)) deferred.push(ctx.remoteRow(action.fid));
                    break;
                case 'forget':
                    units.push({ writes: [], pushes: [], commit: dropIndex(fid) });
                    break;
                case 'adopt': {
                    const local = await ctx.localBytes(path);
                    units.push({ writes: [], pushes: [], commit: setIndex(fid, path, action.change, local), row: action.change });
                    break;
                }
                case 'pull': {
                    const change = action.change || { ...action.from, meta: { sha256: action.from.sha256, docId: action.from.docId } };
                    const bytes = await ctx.remoteBytes(action.change || { fid, op: 'put', blob: action.from.blob, meta: null, base: action.from });
                    if (isPisiSyncMergeableClass(getPisiSyncFileClass(path)) && !parsePisiSyncJsonBytes(bytes))
                        throw new PisiSyncActionError('META_INVALID', 'Uzak içerik JSON değil.');
                    const added = !(await ctx.localExists(path));
                    take(path);
                    units.push({ writes: [{ op: 'write', path, bytes, added }], pushes: [], commit: setIndex(fid, path, change, bytes), row: action.change });
                    break;
                }
                case 'remove':
                    units.push({ writes: [{ op: 'remove', path }], pushes: [], commit: dropIndex(fid), row: action.change });
                    break;
                case 'merge': {
                    const [remote, local, base] = await Promise.all([ctx.remoteBytes(action.change), ctx.localBytes(path), ctx.baseBytes(fid)]);
                    const merged = mergePisiSyncFile({ path, base, local, remote });
                    merged.conflicts.forEach((conflict) => log({ path, ...conflict }));
                    const unit = { writes: [], pushes: [], commit: setIndex(fid, path, action.change, remote), row: action.change };
                    if (merged.copy) {
                        const copy = await makeCopy(path, local, { conflictOf: fid });
                        unit.writes.push(...copy.writes);
                        unit.pushes.push(...copy.pushes);
                        log({ path, kind: 'copy', copyPath: copy.path, reason: 'both-changed' });
                    }
                    if (merged.bytes) unit.writes.push({ op: 'write', path, bytes: merged.bytes });
                    if (merged.pushLocal) unit.pushes.push({ op: 'put', path, fid, baseSeq: action.change.seq, docId: null, bytes: merged.bytes || local });
                    units.push(unit);
                    break;
                }
                case 'rename-merge': {
                    const [remote, local, base] = await Promise.all([ctx.remoteBytes(action.change), ctx.localBytes(action.from), ctx.baseBytes(fid)]);
                    const merged = mergePisiSyncFile({ path: action.to, base, local, remote });
                    merged.conflicts.forEach((conflict) => log({ path: action.to, ...conflict }));
                    const unit = {
                        writes: [{ op: 'remove', path: action.from }],
                        pushes: [],
                        commit: async () => {
                            await dropIndex(fid)();
                            await setIndex(action.toFid, action.to, action.change, remote)();
                        },
                        row: action.change
                    };
                    if (merged.copy) {
                        const copy = await makeCopy(action.to, local, { conflictOf: action.toFid });
                        unit.writes.push(...copy.writes);
                        unit.pushes.push(...copy.pushes);
                        log({ path: action.to, kind: 'copy', copyPath: copy.path, reason: 'both-changed' });
                    }
                    take(action.to);
                    unit.writes.push({ op: 'write', path: action.to, bytes: merged.bytes || local, added: true });
                    if (merged.pushLocal)
                        unit.pushes.push({
                            op: 'put',
                            path: action.to,
                            fid: action.toFid,
                            baseSeq: action.change.seq,
                            docId: null,
                            bytes: merged.bytes || local
                        });
                    units.push(unit);
                    break;
                }
                case 'keep-copy': {
                    const local = await ctx.localBytes(path);
                    const copy = await makeCopy(path, local, { conflictOf: fid });
                    log({ path, kind: 'copy', copyPath: copy.path, reason: 'changed-deleted' });
                    units.push({ writes: [...copy.writes, { op: 'remove', path }], pushes: copy.pushes, commit: dropIndex(fid), row: action.change });
                    break;
                }
                case 'delete-with-copy': {
                    const remote = await ctx.remoteBytes(action.change);
                    const copy = await makeCopy(action.change.meta.path, remote, { conflictOf: fid });
                    log({ path, kind: 'copy', copyPath: copy.path, reason: 'deleted-changed' });
                    units.push({
                        writes: copy.writes,
                        pushes: [...copy.pushes, { op: 'delete', path, fid, baseSeq: action.change.seq }],
                        commit: setIndex(fid, path, action.change, remote),
                        row: action.change
                    });
                    break;
                }
                case 'conflict-copy': {
                    const [remote, local] = await Promise.all([ctx.remoteBytes(action.change), ctx.localBytes(path)]);
                    const copy = await makeCopy(path, local, { conflictOf: fid });
                    log({ path, kind: 'copy', copyPath: copy.path, reason: 'both-changed' });
                    units.push({
                        writes: [...copy.writes, { op: 'write', path, bytes: remote }],
                        pushes: copy.pushes,
                        commit: setIndex(fid, path, action.change, remote),
                        row: action.change
                    });
                    break;
                }
                case 'push-put':
                    units.push({
                        writes: [],
                        pushes: [{ op: 'put', path, fid, baseSeq: action.baseSeq, docId: action.docId ?? null, renamedFrom: action.renamedFrom || null }],
                        commit: null
                    });
                    break;
                case 'push-delete':
                    units.push({ writes: [], pushes: [{ op: 'delete', path, fid, baseSeq: action.baseSeq }], commit: null });
                    break;
                default:
                    issues.push({ path, fid, code: 'UNKNOWN_ACTION' });
            }
        } catch (error) {
            const code = error?.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'APPLY_FAILED';
            issues.push({ path, fid, code });
            // A remote change that could not be verified is not retried; anything else waits for the next turn.
            if (action.change && !['DECRYPT_FAILED', 'HASH_MISMATCH_LOCAL', 'META_INVALID', 'BLOB_NOT_FOUND'].includes(code)) deferred.push(action.change);
        }
    }
    return { units, issues, conflicts, deferred };
}
