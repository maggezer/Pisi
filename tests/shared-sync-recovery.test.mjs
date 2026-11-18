// Recovery rules of a sync turn (shared/sync-recovery.mjs): unapplied remote changes
// (SV9) are kept, shown and tried again; "Sunucuyla yeniden eşleş" after SERVER_ROLLBACK
// keeps what the device knows without losing either side (docs/sync-protocol.md §7.4).

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isPisiSyncRollbackInHeads,
    markPisiSyncKnownReplays,
    PISI_SYNC_FULL_CHECK_MS,
    PISI_SYNC_UNAPPLIED_RETRY_MS,
    preparePisiSyncRejoin,
    settlePisiSyncRejoin,
    shouldMakePisiSyncFullCheck,
    shouldRetryPisiSyncUnapplied,
    updatePisiSyncUnapplied
} from '../shared/sync-recovery.mjs';

const SELF = 'dv_self';
const OTHER = 'dv_other';
const fid = (name) => `f_${name}`;
const row = (name, seq, extra = {}) => ({
    seq,
    fid: fid(name),
    op: 'put',
    blob: `b_${name}_${seq}`,
    size: 10,
    device: OTHER,
    meta: { path: `${name}.node`, sha256: `sha_${name}_${seq}`, dev: extra.device || OTHER, dseq: seq },
    ...extra
});
const entry = (name, seq, extra = {}) => ({
    path: `${name}.node`,
    pathKey: `${name}.node`,
    seq,
    blob: `b_${name}_${seq}`,
    sha256: `sha_${name}_${seq}`,
    size: 10,
    docId: null,
    ...extra
});

test('doğrulanamayan uzak değişiklik tutulur; aynı dosyanın yeni ve geçerli değişikliği onu kapatır', () => {
    const at = '2026-11-18T10:00:00.000Z';
    const first = updatePisiSyncUnapplied({
        previous: {},
        remote: [row('a', 5, { invalid: 'DECRYPT_FAILED' }), row('b', 6)],
        issues: [
            { path: 'a.node', fid: fid('a'), code: 'DECRYPT_FAILED' },
            // A local problem is not an unapplied remote change.
            { path: 'c.node', fid: fid('c'), code: 'LOCAL_CORRUPT' },
            { path: 'd.node', fid: null, code: 'PATH_UNSAFE' }
        ],
        at
    });
    assert.deepEqual(Object.keys(first), [fid('a')]);
    assert.deepEqual(first[fid('a')], { fid: fid('a'), path: 'a.node', seq: 5, code: 'DECRYPT_FAILED', at });

    // A later round that does not see the file keeps it; a round with a newer valid change of it settles it.
    assert.deepEqual(updatePisiSyncUnapplied({ previous: first, remote: [row('b', 7)], issues: [], at: 'later' }), first);
    assert.deepEqual(updatePisiSyncUnapplied({ previous: first, remote: [row('a', 9)], issues: [], at: 'later' }), {});

    // The same change refused again keeps when it was first seen; a full compare drops what it no longer finds.
    const again = updatePisiSyncUnapplied({
        previous: first,
        full: true,
        remote: [row('a', 5)],
        issues: [{ path: 'a.node', fid: fid('a'), code: 'DECRYPT_FAILED' }],
        at: 'later'
    });
    assert.equal(again[fid('a')].at, at);
    assert.deepEqual(updatePisiSyncUnapplied({ previous: first, full: true, remote: [row('b', 7)], issues: [], at: 'later' }), {});
});

test('yeniden deneme: "Şimdi eşitle"de hemen, yoksa 15 dakikada bir; yeniden oynatma denenmez', () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    const decrypt = { [fid('a')]: { fid: fid('a'), seq: 5, code: 'DECRYPT_FAILED' } };
    const replay = { [fid('a')]: { fid: fid('a'), seq: 5, code: 'SERVER_REPLAY' } };
    const justTried = new Date(now.getTime() - 60000).toISOString();
    const longAgo = new Date(now.getTime() - PISI_SYNC_UNAPPLIED_RETRY_MS).toISOString();
    assert.equal(shouldRetryPisiSyncUnapplied({ unapplied: {}, now, reason: 'manual' }), false);
    assert.equal(shouldRetryPisiSyncUnapplied({ unapplied: decrypt, triedAt: justTried, now, reason: 'manual' }), true);
    assert.equal(shouldRetryPisiSyncUnapplied({ unapplied: decrypt, triedAt: justTried, now, reason: 'interval' }), false);
    assert.equal(shouldRetryPisiSyncUnapplied({ unapplied: decrypt, triedAt: longAgo, now, reason: 'interval' }), true);
    assert.equal(shouldRetryPisiSyncUnapplied({ unapplied: replay, triedAt: longAgo, now, reason: 'manual' }), false);
});

test('tam karşılaştırmada daha önce reddedilen yeniden oynatma yine reddedilir', () => {
    const unapplied = { [fid('a')]: { fid: fid('a'), seq: 5, code: 'SERVER_REPLAY' } };
    const [same, newer, other] = markPisiSyncKnownReplays([row('a', 5), row('a', 8), row('b', 5)], unapplied);
    assert.equal(same.invalid, 'SERVER_REPLAY');
    assert.equal(newer.invalid, undefined);
    assert.equal(other.invalid, undefined);
});

test('yeniden eşleşme hazırlığı: imleç ve indeks sıfırlanır, eski indeks ve bekleyenler saklanır', () => {
    const state = {
        stopped: 'SERVER_ROLLBACK',
        cursor: 120,
        knownSeq: 125,
        dseq: 40,
        lastDseq: { [OTHER]: 30 },
        index: { [fid('a')]: entry('a', 100) },
        pendingRemote: [row('p', 118)],
        unapplied: { [fid('u')]: { fid: fid('u'), seq: 119, code: 'DECRYPT_FAILED' } },
        pendingCommit: { commitId: 'cm_x', items: [{ fid: fid('c') }] },
        remoteOnly: { [fid('img')]: {} },
        conflicts: [{ path: 'x' }],
        hashCache: { 'a.node': {} }
    };
    const { state: next, pendingBases } = preparePisiSyncRejoin(state, { at: 'şimdi' });
    assert.deepEqual(pendingBases, [`pending:${fid('c')}`]);
    assert.equal(next.stopped, null);
    assert.equal(next.cursor, 0);
    assert.equal(next.knownSeq, 0);
    assert.deepEqual(next.index, {});
    assert.deepEqual(next.lastDseq, {});
    assert.equal(next.pendingCommit, null);
    assert.deepEqual(next.remoteOnly, {});
    // The conflict log and the hash cache stay; the device's own dseq counter never goes back.
    assert.deepEqual(next.conflicts, state.conflicts);
    assert.deepEqual(next.hashCache, state.hashCache);
    assert.equal(next.dseq, 40);
    assert.deepEqual(next.rejoin, { at: 'şimdi', index: state.index, lastDseq: state.lastDseq, dseq: 40, unsettled: [fid('p'), fid('u')] });
});

test('yeniden eşleşme: aynı içerik kalır, görülmüş eski sürüme karşı yerel kazanır, gerisi boş temelle birleşir', () => {
    const rejoin = {
        index: {
            [fid('same')]: entry('same', 100),
            [fid('older')]: entry('older', 110),
            [fid('mine')]: entry('mine', 112),
            [fid('newer')]: entry('newer', 90),
            [fid('lost')]: entry('lost', 115),
            [fid('pending')]: entry('pending', 80),
            [fid('deleted')]: entry('deleted', 70),
            [fid('broken')]: entry('broken', 60)
        },
        lastDseq: { [OTHER]: 50 },
        dseq: 20,
        unsettled: [fid('pending')]
    };
    const remote = [
        // The server holds exactly what this device synced (its seq may be new).
        { ...row('same', 100), seq: 99, blob: 'b_same_100' },
        // The backup holds an older version that this device had already seen: the device's own version wins.
        row('older', 45),
        { ...row('mine', 15), device: SELF, meta: { ...row('mine', 15).meta, dev: SELF, dseq: 15 } },
        // Written after the rollback by a device that rejoined first: not an ancestor that can be trusted.
        row('newer', 51),
        // Pulled but never applied before the rollback.
        row('pending', 40),
        { ...row('deleted', 30), op: 'delete', blob: null },
        row('broken', 20, { invalid: 'DECRYPT_FAILED' })
        // `lost`: the server has no head for it at all.
    ];
    const { index, dropBases } = settlePisiSyncRejoin({ rejoin, deviceId: SELF, remote });

    assert.deepEqual(index[fid('same')], { ...entry('same', 100), seq: 99 });
    assert.deepEqual(index[fid('older')], { ...entry('older', 110), seq: 45, blob: 'b_older_45', sha256: 'sha_older_45', size: 10 });
    assert.equal(index[fid('mine')].seq, 15);
    assert.equal(index[fid('mine')].sha256, 'sha_mine_15');
    for (const name of ['newer', 'lost', 'pending', 'deleted', 'broken']) assert.equal(index[fid(name)], undefined, name);
    assert.deepEqual(dropBases.sort(), ['older', 'mine', 'newer', 'lost', 'pending', 'deleted', 'broken'].map(fid).sort());
});

test('yeniden eşleşme: tabanı yazan cihazın yeni sürümü üç yollu birleşir; başkasının ya da kendi tabanında boş temel', () => {
    const rejoin = {
        index: {
            // The base came from OTHER, and OTHER (which rejoined first) wrote the server's newer version: a true base.
            [fid('theirs')]: entry('theirs', 100, { dev: OTHER }),
            // The base is this device's own push, possibly lost in the rollback: OTHER may never have had it.
            [fid('own')]: entry('own', 101, { dev: SELF }),
            // The base came from a third device: whether OTHER had it is unknown.
            [fid('third')]: entry('third', 102, { dev: 'dv_third' })
        },
        lastDseq: { [OTHER]: 50 },
        dseq: 20,
        unsettled: []
    };
    const remote = [row('theirs', 60), row('own', 61), row('third', 62)];
    const { index, dropBases } = settlePisiSyncRejoin({ rejoin, deviceId: SELF, remote });
    assert.deepEqual(index[fid('theirs')], { ...entry('theirs', 100, { dev: OTHER }), seq: 0 });
    assert.equal(index[fid('own')], undefined);
    assert.equal(index[fid('third')], undefined);
    assert.deepEqual(dropBases.sort(), [fid('own'), fid('third')].sort());
});

test("başlıklar geri gitmez: indeksin altındaki, aynı seq'te başka blob'lu ya da kaybolan başlık geri sarmadır", () => {
    const index = { [fid('a')]: entry('a', 120), [fid('b')]: entry('b', 90), [fid('z')]: { ...entry('z', 5), seq: 0 } };
    const heads = [
        { fid: fid('a'), seq: 120, blob: 'b_a_120' },
        { fid: fid('b'), seq: 130, blob: 'b_b_130' }
    ];
    assert.equal(isPisiSyncRollbackInHeads({ index, heads }), false, 'olağan: başlık indeksle aynı ya da ileride');
    assert.equal(isPisiSyncRollbackInHeads({ index, heads: [{ ...heads[0], seq: 110 }, heads[1]] }), true, 'başlık indeksin altında');
    assert.equal(isPisiSyncRollbackInHeads({ index, heads: [{ ...heads[0], blob: 'b_baska' }, heads[1]] }), true, "aynı seq'te başka blob");
    assert.equal(isPisiSyncRollbackInHeads({ index, heads: [heads[1]] }), true, 'eşitlenen dosyanın başlığı yok');
    assert.equal(isPisiSyncRollbackInHeads({ index: {}, heads: [] }), false);
});

test('tam denetim günde bir; hiç eşitlemeyen cihaz yapmaz', () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    assert.equal(shouldMakePisiSyncFullCheck({ cursor: 0, now }), false);
    assert.equal(shouldMakePisiSyncFullCheck({ cursor: 5, checkedAt: null, now }), true);
    assert.equal(shouldMakePisiSyncFullCheck({ cursor: 5, checkedAt: new Date(now.getTime() - 1000).toISOString(), now }), false);
    assert.equal(shouldMakePisiSyncFullCheck({ cursor: 5, checkedAt: new Date(now.getTime() - PISI_SYNC_FULL_CHECK_MS).toISOString(), now }), true);
});
