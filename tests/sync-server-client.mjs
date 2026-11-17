// Senkron sunucusu sözleşme testlerinin ortak istemcisi (docs/sync-protocol.md).
// İstekleri protokoldeki uç nokta tablosuna (§6) eşler, görülen hata kodlarını kaydeder;
// scripts/run-sync-server-tests.mjs bütün dosyalardan sonra tabloda eksik kalanı arar.
// Sunucu içerik çözmez; testler zarfları shared/sync-crypto.mjs ile gerçek anahtarlarla
// üretir ya da opak rastgele bayt kullanır.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    computePisiSyncPairingProof,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    exportPisiSyncEcdhPublicKey,
    generatePisiSyncEcdhKeyPair,
    importPisiSyncEcdhPublicKey,
    openPisiSyncJson,
    sealPisiSyncJson,
    toBase64Url
} from '../shared/sync-crypto.mjs';
import { makePisiSyncKeyPackage, makePisiSyncLabel } from '../shared/sync-meta.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const subtle = globalThis.crypto.subtle;
export const SYNC_SERVER_TESTS_ENABLED = process.env.PISI_SYNC_SERVER_TESTS === '1';
export const SYNC_SERVER_SKIP = SYNC_SERVER_TESTS_ENABLED ? false : 'npm run test:sync-server ile çalışır (PHP 8.4 + MariaDB 10.11)';

// ---- Protokol tabloları ----------------------------------------------------

/** §6'daki uç nokta tablosu: [{ method, template, regex }]. */
export function readProtocolEndpoints(text = fs.readFileSync(path.join(root, 'docs', 'sync-protocol.md'), 'utf8')) {
    const endpoints = [];
    for (const match of text.matchAll(/^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(\/v1\/[^`]+)`\s*\|/gm)) {
        const template = match[2];
        const pattern = template.replace(/\{[a-z]+\}/g, '[^/]+');
        endpoints.push({ method: match[1], template, regex: new RegExp(`^${pattern}$`), params: (template.match(/\{/g) || []).length });
    }
    return endpoints;
}

/** §9.2'deki sunucu hata kodları: [{ status, code, retryable }]. */
export function readProtocolErrorCodes(text = fs.readFileSync(path.join(root, 'docs', 'sync-protocol.md'), 'utf8')) {
    const section = text.slice(text.indexOf('### 9.2'), text.indexOf('### 9.3'));
    return [...section.matchAll(/^\|\s*(\d{3})\s*\|\s*`([A-Z_]+)`\s*\|[^|]*\|\s*([^|]*?)\s*\|\s*$/gm)].map((match) => ({
        status: Number(match[1]),
        code: match[2],
        retryable: match[3].startsWith('evet')
    }));
}

const endpoints = readProtocolEndpoints();
const coverage = { endpoints: new Set(), codes: new Set() };

/** Somut yolu tablodaki şablona eşler; birden çok eşleşmede en az parametreli olan (devices/me). */
export function endpointKey(method, pathname) {
    const matches = endpoints.filter((entry) => entry.method === method && entry.regex.test(pathname)).sort((a, b) => a.params - b.params);
    return matches.length ? `${method} ${matches[0].template}` : null;
}

if (process.env.PISI_SYNC_COVERAGE_DIR) {
    process.on('exit', () => {
        const file = path.join(process.env.PISI_SYNC_COVERAGE_DIR, `${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
        fs.writeFileSync(file, JSON.stringify({ endpoints: [...coverage.endpoints], codes: [...coverage.codes] }));
    });
}

// ---- İstemci ---------------------------------------------------------------

export const PROTOCOL_HEADER = { 'Pisi-Sync-Protocol': '1' };

/**
 * İstek atar. `token` Authorization: Bearer olur; `body` nesneyse JSON, Uint8Array/Buffer ise ham.
 * `https: false` X-Forwarded-Proto göndermez; `protocol: null` Pisi-Sync-Protocol göndermez.
 * Dönen: { status, headers, json, bytes, text }.
 */
export async function call(
    server,
    method,
    pathname,
    { token = null, body = undefined, headers = {}, https = true, protocol = '1', contentType = undefined } = {}
) {
    const requestHeaders = { 'User-Agent': 'Pisi-Sync/1' };
    if (https) requestHeaders['X-Forwarded-Proto'] = 'https';
    if (protocol !== null) requestHeaders['Pisi-Sync-Protocol'] = protocol;
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof Uint8Array) {
        payload = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
        requestHeaders['Content-Type'] = contentType || 'application/octet-stream';
    } else if (typeof body === 'string') {
        payload = body;
        requestHeaders['Content-Type'] = contentType || 'application/json';
    } else if (body !== undefined) {
        payload = JSON.stringify(body);
        requestHeaders['Content-Type'] = contentType || 'application/json';
    }
    Object.assign(requestHeaders, headers);
    for (const [key, value] of Object.entries(requestHeaders)) if (value === null) delete requestHeaders[key];
    const response = await fetch(`${server.baseUrl}${pathname}`, { method, headers: requestHeaders, body: /** @type {any} */ (payload) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = Buffer.from(bytes).toString('utf8');
    let json = null;
    if ((response.headers.get('content-type') || '').startsWith('application/json')) json = JSON.parse(text);
    const key = endpointKey(method, pathname.split('?')[0]);
    if (key) coverage.endpoints.add(key);
    if (json?.error?.code) coverage.codes.add(json.error.code);
    return { status: response.status, headers: response.headers, json, bytes, text };
}

/** Beklenen hata kodunu ve protokoldeki HTTP durumunu doğrular. */
export function expectError(assert, response, code) {
    const expected = readProtocolErrorCodes().find((entry) => entry.code === code);
    assert.ok(expected, `${code} protokol tablosunda yok`);
    assert.equal(response.json?.error?.code, code, `beklenen ${code}, gelen ${response.status} ${response.text.slice(0, 300)}`);
    assert.equal(response.status, expected.status, `${code} için HTTP durumu`);
    assert.equal(typeof response.json.error.message, 'string');
    assert.equal(typeof response.json.error.retryable, 'boolean');
    return response.json.error;
}

// ---- Kimlikler ve zarflar ----------------------------------------------------

export const randomId = (prefix, bytes = 16) => `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
export const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const newToken = () => randomId('pst_', 32);
export const newFid = () => randomId('f_', 32);
export const blobIdFor = (bytes) => `b_${crypto.createHash('sha256').update('pisi-test-blob|').update(bytes).digest('base64url')}`;

/** Sunucu için opak bir zarf: "PISE" başlığı + rastgele bayt (base64url). */
export function opaqueEnvelope(size = 80) {
    return Buffer.concat([Buffer.from('PISE\x01\x02\x00\x00\x00\x01', 'latin1'), crypto.randomBytes(size)]).toString('base64url');
}

/** Gerçek bir etiket zarfı: `key` K_label ya da KEK (ham 32 bayt). */
export function sealLabel(key, spaceId, purpose, binding, name, platform) {
    return sealPisiSyncJson({ subtle, key, spaceId, purpose, binding, value: makePisiSyncLabel({ name, platform }), nonce: crypto.randomBytes(12) });
}

// ---- Akışlar -----------------------------------------------------------------

/** Kurulum anahtarıyla yeni bir alan ve admin cihazı açar. */
export async function createSpace(server, { name = 'Pisi Projem', deviceName = 'Masaüstü', labelKey = crypto.randomBytes(32) } = {}) {
    const spaceId = randomId('sp_');
    const deviceId = randomId('dv_');
    const token = newToken();
    const response = await call(server, 'POST', '/v1/spaces', {
        headers: { 'Pisi-Setup-Key': server.setupKey },
        body: {
            spaceId,
            deviceId,
            tokenHash: sha256Hex(token),
            spaceName: await sealLabel(labelKey, spaceId, 'space-name', spaceId, name),
            deviceLabel: await sealLabel(labelKey, spaceId, 'device-label', deviceId, deviceName, 'linux')
        }
    });
    if (response.status !== 201) throw new Error(`Alan açılamadı: ${response.status} ${response.text}`);
    return { spaceId, deviceId, token, labelKey, response };
}

/**
 * QR yoluyla bir cihazı eşleştirir (§6.6): masaüstü başlatır, telefon katılır, masaüstü
 * proof'u doğrular ve onaylar, telefon sonucu alıp anahtar paketini açar.
 */
export async function pairDevice(server, admin, { role = 'member', name = 'Pixel 7', projectKey = crypto.randomBytes(32) } = {}) {
    const pairingId = randomId('pr_');
    const deviceId = randomId('dv_');
    const desktop = await generatePisiSyncEcdhKeyPair(subtle);
    const desktopKey = await exportPisiSyncEcdhPublicKey(subtle, desktop.publicKey);
    const secret = crypto.randomBytes(32);
    const started = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, { token: admin.token, body: { pairingId, deviceId, desktopKey } });
    if (started.status !== 201) throw new Error(`Eşleştirme başlamadı: ${started.text}`);

    const phone = await generatePisiSyncEcdhKeyPair(subtle);
    const deviceKey = await exportPisiSyncEcdhPublicKey(subtle, phone.publicKey);
    const phoneZ = await derivePisiSyncSharedSecret(subtle, phone.privateKey, await importPisiSyncEcdhPublicKey(subtle, desktopKey));
    const phoneKek = await derivePisiSyncPairingKek(subtle, phoneZ, pairingId, desktopKey, deviceKey);
    const token = newToken();
    const claimed = await call(server, 'POST', `/v1/pairings/${pairingId}/claim`, {
        body: {
            method: 'qr',
            proof: await computePisiSyncPairingProof(subtle, secret, pairingId, deviceKey),
            code: null,
            deviceKey,
            label: await sealLabel(phoneKek, admin.spaceId, 'pair-label', pairingId, name, 'android'),
            tokenHash: sha256Hex(token)
        }
    });
    if (claimed.status !== 202) throw new Error(`Katılım başarısız: ${claimed.text}`);

    const status = await call(server, 'GET', `/v1/spaces/${admin.spaceId}/pairings/${pairingId}`, { token: admin.token });
    const desktopZ = await derivePisiSyncSharedSecret(subtle, desktop.privateKey, await importPisiSyncEcdhPublicKey(subtle, status.json.deviceKey));
    const kek = await derivePisiSyncPairingKek(subtle, desktopZ, pairingId, desktopKey, status.json.deviceKey);
    const label = await openPisiSyncJson({ subtle, key: kek, spaceId: admin.spaceId, purpose: 'pair-label', binding: pairingId, envelope: status.json.label });
    const wrappedKey = await sealPisiSyncJson({
        subtle,
        key: kek,
        spaceId: admin.spaceId,
        purpose: 'pair-key',
        binding: pairingId,
        value: makePisiSyncKeyPackage({ spaceId: admin.spaceId, deviceId, key: projectKey, spaceName: 'Pisi Projem' }),
        nonce: crypto.randomBytes(12)
    });
    const granted = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings/${pairingId}/grant`, {
        token: admin.token,
        body: { role, wrappedKey, label: await sealLabel(admin.labelKey, admin.spaceId, 'device-label', deviceId, label.name, 'android') }
    });
    if (granted.status !== 200) throw new Error(`Onay başarısız: ${granted.text}`);
    const result = await call(server, 'GET', `/v1/pairings/${pairingId}/result`, { token });
    if (result.status !== 200) throw new Error(`Sonuç alınamadı: ${result.text}`);
    const keyPackage = await openPisiSyncJson({
        subtle,
        key: phoneKek,
        spaceId: admin.spaceId,
        purpose: 'pair-key',
        binding: pairingId,
        envelope: result.json.wrappedKey
    });
    return { spaceId: admin.spaceId, deviceId, token, role, pairingId, keyPackage, label, result: result.json };
}

/** Bir blob'u tek ya da çok parçada yükler ve kimliğini döner. */
export async function uploadBlob(server, device, bytes, { blobId = blobIdFor(bytes) } = {}) {
    const started = await call(server, 'POST', `/v1/spaces/${device.spaceId}/blobs/${blobId}/uploads`, {
        token: device.token,
        body: { size: bytes.length, sha256: sha256Hex(bytes) }
    });
    if (started.status === 200 && started.json.exists) return blobId;
    if (started.status !== 201) throw new Error(`Yükleme başlamadı: ${started.text}`);
    const { uploadId, partBytes, parts } = started.json;
    for (let part = 1; part <= parts; part++) {
        const chunk = bytes.subarray((part - 1) * partBytes, part * partBytes);
        const sent = await call(server, 'PUT', `/v1/spaces/${device.spaceId}/uploads/${uploadId}/parts/${part}`, {
            token: device.token,
            body: chunk,
            headers: { 'Pisi-Part-Sha256': sha256Hex(chunk) }
        });
        if (sent.status !== 200) throw new Error(`Parça yüklenemedi: ${sent.text}`);
    }
    const completed = await call(server, 'POST', `/v1/spaces/${device.spaceId}/uploads/${uploadId}/complete`, { token: device.token, body: {} });
    if (completed.status !== 201 && completed.status !== 200) throw new Error(`Yükleme bitmedi: ${completed.text}`);
    return blobId;
}

/** Tek değişiklikli `put` commit'i: blob'u yükler ve gönderir. */
export async function putFile(server, device, { fid = newFid(), bytes = crypto.randomBytes(300), baseSeq = 0, commitId = randomId('cm_') } = {}) {
    const blob = await uploadBlob(server, device, bytes);
    const response = await call(server, 'POST', `/v1/spaces/${device.spaceId}/commit`, {
        token: device.token,
        body: { commitId, changes: [{ fid, op: 'put', blob, size: bytes.length, baseSeq, meta: opaqueEnvelope() }] }
    });
    return { fid, blob, bytes, commitId, response };
}

export { toBase64Url };
