// Space and pairing flows of the desktop (docs/sync-protocol.md §6.2, §6.5, §6.6).
// Creating a space makes the project key K, the device token and both ids on
// this device; the server only sees the token hash and sealed labels (SV8).
// Pairing (admin side) keeps the ECDH private key and the QR secret in memory
// only; a claim is shown to the user only after the QR proof checks out, and
// nothing is granted without the user's confirmation. A second desktop joins
// with the code path (claim side, `joinPisiSyncSpaceWithCode`).

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
    openPisiSyncSpaceKeys,
    sealPisiSyncJson,
    verifyPisiSyncPairingProof
} from '../../shared/sync-crypto.mjs';
import {
    formatPisiSyncPairingCode,
    formatPisiSyncPairingUri,
    makePisiSyncKeyPackage,
    makePisiSyncLabel,
    normalizePisiSyncPairingCode,
    parsePisiSyncKeyPackage,
    parsePisiSyncLabel
} from '../../shared/sync-meta.mjs';

export const PISI_SYNC_DESKTOP_PLATFORMS = Object.freeze(['windows', 'macos', 'linux']);

/** Pisi's platform name for a Node platform. */
export function getPisiSyncPlatform(platform = process.platform) {
    return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
}

/** The role a paired device gets: desktops are admins, everything else a member (S3 decision). */
export function getPisiSyncRoleForPlatform(platform) {
    return PISI_SYNC_DESKTOP_PLATFORMS.includes(platform) ? 'admin' : 'member';
}

const sealLabel = (subtle, key, spaceId, purpose, binding, label, random) =>
    sealPisiSyncJson({ subtle, key, spaceId, purpose, binding, value: label, nonce: random(12) });

/**
 * Opens a new space with the setup key. Returns `{ spaceId, deviceId, token, key, role }`;
 * the caller stores token and key as secrets.
 */
export async function createPisiSyncSpace({ subtle, http, setupKey, spaceName, deviceName, platform, random }) {
    const spaceId = formatPisiSyncRandomId('sp_', random(16));
    const deviceId = formatPisiSyncRandomId('dv_', random(16));
    const token = formatPisiSyncRandomId('pst_', random(32));
    const key = random(32);
    const keys = await openPisiSyncSpaceKeys(subtle, key, spaceId);
    const { data } = await http.request('POST', '/v1/spaces', {
        auth: false,
        headers: { 'Pisi-Setup-Key': String(setupKey || '') },
        json: {
            spaceId,
            deviceId,
            tokenHash: await hashPisiSyncToken(subtle, token),
            spaceName: await sealLabel(subtle, keys.label, spaceId, 'space-name', spaceId, makePisiSyncLabel({ name: spaceName }), random),
            deviceLabel: await sealLabel(subtle, keys.label, spaceId, 'device-label', deviceId, makePisiSyncLabel({ name: deviceName, platform }), random)
        }
    });
    return { spaceId, deviceId, token, key, role: data.role || 'admin' };
}

/** Opens a sealed device label; null when it does not open. */
export async function openPisiSyncDeviceLabel({ subtle, keys, deviceId, envelope }) {
    if (!envelope) return null;
    try {
        return parsePisiSyncLabel(
            await openPisiSyncJson({ subtle, key: keys.label, spaceId: keys.spaceId, purpose: 'device-label', binding: deviceId, envelope })
        );
    } catch {
        return null;
    }
}

/** Devices of the space with their opened names (admin). */
export async function listPisiSyncDevices({ subtle, http, keys, selfDeviceId }) {
    const { data } = await http.get(`/v1/spaces/${keys.spaceId}/devices`);
    const devices = [];
    for (const device of data.devices || []) {
        const label = await openPisiSyncDeviceLabel({ subtle, keys, deviceId: device.deviceId, envelope: device.label });
        devices.push({
            deviceId: device.deviceId,
            role: device.role,
            name: label?.name || '',
            platform: label?.platform || null,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
            revokedAt: device.revokedAt,
            self: device.deviceId === selfDeviceId
        });
    }
    return devices;
}

/**
 * Admin side of a pairing. `startPisiSyncPairing` returns the session (kept in
 * main memory) and what the window shows: the QR text, the code and expiry.
 */
export async function startPisiSyncPairing({ subtle, http, serverUrl, spaceId, random }) {
    const pairingId = formatPisiSyncRandomId('pr_', random(16));
    const deviceId = formatPisiSyncRandomId('dv_', random(16));
    const ecdh = await generatePisiSyncEcdhKeyPair(subtle);
    const desktopKey = await exportPisiSyncEcdhPublicKey(subtle, ecdh.publicKey);
    const secret = random(32);
    const { data } = await http.post(`/v1/spaces/${spaceId}/pairings`, { pairingId, deviceId, desktopKey });
    const code = formatPisiSyncPairingCode(data.code);
    return {
        session: { pairingId, deviceId, spaceId, privateKey: ecdh.privateKey, desktopKey, secret, code, expiresAt: data.expiresAt, claim: null },
        view: { pairingId, code, expiresAt: data.expiresAt, uri: formatPisiSyncPairingUri({ serverUrl, spaceId, pairingId, desktopKey, secret, code }) }
    };
}

/**
 * Polls a pairing. When it is claimed the proof (QR path) is checked, the KEK
 * derived and the device's name opened; the code path also gets the six-digit
 * verification number. Returns the view: `{ state, method, name, platform, role, sas, valid }`.
 */
export async function pollPisiSyncPairing({ subtle, http, session }) {
    const { data } = await http.get(`/v1/spaces/${session.spaceId}/pairings/${session.pairingId}`);
    const view = { pairingId: session.pairingId, state: data.state, expiresAt: data.expiresAt, method: data.method || null };
    if (data.state !== 'claimed') return view;
    if (!session.claim || session.claim.deviceKey !== data.deviceKey) {
        let valid = true;
        if (data.method === 'qr') valid = await verifyPisiSyncPairingProof(subtle, session.secret, session.pairingId, data.deviceKey, data.proof);
        let label = null;
        let kek = null;
        let sas = null;
        if (valid) {
            try {
                const z = await derivePisiSyncSharedSecret(subtle, session.privateKey, await importPisiSyncEcdhPublicKey(subtle, data.deviceKey));
                kek = await derivePisiSyncPairingKek(subtle, z, session.pairingId, session.desktopKey, data.deviceKey);
                label = parsePisiSyncLabel(
                    await openPisiSyncJson({
                        subtle,
                        key: kek,
                        spaceId: session.spaceId,
                        purpose: 'pair-label',
                        binding: session.pairingId,
                        envelope: data.label
                    })
                );
                if (data.method === 'code') sas = formatPisiSyncSas(await computePisiSyncSas(subtle, z, session.pairingId, session.desktopKey, data.deviceKey));
            } catch {
                label = null;
            }
            if (!label) valid = false;
        }
        session.claim = { deviceKey: data.deviceKey, method: data.method, valid, label, kek, sas };
    }
    const claim = session.claim;
    return {
        ...view,
        valid: claim.valid,
        name: claim.label?.name || '',
        platform: claim.label?.platform || null,
        role: getPisiSyncRoleForPlatform(claim.label?.platform),
        sas: claim.sas
    };
}

/** Grants the claimed device: wraps K for it and seals its label with K_label. */
export async function grantPisiSyncPairing({ subtle, http, session, keys, projectKey, spaceName, random }) {
    const claim = session.claim;
    if (!claim?.valid || !claim.kek) throw Object.assign(new Error('Eşleştirme doğrulanmadı.'), { code: 'PAIRING_NOT_VERIFIED' });
    const role = getPisiSyncRoleForPlatform(claim.label.platform);
    const wrappedKey = await sealPisiSyncJson({
        subtle,
        key: claim.kek,
        spaceId: session.spaceId,
        purpose: 'pair-key',
        binding: session.pairingId,
        value: makePisiSyncKeyPackage({ spaceId: session.spaceId, deviceId: session.deviceId, key: projectKey, spaceName }),
        nonce: random(12)
    });
    const label = await sealLabel(subtle, keys.label, session.spaceId, 'device-label', session.deviceId, makePisiSyncLabel(claim.label), random);
    const { data } = await http.post(`/v1/spaces/${session.spaceId}/pairings/${session.pairingId}/grant`, { role, wrappedKey, label });
    return { state: data.state, deviceId: data.deviceId, role };
}

export async function rejectPisiSyncPairing({ http, session }) {
    await http.post(`/v1/spaces/${session.spaceId}/pairings/${session.pairingId}/reject`, {});
    return { state: 'rejected' };
}

export async function cancelPisiSyncPairing({ http, session }) {
    await http.request('DELETE', `/v1/spaces/${session.spaceId}/pairings/${session.pairingId}`);
    return { state: 'cancelled' };
}

/**
 * Claim side for a second desktop (code path): looks the code up, claims with
 * a new token and shows the verification number. `waitPisiSyncJoinResult`
 * then polls the result and opens the key package.
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

/** Opens a space's name from `GET /v1/spaces/{space}`. */
export async function openPisiSyncSpaceName({ subtle, keys, envelope }) {
    try {
        return (
            parsePisiSyncLabel(
                await openPisiSyncJson({ subtle, key: keys.label, spaceId: keys.spaceId, purpose: 'space-name', binding: keys.spaceId, envelope })
            )?.name || ''
        );
    } catch {
        return '';
    }
}

export { computePisiSyncPairingProof };
