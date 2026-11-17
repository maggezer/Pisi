// Senkron sunucusu sözleşmesi: taşıma, alanlar, kimlik doğrulama ve cihazlar
// (docs/sync-protocol.md §2, §3, §6.1, §6.2, §6.5, §9). `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SYNC_TEST_PHP, startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import {
    SYNC_SERVER_SKIP,
    readProtocolErrorCodes,
    call,
    createSpace,
    expectError,
    newToken,
    opaqueEnvelope,
    pairDevice,
    randomId,
    sha256Hex,
    uploadBlob
} from './sync-server-client.mjs';

describe('senkron sunucusu: taşıma, alanlar, cihazlar', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('sunucunun hata tablosu protokol §9.2 ile aynıdır (kod, HTTP durumu, yeniden dene)', () => {
        const script = "require 'server/app/src/bootstrap.php'; echo json_encode(PisiSync\\Errors::TABLE);";
        const result = spawnSync(SYNC_TEST_PHP, ['-r', script], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
        assert.equal(result.status, 0, result.stderr);
        const table = JSON.parse(result.stdout);
        const fromServer = Object.entries(table).map(([code, [status, retryable]]) => ({ status, code, retryable }));
        const byCode = (a, b) => (a.code < b.code ? -1 : 1);
        assert.deepEqual(fromServer.sort(byCode), readProtocolErrorCodes().sort(byCode));
    });

    test('GET /v1/info kimlik doğrulamasız sürüm ve sınırları verir', async () => {
        const response = await call(server, 'GET', '/v1/info', { protocol: null });
        assert.equal(response.status, 200);
        assert.equal(response.json.service, 'pisi-sync');
        assert.deepEqual(response.json.protocol, { min: 1, max: 1, revision: 1 });
        assert.equal(response.json.server.version, '1.0.0');
        assert.deepEqual(Object.keys(response.json.limits).sort(), [
            'maxBlobBytes',
            'maxChangesPage',
            'maxCheckBlobs',
            'maxCommitChanges',
            'maxHeadsPage',
            'maxRequestJsonBytes',
            'pairingTtlSeconds',
            'partBytes',
            'spaceQuotaBytes'
        ]);
        assert.equal(response.json.limits.maxBlobBytes, 64 * 1024 * 1024);
        assert.equal(response.json.limits.partBytes, 4 * 1024 * 1024);
        // partBytes sunucunun post_max_size'ının (testte 8M) altındadır.
        assert.ok(response.json.limits.partBytes < 8 * 1024 * 1024);
        assert.equal(response.json.limits.spaceQuotaBytes, null);
        assert.match(response.json.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(response.headers.get('set-cookie'), null);
    });

    test('düz HTTP reddedilir, yönlendirilmez', async () => {
        const response = await call(server, 'GET', '/v1/info', { https: false });
        expectError(assert, response, 'HTTPS_REQUIRED');
        assert.equal(response.headers.get('location'), null);
        const withToken = await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { https: false, token: newToken() });
        expectError(assert, withToken, 'HTTPS_REQUIRED');
    });

    test('bilinmeyen yol NOT_FOUND, yanlış yöntem METHOD_NOT_ALLOWED + Allow', async () => {
        expectError(assert, await call(server, 'GET', '/v1/nope'), 'NOT_FOUND');
        expectError(assert, await call(server, 'GET', '/'), 'NOT_FOUND');
        expectError(assert, await call(server, 'GET', '/v1/info/'), 'NOT_FOUND');
        const wrong = await call(server, 'PUT', '/v1/info');
        expectError(assert, wrong, 'METHOD_NOT_ALLOWED');
        assert.equal(wrong.headers.get('allow'), 'GET');
        const devices = await call(server, 'POST', `/v1/spaces/${randomId('sp_')}/devices/me`);
        expectError(assert, devices, 'METHOD_NOT_ALLOWED');
        assert.deepEqual(devices.headers.get('allow').split(', ').sort(), ['DELETE', 'GET', 'PATCH']);
    });

    test('Pisi-Sync-Protocol başlığı /v1/info dışında zorunludur', async () => {
        const missing = expectError(assert, await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { protocol: null }), 'PROTOCOL_UNSUPPORTED');
        assert.deepEqual(missing.details, { min: 1, max: 1 });
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { protocol: '2', body: { code: 'AAAA-AAAA' } }), 'PROTOCOL_UNSUPPORTED');
        expectError(assert, await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { protocol: 'bir' }), 'PROTOCOL_UNSUPPORTED');
    });

    test('CORS yalnız ayardaki kaynağa izin verir ve kimlik bilgisi istemez', async () => {
        const preflight = await call(server, 'OPTIONS', '/v1/spaces', { headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost');
        assert.match(preflight.headers.get('access-control-allow-headers'), /Pisi-Sync-Protocol/);
        assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
        assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
        const normal = await call(server, 'GET', '/v1/info', { headers: { Origin: 'https://localhost' } });
        assert.equal(normal.headers.get('access-control-allow-origin'), 'https://localhost');
        assert.match(normal.headers.get('access-control-expose-headers'), /Retry-After/);
        const other = await call(server, 'GET', '/v1/info', { headers: { Origin: 'https://ornek.invalid' } });
        assert.equal(other.headers.get('access-control-allow-origin'), null);
    });

    test('POST /v1/spaces alan ve admin cihazı açar', async () => {
        const space = await createSpace(server);
        assert.equal(space.response.status, 201);
        assert.equal(space.response.json.spaceId, space.spaceId);
        assert.equal(space.response.json.deviceId, space.deviceId);
        assert.equal(space.response.json.role, 'admin');
        assert.equal(space.response.json.head, 0);
        assert.match(space.response.json.createdAt, /Z$/);

        const info = await call(server, 'GET', `/v1/spaces/${space.spaceId}`, { token: space.token });
        assert.equal(info.status, 200);
        assert.equal(info.json.spaceId, space.spaceId);
        assert.equal(info.json.keyEpoch, 1);
        assert.equal(info.json.head, 0);
        assert.equal(info.json.prunedThrough, 0);
        assert.equal(info.json.usageBytes, 0);
        assert.equal(info.json.quotaBytes, null);
        assert.equal(typeof info.json.spaceName, 'string');
    });

    test('kurulum anahtarı, kimlik çakışması ve gövde hataları', async () => {
        const token = newToken();
        const body = {
            spaceId: randomId('sp_'),
            deviceId: randomId('dv_'),
            tokenHash: sha256Hex(token),
            spaceName: opaqueEnvelope(),
            deviceLabel: opaqueEnvelope()
        };
        expectError(assert, await call(server, 'POST', '/v1/spaces', { body }), 'SETUP_KEY_INVALID');
        expectError(assert, await call(server, 'POST', '/v1/spaces', { body, headers: { 'Pisi-Setup-Key': 'psk_yanlis' } }), 'SETUP_KEY_INVALID');

        const headers = { 'Pisi-Setup-Key': server.setupKey };
        const existing = await createSpace(server);
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, spaceId: existing.spaceId } }), 'ID_TAKEN');
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, deviceId: existing.deviceId } }), 'ID_TAKEN');
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, tokenHash: sha256Hex(existing.token) } }), 'ID_TAKEN');

        assert.equal(
            expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, tokenHash: 'abc' } }), 'INVALID_FIELD').details.field,
            'tokenHash'
        );
        assert.equal(
            expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, spaceId: 'sp_kisa' } }), 'INVALID_FIELD').details.field,
            'spaceId'
        );
        assert.equal(
            expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: { ...body, spaceName: 'kısa' } }), 'INVALID_FIELD').details.field,
            'spaceName'
        );
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: '{"spaceId": ' }), 'INVALID_JSON');
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: '[1, 2]' }), 'INVALID_JSON');
        expectError(
            assert,
            await call(server, 'POST', '/v1/spaces', { headers, body: JSON.stringify(body), contentType: 'text/plain' }),
            'UNSUPPORTED_MEDIA_TYPE'
        );
        const huge = JSON.stringify({ ...body, padding: 'x'.repeat(1024 * 1024 + 10) });
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers, body: huge }), 'PAYLOAD_TOO_LARGE');

        // Hiçbiri alan açmadı.
        const count = server.sql('SELECT COUNT(*) AS n FROM spaces WHERE space_id = ?', [body.spaceId]).rows[0].n;
        assert.equal(count, 0);
    });

    test('token: yok, biçimsiz, tanınmayan, iki başlık farklı; X-Pisi-Token yedeği çalışır', async () => {
        const space = await createSpace(server);
        const pathname = `/v1/spaces/${space.spaceId}/head`;
        expectError(assert, await call(server, 'GET', pathname), 'AUTH_REQUIRED');
        expectError(assert, await call(server, 'GET', pathname, { token: 'pst_kisa' }), 'TOKEN_INVALID');
        expectError(assert, await call(server, 'GET', pathname, { token: newToken() }), 'TOKEN_INVALID');
        expectError(assert, await call(server, 'GET', pathname, { headers: { Authorization: `Basic ${space.token}` } }), 'TOKEN_INVALID');
        expectError(assert, await call(server, 'GET', pathname, { token: space.token, headers: { 'X-Pisi-Token': newToken() } }), 'TOKEN_INVALID');

        const alternate = await call(server, 'GET', pathname, { headers: { 'X-Pisi-Token': space.token } });
        assert.equal(alternate.status, 200);
        assert.deepEqual(alternate.json, { head: 0, prunedThrough: 0 });
        const both = await call(server, 'GET', pathname, { token: space.token, headers: { 'X-Pisi-Token': space.token } });
        assert.equal(both.status, 200);
    });

    test('başka alanın kaynağı NOT_FOUND; biçimsiz alan kimliği BAD_REQUEST', async () => {
        const first = await createSpace(server);
        const second = await createSpace(server);
        expectError(assert, await call(server, 'GET', `/v1/spaces/${second.spaceId}`, { token: first.token }), 'NOT_FOUND');
        expectError(assert, await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { token: first.token }), 'NOT_FOUND');
        expectError(assert, await call(server, 'GET', `/v1/spaces/sp_kisa/head`, { token: first.token }), 'BAD_REQUEST');
    });

    test('cihazlar: liste, me, etiket değiştirme, son görülme dakikası', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        assert.equal(member.keyPackage.spaceId, admin.spaceId);
        assert.equal(member.keyPackage.deviceId, member.deviceId);

        const list = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/devices`, { token: admin.token });
        assert.equal(list.status, 200);
        assert.equal(list.json.devices.length, 2);
        const byId = Object.fromEntries(list.json.devices.map((device) => [device.deviceId, device]));
        assert.equal(byId[admin.deviceId].role, 'admin');
        assert.equal(byId[member.deviceId].role, 'member');
        for (const device of list.json.devices) {
            assert.equal(device.revokedAt, null);
            assert.equal(typeof device.label, 'string');
            assert.match(device.lastSeenAt, /:00\.000Z$/, 'son görülme dakika hassasiyetinde');
            assert.equal(device.lastProtocol, 1);
        }

        const me = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/devices/me`, { token: member.token });
        assert.equal(me.status, 200);
        assert.equal(me.json.deviceId, member.deviceId);
        assert.equal(me.json.role, 'member');

        const label = opaqueEnvelope(64);
        const patched = await call(server, 'PATCH', `/v1/spaces/${admin.spaceId}/devices/me`, { token: member.token, body: { label } });
        assert.equal(patched.status, 200);
        assert.equal(patched.json.label, label);
        expectError(
            assert,
            await call(server, 'PATCH', `/v1/spaces/${admin.spaceId}/devices/me`, { token: member.token, body: { label: 'x' } }),
            'INVALID_FIELD'
        );

        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/devices`, { token: member.token }), 'FORBIDDEN_ROLE');
        expectError(assert, await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, { token: member.token, body: {} }), 'FORBIDDEN_ROLE');
        expectError(
            assert,
            await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}`, { token: member.token, body: { confirm: admin.spaceId } }),
            'FORBIDDEN_ROLE'
        );
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/${admin.deviceId}`, { token: member.token }), 'FORBIDDEN_ROLE');
    });

    test('iptal: iptal edilen cihazın her isteği DEVICE_REVOKED; son admin kendini iptal edemez', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/me`, { token: admin.token }), 'LAST_ADMIN');
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/${admin.deviceId}`, { token: admin.token }), 'LAST_ADMIN');
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/${randomId('dv_')}`, { token: admin.token }), 'NOT_FOUND');

        const revoked = await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/${member.deviceId}`, { token: admin.token });
        assert.equal(revoked.status, 204);
        const again = await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/${member.deviceId}`, { token: admin.token });
        assert.equal(again.status, 204, 'iptal tekrarlanabilir');

        const space = admin.spaceId;
        const requests = [
            ['GET', `/v1/spaces/${space}`],
            ['GET', `/v1/spaces/${space}/head`],
            ['GET', `/v1/spaces/${space}/changes?after=0`],
            ['GET', `/v1/spaces/${space}/heads`],
            ['POST', `/v1/spaces/${space}/commit`, { commitId: randomId('cm_'), changes: [] }],
            ['POST', `/v1/spaces/${space}/blobs/check`, { blobs: [] }],
            ['GET', `/v1/spaces/${space}/devices/me`],
            ['PATCH', `/v1/spaces/${space}/devices/me`, { label: opaqueEnvelope() }],
            ['DELETE', `/v1/spaces/${space}/devices/me`],
            ['GET', `/v1/spaces/${randomId('sp_')}/head`]
        ];
        for (const [method, pathname, body] of requests) {
            expectError(assert, await call(server, method, pathname, { token: member.token, body }), 'DEVICE_REVOKED');
        }
        const list = await call(server, 'GET', `/v1/spaces/${space}/devices`, { token: admin.token });
        const row = list.json.devices.find((device) => device.deviceId === member.deviceId);
        assert.match(row.revokedAt, /Z$/, 'satır ve iptal zamanı kalır');
    });

    test('üye kendi bağlantısını kaldırabilir; ikinci admin varken admin ayrılabilir', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        assert.equal((await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/me`, { token: member.token })).status, 204);
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: member.token }), 'DEVICE_REVOKED');

        const second = await pairDevice(server, admin, { role: 'admin', name: 'İkinci masaüstü' });
        assert.equal(second.result.role, 'admin');
        assert.equal((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/devices`, { token: second.token })).status, 200);
        assert.equal((await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/me`, { token: admin.token })).status, 204);
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/devices/me`, { token: second.token }), 'LAST_ADMIN');
    });

    test('DELETE /v1/spaces/{space} onay ister; sonra her şey silinir', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        expectError(
            assert,
            await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}`, { token: admin.token, body: { confirm: randomId('sp_') } }),
            'INVALID_FIELD'
        );
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}`, { token: admin.token, body: {} }), 'INVALID_FIELD');
        const blob = crypto.randomBytes(500);
        await uploadBlob(server, admin, blob);

        const deleted = await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}`, { token: admin.token, body: { confirm: admin.spaceId } });
        assert.equal(deleted.status, 204);
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}`, { token: admin.token }), 'TOKEN_INVALID');
        expectError(assert, await call(server, 'GET', `/v1/spaces/${admin.spaceId}`, { token: member.token }), 'TOKEN_INVALID');
        for (const table of ['spaces', 'devices', 'pairings', 'heads', 'changes', 'blobs', 'uploads', 'commits']) {
            assert.equal(server.sql(`SELECT COUNT(*) AS n FROM ${table} WHERE space_id = ?`, [admin.spaceId]).rows[0].n, 0, table);
        }
    });
});
