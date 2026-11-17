// Senkron sunucusu sözleşmesi: blob sorma, parçalı yükleme ve Range ile indirme
// (docs/sync-protocol.md §6.4, §12). Test sunucusu post_max_size = 8M ile çalışır.
// `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP, blobIdFor, call, createSpace, expectError, randomId, sha256Hex, uploadBlob } from './sync-server-client.mjs';

const MIB = 1024 * 1024;

async function start(server, device, bytes, blobId = blobIdFor(bytes), sha256 = sha256Hex(bytes)) {
    return call(server, 'POST', `/v1/spaces/${device.spaceId}/blobs/${blobId}/uploads`, { token: device.token, body: { size: bytes.length, sha256 } });
}

async function putPart(server, device, uploadId, part, chunk, hash = sha256Hex(chunk), extra = {}) {
    return call(server, 'PUT', `/v1/spaces/${device.spaceId}/uploads/${uploadId}/parts/${part}`, {
        token: device.token,
        body: chunk,
        headers: { 'Pisi-Part-Sha256': hash },
        ...extra
    });
}

async function complete(server, device, uploadId) {
    return call(server, 'POST', `/v1/spaces/${device.spaceId}/uploads/${uploadId}/complete`, { token: device.token, body: {} });
}

describe("senkron sunucusu: blob'lar", { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    let admin;
    before(async () => {
        server = await startSyncTestServer({ ini: { post_max_size: '8M' } });
        admin = await createSpace(server);
    });
    after(async () => {
        await server?.stop();
    });

    test('20 MB blob 4 MiB parçalarla yüklenir, Range ile parça parça iner ve özeti tutar', async () => {
        const bytes = crypto.randomBytes(20 * 1000 * 1000);
        const blobId = blobIdFor(bytes);
        const started = await start(server, admin, bytes, blobId);
        assert.equal(started.status, 201);
        assert.equal(started.json.partBytes, 4 * MIB);
        assert.equal(started.json.parts, 5);
        assert.match(started.json.uploadId, /^up_[A-Za-z0-9_-]{22}$/);
        assert.match(started.json.expiresAt, /Z$/);
        const { uploadId, partBytes } = started.json;
        const chunk = (part) => bytes.subarray((part - 1) * partBytes, part * partBytes);

        // Parçalar sırasız gelir; bir parça yeniden gönderilir (son gelen geçerlidir).
        for (const part of [3, 1, 5]) assert.equal((await putPart(server, admin, uploadId, part, chunk(part))).status, 200);
        const incomplete = expectError(assert, await complete(server, admin, uploadId), 'UPLOAD_INCOMPLETE');
        assert.deepEqual(incomplete.details, { missing: [2, 4] });
        await putPart(server, admin, uploadId, 2, chunk(2));
        const last = await putPart(server, admin, uploadId, 4, chunk(4));
        assert.deepEqual(last.json, { part: 4, received: bytes.length });
        assert.equal((await putPart(server, admin, uploadId, 4, chunk(4))).status, 200);

        const done = await complete(server, admin, uploadId);
        assert.equal(done.status, 201);
        assert.deepEqual(done.json, { blob: blobId, size: bytes.length });

        const whole = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${blobId}`, { token: admin.token });
        assert.equal(whole.status, 200);
        assert.equal(whole.headers.get('content-type'), 'application/octet-stream');
        assert.equal(whole.headers.get('content-length'), String(bytes.length));
        assert.equal(whole.headers.get('accept-ranges'), 'bytes');
        assert.equal(whole.headers.get('etag'), `"${blobId}"`);
        assert.equal(whole.headers.get('pisi-blob-sha256'), sha256Hex(bytes));
        assert.equal(sha256Hex(whole.bytes), sha256Hex(bytes));

        const pieces = [];
        for (let offset = 0; offset < bytes.length; offset += 4 * MIB) {
            const end = Math.min(bytes.length, offset + 4 * MIB) - 1;
            const piece = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${blobId}`, {
                token: admin.token,
                headers: { Range: `bytes=${offset}-${end}` }
            });
            assert.equal(piece.status, 206);
            assert.equal(piece.headers.get('content-range'), `bytes ${offset}-${end}/${bytes.length}`);
            pieces.push(piece.bytes);
        }
        assert.equal(sha256Hex(Buffer.concat(pieces)), sha256Hex(bytes));

        const suffix = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${blobId}`, { token: admin.token, headers: { Range: 'bytes=-10' } });
        assert.equal(suffix.status, 206);
        assert.deepEqual(Buffer.from(suffix.bytes), bytes.subarray(bytes.length - 10));
        const open = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${blobId}`, {
            token: admin.token,
            headers: { Range: `bytes=${bytes.length - 5}-` }
        });
        assert.deepEqual(Buffer.from(open.bytes), bytes.subarray(bytes.length - 5));

        const info = await call(server, 'GET', `/v1/spaces/${admin.spaceId}`, { token: admin.token });
        assert.equal(info.json.usageBytes, bytes.length);
    });

    test('blob dosyası web kökünün dışında, 0600; klasörler 0700; yükleme klasörü temizlenir', async () => {
        const bytes = crypto.randomBytes(5000);
        const blobId = await uploadBlob(server, admin, bytes);
        const file = path.join(server.dataDir, 'blobs', admin.spaceId, blobId.slice(2, 4), blobId.slice(4, 6), blobId);
        assert.ok(fs.existsSync(file));
        assert.equal(sha256Hex(fs.readFileSync(file)), sha256Hex(bytes));
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
        assert.equal(fs.statSync(path.join(server.dataDir, 'blobs')).mode & 0o777, 0o700);
        assert.deepEqual(fs.existsSync(path.join(server.dataDir, 'tmp')) ? fs.readdirSync(path.join(server.dataDir, 'tmp')) : [], []);
    });

    test('blobs/check eksikleri döner; sınır ve biçim hataları', async () => {
        const present = await uploadBlob(server, admin, crypto.randomBytes(100));
        const absent = randomId('b_', 32);
        const response = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, {
            token: admin.token,
            body: { blobs: [present, absent, absent] }
        });
        assert.deepEqual(response.json, { missing: [absent] });
        assert.deepEqual((await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, { token: admin.token, body: { blobs: [] } })).json, {
            missing: []
        });
        const many = Array.from({ length: 501 }, () => randomId('b_', 32));
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, { token: admin.token, body: { blobs: many } }),
            'BATCH_TOO_LARGE'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, { token: admin.token, body: { blobs: ['b_kisa'] } }),
            'INVALID_FIELD'
        );
        expectError(assert, await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/check`, { token: admin.token, body: {} }), 'INVALID_FIELD');
    });

    test("var olan blob için yükleme exists döner; aynı blob'un iki yüklemesinden ikincisi exists ile biter", async () => {
        const bytes = crypto.randomBytes(3000);
        const blobId = blobIdFor(bytes);
        const first = await start(server, admin, bytes);
        const second = await start(server, admin, bytes);
        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        for (const upload of [first, second]) await putPart(server, admin, upload.json.uploadId, 1, bytes);
        assert.equal((await complete(server, admin, first.json.uploadId)).status, 201);
        const late = await complete(server, admin, second.json.uploadId);
        assert.equal(late.status, 200);
        assert.deepEqual(late.json, { blob: blobId, size: bytes.length, exists: true });
        const again = await start(server, admin, bytes);
        assert.equal(again.status, 200);
        assert.deepEqual(again.json, { exists: true });
        assert.equal(server.sql('SELECT COUNT(*) AS n FROM blobs WHERE space_id = ? AND blob_id = ?', [admin.spaceId, blobId]).rows[0].n, 1);
    });

    test('yükleme başlatma hataları: boyut sınırı, kota, biçim', async () => {
        const blobId = randomId('b_', 32);
        const body = (size) => ({ size, sha256: sha256Hex(Buffer.from('x')) });
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/${blobId}/uploads`, { token: admin.token, body: body(64 * MIB + 1) }),
            'PAYLOAD_TOO_LARGE'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/${blobId}/uploads`, { token: admin.token, body: body(0) }),
            'INVALID_FIELD'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/${blobId}/uploads`, { token: admin.token, body: { size: 10, sha256: 'ABC' } }),
            'INVALID_FIELD'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/blobs/b_kisa/uploads`, { token: admin.token, body: body(10) }),
            'BAD_REQUEST'
        );

        const quota = await createSpace(server);
        server.sql('UPDATE spaces SET quota_bytes = 1000 WHERE space_id = ?', [quota.spaceId]);
        await uploadBlob(server, quota, crypto.randomBytes(600));
        const over = expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${quota.spaceId}/blobs/${blobId}/uploads`, { token: quota.token, body: body(500) }),
            'QUOTA_EXCEEDED'
        );
        assert.equal(over.details.quotaBytes, 1000);
        assert.equal((await call(server, 'GET', `/v1/spaces/${quota.spaceId}`, { token: quota.token })).json.quotaBytes, 1000);
    });

    test('parça hataları: özet, boyut, tür, numara, başlık', async () => {
        const bytes = crypto.randomBytes(5 * MIB);
        const started = await start(server, admin, bytes);
        const { uploadId } = started.json;
        const first = bytes.subarray(0, 4 * MIB);
        const rest = bytes.subarray(4 * MIB);
        expectError(assert, await putPart(server, admin, uploadId, 1, first, sha256Hex(Buffer.from('başka'))), 'HASH_MISMATCH');
        expectError(assert, await putPart(server, admin, uploadId, 1, first.subarray(0, 1000)), 'BAD_REQUEST');
        expectError(assert, await putPart(server, admin, uploadId, 2, Buffer.concat([rest, Buffer.from('fazla')])), 'PAYLOAD_TOO_LARGE');
        expectError(assert, await putPart(server, admin, uploadId, 1, first, sha256Hex(first), { contentType: 'application/json' }), 'UNSUPPORTED_MEDIA_TYPE');
        expectError(assert, await putPart(server, admin, uploadId, 0, first), 'BAD_REQUEST');
        expectError(assert, await putPart(server, admin, uploadId, 3, rest), 'BAD_REQUEST');
        expectError(assert, await putPart(server, admin, uploadId, 1, first, 'yok'), 'BAD_REQUEST');
        expectError(assert, await putPart(server, admin, randomId('up_'), 1, first), 'UPLOAD_NOT_FOUND');
        // Hatalı denemeler kayıt bırakmaz; doğru parçalar yine kabul edilir.
        assert.equal((await putPart(server, admin, uploadId, 1, first)).status, 200);
        assert.equal((await putPart(server, admin, uploadId, 2, rest)).status, 200);
        assert.equal((await complete(server, admin, uploadId)).status, 201);
    });

    test('birleşik özet tutmazsa HASH_MISMATCH ve yükleme silinir', async () => {
        const bytes = crypto.randomBytes(2000);
        const started = await start(server, admin, bytes, blobIdFor(bytes), sha256Hex(Buffer.from('yanlış')));
        await putPart(server, admin, started.json.uploadId, 1, bytes);
        expectError(assert, await complete(server, admin, started.json.uploadId), 'HASH_MISMATCH');
        expectError(assert, await complete(server, admin, started.json.uploadId), 'UPLOAD_NOT_FOUND');
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${blobIdFor(bytes)}`, { token: admin.token }), 'BLOB_NOT_FOUND');
    });

    test('yüklemeyi bırakma, süresi dolan yükleme, başka alanın yüklemesi', async () => {
        const bytes = crypto.randomBytes(1000);
        const started = await start(server, admin, bytes);
        const { uploadId } = started.json;
        const other = await createSpace(server);
        expectError(assert, await putPart(server, other, uploadId, 1, bytes), 'UPLOAD_NOT_FOUND');
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${other.spaceId}/uploads/${uploadId}`, { token: other.token }), 'UPLOAD_NOT_FOUND');
        assert.equal((await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/uploads/${uploadId}`, { token: admin.token })).status, 204);
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/uploads/${uploadId}`, { token: admin.token }), 'UPLOAD_NOT_FOUND');
        assert.equal(fs.existsSync(path.join(server.dataDir, 'tmp', uploadId)), false);

        const expiring = await start(server, admin, bytes);
        await putPart(server, admin, expiring.json.uploadId, 1, bytes);
        server.sql('UPDATE uploads SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE upload_id = ?', [expiring.json.uploadId]);
        const expired = expectError(assert, await complete(server, admin, expiring.json.uploadId), 'UPLOAD_EXPIRED');
        assert.equal(expired.retryable, true);
        expectError(assert, await putPart(server, admin, expiring.json.uploadId, 1, bytes), 'UPLOAD_EXPIRED');
        assert.equal(server.runBin('gc.php').status, 0);
        expectError(assert, await complete(server, admin, expiring.json.uploadId), 'UPLOAD_NOT_FOUND');
        assert.equal(fs.existsSync(path.join(server.dataDir, 'tmp', expiring.json.uploadId)), false, 'gc parçaları sildi');
    });

    test('indirme hataları: blob yok, geçersiz ya da çoklu aralık', async () => {
        const bytes = crypto.randomBytes(1000);
        const blobId = await uploadBlob(server, admin, bytes);
        const url = `/v1/spaces/${admin.spaceId}/blobs/${blobId}`;
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/blobs/${randomId('b_', 32)}`, { token: admin.token }), 'BLOB_NOT_FOUND');
        const other = await createSpace(server);
        expectError(assert, await call(server, 'GET', `/v1/spaces/${other.spaceId}/blobs/${blobId}`, { token: other.token }), 'BLOB_NOT_FOUND');
        for (const range of ['bytes=1000-', 'bytes=5-2', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-0']) {
            const response = await call(server, 'GET', url, { token: admin.token, headers: { Range: range } });
            expectError(assert, response, 'RANGE_NOT_SATISFIABLE');
            assert.equal(response.headers.get('content-range'), 'bytes */1000');
        }
        const clipped = await call(server, 'GET', url, { token: admin.token, headers: { Range: 'bytes=990-5000' } });
        assert.equal(clipped.status, 206);
        assert.equal(clipped.bytes.length, 10);
    });
});
