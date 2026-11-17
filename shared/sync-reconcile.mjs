// The pure decision engine of a sync turn (docs/sync-plan.md §3.6, rules
// SV4, SV7, SV9, SV10, SV12). Given what the device last synced (the index),
// what is on disk now (the scan) and what the server sent (opened changes),
// it lists what to do for every file: apply a remote change, push a local
// one, merge, keep a conflict copy, defer or skip. It reads and writes
// nothing; desktop and mobile run the actions with their own I/O.
//
// index:  { [fid]: { path, seq, blob, sha256, size, docId } }  — last synced state
// local:  [{ path, fid, sha256, size, docId, dirty, corrupt, tooLarge }]  — scan of the project
// remote: [{ seq, fid, op, blob, size, device, commit, meta, invalid }]  — changes after the cursor
//         (or every head on a full compare), meta opened by readPisiSyncChangeMeta;
//         `invalid` is the code of a change that did not pass it.

import { checkPisiSyncPath, findPisiSyncPathCollisions, getPisiSyncFileClass, getPisiSyncPathKey, isPisiSyncMergeableClass } from './sync-paths.mjs';

export const PISI_SYNC_MAX_COMMIT_CHANGES = 200;
// Apply order inside a turn (§3.6 step 4): attachments, then documents, then authorities.
const CLASS_RANK = Object.freeze({ asset: 0, marker: 1, other: 1, node: 2, map: 2, json: 2, authority: 3 });
const PUSH_TYPES = new Set(['push-put', 'push-delete']);

/** The last change of every fid, in seq order, and the puts that rename a fid away. */
function latestRemote(remote) {
    const byFid = new Map();
    for (const change of [...remote].sort((left, right) => left.seq - right.seq)) byFid.set(change.fid, change);
    const renames = new Map();
    for (const change of byFid.values()) {
        const from = change.meta?.renamedFrom;
        if (change.op === 'put' && from && !change.invalid) renames.set(from, change);
    }
    return { byFid, renames };
}

const isMember = (role) => role !== 'admin';

/**
 * Decides one turn. Returns `{ actions, issues }`. Action types:
 * - `pull` (write the remote content), `remove` (apply a remote delete), `adopt`
 *   (local already equals remote: update the index only), `forget` (drop an index entry);
 * - `merge` (three-way merge with `base`, then push with baseSeq = change.seq);
 * - `rename-merge` (local edits of `from` merge into the remote file `to`);
 * - `keep-copy` (remote deleted a file changed here: keep the local version as a
 *   conflict copy, then apply the delete);
 * - `delete-with-copy` (admin deleted a file the remote changed: keep the remote
 *   version as a conflict copy and push the delete);
 * - `conflict-copy` (a non-mergeable file changed on both sides: copy the local one aside, pull);
 * - `push-put`, `push-delete` (with baseSeq, and renamedFrom for a local rename);
 * - `defer` (DEFERRED_DIRTY) and `skip` (with a §9.3 code).
 * A member device (the phone) never pushes a delete: a file it is missing is pulled again (SV12).
 */
export function reconcilePisiSyncTurn({ role = 'member', index = {}, local = [], remote = [] }) {
    /** @type {any[]} */
    const actions = [];
    const issues = [];
    const skip = (path, fid, code) => {
        actions.push({ type: 'skip', path, fid, code });
        issues.push({ path, fid, code });
    };

    // Local files that may not be synced (SV7, SV9, SV10) and paths that fold together (§4.5).
    const collisions = new Set(findPisiSyncPathCollisions(local.map((entry) => entry.path)).flat());
    const localByFid = new Map();
    const blockedFids = new Set();
    for (const entry of local) {
        const checked = checkPisiSyncPath(entry.path);
        if (!checked.ok) {
            if (checked.reason !== 'excluded') skip(entry.path, entry.fid ?? null, 'PATH_UNSAFE');
            continue;
        }
        if (collisions.has(entry.path)) {
            skip(entry.path, entry.fid ?? null, 'PATH_COLLISION');
            if (entry.fid) blockedFids.add(entry.fid);
            continue;
        }
        localByFid.set(entry.fid, entry);
    }

    const { byFid: remoteByFid, renames } = latestRemote(remote);
    const fids = new Set([...Object.keys(index), ...localByFid.keys(), ...remoteByFid.keys()]);

    // Local renames on the desktop: an indexed file is gone and a new one carries its docId.
    const renamedTo = new Map();
    if (!isMember(role)) {
        const newByDocId = new Map();
        for (const entry of localByFid.values()) if (!index[entry.fid] && entry.docId && !newByDocId.has(entry.docId)) newByDocId.set(entry.docId, entry);
        for (const [fid, base] of Object.entries(index)) {
            if (localByFid.has(fid) || !base.docId || remoteByFid.has(fid)) continue;
            const target = newByDocId.get(base.docId);
            if (target && !remoteByFid.has(target.fid)) renamedTo.set(target.fid, fid);
        }
    }

    for (const fid of [...fids].sort()) {
        if (blockedFids.has(fid)) continue;
        const base = index[fid] || null;
        const file = localByFid.get(fid) || null;
        const change = remoteByFid.get(fid) || null;
        const path = file?.path || change?.meta?.path || base?.path;
        const fileClass = getPisiSyncFileClass(path);

        if (change?.invalid) {
            skip(path, fid, change.invalid);
            continue;
        }
        if (change && !change.meta) {
            skip(path, fid, 'META_INVALID');
            continue;
        }
        if (file?.corrupt) {
            skip(file.path, fid, 'LOCAL_CORRUPT');
            continue;
        }
        if (file?.tooLarge) {
            skip(file.path, fid, 'FILE_TOO_LARGE');
            continue;
        }

        const remoteChanged = Boolean(change) && change.seq > (base?.seq ?? 0) && !(change.op === 'put' && base && change.blob === base.blob);
        const remoteLive = remoteChanged ? change.op === 'put' : Boolean(base);
        const localChanged = file ? !base || file.sha256 !== base.sha256 : Boolean(base);

        if (file?.dirty && remoteChanged) {
            actions.push({ type: 'defer', path: file.path, fid, code: 'DEFERRED_DIRTY' });
            issues.push({ path: file.path, fid, code: 'DEFERRED_DIRTY' });
            continue;
        }
        const action = decide({ role, fid, base, file, change, fileClass, remoteChanged, remoteLive, localChanged, renames, renamedTo });
        if (action) actions.push(action);
    }

    // Each local rename pushes the delete of its old path in the same commit.
    for (const [newFid, oldFid] of renamedTo) {
        if (!actions.some((action) => action.type === 'push-put' && action.fid === newFid)) continue;
        const base = index[oldFid];
        const at = actions.findIndex((action) => action.fid === oldFid);
        const deletion = { type: 'push-delete', path: base.path, fid: oldFid, baseSeq: base.seq, class: getPisiSyncFileClass(base.path) };
        if (at >= 0) actions[at] = deletion;
        else actions.push(deletion);
    }
    // A rename-merge writes the renamed file itself (the remote put merged with the local edits).
    const mergedInto = new Set(actions.filter((action) => action.type === 'rename-merge').map((action) => action.toFid));
    const kept = actions.filter((action) => !(action.type === 'pull' && mergedInto.has(action.fid)));
    return { actions: sortPisiSyncActions(kept), issues };
}

function decide({ role, fid, base, file, change, fileClass, remoteChanged, remoteLive, localChanged, renames, renamedTo }) {
    const at = (type, extra = {}) => ({ type, path: file?.path || change?.meta?.path || base?.path, fid, class: fileClass, ...extra });

    if (!remoteChanged) {
        if (!localChanged) return null;
        if (file) {
            const renamedFrom = renamedTo.get(fid) || null;
            return at('push-put', { baseSeq: Math.max(change?.seq ?? 0, base?.seq ?? 0), docId: file.docId ?? null, renamedFrom });
        }
        // Gone from disk. The desktop pushes a delete (unless it was renamed); the phone downloads it again.
        if (!base) return null;
        if (isMember(role)) return at('pull', { path: base.path, change: null, from: base });
        if ([...renamedTo.values()].includes(fid)) return null;
        return at('push-delete', { path: base.path, baseSeq: base.seq });
    }

    // The remote side changed this fid.
    if (!localChanged || (!file && !base)) {
        if (change.op === 'put') return at('pull', { path: change.meta.path, change });
        return file || base ? at('remove', { path: base?.path || change.meta.path, change }) : at('forget', { change });
    }

    // Both sides changed.
    if (file && change.op === 'put') {
        if (file.sha256 === change.meta.sha256) return at('adopt', { change });
        if (isPisiSyncMergeableClass(fileClass)) return at('merge', { change, base, baseSeq: change.seq });
        if (fileClass === 'asset' || fileClass === 'marker') return at('pull', { path: change.meta.path, change });
        return at('conflict-copy', { change });
    }
    if (file && change.op === 'delete') {
        if (!base) return at('push-put', { baseSeq: change.seq, docId: file.docId ?? null, renamedFrom: null });
        const renamed = renames.get(fid) || null;
        if (renamed) return at('rename-merge', { from: file.path, to: renamed.meta.path, toFid: renamed.fid, change: renamed, deletion: change, base });
        return at('keep-copy', { change, base });
    }
    // Deleted here, changed there.
    if (!remoteLive) return at('forget', { change });
    if (isMember(role)) return at('pull', { path: change.meta.path, change });
    return at('delete-with-copy', { change, base, baseSeq: change.seq });
}

/** Applies first (attachments → documents → authorities), then pushes; each group by path. */
export function sortPisiSyncActions(actions) {
    const rank = (action) => (PUSH_TYPES.has(action.type) ? 10 : 0) + (CLASS_RANK[action.class] ?? 1);
    return [...actions].sort((left, right) => rank(left) - rank(right) || compareText(left.path, right.path) || compareText(left.type, right.type));
}

const compareText = (left, right) => (String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0);

/**
 * Splits push actions into commits of at most `max` changes; a rename's
 * delete and put always share a commit (§3.2).
 */
export function planPisiSyncCommits(pushes, max = PISI_SYNC_MAX_COMMIT_CHANGES) {
    const units = [];
    const pairedDeletes = new Set(pushes.filter((push) => push.type === 'push-put' && push.renamedFrom).map((push) => push.renamedFrom));
    for (const push of pushes) {
        if (push.type === 'push-delete' && pairedDeletes.has(push.fid)) continue;
        const pair =
            push.type === 'push-put' && push.renamedFrom ? pushes.find((other) => other.type === 'push-delete' && other.fid === push.renamedFrom) : null;
        units.push(pair ? [pair, push] : [push]);
    }
    const commits = [];
    let current = [];
    for (const unit of units) {
        if (current.length + unit.length > max && current.length) {
            commits.push(current);
            current = [];
        }
        current.push(...unit);
    }
    if (current.length) commits.push(current);
    return commits;
}

/**
 * Checks pulled changes against what the device saw before (§7.4). `cursor`
 * is the last applied seq, `head` the server's, `lastDseq` the largest dseq
 * seen per device. A head or seq below the cursor is SERVER_ROLLBACK (stop the
 * turn, write nothing). A change whose dseq is not above its device's last one
 * is SERVER_REPLAY and is not applied. On a full compare (`heads: true`) rows
 * come in fid order, so only the head is checked. Returns
 * `{ ok, code, accepted, rejected, lastDseq }`.
 */
export function checkPisiSyncRemoteOrder({ cursor = 0, head, changes = [], lastDseq = {}, heads = false }) {
    if (Number.isFinite(head) && head < cursor) return { ok: false, code: 'SERVER_ROLLBACK', accepted: [], rejected: [], lastDseq };
    const seen = { ...lastDseq };
    const accepted = [];
    const rejected = [];
    let previous = cursor;
    for (const change of changes) {
        if (!heads) {
            if (!(change.seq > previous)) return { ok: false, code: 'SERVER_ROLLBACK', accepted: [], rejected: [], lastDseq };
            previous = change.seq;
        }
        const meta = change.meta;
        if (!heads && meta && Number.isSafeInteger(meta.dseq)) {
            if (meta.dseq <= (seen[change.device] ?? 0)) {
                rejected.push({ seq: change.seq, fid: change.fid, code: 'SERVER_REPLAY' });
                continue;
            }
            seen[change.device] = meta.dseq;
        }
        accepted.push(change);
    }
    return { ok: true, code: null, accepted, rejected, lastDseq: seen };
}

/** Index entry after a file was applied or pushed with `seq`. */
export function makePisiSyncIndexEntry({ path, seq, blob, sha256, size, docId = null }) {
    return { path, pathKey: getPisiSyncPathKey(path), seq, blob, sha256, size, docId };
}
