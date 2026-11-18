// Recovery rules of a sync turn (docs/sync-protocol.md §7.4, §9.3). Pure: the
// engine (sync-engine.mjs) gives the rows, the state and the clock.
//
// - Unapplied remote changes (SV9). A change that failed verification is not
//   written, but the cursor moves on. So that the file does not stay missing in
//   silence, the change is kept in `state.unapplied` (by fid), shown in Settings
//   and tried again with a full compare (`GET heads`): at "Şimdi eşitle" and at
//   most every 15 minutes otherwise. A newer change of the same file settles it.
//   A replayed change (SERVER_REPLAY) is shown but never taken again from heads.
// - "Sunucuyla yeniden eşleş" after SERVER_ROLLBACK. The device starts over from
//   the server's heads but keeps what it knows. For each file it had synced:
//     - the server holds the same content: the entry stays (with the server's seq);
//     - the server holds a version this device had already seen (its own, or one
//       whose `dseq` was not above the last one seen from that device): the
//       server's version is older than the device's, which therefore wins and is
//       sent again (the server lost it in the rollback);
//     - the server holds a newer version written by the same device that wrote the
//       version this device last synced (e.g. the desktop rejoined first): that
//       device had this version, so it is a true base and the usual three-way merge
//       applies (an unchanged local file simply takes the server's);
//     - anything else (a newer version by a device that may never have had this
//       device's version, a change that was pulled but not applied yet, a delete,
//       an unreadable row): the entry and its merge base are dropped, so local and
//       remote merge with an empty base (docs/sync-plan.md §3.4) and nothing is
//       lost on either side.
//   The author of an index entry is its `dev` (sync-reconcile.mjs makePisiSyncIndexEntry).
//   Entries written before it existed have none and take the empty base.
//   Files deleted after the backup the server went back to come back; deletes are
//   not guessed.
// - A rollback the cursor cannot show (the device last synced above the backup, and
//   other devices sent enough after rejoining to lift the head over its cursor again)
//   shows in every head: a head never goes back, so a head below the seq this device
//   synced for that file, the same seq with another blob, or no head at all for a file
//   it synced, is SERVER_ROLLBACK. Every full compare checks this, and a device makes
//   one at least once a day.

/** Codes of remote changes that were not applied and are kept in `state.unapplied`. */
export const PISI_SYNC_UNAPPLIED_CODES = Object.freeze([
    'DECRYPT_FAILED',
    'HASH_MISMATCH_LOCAL',
    'META_INVALID',
    'PATH_UNSAFE',
    'PROTOCOL_UNSUPPORTED',
    'SERVER_REPLAY',
    'BLOB_NOT_FOUND'
]);
const UNAPPLIED = new Set(PISI_SYNC_UNAPPLIED_CODES);
// The server may serve a repaired blob, and a newer app reads a newer metadata version; a
// replay or an unsafe path stays what it is.
const RETRIED = new Set(['DECRYPT_FAILED', 'HASH_MISMATCH_LOCAL', 'META_INVALID', 'PROTOCOL_UNSUPPORTED', 'BLOB_NOT_FOUND']);

/** The time between two automatic full compares made for unapplied changes. */
export const PISI_SYNC_UNAPPLIED_RETRY_MS = 15 * 60 * 1000;
/** A device compares every head at least this often, to see a rollback its cursor cannot show. */
export const PISI_SYNC_FULL_CHECK_MS = 24 * 60 * 60 * 1000;

/** The last row of every fid. */
function latestByFid(rows) {
    const latest = new Map();
    for (const row of rows || []) {
        if (!row || typeof row.fid !== 'string') continue;
        const previous = latest.get(row.fid);
        if (!previous || row.seq > previous.seq) latest.set(row.fid, row);
    }
    return latest;
}

/**
 * The unapplied changes after a round. `previous` is `state.unapplied`, `remote`
 * the rows the round decided on, `issues` the round's issues (`{ path, fid, code }`)
 * and `full` whether the rows were every head (then nothing older is kept).
 * An entry is `{ fid, path, seq, code, at }`; `at` is when it was first seen.
 */
export function updatePisiSyncUnapplied({ previous = {}, full = false, remote = [], issues = [], at }) {
    const latest = latestByFid(remote);
    /** @type {Record<string, any>} */
    const next = {};
    if (!full) for (const [fid, entry] of Object.entries(previous || {})) if (!latest.has(fid)) next[fid] = entry;
    for (const issue of issues || []) {
        if (!issue?.fid || !UNAPPLIED.has(issue.code)) continue;
        const row = latest.get(issue.fid);
        if (!row) continue;
        const before = previous?.[issue.fid];
        next[issue.fid] = {
            fid: issue.fid,
            path: issue.path || row.meta?.path || before?.path || null,
            seq: row.seq,
            code: issue.code,
            at: before && before.seq === row.seq ? before.at : at
        };
    }
    return next;
}

/**
 * Whether this turn compares every head again for unapplied changes: always at
 * "Şimdi eşitle" (`reason` 'manual'), otherwise once `PISI_SYNC_UNAPPLIED_RETRY_MS`
 * passed since `triedAt` (ISO).
 */
export function shouldRetryPisiSyncUnapplied({ unapplied = {}, triedAt = null, now, reason = '' }) {
    const retried = Object.values(unapplied || {}).some((entry) => RETRIED.has(entry?.code));
    if (!retried) return false;
    if (reason === 'manual') return true;
    const last = triedAt ? Date.parse(triedAt) : NaN;
    return !Number.isFinite(last) || now.getTime() - last >= PISI_SYNC_UNAPPLIED_RETRY_MS;
}

/** Whether this turn makes its daily full compare (`checkedAt` ISO: the last one). A device that synced nothing yet does not need it. */
export function shouldMakePisiSyncFullCheck({ cursor = 0, checkedAt = null, now }) {
    if (!(cursor > 0)) return false;
    const last = checkedAt ? Date.parse(checkedAt) : NaN;
    return !Number.isFinite(last) || now.getTime() - last >= PISI_SYNC_FULL_CHECK_MS;
}

/**
 * Checks every head of the space (raw rows of `GET heads`) against the index:
 * true when the server went back (see above). Index entries with seq 0 (a rejoin's
 * three-way base) are not checked.
 */
export function isPisiSyncRollbackInHeads({ index = {}, heads = [] }) {
    const byFid = new Map((heads || []).map((row) => [row.fid, row]));
    for (const [fid, entry] of Object.entries(index || {})) {
        if (!(entry?.seq > 0)) continue;
        const head = byFid.get(fid);
        if (!head || head.seq < entry.seq) return true;
        if (head.seq === entry.seq && head.blob !== entry.blob) return true;
    }
    return false;
}

/**
 * Marks again the heads of replays this device refused before (the same fid at
 * the same seq): a full compare does not check `dseq`, so it must not let them in.
 */
export function markPisiSyncKnownReplays(rows, unapplied = {}) {
    return (rows || []).map((row) => {
        const entry = unapplied?.[row.fid];
        if (!row.invalid && entry?.code === 'SERVER_REPLAY' && entry.seq === row.seq) return { ...row, invalid: 'SERVER_REPLAY' };
        return row;
    });
}

/**
 * Starts "Sunucuyla yeniden eşleş" for a state stopped by SERVER_ROLLBACK.
 * Returns `{ state, pendingBases }`: the state to save (it pulls every head on
 * its next turn and keeps the old index in `state.rejoin` until then) and the
 * store keys of the pending commit's merge bases to remove.
 */
export function preparePisiSyncRejoin(state, { at }) {
    const unsettled = new Set([...(state.pendingRemote || []).map((row) => row?.fid).filter(Boolean), ...Object.keys(state.unapplied || {})]);
    const pendingBases = (state.pendingCommit?.items || []).map((item) => `pending:${item.fid}`);
    return {
        pendingBases,
        state: {
            ...state,
            stopped: null,
            cursor: 0,
            knownSeq: 0,
            lastDseq: {},
            index: {},
            pendingRemote: [],
            pendingCommit: null,
            remoteOnly: {},
            unapplied: {},
            unappliedTriedAt: null,
            issues: [],
            rejoin: { at, index: state.index || {}, lastDseq: state.lastDseq || {}, dseq: state.dseq || 0, unsettled: [...unsettled].sort() }
        }
    };
}

/**
 * The index a rejoin starts from, given the heads the server holds now
 * (`remote`, opened rows). Returns `{ index, dropBases }`: the merge bases of
 * `dropBases` must be removed before the turn decides.
 */
export function settlePisiSyncRejoin({ rejoin, deviceId, remote }) {
    const latest = latestByFid(remote);
    const unsettled = new Set(rejoin?.unsettled || []);
    const lastDseq = rejoin?.lastDseq || {};
    /** @type {Record<string, any>} */
    const index = {};
    const dropBases = [];
    for (const [fid, entry] of Object.entries(rejoin?.index || {})) {
        const row = latest.get(fid);
        const usable = row && !row.invalid && row.meta && row.op === 'put' && !unsettled.has(fid);
        if (usable && row.blob === entry.blob) {
            index[fid] = { ...entry, seq: row.seq };
            continue;
        }
        if (usable && Number.isSafeInteger(row.meta.dseq)) {
            const seen = row.device === deviceId ? row.meta.dseq <= (rejoin.dseq || 0) : row.meta.dseq <= (lastDseq[row.device] ?? 0);
            if (seen) {
                // The server's version is one this device had already merged: its own content is newer and goes again.
                index[fid] = { ...entry, seq: row.seq, blob: row.blob, size: row.size, sha256: row.meta.sha256 };
                dropBases.push(fid);
                continue;
            }
            if (entry.dev && entry.dev !== deviceId && entry.dev === row.device) {
                // Newer, by the device that wrote this device's base: a three-way merge on that base (seq 0: the remote side changed).
                index[fid] = { ...entry, seq: 0 };
                continue;
            }
        }
        dropBases.push(fid);
    }
    return { index, dropBases };
}
