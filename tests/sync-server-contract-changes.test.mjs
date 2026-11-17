// Senkron sunucusu sözleşmesi: değişiklik günlüğü, başlıklar, commit, idempotens ve budama
// (docs/sync-protocol.md §5, §6.3, §7, §8). `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP, call, createSpace, expectError, newFid, opaqueEnvelope, pairDevice, putFile, randomId, uploadBlob } from './sync-server-client.mjs';

const commitPath = (device) => `/v1/spaces/${device.spaceId}/commit`;

async function commit(server, device, changes, commitId = randomId('cm_')) {
    return call(server, 'POST', commitPath(device), { token: device.token, body: { commitId, changes } });
}

function counts(server, spaceId) {
    const value = (table) => server.sql(`SELECT COUNT(*) AS n FROM ${table} WHERE space_id = ?`, [spaceId]).rows[0].n;
    return {
        changes: value('changes'),
        heads: value('heads'),
        commits: value('commits'),
        head: server.sql('SELECT head FROM spaces WHERE space_id = ?', [spaceId]).rows[0].head
    };
}

describe('senkron sunucusu: değişiklik günlüğü ve commit', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('boş alan: head 0, değişiklik ve başlık yok', async () => {
        const admin = await createSpace(server);
        assert.deepEqual((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: admin.token })).json, { head: 0, prunedThrough: 0 });
        assert.deepEqual((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=0`, { token: admin.token })).json, {
            changes: [],
            head: 0,
            more: false
        });
        assert.deepEqual((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads`, { token: admin.token })).json, { asOfSeq: 0, heads: [], next: null });
    });

    test('put commit seq verir; changes ve heads aynı kaydı, aynı meta zarfıyla döner', async () => {
        const admin = await createSpace(server);
        const bytes = crypto.randomBytes(1234);
        const blob = await uploadBlob(server, admin, bytes);
        const fidA = newFid();
        const fidB = newFid();
        const metaA = opaqueEnvelope(120);
        const metaB = opaqueEnvelope(90);
        const commitId = randomId('cm_');
        const response = await commit(
            server,
            admin,
            [
                { fid: fidA, op: 'put', blob, size: bytes.length, baseSeq: 0, meta: metaA },
                { fid: fidB, op: 'put', blob, size: bytes.length, baseSeq: 0, meta: metaB }
            ],
            commitId
        );
        assert.equal(response.status, 200);
        assert.deepEqual(response.json, { commitId, seqs: [1, 2], head: 2 });

        const changes = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=0`, { token: admin.token });
        assert.equal(changes.json.head, 2);
        assert.equal(changes.json.more, false);
        assert.deepEqual(
            changes.json.changes.map(({ seq, fid, op, blob: id, size, device, commit: cm, meta }) => ({
                seq,
                fid,
                op,
                blob: id,
                size,
                device,
                commit: cm,
                meta
            })),
            [
                { seq: 1, fid: fidA, op: 'put', blob, size: bytes.length, device: admin.deviceId, commit: commitId, meta: metaA },
                { seq: 2, fid: fidB, op: 'put', blob, size: bytes.length, device: admin.deviceId, commit: commitId, meta: metaB }
            ]
        );
        assert.match(changes.json.changes[0].at, /^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/);

        const heads = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads`, { token: admin.token });
        assert.equal(heads.json.asOfSeq, 2);
        assert.equal(heads.json.next, null);
        assert.deepEqual(heads.json.heads.map((head) => head.fid).sort(), [fidA, fidB].sort());
        assert.equal(heads.json.heads.find((head) => head.fid === fidA).meta, metaA);
        assert.deepEqual((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: admin.token })).json, { head: 2, prunedThrough: 0 });
    });

    test("STALE_BASE bütün commit'i reddeder ve hiçbir kaydı yazmaz", async () => {
        const admin = await createSpace(server);
        const first = await putFile(server, admin);
        assert.equal(first.response.status, 200);
        const second = await putFile(server, admin, { fid: first.fid, baseSeq: 1 });
        assert.equal(second.response.status, 200);
        const before = counts(server, admin.spaceId);

        const bytes = crypto.randomBytes(200);
        const blob = await uploadBlob(server, admin, bytes);
        const fresh = newFid();
        const stale = await commit(server, admin, [
            { fid: fresh, op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() },
            { fid: first.fid, op: 'put', blob, size: bytes.length, baseSeq: 1, meta: opaqueEnvelope() }
        ]);
        const error = expectError(assert, stale, 'STALE_BASE');
        assert.equal(error.retryable, true);
        assert.deepEqual(error.details, { head: 2, stale: [{ fid: first.fid, baseSeq: 1, headSeq: 2 }] });
        // Yeni fid hiç görülmemiş olsa da gönderenin bildiği baseSeq 5 ise o da bayattır.
        const unknown = await commit(server, admin, [{ fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 5, meta: opaqueEnvelope() }]);
        assert.equal(expectError(assert, unknown, 'STALE_BASE').details.stale[0].headSeq, 0);
        assert.deepEqual(counts(server, admin.spaceId), before, 'STALE_BASE hiçbir kayıt yazmadı');
        const heads = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads`, { token: admin.token });
        assert.equal(heads.json.heads.length, 1);
    });

    test('aynı commitId ile tekrar aynı sonucu döner ve tek kayıt üretir; farklı gövde COMMIT_ID_REUSED', async () => {
        const admin = await createSpace(server);
        const bytes = crypto.randomBytes(400);
        const blob = await uploadBlob(server, admin, bytes);
        const changes = [{ fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() }];
        const commitId = randomId('cm_');
        const first = await commit(server, admin, changes, commitId);
        const again = await commit(server, admin, changes, commitId);
        assert.equal(first.status, 200);
        assert.equal(again.status, 200);
        assert.deepEqual(again.json, first.json);
        const parallel = await Promise.all([commit(server, admin, changes, commitId), commit(server, admin, changes, commitId)]);
        for (const response of parallel) assert.deepEqual(response.json, first.json);
        assert.deepEqual(counts(server, admin.spaceId), { changes: 1, heads: 1, commits: 1, head: 1 });

        const changed = [{ ...changes[0], meta: opaqueEnvelope() }];
        expectError(assert, await commit(server, admin, changed, commitId), 'COMMIT_ID_REUSED');
        // Aynı gövdeyi başka bir cihaz aynı commitId ile gönderemez.
        const member = await pairDevice(server, admin);
        expectError(assert, await commit(server, member, changes, commitId), 'COMMIT_ID_REUSED');
        assert.deepEqual(counts(server, admin.spaceId), { changes: 1, heads: 1, commits: 1, head: 1 });
    });

    test('eşzamanlı iki commit aynı başlığa: biri kabul, öbürü STALE_BASE', async () => {
        const admin = await createSpace(server);
        const base = await putFile(server, admin);
        const bytes = crypto.randomBytes(321);
        const blob = await uploadBlob(server, admin, bytes);
        const attempts = await Promise.all(
            Array.from({ length: 4 }, () => commit(server, admin, [{ fid: base.fid, op: 'put', blob, size: bytes.length, baseSeq: 1, meta: opaqueEnvelope() }]))
        );
        const accepted = attempts.filter((response) => response.status === 200);
        assert.equal(accepted.length, 1);
        for (const response of attempts.filter((item) => item.status !== 200)) expectError(assert, response, 'STALE_BASE');
        assert.deepEqual(counts(server, admin.spaceId), { changes: 2, heads: 1, commits: 2, head: 2 });
    });

    test('geçişler: silme, silinmişi silme, silinmişi yeniden yazma', async () => {
        const admin = await createSpace(server);
        const file = await putFile(server, admin);
        expectError(assert, await commit(server, admin, [{ fid: newFid(), op: 'delete', baseSeq: 0, meta: opaqueEnvelope() }]), 'INVALID_CHANGE');
        const deleted = await commit(server, admin, [{ fid: file.fid, op: 'delete', baseSeq: 1, meta: opaqueEnvelope() }]);
        assert.deepEqual(deleted.json.seqs, [2]);
        const heads = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads`, { token: admin.token });
        assert.deepEqual(
            heads.json.heads.map(({ fid, seq, op, blob, size }) => ({ fid, seq, op, blob, size })),
            [{ fid: file.fid, seq: 2, op: 'delete', blob: null, size: 0 }],
            'silme başlığı (tombstone) listelenir'
        );
        const changes = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=1`, { token: admin.token });
        assert.equal(changes.json.changes[0].op, 'delete');
        assert.equal(changes.json.changes[0].blob, null);
        expectError(assert, await commit(server, admin, [{ fid: file.fid, op: 'delete', baseSeq: 2, meta: opaqueEnvelope() }]), 'INVALID_CHANGE');
        const recreated = await commit(server, admin, [
            { fid: file.fid, op: 'put', blob: file.blob, size: file.bytes.length, baseSeq: 2, meta: opaqueEnvelope() }
        ]);
        assert.deepEqual(recreated.json.seqs, [3]);
    });

    test('üye cihaz silme gönderemez; commit hiçbir kaydı yazmaz', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        const file = await putFile(server, admin);
        const bytes = crypto.randomBytes(100);
        const blob = await uploadBlob(server, member, bytes);
        const before = counts(server, admin.spaceId);
        const response = await commit(server, member, [
            { fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() },
            { fid: file.fid, op: 'delete', baseSeq: 1, meta: opaqueEnvelope() }
        ]);
        expectError(assert, response, 'DELETE_NOT_ALLOWED');
        assert.deepEqual(counts(server, admin.spaceId), before);
        const put = await commit(server, member, [{ fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() }]);
        assert.equal(put.status, 200);
        const changes = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=${before.head}`, { token: admin.token });
        assert.equal(changes.json.changes[0].device, member.deviceId);
    });

    test('commit doğrulaması: DUPLICATE_FID, BATCH_TOO_LARGE, BLOB_MISSING, SIZE_MISMATCH, INVALID_FIELD', async () => {
        const admin = await createSpace(server);
        const bytes = crypto.randomBytes(256);
        const blob = await uploadBlob(server, admin, bytes);
        const fid = newFid();
        const put = (extra = {}) => ({ fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope(), ...extra });

        expectError(assert, await commit(server, admin, [put({ fid }), put({ fid })]), 'DUPLICATE_FID');
        const tooMany = expectError(
            assert,
            await commit(
                server,
                admin,
                Array.from({ length: 201 }, () => put())
            ),
            'BATCH_TOO_LARGE'
        );
        assert.deepEqual(tooMany.details, { limit: 200 });
        const missingBlob = randomId('b_', 32);
        assert.deepEqual(expectError(assert, await commit(server, admin, [put({ blob: missingBlob })]), 'BLOB_MISSING').details, { blobs: [missingBlob] });
        expectError(assert, await commit(server, admin, [put({ size: bytes.length + 1 })]), 'SIZE_MISMATCH');

        const invalid = [
            [[], 'changes'],
            [[put({ fid: 'f_kisa' })], 'changes[0].fid'],
            [[put({ op: 'move' })], 'changes[0].op'],
            [[put({ baseSeq: -1 })], 'changes[0].baseSeq'],
            [[put({ baseSeq: '0' })], 'changes[0].baseSeq'],
            [[put({ meta: 'zarf' })], 'changes[0].meta'],
            [[put({ size: 0 })], 'changes[0].size'],
            [[put({ blob: undefined })], 'changes[0].blob'],
            [[{ fid, op: 'delete', blob, baseSeq: 0, meta: opaqueEnvelope() }], 'changes[0].blob']
        ];
        for (const [changes, field] of invalid) {
            assert.equal(expectError(assert, await commit(server, admin, changes), 'INVALID_FIELD').details.field, field);
        }
        assert.equal(
            expectError(
                assert,
                await call(server, 'POST', commitPath(admin), { token: admin.token, body: { commitId: 'cm_x', changes: [put()] } }),
                'INVALID_FIELD'
            ).details.field,
            'commitId'
        );
        assert.deepEqual(counts(server, admin.spaceId), { changes: 0, heads: 0, commits: 0, head: 0 });
    });

    test("changes sayfalanır ve sayfa bir commit'in ortasında bitmez", async () => {
        const admin = await createSpace(server);
        const bytes = crypto.randomBytes(64);
        const blob = await uploadBlob(server, admin, bytes);
        const put = () => ({ fid: newFid(), op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() });
        await commit(server, admin, [put()]);
        const triple = await commit(server, admin, [put(), put(), put()]);
        await commit(server, admin, [put()]);
        assert.deepEqual(triple.json.seqs, [2, 3, 4]);

        const page1 = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=0&limit=2`, { token: admin.token });
        assert.deepEqual(
            page1.json.changes.map((change) => change.seq),
            [1, 2, 3, 4],
            'commit bütün döner (limit aşılır)'
        );
        assert.equal(page1.json.more, true);
        const page2 = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=4&limit=2`, { token: admin.token });
        assert.deepEqual(
            page2.json.changes.map((change) => change.seq),
            [5]
        );
        assert.equal(page2.json.more, false);
        const ahead = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=99`, { token: admin.token });
        assert.deepEqual(ahead.json, { changes: [], head: 5, more: false });

        for (const query of ['after=-1', 'after=abc', 'limit=0', 'limit=1001', 'after[]=1']) {
            expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?${query}`, { token: admin.token }), 'BAD_REQUEST');
        }
    });

    test('heads fid sırasıyla sayfalanır', async () => {
        const admin = await createSpace(server);
        const bytes = crypto.randomBytes(64);
        const blob = await uploadBlob(server, admin, bytes);
        const fids = Array.from({ length: 5 }, () => newFid());
        await commit(
            server,
            admin,
            fids.map((fid) => ({ fid, op: 'put', blob, size: bytes.length, baseSeq: 0, meta: opaqueEnvelope() }))
        );
        const seen = [];
        let after = '';
        for (let page = 0; page < 5; page++) {
            const response = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads?limit=2${after ? `&after=${after}` : ''}`, { token: admin.token });
            assert.equal(response.json.asOfSeq, 5);
            seen.push(...response.json.heads.map((head) => head.fid));
            if (!response.json.next) break;
            after = response.json.next;
        }
        assert.deepEqual(
            seen,
            [...fids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        );
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads?after=f_kisa`, { token: admin.token }), 'BAD_REQUEST');
    });

    test('budama: eski, başlık olmayan kayıtlar gider; CURSOR_EXPIRED; başlıklar ve blob temizliği', async () => {
        const admin = await createSpace(server);
        const file = await putFile(server, admin);
        const v2 = await putFile(server, admin, { fid: file.fid, baseSeq: 1 });
        const v3 = await putFile(server, admin, { fid: file.fid, baseSeq: 2 });
        const other = await putFile(server, admin);
        assert.equal(v3.response.json.head, 3);
        assert.equal(other.response.json.head, 4);
        const orphanBytes = crypto.randomBytes(777);
        const orphan = await uploadBlob(server, admin, orphanBytes);

        server.sql('UPDATE changes SET at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 100 DAY) WHERE space_id = ?', [admin.spaceId]);
        server.sql(
            'UPDATE blobs SET last_ref_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY), created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY) WHERE space_id = ?',
            [admin.spaceId]
        );
        server.sql('UPDATE commits SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 8 DAY) WHERE space_id = ?', [admin.spaceId]);
        const usageBefore = (await call(server, 'GET', `/v1/spaces/${admin.spaceId}`, { token: admin.token })).json.usageBytes;
        const gc = server.runBin('gc.php');
        assert.equal(gc.status, 0, gc.stderr);
        const stats = JSON.parse(gc.stdout);
        assert.ok(stats.changes >= 2);
        assert.ok(stats.blobs >= 3, "eski sürümlerin ve sahipsiz blob'un blob'ları silindi");

        const head = (await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: admin.token })).json;
        assert.deepEqual(head, { head: 4, prunedThrough: 2 });
        const expired = expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=1`, { token: admin.token }), 'CURSOR_EXPIRED');
        assert.deepEqual(expired.details, { prunedThrough: 2 });
        assert.equal(expired.retryable, true);
        const fromPruned = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/changes?after=2`, { token: admin.token });
        assert.deepEqual(
            fromPruned.json.changes.map((change) => change.seq),
            [3, 4]
        );
        const heads = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/heads`, { token: admin.token });
        assert.deepEqual(heads.json.heads.map((item) => item.seq).sort(), [3, 4], 'başlıklar budanmaz');

        const check = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, {
            token: admin.token,
            body: { blobs: [file.blob, v2.blob, v3.blob, other.blob, orphan] }
        });
        assert.deepEqual(check.json.missing.sort(), [file.blob, v2.blob, orphan].sort());
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${orphan}`, { token: admin.token }), 'BLOB_NOT_FOUND');
        assert.equal((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${v3.blob}`, { token: admin.token })).status, 200);
        const usageAfter = (await call(server, 'GET', `/v1/spaces/${admin.spaceId}`, { token: admin.token })).json.usageBytes;
        assert.ok(usageAfter < usageBefore);
        assert.equal(
            server.sql('SELECT COUNT(*) AS n FROM commits WHERE space_id = ?', [admin.spaceId]).rows[0].n,
            0,
            '7 günden eski commit kayıtları silindi'
        );

        // Gc tekrar çalışınca bir şey değişmez.
        assert.equal(server.runBin('gc.php').status, 0);
        assert.deepEqual((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: admin.token })).json, { head: 4, prunedThrough: 2 });
    });
});
