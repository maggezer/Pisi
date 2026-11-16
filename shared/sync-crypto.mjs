// Cryptography of the sync protocol (docs/sync-protocol.md §3, §4, §6.6).
// Every operation goes through the Web Crypto `subtle` object the caller
// passes in (Node 24 globalThis.crypto.subtle, Android WebView crypto.subtle);
// randomness (nonces, ids) and gzip also come from the caller, so this module
// stays pure and the test vectors (tests/fixtures/sync-vectors.json) are exact.

import { getPisiSyncPathKey } from './sync-paths.mjs';

export const PISI_SYNC_PROTOCOL_VERSION = 1;
export const PISI_SYNC_KEY_EPOCH = 1;
export const PISI_SYNC_ENVELOPE_VERSION = 1;
export const PISI_SYNC_ENVELOPE_HEADER_BYTES = 22;
export const PISI_SYNC_TAG_BYTES = 16;
export const PISI_SYNC_NONCE_BYTES = 12;
export const PISI_SYNC_MIN_PADDED_BYTES = 256;
const ENVELOPE_MAGIC = Object.freeze([0x50, 0x49, 0x53, 0x45]); // "PISE"
const FLAG_GZIP = 1;
const FLAG_PADDED = 2;
// Which subkey seals each purpose (§4.2). Pairing purposes are sealed with the KEK.
export const PISI_SYNC_ENVELOPE_PURPOSES = Object.freeze({
    blob: 'content',
    meta: 'meta',
    'space-name': 'label',
    'device-label': 'label',
    'pair-label': 'kek',
    'pair-key': 'kek'
});
export const PISI_SYNC_SUBKEYS = Object.freeze(['content', 'meta', 'label', 'fid', 'blob']);
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A sync failure with one of the client codes of docs/sync-protocol.md §9.3. */
export class PisiSyncError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiSyncError';
        this.code = code;
    }
}

// ---- Bytes ---------------------------------------------------------------

export function utf8Encode(value) {
    const text = String(value);
    const bytes = [];
    for (const char of text) {
        let code = char.codePointAt(0);
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return Uint8Array.from(bytes);
}

/** Strict UTF-8 decoding: malformed input throws instead of becoming U+FFFD. */
export function utf8Decode(input) {
    const bytes = toBytes(input);
    let text = '';
    let index = 0;
    const fail = () => {
        throw new PisiSyncError('DECRYPT_FAILED', 'Geçersiz UTF-8.');
    };
    const continuation = (offset) => {
        const byte = bytes[index + offset];
        if (byte === undefined || (byte & 0xc0) !== 0x80) fail();
        return byte & 63;
    };
    while (index < bytes.length) {
        const first = bytes[index];
        let code;
        let size;
        if (first < 0x80) {
            code = first;
            size = 1;
        } else if (first >= 0xc2 && first <= 0xdf) {
            code = ((first & 31) << 6) | continuation(1);
            size = 2;
        } else if (first >= 0xe0 && first <= 0xef) {
            code = ((first & 15) << 12) | (continuation(1) << 6) | continuation(2);
            size = 3;
            if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) fail();
        } else if (first >= 0xf0 && first <= 0xf4) {
            code = ((first & 7) << 18) | (continuation(1) << 12) | (continuation(2) << 6) | continuation(3);
            size = 4;
            if (code < 0x10000 || code > 0x10ffff) fail();
        } else {
            fail();
        }
        text += String.fromCodePoint(code);
        index += size;
    }
    return text;
}

/** A Uint8Array view of bytes given as Uint8Array, ArrayBuffer or another typed array. */
export function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Bayt dizisi bekleniyordu.');
}

export function concatBytes(...parts) {
    const arrays = parts.map(toBytes);
    const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of arrays) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** Comparison whose time does not depend on where the inputs differ. */
export function bytesEqual(left, right) {
    const a = toBytes(left);
    const b = toBytes(right);
    let difference = a.length ^ b.length;
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
    return difference === 0;
}

/** Constant-time comparison of two strings (tokens, proofs). */
export function stringsEqual(left, right) {
    return bytesEqual(utf8Encode(left), utf8Encode(right));
}

/** Unpadded base64url (RFC 4648 §5). */
export function toBase64Url(input) {
    const bytes = toBytes(input);
    let out = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
        const count = Math.min(3, bytes.length - index);
        out += BASE64URL[(chunk >> 18) & 63] + BASE64URL[(chunk >> 12) & 63];
        if (count > 1) out += BASE64URL[(chunk >> 6) & 63];
        if (count > 2) out += BASE64URL[chunk & 63];
    }
    return out;
}

/** Strict unpadded base64url decoding; anything else throws. */
export function fromBase64Url(value) {
    const text = String(value);
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new PisiSyncError('DECRYPT_FAILED', 'Geçersiz base64url.');
    const out = new Uint8Array(Math.floor((text.length * 3) / 4));
    let bits = 0;
    let buffer = 0;
    let offset = 0;
    for (const char of text) {
        buffer = (buffer << 6) | BASE64URL.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[offset] = (buffer >> bits) & 0xff;
            offset += 1;
        }
    }
    if (bits && buffer & ((1 << bits) - 1)) throw new PisiSyncError('DECRYPT_FAILED', 'Geçersiz base64url.');
    return out;
}

export function toHex(input) {
    return Array.from(toBytes(input), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value) {
    const text = String(value);
    if (!/^(?:[0-9a-f]{2})*$/i.test(text)) throw new TypeError('Geçersiz onaltılık değer.');
    const out = new Uint8Array(text.length / 2);
    for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
    return out;
}

// ---- Primitives ----------------------------------------------------------

export async function sha256(subtle, bytes) {
    return new Uint8Array(await subtle.digest('SHA-256', toBytes(bytes)));
}

export async function sha256Hex(subtle, bytes) {
    return toHex(await sha256(subtle, bytes));
}

/** HKDF-SHA256: `length` bytes from `ikm`, `salt` and `info` (strings are UTF-8). */
export async function hkdfSha256(subtle, ikm, salt, info, length) {
    const key = await subtle.importKey('raw', toBytes(ikm), 'HKDF', false, ['deriveBits']);
    const asBytes = (value) => (typeof value === 'string' ? utf8Encode(value) : toBytes(value));
    const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: asBytes(salt), info: asBytes(info) }, key, length * 8);
    return new Uint8Array(bits);
}

/** HMAC-SHA256 with a raw key (bytes) or an imported HMAC CryptoKey. */
export async function hmacSha256(subtle, key, data) {
    const cryptoKey = key instanceof Uint8Array ? await importHmacKey(subtle, key) : key;
    return new Uint8Array(await subtle.sign('HMAC', cryptoKey, typeof data === 'string' ? utf8Encode(data) : toBytes(data)));
}

function importHmacKey(subtle, raw) {
    return subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function importAesKey(subtle, raw) {
    return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---- Space keys (§4.1) ---------------------------------------------------

/** The raw 32-byte subkeys of `K` for a space: content, meta, label (AES-256-GCM), fid, blob (HMAC-SHA256). */
export async function derivePisiSyncSubkeyBytes(subtle, projectKey, spaceId) {
    const key = toBytes(projectKey);
    if (key.length !== 32) throw new TypeError('Proje anahtarı 32 bayt olmalı.');
    const salt = `pisi-sync/1|${spaceId}`;
    const raw = {};
    for (const name of PISI_SYNC_SUBKEYS) raw[name] = await hkdfSha256(subtle, key, salt, name, 32);
    return raw;
}

/** CryptoKeys for a space, ready for sealing, opening, fids and blob ids. */
export async function openPisiSyncSpaceKeys(subtle, projectKey, spaceId) {
    const raw = await derivePisiSyncSubkeyBytes(subtle, projectKey, spaceId);
    return {
        spaceId,
        content: await importAesKey(subtle, raw.content),
        meta: await importAesKey(subtle, raw.meta),
        label: await importAesKey(subtle, raw.label),
        fid: await importHmacKey(subtle, raw.fid),
        blob: await importHmacKey(subtle, raw.blob)
    };
}

/** fid of a path: "f_" + base64url(HMAC(K_fid, UTF8(pathKey))) (§4.5). `fidKey` is a raw key or an HMAC CryptoKey. */
export async function computePisiSyncFid(subtle, fidKey, path) {
    return `f_${toBase64Url(await hmacSha256(subtle, fidKey, getPisiSyncPathKey(path)))}`;
}

/** Blob id of a file's plain bytes: "b_" + base64url(HMAC(K_blob, bytes)) (§4.6). */
export async function computePisiSyncBlobId(subtle, blobKey, bytes) {
    return `b_${toBase64Url(await hmacSha256(subtle, blobKey, toBytes(bytes)))}`;
}

/** SHA-256 hex of a device token: the `tokenHash` the server stores (§6.2). */
export async function hashPisiSyncToken(subtle, token) {
    return sha256Hex(subtle, utf8Encode(token));
}

/** `prefix` + base64url of caller-provided random bytes: 16 bytes for sp_/dv_/pr_/cm_, 32 for pst_ (§3). */
export function formatPisiSyncRandomId(prefix, randomBytes) {
    const bytes = toBytes(randomBytes);
    const expected = prefix === 'pst_' ? 32 : 16;
    if (bytes.length !== expected) throw new TypeError(`${prefix} için ${expected} bayt gerekir.`);
    return `${prefix}${toBase64Url(bytes)}`;
}

// ---- Padding (§4.4) ------------------------------------------------------

/** Padmé(L): rounds L up so that only O(log log L) bits of the length leak. */
export function padme(length) {
    const value = Math.floor(Number(length));
    if (!(value >= 2)) return Math.max(0, value);
    let exponent = 0;
    while (2 ** (exponent + 1) <= value) exponent += 1;
    let bits = 0;
    while (2 ** (bits + 1) <= exponent) bits += 1;
    const lastBits = exponent - (bits + 1);
    const step = 2 ** Math.max(0, lastBits);
    return Math.ceil(value / step) * step;
}

/** Length of the padded payload for `length` data bytes: max(256, Padmé(length + 1)). */
export function getPisiSyncPaddedLength(length) {
    return Math.max(PISI_SYNC_MIN_PADDED_BYTES, padme(length + 1));
}

/** ISO/IEC 7816-4 padding: data ‖ 0x80 ‖ 0x00… to getPisiSyncPaddedLength. */
export function padPisiSyncPayload(input) {
    const bytes = toBytes(input);
    const out = new Uint8Array(getPisiSyncPaddedLength(bytes.length));
    out.set(bytes);
    out[bytes.length] = 0x80;
    return out;
}

export function unpadPisiSyncPayload(input) {
    const bytes = toBytes(input);
    let index = bytes.length - 1;
    while (index >= 0 && bytes[index] === 0) index -= 1;
    if (index < 0 || bytes[index] !== 0x80) throw new PisiSyncError('DECRYPT_FAILED', 'Dolgu geçersiz.');
    return bytes.slice(0, index);
}

/** Sealed size of a payload of `length` bytes (after any compression): header + padded data + tag. */
export function getPisiSyncSealedSize(length, { pad = true } = {}) {
    return PISI_SYNC_ENVELOPE_HEADER_BYTES + (pad ? getPisiSyncPaddedLength(length) : length) + PISI_SYNC_TAG_BYTES;
}

// ---- Envelope (§4.2) -----------------------------------------------------

function makeHeader(flags, keyEpoch, nonce) {
    const header = new Uint8Array(PISI_SYNC_ENVELOPE_HEADER_BYTES);
    header.set(ENVELOPE_MAGIC, 0);
    header[4] = PISI_SYNC_ENVELOPE_VERSION;
    header[5] = flags;
    new DataView(header.buffer).setUint32(6, keyEpoch >>> 0, false);
    header.set(nonce, 10);
    return header;
}

/** AAD = header ‖ UTF8("pisi-sync/1|" + spaceId + "|" + purpose + "|" + binding). */
export function getPisiSyncEnvelopeAad(header, spaceId, purpose, binding) {
    return concatBytes(header, utf8Encode(`pisi-sync/1|${spaceId}|${purpose}|${binding}`));
}

/** The binding of a `meta` envelope: fid|op|blob, with "-" for a delete (§4.2). */
export function getPisiSyncMetaBinding(fid, op, blob) {
    return `${fid}|${op}|${blob || '-'}`;
}

/** Reads the 22-byte header. Unknown magic, version or flag bits throw DECRYPT_FAILED. */
export function parsePisiSyncEnvelopeHeader(envelope) {
    const bytes = toBytes(envelope);
    if (bytes.length < PISI_SYNC_ENVELOPE_HEADER_BYTES + PISI_SYNC_TAG_BYTES) throw new PisiSyncError('DECRYPT_FAILED', 'Zarf çok kısa.');
    if (ENVELOPE_MAGIC.some((byte, index) => bytes[index] !== byte)) throw new PisiSyncError('DECRYPT_FAILED', 'Zarf sihirli değeri bilinmiyor.');
    if (bytes[4] !== PISI_SYNC_ENVELOPE_VERSION) throw new PisiSyncError('DECRYPT_FAILED', 'Zarf sürümü bilinmiyor.');
    const flags = bytes[5];
    if (flags & ~(FLAG_GZIP | FLAG_PADDED)) throw new PisiSyncError('DECRYPT_FAILED', 'Zarf bayrağı bilinmiyor.');
    const keyEpoch = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(6, false);
    if (keyEpoch !== PISI_SYNC_KEY_EPOCH) throw new PisiSyncError('DECRYPT_FAILED', 'Anahtar dönemi bilinmiyor.');
    return {
        flags,
        compressed: Boolean(flags & FLAG_GZIP),
        padded: Boolean(flags & FLAG_PADDED),
        keyEpoch,
        nonce: bytes.slice(10, 22),
        header: bytes.slice(0, PISI_SYNC_ENVELOPE_HEADER_BYTES)
    };
}

function assertPurpose(purpose) {
    if (!Object.hasOwn(PISI_SYNC_ENVELOPE_PURPOSES, purpose)) throw new TypeError(`Bilinmeyen zarf amacı: ${purpose}`);
}

/**
 * Seals `plaintext` (bytes or a string) for `purpose` and `binding`.
 * `key` is the AES-GCM CryptoKey or raw 32 bytes of the purpose's subkey (or
 * the KEK). `nonce` is 12 fresh random bytes from the caller. `gzip` (an async
 * bytes → bytes function) compresses first when given; `pad` pads (§4.4).
 */
export async function sealPisiSyncEnvelope({
    subtle,
    key,
    spaceId,
    purpose,
    binding,
    plaintext,
    nonce,
    gzip = null,
    pad = true,
    keyEpoch = PISI_SYNC_KEY_EPOCH
}) {
    assertPurpose(purpose);
    const nonceBytes = toBytes(nonce);
    if (nonceBytes.length !== PISI_SYNC_NONCE_BYTES) throw new TypeError('Nonce 12 bayt olmalı.');
    let payload = typeof plaintext === 'string' ? utf8Encode(plaintext) : toBytes(plaintext);
    if (gzip) payload = toBytes(await gzip(payload));
    if (pad) payload = padPisiSyncPayload(payload);
    const header = makeHeader((gzip ? FLAG_GZIP : 0) | (pad ? FLAG_PADDED : 0), keyEpoch, nonceBytes);
    const cryptoKey = key instanceof Uint8Array ? await importAesKey(subtle, key) : key;
    const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv: nonceBytes, additionalData: getPisiSyncEnvelopeAad(header, spaceId, purpose, binding), tagLength: 128 },
        cryptoKey,
        payload
    );
    return concatBytes(header, new Uint8Array(sealed));
}

/**
 * Opens an envelope sealed for `purpose` and `binding` and returns the plain
 * bytes. Any failure (unknown format, wrong key, tag, binding, padding or a
 * compressed payload without `gunzip`) throws PisiSyncError DECRYPT_FAILED.
 */
export async function openPisiSyncEnvelope({ subtle, key, spaceId, purpose, binding, envelope, gunzip = null }) {
    assertPurpose(purpose);
    const bytes = toBytes(envelope);
    const parsed = parsePisiSyncEnvelopeHeader(bytes);
    let payload;
    try {
        const cryptoKey = key instanceof Uint8Array ? await importAesKey(subtle, key) : key;
        payload = new Uint8Array(
            await subtle.decrypt(
                { name: 'AES-GCM', iv: parsed.nonce, additionalData: getPisiSyncEnvelopeAad(parsed.header, spaceId, purpose, binding), tagLength: 128 },
                cryptoKey,
                bytes.subarray(PISI_SYNC_ENVELOPE_HEADER_BYTES)
            )
        );
    } catch {
        throw new PisiSyncError('DECRYPT_FAILED', 'Zarf çözülemedi.');
    }
    if (parsed.padded) payload = unpadPisiSyncPayload(payload);
    if (parsed.compressed) {
        if (!gunzip) throw new PisiSyncError('DECRYPT_FAILED', 'Sıkıştırılmış zarf açılamadı.');
        try {
            payload = toBytes(await gunzip(payload));
        } catch {
            throw new PisiSyncError('DECRYPT_FAILED', 'Sıkıştırılmış zarf açılamadı.');
        }
    }
    return payload;
}

/** Seals a JSON value as a base64url envelope string (labels, meta, key packages). */
export async function sealPisiSyncJson(options) {
    return toBase64Url(await sealPisiSyncEnvelope({ ...options, plaintext: utf8Encode(JSON.stringify(options.value)) }));
}

/** Opens a base64url envelope string and parses its JSON; failures throw DECRYPT_FAILED. */
export async function openPisiSyncJson(options) {
    const plain = await openPisiSyncEnvelope({ ...options, envelope: fromBase64Url(options.envelope) });
    try {
        return JSON.parse(utf8Decode(plain));
    } catch {
        throw new PisiSyncError('DECRYPT_FAILED', 'Zarfın içeriği JSON değil.');
    }
}

// ---- Pairing (§6.6) ------------------------------------------------------

export function generatePisiSyncEcdhKeyPair(subtle) {
    return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

/** An ECDH P-256 public key as 87 base64url characters of its uncompressed raw form. */
export async function exportPisiSyncEcdhPublicKey(subtle, publicKey) {
    return toBase64Url(new Uint8Array(await subtle.exportKey('raw', publicKey)));
}

export async function importPisiSyncEcdhPublicKey(subtle, encoded) {
    const raw = fromBase64Url(encoded);
    if (raw.length !== 65 || raw[0] !== 4) throw new PisiSyncError('DECRYPT_FAILED', 'ECDH açık anahtarı geçersiz.');
    try {
        return await subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    } catch {
        throw new PisiSyncError('DECRYPT_FAILED', 'ECDH açık anahtarı geçersiz.');
    }
}

/** Z = ECDH-P256(own private key, peer public key): the 32-byte x coordinate. */
export async function derivePisiSyncSharedSecret(subtle, privateKey, peerPublicKey) {
    return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256));
}

/** KEK = HKDF(Z, "pisi-sync/1|pair|" + pairingId, "kek|" + desktopKey + "|" + deviceKey, 32): raw bytes. */
export function derivePisiSyncPairingKek(subtle, sharedSecret, pairingId, desktopKey, deviceKey) {
    return hkdfSha256(subtle, sharedSecret, `pisi-sync/1|pair|${pairingId}`, `kek|${desktopKey}|${deviceKey}`, 32);
}

/** proof = base64url(HMAC-SHA256(x, "pisi-sync/1|claim|" + pairingId + "|" + deviceKey)); `secret` is the QR's 32 bytes. */
export async function computePisiSyncPairingProof(subtle, secret, pairingId, deviceKey) {
    return toBase64Url(await hmacSha256(subtle, toBytes(secret), `pisi-sync/1|claim|${pairingId}|${deviceKey}`));
}

export async function verifyPisiSyncPairingProof(subtle, secret, pairingId, deviceKey, proof) {
    return stringsEqual(await computePisiSyncPairingProof(subtle, secret, pairingId, deviceKey), String(proof || ''));
}

/** The six-digit verification number both screens show on the code path. */
export async function computePisiSyncSas(subtle, sharedSecret, pairingId, desktopKey, deviceKey) {
    const bytes = await hkdfSha256(subtle, sharedSecret, `pisi-sync/1|sas|${pairingId}`, `${desktopKey}|${deviceKey}`, 4);
    return new DataView(bytes.buffer).getUint32(0, false) % 1000000;
}

/** 482913 → "482 913". */
export function formatPisiSyncSas(value) {
    const digits = String(Math.max(0, Math.floor(Number(value) || 0)) % 1000000).padStart(6, '0');
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
