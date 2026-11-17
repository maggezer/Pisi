// The phone's side of pairing (docs/sync-protocol.md §6.6, docs/sync-plan.md S5
// step 3). QR path: the desktop key and the secret come only from the QR and
// the claim carries the proof. Code path: the code is looked up and both
// screens show the same six-digit verification number. Either way the phone
// then waits until the user confirms on the desktop. The token and the
// project key stay in memory until they are handed to the state store.

import { claimPisiSyncPairingWithCode, claimPisiSyncPairingWithQr, pollPisiSyncJoinResult } from '../../../shared/sync-pairing-claim.mjs';
import { normalizePisiSyncServerUrl, parsePisiSyncPairingUri } from '../../../shared/sync-meta.mjs';

export const PISI_PAIRING_POLL_MS = 2000;
// The desktop has 10 minutes; a little more covers a slow clock.
const DEFAULT_WAIT_MS = 11 * 60 * 1000;

export class PisiPairingError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiPairingError';
        this.code = code;
    }
}

const codeOf = (error) => (typeof error?.code === 'string' ? error.code : 'PAIRING_FAILED');

/** The server address of a pairing: from the QR, or the address typed in (https:// is added when missing). */
export function getPairingServerUrl({ method, uri, serverUrl }) {
    if (method === 'qr') {
        const parsed = parsePisiSyncPairingUri(uri);
        return parsed.ok ? parsed.value.serverUrl : null;
    }
    const text = String(serverUrl ?? '').trim();
    if (!text) return null;
    return normalizePisiSyncServerUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
}

/**
 * Claims a pairing. `method` is 'qr' (with `uri`) or 'code' (with `code`).
 * Resolves `{ session, sas, expiresAt }`; `sas` is the verification number
 * on the code path and null on the QR path.
 */
export async function claimPairing({ subtle, http, random, method, uri, code, deviceName, platform }) {
    try {
        if (method === 'qr') {
            const claimed = await claimPisiSyncPairingWithQr({ subtle, http, uri, deviceName, platform, random });
            return { session: claimed.session, sas: null, expiresAt: claimed.view.expiresAt };
        }
        const claimed = await claimPisiSyncPairingWithCode({ subtle, http, code, deviceName, platform, random });
        return { session: claimed.session, sas: claimed.view.sas, expiresAt: claimed.view.expiresAt };
    } catch (error) {
        throw new PisiPairingError(codeOf(error));
    }
}

/**
 * Polls the result every two seconds until the desktop grants the device.
 * Resolves `{ spaceId, deviceId, role, token, key, spaceName }`; rejects with
 * PAIRING_REJECTED, PAIRING_EXPIRED, PAIRING_CANCELLED or the server's code.
 */
export async function waitForGrant({ subtle, http, session, sleep, now = () => Date.now(), isCancelled = () => false, timeoutMs = DEFAULT_WAIT_MS }) {
    const deadline = now() + timeoutMs;
    for (;;) {
        if (isCancelled()) throw new PisiPairingError('PAIRING_CANCELLED');
        let result;
        try {
            result = await pollPisiSyncJoinResult({ subtle, http, session });
        } catch (error) {
            // A short network gap while waiting is not the end of the pairing.
            if (codeOf(error) !== 'OFFLINE') throw new PisiPairingError(codeOf(error));
            result = { state: 'claimed' };
        }
        if (isCancelled()) throw new PisiPairingError('PAIRING_CANCELLED');
        if (result.state === 'granted') return result;
        if (now() >= deadline) throw new PisiPairingError('PAIRING_EXPIRED');
        await sleep(PISI_PAIRING_POLL_MS);
    }
}
