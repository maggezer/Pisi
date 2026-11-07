import * as crypto from 'node:crypto';

// Signed update manifests and installer publisher checks, without Electron.
// latest.json is signed with Ed25519 over its exact bytes; the signature is
// published next to it as latest.json.sig: { "keyId": "…", "signature": "<base64>" }.
// Several public keys may be trusted at once so the signing key can rotate.
// Unit-tested; the release workflow signs with the same functions.

export const PISI_UPDATE_SIGNATURE_FILE = 'latest.json.sig';
const PISI_UPDATE_SIGNATURE_MAX_BYTES = 4096;

/**
 * Public keys from build metadata: a comma/whitespace separated list of
 * base64 SPKI DER keys, or PEM blocks, or an array of either.
 * @returns {crypto.KeyObject[]}
 */
export function parsePisiUpdatePublicKeys(value) {
    const items = Array.isArray(value)
        ? value
        : String(value || '').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----|[A-Za-z0-9+/=]{40,}/g) || [];
    const keys = [];
    for (const item of items) {
        const text = String(item || '').trim();
        if (!text) continue;
        try {
            const key = text.startsWith('-----BEGIN')
                ? crypto.createPublicKey(text)
                : crypto.createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
            if (key.asymmetricKeyType === 'ed25519') keys.push(key);
        } catch {
            // An unreadable entry is ignored; the rest of the list still counts.
        }
    }
    return keys;
}

/** The key id: the first 16 hex characters of SHA-256 over the SPKI DER bytes. */
export function getPisiUpdateKeyId(publicKey) {
    const der = publicKey.export({ format: 'der', type: 'spki' });
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** Signs manifest bytes (release workflow). */
export function signPisiUpdateManifest(manifestBytes, privateKey) {
    const key = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
    const publicKey = crypto.createPublicKey(key);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Update manifests are signed with an Ed25519 key.');
    return { keyId: getPisiUpdateKeyId(publicKey), signature: crypto.sign(null, Buffer.from(manifestBytes), key).toString('base64') };
}

/**
 * Verifies manifest bytes against the signature file text and the trusted keys.
 * @param {Buffer|string} manifestBytes
 * @param {string|null|undefined} signatureText the content of latest.json.sig
 * @param {crypto.KeyObject[]} publicKeys
 * @returns {{ ok: boolean, keyId?: string, code?: string, error?: string }}
 */
export function verifyPisiUpdateManifest(manifestBytes, signatureText, publicKeys) {
    if (!publicKeys?.length) return { ok: false, code: 'UPDATE_KEYS_MISSING', error: 'No update signing key is built into this version.' };
    if (signatureText === null || signatureText === undefined || !String(signatureText).trim()) {
        return { ok: false, code: 'UPDATE_SIGNATURE_MISSING', error: 'The update manifest is not signed.' };
    }
    if (Buffer.byteLength(String(signatureText), 'utf8') > PISI_UPDATE_SIGNATURE_MAX_BYTES) {
        return { ok: false, code: 'UPDATE_SIGNATURE_INVALID', error: 'The update manifest signature is unexpectedly large.' };
    }
    let parsed;
    try {
        parsed = JSON.parse(String(signatureText));
    } catch {
        return { ok: false, code: 'UPDATE_SIGNATURE_INVALID', error: 'The update manifest signature is not valid JSON.' };
    }
    const keyId = String(parsed?.keyId || '');
    const signature = Buffer.from(String(parsed?.signature || ''), 'base64');
    if (!/^[a-f0-9]{16}$/.test(keyId) || signature.length !== 64) {
        return { ok: false, code: 'UPDATE_SIGNATURE_INVALID', error: 'The update manifest signature is malformed.' };
    }
    const key = publicKeys.find((candidate) => getPisiUpdateKeyId(candidate) === keyId);
    if (!key) return { ok: false, code: 'UPDATE_SIGNATURE_UNKNOWN_KEY', error: 'The update manifest is signed with an unknown key.' };
    let valid = false;
    try {
        valid = crypto.verify(null, Buffer.from(manifestBytes), key, signature);
    } catch {
        valid = false;
    }
    return valid ? { ok: true, keyId } : { ok: false, code: 'UPDATE_SIGNATURE_INVALID', error: 'The update manifest signature does not match.' };
}

/** The common name of an X.500 subject ("CN=Pisi Ltd, O=…" → "Pisi Ltd"). */
export function getPisiCertificateCommonName(subject) {
    const match = /(?:^|,\s*)CN=("(?:[^"]|"")*"|[^,]*)/i.exec(String(subject || ''));
    if (!match) return '';
    const value = match[1].trim();
    return value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
}

/**
 * Checks the output of Get-AuthenticodeSignature (as JSON: { Status, Subject })
 * against the expected publisher name. No expected name: the check is skipped.
 * @returns {{ ok: boolean, skipped?: boolean, code?: string, error?: string, publisher?: string }}
 */
export function evaluatePisiAuthenticodeResult(output, expectedPublisher) {
    const expected = String(expectedPublisher || '').trim();
    if (!expected) return { ok: true, skipped: true };
    let parsed;
    try {
        parsed = JSON.parse(String(output || ''));
    } catch {
        return { ok: false, code: 'AUTHENTICODE_UNREADABLE', error: 'The installer signature could not be read.' };
    }
    const status = String(parsed?.Status ?? '');
    // Get-AuthenticodeSignature reports Status as a name or as its enum number (0 = Valid).
    if (status !== 'Valid' && status !== '0')
        return { ok: false, code: 'AUTHENTICODE_INVALID', error: `The installer signature is not valid (${status || 'unknown'}).` };
    const publisher = getPisiCertificateCommonName(parsed?.Subject);
    if (publisher.localeCompare(expected, undefined, { sensitivity: 'accent' }) !== 0) {
        return {
            ok: false,
            code: 'AUTHENTICODE_PUBLISHER_MISMATCH',
            error: `The installer is signed by "${publisher || 'unknown'}", not "${expected}".`,
            publisher
        };
    }
    return { ok: true, publisher };
}
