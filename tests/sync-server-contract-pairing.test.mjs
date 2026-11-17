// Senkron sunucusu sözleşmesi: eşleştirme (docs/sync-protocol.md §6.6). Sunucu proof'u
// doğrulayamaz ve anahtar paketini açamaz; istemci kriptosu shared/sync-crypto.mjs'ten gelir.
// `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import {
    computePisiSyncPairingProof,
    computePisiSyncSas,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    exportPisiSyncEcdhPublicKey,
    generatePisiSyncEcdhKeyPair,
    importPisiSyncEcdhPublicKey,
    openPisiSyncJson,
    sealPisiSyncJson,
    verifyPisiSyncPairingProof
} from '../shared/sync-crypto.mjs';
import { makePisiSyncKeyPackage, normalizePisiSyncPairingCode, parsePisiSyncKeyPackage } from '../shared/sync-meta.mjs';
import {
    SYNC_SERVER_SKIP,
    call,
    createSpace,
    expectError,
    newToken,
    opaqueEnvelope,
    pairDevice,
    randomId,
    sealLabel,
    sha256Hex,
    subtle
} from './sync-server-client.mjs';

async function startPairing(server, admin) {
    const pairingId = randomId('pr_');
    const deviceId = randomId('dv_');
    const keys = await generatePisiSyncEcdhKeyPair(subtle);
    const desktopKey = await exportPisiSyncEcdhPublicKey(subtle, keys.publicKey);
    const response = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, { token: admin.token, body: { pairingId, deviceId, desktopKey } });
    return { pairingId, deviceId, keys, desktopKey, response, code: response.json?.code };
}

async function phoneClaim(server, admin, pairing, { method = 'qr', secret = crypto.randomBytes(32), code = null, token = newToken() } = {}) {
    const keys = await generatePisiSyncEcdhKeyPair(subtle);
    const deviceKey = await exportPisiSyncEcdhPublicKey(subtle, keys.publicKey);
    const z = await derivePisiSyncSharedSecret(subtle, keys.privateKey, await importPisiSyncEcdhPublicKey(subtle, pairing.desktopKey));
    const kek = await derivePisiSyncPairingKek(subtle, z, pairing.pairingId, pairing.desktopKey, deviceKey);
    const body = {
        method,
        proof: method === 'qr' ? await computePisiSyncPairingProof(subtle, secret, pairing.pairingId, deviceKey) : null,
        code: method === 'code' ? code : null,
        deviceKey,
        label: await sealLabel(kek, admin.spaceId, 'pair-label', pairing.pairingId, 'Pixel 7', 'android'),
        tokenHash: sha256Hex(token)
    };
    const response = await call(server, 'POST', `/v1/pairings/${pairing.pairingId}/claim`, { body });
    return { response, token, deviceKey, z, kek, secret, body };
}

describe('senkron sunucusu: eşleştirme', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('QR yolu: başlat → katıl → proof doğrula → onay → sonuç; anahtar paketi yalnız bir kez alınır', async () => {
        const admin = await createSpace(server);
        const pairing = await startPairing(server, admin);
        assert.equal(pairing.response.status, 201);
        assert.equal(pairing.response.json.pairingId, pairing.pairingId);
        assert.match(pairing.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        assert.match(pairing.response.json.expiresAt, /Z$/);

        const open = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}`, { token: admin.token });
        assert.deepEqual(open.json, {
            pairingId: pairing.pairingId,
            state: 'open',
            method: null,
            deviceKey: null,
            proof: null,
            label: null,
            expiresAt: pairing.response.json.expiresAt
        });
        const early = await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { token: newToken() });
        expectError(assert, early, 'TOKEN_INVALID');
        expectError(assert, await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`), 'AUTH_REQUIRED');
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}/grant`, {
                token: admin.token,
                body: { role: 'member', wrappedKey: opaqueEnvelope(), label: opaqueEnvelope() }
            }),
            'PAIRING_STATE'
        );

        const phone = await phoneClaim(server, admin, pairing);
        assert.equal(phone.response.status, 202);
        assert.equal(phone.response.json.state, 'claimed');
        expectError(assert, (await phoneClaim(server, admin, pairing)).response, 'PAIRING_STATE');

        const waiting = await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { token: phone.token });
        assert.equal(waiting.status, 202);
        assert.deepEqual(waiting.json, { state: 'claimed' });
        expectError(assert, await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { token: newToken() }), 'TOKEN_INVALID');

        const claimed = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}`, { token: admin.token });
        assert.equal(claimed.json.state, 'claimed');
        assert.equal(claimed.json.method, 'qr');
        assert.equal(claimed.json.deviceKey, phone.deviceKey);
        assert.ok(
            await verifyPisiSyncPairingProof(subtle, phone.secret, pairing.pairingId, claimed.json.deviceKey, claimed.json.proof),
            "masaüstü proof'u QR sırrıyla doğrular"
        );
        const z = await derivePisiSyncSharedSecret(subtle, pairing.keys.privateKey, await importPisiSyncEcdhPublicKey(subtle, claimed.json.deviceKey));
        const kek = await derivePisiSyncPairingKek(subtle, z, pairing.pairingId, pairing.desktopKey, claimed.json.deviceKey);
        const label = await openPisiSyncJson({
            subtle,
            key: kek,
            spaceId: admin.spaceId,
            purpose: 'pair-label',
            binding: pairing.pairingId,
            envelope: claimed.json.label
        });
        assert.deepEqual(label, { v: 1, name: 'Pixel 7', platform: 'android' });

        const projectKey = crypto.randomBytes(32);
        const wrappedKey = await sealPisiSyncJson({
            subtle,
            key: kek,
            spaceId: admin.spaceId,
            purpose: 'pair-key',
            binding: pairing.pairingId,
            value: makePisiSyncKeyPackage({ spaceId: admin.spaceId, deviceId: pairing.deviceId, key: projectKey, spaceName: 'Pisi Projem' }),
            nonce: crypto.randomBytes(12)
        });
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}/grant`, {
                token: admin.token,
                body: { role: 'owner', wrappedKey, label: opaqueEnvelope() }
            }),
            'INVALID_FIELD'
        );
        const granted = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}/grant`, {
            token: admin.token,
            body: { role: 'member', wrappedKey, label: opaqueEnvelope() }
        });
        assert.equal(granted.status, 200);
        assert.deepEqual(granted.json, { state: 'granted', deviceId: pairing.deviceId });

        const result = await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { headers: { 'X-Pisi-Token': phone.token } });
        assert.equal(result.status, 200);
        assert.deepEqual(result.json, {
            state: 'granted',
            spaceId: admin.spaceId,
            deviceId: pairing.deviceId,
            role: 'member',
            wrappedKey,
            desktopKey: pairing.desktopKey
        });
        const keyPackage = parsePisiSyncKeyPackage(
            await openPisiSyncJson({
                subtle,
                key: phone.kek,
                spaceId: admin.spaceId,
                purpose: 'pair-key',
                binding: pairing.pairingId,
                envelope: result.json.wrappedKey
            }),
            { spaceId: admin.spaceId, deviceId: pairing.deviceId }
        );
        assert.deepEqual(Buffer.from(keyPackage.key), projectKey);

        const second = expectError(assert, await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { token: phone.token }), 'PAIRING_STATE');
        assert.deepEqual(second.details, { state: 'collected' });
        const row = server.sql('SELECT state, wrapped_key, code_hash FROM pairings WHERE pairing_id = ?', [pairing.pairingId]).rows[0];
        assert.deepEqual(row, { state: 'collected', wrapped_key: null, code_hash: null }, 'anahtar paketi sunucudan silindi');

        const me = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/devices/me`, { token: phone.token });
        assert.equal(me.json.deviceId, pairing.deviceId);
        assert.equal(me.json.role, 'member');
    });

    test('kod yolu: lookup → claim → iki tarafta aynı doğrulama numarası → onay', async () => {
        const admin = await createSpace(server);
        const pairing = await startPairing(server, admin);
        const typed = pairing.code.toLowerCase().replace('-', ' ');
        const lookup = await call(server, 'POST', '/v1/pairings/lookup', { body: { code: typed } });
        assert.equal(lookup.status, 200);
        assert.deepEqual(lookup.json, {
            pairingId: pairing.pairingId,
            spaceId: admin.spaceId,
            desktopKey: pairing.desktopKey,
            expiresAt: pairing.response.json.expiresAt
        });
        assert.equal((await call(server, 'POST', '/v1/pairings/lookup', { body: { code: normalizePisiSyncPairingCode(pairing.code) } })).status, 200);

        const phone = await phoneClaim(server, admin, { ...pairing, desktopKey: lookup.json.desktopKey }, { method: 'code', code: pairing.code.toLowerCase() });
        assert.equal(phone.response.status, 202);
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: pairing.code } }), 'PAIRING_NOT_FOUND');

        const status = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}`, { token: admin.token });
        assert.equal(status.json.method, 'code');
        assert.equal(status.json.proof, null);
        const desktopZ = await derivePisiSyncSharedSecret(subtle, pairing.keys.privateKey, await importPisiSyncEcdhPublicKey(subtle, status.json.deviceKey));
        const desktopSas = await computePisiSyncSas(subtle, desktopZ, pairing.pairingId, pairing.desktopKey, status.json.deviceKey);
        const phoneSas = await computePisiSyncSas(subtle, phone.z, pairing.pairingId, lookup.json.desktopKey, phone.deviceKey);
        assert.equal(desktopSas, phoneSas);

        const granted = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}/grant`, {
            token: admin.token,
            body: { role: 'member', wrappedKey: opaqueEnvelope(), label: opaqueEnvelope() }
        });
        assert.equal(granted.status, 200);
        assert.equal((await call(server, 'GET', `/v1/pairings/${pairing.pairingId}/result`, { token: phone.token })).status, 200);
    });

    test('yanlış kod: PAIRING_CODE_INVALID; 5 yanlıştan sonra eşleştirme kapanır', async () => {
        const admin = await createSpace(server);
        const pairing = await startPairing(server, admin);
        const wrong = pairing.code.startsWith('0') ? '1111-1111' : '0000-0000';
        for (let attempt = 1; attempt <= 5; attempt++) {
            expectError(assert, (await phoneClaim(server, admin, pairing, { method: 'code', code: wrong })).response, 'PAIRING_CODE_INVALID');
        }
        expectError(assert, (await phoneClaim(server, admin, pairing, { method: 'code', code: pairing.code })).response, 'PAIRING_EXPIRED');
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: pairing.code } }), 'PAIRING_NOT_FOUND');
        assert.equal(server.sql('SELECT failed_attempts AS n FROM pairings WHERE pairing_id = ?', [pairing.pairingId]).rows[0].n, 5);

        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: 'ZZZZ-ZZZZ' } }), 'PAIRING_NOT_FOUND');
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: 'OOOO-IIII' } }), 'PAIRING_NOT_FOUND');
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: {} }), 'INVALID_FIELD');
        expectError(
            assert,
            await call(server, 'POST', `/v1/pairings/${randomId('pr_')}/claim`, { body: (await phoneClaim(server, admin, pairing)).body }),
            'PAIRING_NOT_FOUND'
        );
    });

    test('ret: telefon PAIRING_REJECTED alır; iptal: katılım PAIRING_STATE', async () => {
        const admin = await createSpace(server);
        const rejected = await startPairing(server, admin);
        const phone = await phoneClaim(server, admin, rejected);
        const response = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${rejected.pairingId}/reject`, { token: admin.token, body: {} });
        assert.deepEqual(response.json, { state: 'rejected' });
        expectError(assert, await call(server, 'GET', `/v1/pairings/${rejected.pairingId}/result`, { token: phone.token }), 'PAIRING_REJECTED');
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${rejected.pairingId}/grant`, {
                token: admin.token,
                body: { role: 'member', wrappedKey: opaqueEnvelope(), label: opaqueEnvelope() }
            }),
            'PAIRING_STATE'
        );
        expectError(
            assert,
            await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/pairings/${rejected.pairingId}`, { token: admin.token }),
            'PAIRING_STATE'
        );

        const cancelled = await startPairing(server, admin);
        assert.equal((await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/pairings/${cancelled.pairingId}`, { token: admin.token })).status, 204);
        assert.equal((await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/pairings/${cancelled.pairingId}`, { token: admin.token })).status, 204);
        assert.equal(
            (await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${cancelled.pairingId}`, { token: admin.token })).json.state,
            'cancelled'
        );
        assert.deepEqual(expectError(assert, (await phoneClaim(server, admin, cancelled)).response, 'PAIRING_STATE').details, { state: 'cancelled' });
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: cancelled.code } }), 'PAIRING_NOT_FOUND');
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${cancelled.pairingId}/reject`, { token: admin.token, body: {} }),
            'PAIRING_STATE'
        );

        const other = await createSpace(server);
        expectError(
            assert,
            await call(server, 'GET', `/v1/spaces/${other.spaceId}/pairings/${cancelled.pairingId}`, { token: other.token }),
            'PAIRING_NOT_FOUND'
        );
    });

    test('süresi dolan eşleştirme: lookup bulamaz, claim ve sonuç PAIRING_EXPIRED', async () => {
        const admin = await createSpace(server);
        const pairing = await startPairing(server, admin);
        server.sql('UPDATE pairings SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE pairing_id = ?', [pairing.pairingId]);
        expectError(assert, await call(server, 'POST', '/v1/pairings/lookup', { body: { code: pairing.code } }), 'PAIRING_NOT_FOUND');
        expectError(assert, (await phoneClaim(server, admin, pairing)).response, 'PAIRING_EXPIRED');
        assert.equal((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${pairing.pairingId}`, { token: admin.token })).json.state, 'expired');

        const claimed = await startPairing(server, admin);
        const phone = await phoneClaim(server, admin, claimed);
        server.sql('UPDATE pairings SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE pairing_id = ?', [claimed.pairingId]);
        expectError(assert, await call(server, 'GET', `/v1/pairings/${claimed.pairingId}/result`, { token: phone.token }), 'PAIRING_EXPIRED');
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${claimed.pairingId}/grant`, {
                token: admin.token,
                body: { role: 'member', wrappedKey: opaqueEnvelope(), label: opaqueEnvelope() }
            }),
            'PAIRING_EXPIRED'
        );

        server.sql('UPDATE pairings SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 8 DAY) WHERE space_id = ?', [admin.spaceId]);
        assert.equal(server.runBin('gc.php').status, 0);
        assert.equal(server.sql('SELECT COUNT(*) AS n FROM pairings WHERE space_id = ?', [admin.spaceId]).rows[0].n, 0, '7 gün sonra silinir');
    });

    test('bir alanda en çok 3 açık eşleştirme; kimlik çakışmaları; biçim hataları', async () => {
        const admin = await createSpace(server);
        const opened = [];
        for (let index = 0; index < 3; index++) opened.push(await startPairing(server, admin));
        const fourth = await startPairing(server, admin);
        assert.deepEqual(expectError(assert, fourth.response, 'PAIRING_LIMIT').details, { limit: 3 });
        await call(server, 'DELETE', `/v1/spaces/${admin.spaceId}/pairings/${opened[0].pairingId}`, { token: admin.token });
        const desktopKey = opened[1].desktopKey;
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, {
                token: admin.token,
                body: { pairingId: opened[1].pairingId, deviceId: randomId('dv_'), desktopKey }
            }),
            'ID_TAKEN'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, {
                token: admin.token,
                body: { pairingId: randomId('pr_'), deviceId: opened[1].deviceId, desktopKey }
            }),
            'ID_TAKEN'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, {
                token: admin.token,
                body: { pairingId: randomId('pr_'), deviceId: admin.deviceId, desktopKey }
            }),
            'ID_TAKEN'
        );
        expectError(
            assert,
            await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, {
                token: admin.token,
                body: { pairingId: randomId('pr_'), deviceId: randomId('dv_'), desktopKey: 'kisa' }
            }),
            'INVALID_FIELD'
        );

        // Telefonun token'ı başka bir cihazınkiyle aynı olamaz.
        const taken = await phoneClaim(server, admin, opened[1], { token: admin.token });
        expectError(assert, taken.response, 'ID_TAKEN');
        const badClaim = await phoneClaim(server, admin, opened[1]);
        assert.equal(badClaim.response.status, 202);
        const qrWithoutProof = { ...badClaim.body, proof: null };
        assert.equal(
            expectError(assert, await call(server, 'POST', `/v1/pairings/${opened[2].pairingId}/claim`, { body: qrWithoutProof }), 'INVALID_FIELD').details
                .field,
            'proof'
        );
        assert.equal(
            expectError(
                assert,
                await call(server, 'POST', `/v1/pairings/${opened[2].pairingId}/claim`, { body: { ...badClaim.body, method: 'nfc' } }),
                'INVALID_FIELD'
            ).details.field,
            'method'
        );
        expectError(assert, await call(server, 'POST', `/v1/pairings/pr_kisa/claim`, { body: badClaim.body }), 'BAD_REQUEST');
    });

    test('pairDevice yardımcısı uçtan uca çalışır ve üye cihaz senkron uç noktalarına erişir', async () => {
        const admin = await createSpace(server);
        const member = await pairDevice(server, admin);
        assert.equal(member.label.name, 'Pixel 7');
        assert.equal((await call(server, 'GET', `/v1/spaces/${admin.spaceId}/head`, { token: member.token })).status, 200);
    });
});
