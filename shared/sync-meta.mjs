// Schemas of what travels encrypted or inside the pairing QR
// (docs/sync-protocol.md §3, §4.7, §6.6): change metadata, device and space
// labels, the key package, id formats, the short pairing code and the QR URI.
// Opening a change's meta also re-checks its path and fid (rule SV9).

import {
    PISI_SYNC_KEY_EPOCH,
    PisiSyncError,
    computePisiSyncBlobId,
    computePisiSyncFid,
    fromBase64Url,
    getPisiSyncMetaBinding,
    openPisiSyncJson,
    sealPisiSyncJson,
    sha256Hex,
    toBase64Url,
    toBytes
} from './sync-crypto.mjs';
import { PISI_SYNC_FILE_CLASSES, checkPisiSyncPath, getPisiSyncAssetDigest, getPisiSyncFileClass } from './sync-paths.mjs';

export const PISI_SYNC_META_VERSION = 1;
export const PISI_SYNC_LABEL_VERSION = 1;
export const PISI_SYNC_KEY_PACKAGE_VERSION = 1;
export const PISI_SYNC_PLATFORMS = Object.freeze(['windows', 'macos', 'linux', 'android', 'ios', 'web']);
export const PISI_SYNC_ID_PATTERNS = Object.freeze({
    space: /^sp_[A-Za-z0-9_-]{22}$/,
    device: /^dv_[A-Za-z0-9_-]{22}$/,
    pairing: /^pr_[A-Za-z0-9_-]{22}$/,
    commit: /^cm_[A-Za-z0-9_-]{22}$/,
    upload: /^up_[A-Za-z0-9_-]{22}$/,
    token: /^pst_[A-Za-z0-9_-]{43}$/,
    fid: /^f_[A-Za-z0-9_-]{43}$/,
    blob: /^b_[A-Za-z0-9_-]{43}$/,
    publicKey: /^[A-Za-z0-9_-]{87}$/
});
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DOC_ID = /^(?:node|map)_[A-Za-z0-9_-]{1,96}$/;
// Crockford base32 without I, L, O and U (§3).
const PAIRING_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const PAIRING_URI_PREFIX = 'pisi-sync:1?';

/** Whether `value` has the format of an id of `kind` (§3). */
export function isPisiSyncId(kind, value) {
    const pattern = PISI_SYNC_ID_PATTERNS[kind];
    return Boolean(pattern) && typeof value === 'string' && pattern.test(value);
}

/** Server base URL as entered: https only, trailing '/' dropped (§2). Returns null for anything else. */
export function normalizePisiSyncServerUrl(value) {
    const text = String(value || '').trim();
    const match = /^https:\/\/([^/?#\s@]+)(\/[^?#\s]*)?$/i.exec(text);
    if (!match) return null;
    return `https://${match[1].toLowerCase()}${(match[2] || '').replace(/\/+$/, '')}`;
}

/** Short pairing code as the server compares it: upper case, without '-' or spaces; null when it is not 8 Crockford characters. */
export function normalizePisiSyncPairingCode(value) {
    const code = String(value || '')
        .toUpperCase()
        .replace(/[-\s]/g, '');
    return PAIRING_CODE.test(code) ? code : null;
}

/** "7K3MQ9WX" → "7K3M-Q9WX". */
export function formatPisiSyncPairingCode(value) {
    const code = normalizePisiSyncPairingCode(value);
    return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}

// ---- Pairing QR ----------------------------------------------------------

/** `pisi-sync:1?u=…&s=…&p=…&k=…&x=…&c=…` for the desktop's pairing window (§6.6). `secret` is 32 bytes. */
export function formatPisiSyncPairingUri({ serverUrl, spaceId, pairingId, desktopKey, secret, code }) {
    const fields = [
        ['u', normalizePisiSyncServerUrl(serverUrl)],
        ['s', spaceId],
        ['p', pairingId],
        ['k', desktopKey],
        ['x', typeof secret === 'string' ? secret : toBase64Url(secret)],
        ['c', formatPisiSyncPairingCode(code)]
    ];
    if (fields.some(([, value]) => !value)) throw new TypeError('Eşleştirme QR alanları eksik.');
    return PAIRING_URI_PREFIX + fields.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
}

/** Reads a pairing QR. Returns `{ ok: true, value }` or `{ ok: false, field }`; the secret is returned as 32 bytes. */
export function parsePisiSyncPairingUri(text) {
    const value = String(text || '').trim();
    if (!value.startsWith(PAIRING_URI_PREFIX)) return { ok: false, field: 'scheme' };
    const fields = {};
    for (const part of value.slice(PAIRING_URI_PREFIX.length).split('&')) {
        const equals = part.indexOf('=');
        if (equals < 1) return { ok: false, field: 'format' };
        const name = part.slice(0, equals);
        if (Object.hasOwn(fields, name)) return { ok: false, field: name };
        try {
            fields[name] = decodeURIComponent(part.slice(equals + 1));
        } catch {
            return { ok: false, field: name };
        }
    }
    const serverUrl = normalizePisiSyncServerUrl(fields.u);
    if (!serverUrl) return { ok: false, field: 'u' };
    if (!isPisiSyncId('space', fields.s)) return { ok: false, field: 's' };
    if (!isPisiSyncId('pairing', fields.p)) return { ok: false, field: 'p' };
    if (!isPisiSyncId('publicKey', fields.k)) return { ok: false, field: 'k' };
    let secret;
    try {
        secret = fromBase64Url(fields.x);
    } catch {
        secret = null;
    }
    if (!secret || secret.length !== 32) return { ok: false, field: 'x' };
    const code = normalizePisiSyncPairingCode(fields.c);
    if (!code) return { ok: false, field: 'c' };
    return { ok: true, value: { serverUrl, spaceId: fields.s, pairingId: fields.p, desktopKey: fields.k, secret, code } };
}

// ---- Labels and key package ----------------------------------------------

/** `{"v":1,"name":…,"platform":…}` for a device label, `{"v":1,"name":…}` for a space name (§4.2). */
export function makePisiSyncLabel({ name, platform = undefined }) {
    const label = {
        v: PISI_SYNC_LABEL_VERSION,
        name: String(name || '')
            .trim()
            .slice(0, 120)
    };
    if (platform !== undefined) label.platform = PISI_SYNC_PLATFORMS.includes(platform) ? platform : 'web';
    return label;
}

/** The label after opening its envelope, or null when its schema is not valid. */
export function parsePisiSyncLabel(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== PISI_SYNC_LABEL_VERSION) return null;
    if (typeof value.name !== 'string' || value.name.length > 120) return null;
    if (value.platform !== undefined && !PISI_SYNC_PLATFORMS.includes(value.platform)) return null;
    return value.platform === undefined ? { v: 1, name: value.name } : { v: 1, name: value.name, platform: value.platform };
}

/** The key package a desktop wraps for a paired device (§6.6). `key` is the 32-byte project key. */
export function makePisiSyncKeyPackage({ spaceId, deviceId, key, spaceName }) {
    const raw = toBytes(key);
    if (raw.length !== 32) throw new TypeError('Proje anahtarı 32 bayt olmalı.');
    return { v: PISI_SYNC_KEY_PACKAGE_VERSION, spaceId, deviceId, keyEpoch: PISI_SYNC_KEY_EPOCH, key: toBase64Url(raw), spaceName: String(spaceName || '') };
}

/** The key package after opening it; `key` comes back as 32 bytes. Returns null when it is not valid or not for `expected`. */
export function parsePisiSyncKeyPackage(value, expected = {}) {
    if (!value || typeof value !== 'object' || value.v !== PISI_SYNC_KEY_PACKAGE_VERSION) return null;
    if (!isPisiSyncId('space', value.spaceId) || !isPisiSyncId('device', value.deviceId) || value.keyEpoch !== PISI_SYNC_KEY_EPOCH) return null;
    if (expected.spaceId && expected.spaceId !== value.spaceId) return null;
    if (expected.deviceId && expected.deviceId !== value.deviceId) return null;
    let key;
    try {
        key = fromBase64Url(value.key);
    } catch {
        return null;
    }
    if (key.length !== 32 || typeof value.spaceName !== 'string') return null;
    return { spaceId: value.spaceId, deviceId: value.deviceId, keyEpoch: value.keyEpoch, key, spaceName: value.spaceName };
}

// ---- Change metadata (§4.7) ----------------------------------------------

/** Metadata of a change, fields in protocol order. Optional fields are null when not given. */
export function makePisiSyncChangeMeta({ path, op, size = null, sha256 = null, docId = null, device, dseq, at, renamedFrom = null, conflictOf = null }) {
    const meta = { v: PISI_SYNC_META_VERSION, path, class: getPisiSyncFileClass(path), op };
    if (op === 'put') {
        meta.size = size;
        meta.sha256 = sha256;
    }
    meta.docId = docId;
    meta.dev = device;
    meta.dseq = dseq;
    meta.at = at;
    meta.renamedFrom = renamedFrom;
    meta.conflictOf = conflictOf;
    return meta;
}

/**
 * Checks a metadata object against the change it came with (`{ op, device }`
 * from the server). Returns `{ ok: true }` or `{ ok: false, code, field }`
 * with code PROTOCOL_UNSUPPORTED, META_INVALID or PATH_UNSAFE.
 */
export function validatePisiSyncChangeMeta(meta, change = {}) {
    const fail = (code, field) => ({ ok: false, code, field });
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return fail('META_INVALID', 'meta');
    if (meta.v !== PISI_SYNC_META_VERSION) return fail('PROTOCOL_UNSUPPORTED', 'v');
    const path = checkPisiSyncPath(meta.path);
    if (!path.ok) return fail('PATH_UNSAFE', 'path');
    if (path.path !== meta.path) return fail('PATH_UNSAFE', 'path');
    if (!PISI_SYNC_FILE_CLASSES.includes(meta.class) || meta.class !== getPisiSyncFileClass(meta.path)) return fail('META_INVALID', 'class');
    if (meta.op !== 'put' && meta.op !== 'delete') return fail('META_INVALID', 'op');
    if (change.op !== undefined && change.op !== meta.op) return fail('META_INVALID', 'op');
    if (meta.op === 'put') {
        if (!Number.isSafeInteger(meta.size) || meta.size < 0) return fail('META_INVALID', 'size');
        if (typeof meta.sha256 !== 'string' || !SHA256_HEX.test(meta.sha256)) return fail('META_INVALID', 'sha256');
    }
    const needsDocId = meta.class === 'node' || meta.class === 'map';
    if (meta.docId !== null && meta.docId !== undefined && (typeof meta.docId !== 'string' || !DOC_ID.test(meta.docId))) return fail('META_INVALID', 'docId');
    if (needsDocId && meta.op === 'put' && !meta.docId) return fail('META_INVALID', 'docId');
    if (!isPisiSyncId('device', meta.dev)) return fail('META_INVALID', 'dev');
    if (change.device !== undefined && change.device !== meta.dev) return fail('META_INVALID', 'dev');
    if (!Number.isSafeInteger(meta.dseq) || meta.dseq < 1) return fail('META_INVALID', 'dseq');
    if (typeof meta.at !== 'string' || !ISO_TIME.test(meta.at)) return fail('META_INVALID', 'at');
    for (const field of ['renamedFrom', 'conflictOf']) {
        if (meta[field] !== null && meta[field] !== undefined && !isPisiSyncId('fid', meta[field])) return fail('META_INVALID', field);
    }
    return { ok: true };
}

/** Seals a change's metadata, bound to its fid, op and blob (§4.2). `nonce` is 12 random bytes. */
export function sealPisiSyncChangeMeta({ subtle, keys, fid, blob = null, meta, nonce }) {
    return sealPisiSyncJson({
        subtle,
        key: keys.meta,
        spaceId: keys.spaceId,
        purpose: 'meta',
        binding: getPisiSyncMetaBinding(fid, meta.op, blob),
        value: meta,
        nonce
    });
}

/**
 * Opens and checks the metadata of a server change (a `changes` or `heads`
 * row): envelope, schema, path, op, device and that the path's fid is the
 * change's fid. Returns `{ ok: true, meta }` or `{ ok: false, code }`.
 */
export async function readPisiSyncChangeMeta({ subtle, keys, change }) {
    let meta;
    try {
        meta = await openPisiSyncJson({
            subtle,
            key: keys.meta,
            spaceId: keys.spaceId,
            purpose: 'meta',
            binding: getPisiSyncMetaBinding(change.fid, change.op, change.op === 'put' ? change.blob : null),
            envelope: change.meta
        });
    } catch (error) {
        return { ok: false, code: error instanceof PisiSyncError ? error.code : 'DECRYPT_FAILED' };
    }
    const valid = validatePisiSyncChangeMeta(meta, change);
    if (!valid.ok) return valid;
    if ((await computePisiSyncFid(subtle, keys.fid, meta.path)) !== change.fid) return { ok: false, code: 'META_INVALID', field: 'fid' };
    return { ok: true, meta };
}

/**
 * Checks opened blob bytes (§4.3): the blob id is the HMAC of the bytes, size
 * and SHA-256 match the metadata and an attachment's name is its SHA-256.
 * Returns `{ ok: true }` or `{ ok: false, code: 'HASH_MISMATCH_LOCAL' }`.
 */
export async function verifyPisiSyncBlobContent({ subtle, keys, blob, bytes, meta }) {
    const plain = toBytes(bytes);
    const fail = { ok: false, code: 'HASH_MISMATCH_LOCAL' };
    if ((await computePisiSyncBlobId(subtle, keys.blob, plain)) !== blob) return fail;
    const digest = await sha256Hex(subtle, plain);
    if (meta) {
        if (meta.size !== plain.length || meta.sha256 !== digest) return fail;
        const assetDigest = meta.class === 'asset' ? getPisiSyncAssetDigest(meta.path) : null;
        if (assetDigest && assetDigest !== digest) return fail;
    }
    return { ok: true };
}
