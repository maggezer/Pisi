// Claim side of a pairing (docs/sync-protocol.md §6.6): the device that joins a
// space. The phone (mobile/src/sync/) and a second desktop
// (main/functions/sync-client-pairing.js) share it. The ECDH private key stays
// in memory; the token is made here and only its hash reaches the server
// before the desktop grants the device. `http` is a client of sync-http.mjs.

import {
    computePisiSyncPairingProof,
    computePisiSyncSas,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    exportPisiSyncEcdhPublicKey,
    formatPisiSyncRandomId,
    formatPisiSyncSas,
    generatePisiSyncEcdhKeyPair,
    hashPisiSyncToken,
    importPisiSyncEcdhPublicKey,
    openPisiSyncJson,
    sealPisiSyncJson
} from './sync-crypto.mjs';
import { formatPisiSyncPairingCode, makePisiSyncLabel, normalizePisiSyncPairingCode, parsePisiSyncKeyPackage, parsePisiSyncPairingUri } from './sync-meta.mjs';

const sealLabel = (subtle, key, spaceId, purpose, binding, label, random) =>
    sealPisiSyncJson({ subtle, key, spaceId, purpose, binding, value: label, nonce: random(12) });

/**
 * Code path (§6.6): looks the code up, claims with a new token and returns the
 * verification number both screens show. `pollPisiSyncJoinResult` then polls
 * the result and opens the key package.
 */
export async function claimPisiSyncPairingWithCode({ subtle, http, code, deviceName, platform, random }) {
    const normalized = normalizePisiSyncPairingCode(code);
    if (!normalized) throw Object.assign(new Error('Kod geçersiz.'), { code: 'PAIRING_CODE_INVALID' });
    const { data: found } = await http.post('/v1/pairings/lookup', { code: formatPisiSyncPairingCode(normalized) }, { auth: false });
    const ecdh = await generatePisiSyncEcdhKeyPair(subtle);
    const deviceKey = await exportPisiSyncEcdhPublicKey(subtle, ecdh.publicKey);
    const z = await derivePisiSyncSharedSecret(subtle, ecdh.privateKey, await importPisiSyncEcdhPublicKey(subtle, found.desktopKey));
    const kek = await derivePisiSyncPairingKek(subtle, z, found.pairingId, found.desktopKey, deviceKey);
    const token = formatPisiSyncRandomId('pst_', random(32));
    await http.post(
        `/v1/pairings/${found.pairingId}/claim`,
        {
            method: 'code',
            proof: null,
            code: formatPisiSyncPairingCode(normalized),
            deviceKey,
            label: await sealLabel(subtle, kek, found.spaceId, 'pair-label', found.pairingId, makePisiSyncLabel({ name: deviceName, platform }), random),
            tokenHash: await hashPisiSyncToken(subtle, token)
        },
        { auth: false }
    );
    const sas = formatPisiSyncSas(await computePisiSyncSas(subtle, z, found.pairingId, found.desktopKey, deviceKey));
    return {
        session: { pairingId: found.pairingId, spaceId: found.spaceId, desktopKey: found.desktopKey, kek, token },
        view: { sas, expiresAt: found.expiresAt }
    };
}

/**
 * One poll of the result: `{ state: 'claimed' }` while waiting, or the joined space with its key.
 * @returns {Promise<any>}
 */
export async function pollPisiSyncJoinResult({ http, subtle, session }) {
    const response = await http.request('GET', `/v1/pairings/${session.pairingId}/result`, { token: session.token });
    if (response.status === 202) return { state: 'claimed' };
    const data = response.data;
    if (data.desktopKey !== session.desktopKey) throw Object.assign(new Error('Masaüstü anahtarı değişti.'), { code: 'PAIRING_KEY_MISMATCH' });
    const keyPackage = parsePisiSyncKeyPackage(
        await openPisiSyncJson({
            subtle,
            key: session.kek,
            spaceId: session.spaceId,
            purpose: 'pair-key',
            binding: session.pairingId,
            envelope: data.wrappedKey
        }),
        { spaceId: data.spaceId, deviceId: data.deviceId }
    );
    if (!keyPackage) throw Object.assign(new Error('Anahtar paketi geçersiz.'), { code: 'DECRYPT_FAILED' });
    return {
        state: 'granted',
        spaceId: data.spaceId,
        deviceId: data.deviceId,
        role: data.role,
        token: session.token,
        key: keyPackage.key,
        spaceName: keyPackage.spaceName
    };
}

/**
 * QR path (§6.6): the desktop key and the secret come from the QR only (no
 * lookup); the claim carries the proof, so the desktop shows the request only
 * when the QR was really read. `uri` is the QR's text.
 */
export async function claimPisiSyncPairingWithQr({ subtle, http, uri, deviceName, platform, random }) {
    const parsed = parsePisiSyncPairingUri(uri);
    if (!parsed.ok) throw Object.assign(new Error('QR geçersiz.'), { code: 'PAIRING_QR_INVALID', field: parsed.field });
    const { spaceId, pairingId, desktopKey, secret } = parsed.value;
    const ecdh = await generatePisiSyncEcdhKeyPair(subtle);
    const deviceKey = await exportPisiSyncEcdhPublicKey(subtle, ecdh.publicKey);
    const z = await derivePisiSyncSharedSecret(subtle, ecdh.privateKey, await importPisiSyncEcdhPublicKey(subtle, desktopKey));
    const kek = await derivePisiSyncPairingKek(subtle, z, pairingId, desktopKey, deviceKey);
    const token = formatPisiSyncRandomId('pst_', random(32));
    const { data } = await http.post(
        `/v1/pairings/${pairingId}/claim`,
        {
            method: 'qr',
            proof: await computePisiSyncPairingProof(subtle, secret, pairingId, deviceKey),
            code: null,
            deviceKey,
            label: await sealLabel(subtle, kek, spaceId, 'pair-label', pairingId, makePisiSyncLabel({ name: deviceName, platform }), random),
            tokenHash: await hashPisiSyncToken(subtle, token)
        },
        { auth: false }
    );
    return {
        session: { pairingId, spaceId, desktopKey, kek, token },
        view: { serverUrl: parsed.value.serverUrl, expiresAt: data?.expiresAt ?? null }
    };
}
