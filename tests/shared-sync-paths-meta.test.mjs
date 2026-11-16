// Paths (docs/sync-plan.md §3.3, rule SV7) and the encrypted metadata of a
// change (docs/sync-protocol.md §4.3, §4.7, §6.6) of the sync core.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { computePisiSyncBlobId, computePisiSyncFid, openPisiSyncSpaceKeys, utf8Encode } from '../shared/sync-crypto.mjs';
import {
    formatPisiSyncPairingCode,
    formatPisiSyncPairingUri,
    isPisiSyncId,
    makePisiSyncChangeMeta,
    makePisiSyncKeyPackage,
    makePisiSyncLabel,
    normalizePisiSyncPairingCode,
    normalizePisiSyncServerUrl,
    parsePisiSyncKeyPackage,
    parsePisiSyncLabel,
    parsePisiSyncPairingUri,
    readPisiSyncChangeMeta,
    sealPisiSyncChangeMeta,
    validatePisiSyncChangeMeta,
    verifyPisiSyncBlobContent
} from '../shared/sync-meta.mjs';
import {
    findPisiSyncPathCollisions,
    getPisiSyncAssetDigest,
    getPisiSyncDiaryDate,
    getPisiSyncFileClass,
    isPisiSyncExcludedPath,
    normalizePisiSyncPath
} from '../shared/sync-paths.mjs';

const subtle = globalThis.crypto.subtle;
const SHA = 'c0b5e49c4f24f5964ca1fd17270bb24279aaf87fdfa35a62bf2e6f1f038488ae';
const DEVICE = 'dv_8h1Lq0Zx2Wc7Vb3Nm5Kp4J';
const SIDECAR = 'inv_Toplantı Notları__node_829ebade-0cb6-4470-8dc8-1407ff6b103c';

test('dosya sınıfları plan §3.3 tablosuyla aynı', () => {
    const cases = {
        'Toplantı Notları.node': 'node',
        'diary/2026-11-14.node': 'node',
        'nd_Yol Haritası__map_b3ec2889-a557-40c1-9c86-24d9eb25318d/Yeni Node.node': 'node',
        'Yol Haritası.map': 'map',
        '.pisi/tasks.json': 'authority',
        '.pisi/relationships.json': 'authority',
        '.pisi/properties.json': 'authority',
        '.pisi/other.json': 'json',
        '.pisi-views.json': 'json',
        '.pisi-templates.json': 'json',
        'diary/.pisi-diary': 'marker',
        [`${SIDECAR}/image/${SHA}.png`]: 'asset',
        [`${SIDECAR}/file/${SHA}.pdf`]: 'asset',
        [`${SIDECAR}/paint/${SHA}.png`]: 'asset',
        [`${SIDECAR}/sheet/${SHA}.json`]: 'asset',
        [`nd_Harita__map_x1/${SIDECAR}/image/${SHA}.png`]: 'asset',
        [`${SIDECAR}/image/kedi.png`]: 'other',
        [`${SIDECAR}/notlar/${SHA}.png`]: 'other',
        'belge.pdf': 'other',
        '.pisi/alt/klasör.json': 'other'
    };
    for (const [path, expected] of Object.entries(cases)) assert.equal(getPisiSyncFileClass(path), expected, path);
    assert.equal(getPisiSyncAssetDigest(`${SIDECAR}/image/${SHA}.png`), SHA);
    assert.equal(getPisiSyncDiaryDate('diary/2026-11-14.node'), '2026-11-14');
    assert.equal(getPisiSyncDiaryDate('notlar/diary/2026-11-14.node'), null);
});

test('senkron dışı yollar ve yol normalizasyonu', () => {
    for (const excluded of ['.pisi-history', '.pisi/mutations/', '.pisi/trash', '.PISI/Trash/items/a.json', 'a/node_modules/b', '.git']) {
        assert.equal(isPisiSyncExcludedPath(excluded), true, excluded);
    }
    for (const kept of ['.pisi/tasks.json', '.pisi', 'diary/.pisi-diary', 'notlar/.pisi-history-not.node', 'trash/not.node']) {
        assert.equal(isPisiSyncExcludedPath(kept), false, kept);
    }
    assert.equal(normalizePisiSyncPath('Çiçek.node'), 'Çiçek.node');
    assert.equal(normalizePisiSyncPath('../a.node'), null);
    assert.deepEqual(findPisiSyncPathCollisions(['Not.node', 'not.node', 'Başka.node', 'NOT.NODE', 'İ.node', 'i.node']), [
        ['NOT.NODE', 'Not.node', 'not.node']
    ]);
});

test('kimlik biçimleri, sunucu adresi, kısa kod', () => {
    assert.equal(isPisiSyncId('space', 'sp_Q0x3mVt2Yk1pR8sA0bC9dE'), true);
    assert.equal(isPisiSyncId('space', 'sp_short'), false);
    assert.equal(isPisiSyncId('unknown', 'x'), false);
    assert.equal(normalizePisiSyncServerUrl(' https://Sync.Ornek.com/pisi/ '), 'https://sync.ornek.com/pisi');
    assert.equal(normalizePisiSyncServerUrl('http://sync.ornek.com'), null);
    assert.equal(normalizePisiSyncServerUrl('https://user@ornek.com'), null);
    assert.equal(normalizePisiSyncPairingCode('7k3m-q9wx'), '7K3MQ9WX');
    assert.equal(normalizePisiSyncPairingCode('7K3M-Q9WI'), null, 'I Crockford alfabesinde yok');
    assert.equal(formatPisiSyncPairingCode('7k3mq9wx'), '7K3M-Q9WX');
});

test('eşleştirme QR adresi yazılır ve okunur; eksik ya da bozuk alan reddedilir', () => {
    const secret = crypto.randomBytes(32);
    const value = {
        serverUrl: 'https://sync.ornek.com/pisi',
        spaceId: 'sp_Q0x3mVt2Yk1pR8sA0bC9dE',
        pairingId: 'pr_V2c8Qm1Zp0Lx7Nk3Tb5Rw9',
        desktopKey: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url'),
        secret,
        code: '7K3MQ9WX'
    };
    const uri = formatPisiSyncPairingUri(value);
    assert.match(uri, /^pisi-sync:1\?u=https%3A%2F%2Fsync\.ornek\.com%2Fpisi&s=sp_/);
    const parsed = parsePisiSyncPairingUri(uri);
    assert.equal(parsed.ok, true);
    assert.deepEqual({ ...parsed.value, secret: Buffer.from(parsed.value.secret) }, { ...value, secret });
    assert.deepEqual(parsePisiSyncPairingUri('https://ornek.com'), { ok: false, field: 'scheme' });
    assert.deepEqual(parsePisiSyncPairingUri(uri.replace('&c=7K3M-Q9WX', '')), { ok: false, field: 'c' });
    assert.deepEqual(parsePisiSyncPairingUri(uri.replace('u=https', 'u=http')), { ok: false, field: 'u' });
    assert.deepEqual(parsePisiSyncPairingUri(`${uri}&s=sp_Q0x3mVt2Yk1pR8sA0bC9dE`), { ok: false, field: 's' });
});

test('etiket ve anahtar paketi şemaları', () => {
    assert.deepEqual(makePisiSyncLabel({ name: ' Pixel 7 ', platform: 'android' }), { v: 1, name: 'Pixel 7', platform: 'android' });
    assert.deepEqual(makePisiSyncLabel({ name: 'Pisi Projem' }), { v: 1, name: 'Pisi Projem' });
    assert.equal(parsePisiSyncLabel({ v: 2, name: 'x' }), null);
    assert.equal(parsePisiSyncLabel({ v: 1, name: 'x', platform: 'amiga' }), null);
    assert.deepEqual(parsePisiSyncLabel({ v: 1, name: 'x', extra: 1 }), { v: 1, name: 'x' });

    const key = crypto.randomBytes(32);
    const keyPackage = makePisiSyncKeyPackage({ spaceId: 'sp_Q0x3mVt2Yk1pR8sA0bC9dE', deviceId: DEVICE, key, spaceName: 'Pisi Projem' });
    const parsed = parsePisiSyncKeyPackage(JSON.parse(JSON.stringify(keyPackage)), { deviceId: DEVICE });
    assert.deepEqual(Buffer.from(parsed.key), key);
    assert.equal(parsePisiSyncKeyPackage(keyPackage, { deviceId: 'dv_AAAAAAAAAAAAAAAAAAAAAA' }), null);
    assert.equal(parsePisiSyncKeyPackage({ ...keyPackage, key: 'kısa' }), null);
    assert.equal(parsePisiSyncKeyPackage({ ...keyPackage, keyEpoch: 2 }), null);
});

test('metadata şeması: zorunlu alanlar, sınıf, yol ve cihaz eşleşmesi', () => {
    const meta = makePisiSyncChangeMeta({
        path: 'Toplantı Notları.node',
        op: 'put',
        size: 10,
        sha256: SHA,
        docId: 'node_829ebade-0cb6-4470-8dc8-1407ff6b103c',
        device: DEVICE,
        dseq: 1,
        at: '2026-11-16T10:00:00.000Z'
    });
    assert.deepEqual(Object.keys(meta), ['v', 'path', 'class', 'op', 'size', 'sha256', 'docId', 'dev', 'dseq', 'at', 'renamedFrom', 'conflictOf']);
    assert.deepEqual(validatePisiSyncChangeMeta(meta, { op: 'put', device: DEVICE }), { ok: true });
    const bad = (patch, change = {}) => validatePisiSyncChangeMeta({ ...meta, ...patch }, change);
    assert.equal(bad({ v: 2 }).code, 'PROTOCOL_UNSUPPORTED');
    assert.equal(bad({ path: '../x.node' }).code, 'PATH_UNSAFE');
    assert.equal(bad({ path: '.pisi/trash/x.node' }).code, 'PATH_UNSAFE');
    assert.equal(bad({ path: 'Ç.node' }).code, 'PATH_UNSAFE', 'NFC olmayan yol');
    assert.equal(bad({ class: 'map' }).field, 'class');
    assert.equal(bad({ sha256: 'xyz' }).field, 'sha256');
    assert.equal(bad({ docId: null }).field, 'docId');
    assert.equal(bad({ dseq: 0 }).field, 'dseq');
    assert.equal(bad({}, { device: 'dv_AAAAAAAAAAAAAAAAAAAAAA' }).field, 'dev');
    assert.equal(bad({}, { op: 'delete' }).field, 'op');
    assert.equal(bad({ renamedFrom: 'eski.node' }).field, 'renamedFrom');
    const deletion = makePisiSyncChangeMeta({ path: 'a.node', op: 'delete', docId: null, device: DEVICE, dseq: 2, at: '2026-11-16T10:00:00Z' });
    assert.deepEqual(validatePisiSyncChangeMeta(deletion, { op: 'delete' }), { ok: true });
    assert.equal('size' in deletion, false);
});

test('metadata zarfı fid, op ve blob kimliğine bağlıdır; içerik özeti doğrulanır', async () => {
    const keys = await openPisiSyncSpaceKeys(subtle, crypto.randomBytes(32), 'sp_Q0x3mVt2Yk1pR8sA0bC9dE');
    const bytes = utf8Encode('{"pisi":{}}');
    const blob = await computePisiSyncBlobId(subtle, keys.blob, bytes);
    const path = 'Toplantı Notları.node';
    const fid = await computePisiSyncFid(subtle, keys.fid, path);
    const meta = makePisiSyncChangeMeta({
        path,
        op: 'put',
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        docId: 'node_1',
        device: DEVICE,
        dseq: 3,
        at: '2026-11-16T10:00:00.000Z'
    });
    const envelope = await sealPisiSyncChangeMeta({ subtle, keys, fid, blob, meta, nonce: crypto.randomBytes(12) });
    const change = { fid, op: 'put', blob, device: DEVICE, meta: envelope };

    assert.deepEqual(await readPisiSyncChangeMeta({ subtle, keys, change }), { ok: true, meta });
    const otherFid = await computePisiSyncFid(subtle, keys.fid, 'Başka.node');
    assert.deepEqual(await readPisiSyncChangeMeta({ subtle, keys, change: { ...change, fid: otherFid } }), { ok: false, code: 'DECRYPT_FAILED' });
    assert.deepEqual(await readPisiSyncChangeMeta({ subtle, keys, change: { ...change, blob: `b_${'A'.repeat(43)}` } }), { ok: false, code: 'DECRYPT_FAILED' });
    // Sealed with the wrong fid inside: the binding holds but the recomputed fid does not.
    const lying = await sealPisiSyncChangeMeta({ subtle, keys, fid: otherFid, blob, meta, nonce: crypto.randomBytes(12) });
    assert.deepEqual(await readPisiSyncChangeMeta({ subtle, keys, change: { ...change, fid: otherFid, meta: lying } }), {
        ok: false,
        code: 'META_INVALID',
        field: 'fid'
    });

    assert.deepEqual(await verifyPisiSyncBlobContent({ subtle, keys, blob, bytes, meta }), { ok: true });
    assert.equal((await verifyPisiSyncBlobContent({ subtle, keys, blob, bytes: utf8Encode('{"pisi":{"x":1}}'), meta })).code, 'HASH_MISMATCH_LOCAL');
    assert.equal((await verifyPisiSyncBlobContent({ subtle, keys, blob, bytes, meta: { ...meta, size: 1 } })).code, 'HASH_MISMATCH_LOCAL');

    // An attachment's name is its SHA-256 (§4.3).
    const image = crypto.randomBytes(100);
    const imageBlob = await computePisiSyncBlobId(subtle, keys.blob, image);
    const imageMeta = (digest) => ({
        class: 'asset',
        path: `${SIDECAR}/image/${digest}.png`,
        size: image.length,
        sha256: crypto.createHash('sha256').update(image).digest('hex')
    });
    const goodName = crypto.createHash('sha256').update(image).digest('hex');
    assert.deepEqual(await verifyPisiSyncBlobContent({ subtle, keys, blob: imageBlob, bytes: image, meta: imageMeta(goodName) }), { ok: true });
    assert.equal((await verifyPisiSyncBlobContent({ subtle, keys, blob: imageBlob, bytes: image, meta: imageMeta(SHA) })).code, 'HASH_MISMATCH_LOCAL');
});
