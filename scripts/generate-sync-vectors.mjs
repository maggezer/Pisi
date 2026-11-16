#!/usr/bin/env node
// Writes tests/fixtures/sync-vectors.json (docs/sync-protocol.md §13) from
// fixed inputs. Every value is computed by shared/sync-crypto.mjs; the tests
// (tests/shared-sync-vectors.test.mjs, mobile/tests/sync-vectors.test.mjs)
// recompute them and tests/shared-sync-vectors.test.mjs also cross-checks
// them with node:crypto, so the file is not only checked against itself.
//
//   node scripts/generate-sync-vectors.mjs           # check that the file is current
//   node scripts/generate-sync-vectors.mjs --write   # rewrite it

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
    computePisiSyncBlobId,
    computePisiSyncFid,
    computePisiSyncPairingProof,
    computePisiSyncSas,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    derivePisiSyncSubkeyBytes,
    formatPisiSyncRandomId,
    formatPisiSyncSas,
    getPisiSyncMetaBinding,
    getPisiSyncPaddedLength,
    hashPisiSyncToken,
    padme,
    sealPisiSyncEnvelope,
    toBase64Url,
    toHex,
    utf8Encode
} from '../shared/sync-crypto.mjs';
import { checkPisiSyncPath, getPisiSyncPathKey } from '../shared/sync-paths.mjs';

const subtle = globalThis.crypto.subtle;
const target = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'sync-vectors.json');
const seeded = (label, length = 32) => crypto.createHash('sha256').update(`pisi-sync-vectors|${label}`).digest().subarray(0, length);

function ecdhKeyPair(label) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(seeded(label));
    const publicKey = ecdh.getPublicKey(null, 'uncompressed');
    return {
        jwk: {
            kty: 'EC',
            crv: 'P-256',
            d: toBase64Url(ecdh.getPrivateKey()),
            x: toBase64Url(publicKey.subarray(1, 33)),
            y: toBase64Url(publicKey.subarray(33, 65))
        },
        publicKey: toBase64Url(publicKey)
    };
}

async function build() {
    const projectKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const spaceId = formatPisiSyncRandomId('sp_', seeded('space', 16));
    const deviceId = formatPisiSyncRandomId('dv_', seeded('device', 16));
    const pairingId = formatPisiSyncRandomId('pr_', seeded('pairing', 16));
    const subkeys = await derivePisiSyncSubkeyBytes(subtle, projectKey, spaceId);
    const hex = (bytes) => toHex(bytes);

    const assetSha = crypto.createHash('sha256').update('pisi image').digest('hex');
    const paths = [
        'Toplantı Notları.node',
        'diary/2026-11-16.node',
        `inv_Not__node_829ebade-0cb6-4470-8dc8-1407ff6b103c/image/${assetSha}.png`,
        '.pisi/tasks.json',
        'ISTANBUL.node',
        'istanbul.node',
        'İSTANBUL.node',
        'Çiçek.node',
        'C\u0327ic\u0327ek.node'
    ];
    const pathVectors = [];
    for (const value of paths) {
        pathVectors.push({ path: value, pathKey: getPisiSyncPathKey(value), fid: await computePisiSyncFid(subtle, subkeys.fid, value) });
    }

    const blobInputs = [
        { label: 'empty', bytes: new Uint8Array() },
        { label: 'utf8', bytes: utf8Encode('Merhaba Pisi — çğıöşü') },
        { label: 'binary', bytes: Uint8Array.from({ length: 300 }, (_, index) => (index * 37) & 0xff) }
    ];
    const blobs = [];
    for (const input of blobInputs) {
        blobs.push({ label: input.label, plainHex: hex(input.bytes), blob: await computePisiSyncBlobId(subtle, subkeys.blob, input.bytes) });
    }

    // Pairing (§6.6) with fixed ECDH key pairs.
    const desktop = ecdhKeyPair('desktop');
    const device = ecdhKeyPair('device');
    const importPrivate = (jwk) => subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const importPublic = (encoded) => subtle.importKey('raw', Buffer.from(encoded, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const sharedSecret = await derivePisiSyncSharedSecret(subtle, await importPrivate(desktop.jwk), await importPublic(device.publicKey));
    const kek = await derivePisiSyncPairingKek(subtle, sharedSecret, pairingId, desktop.publicKey, device.publicKey);
    const qrSecret = seeded('qr-secret');
    const sas = await computePisiSyncSas(subtle, sharedSecret, pairingId, desktop.publicKey, device.publicKey);

    // Envelopes (§4.2): one per purpose, plus the compressed and unpadded forms.
    const fid = pathVectors[0].fid;
    const nodeText = JSON.stringify(
        { pisi: { id: 'node_829ebade-0cb6-4470-8dc8-1407ff6b103c', title: 'Toplantı Notları' }, content: 'Pisi '.repeat(40) },
        null,
        2
    );
    const nodeBytes = utf8Encode(nodeText);
    const nodeBlob = await computePisiSyncBlobId(subtle, subkeys.blob, nodeBytes);
    const gzipped = zlib.gzipSync(nodeBytes, { level: 9 });
    const meta = {
        v: 1,
        path: 'Toplantı Notları.node',
        class: 'node',
        op: 'put',
        size: nodeBytes.length,
        sha256: crypto.createHash('sha256').update(nodeBytes).digest('hex'),
        docId: 'node_829ebade-0cb6-4470-8dc8-1407ff6b103c',
        dev: deviceId,
        dseq: 57,
        at: '2026-11-16T10:00:00.000Z',
        renamedFrom: null,
        conflictOf: null
    };
    const keyPackage = { v: 1, spaceId, deviceId, keyEpoch: 1, key: toBase64Url(projectKey), spaceName: 'Pisi Projem' };
    const envelopeInputs = [
        { name: 'blob-plain-padded', purpose: 'blob', key: 'content', binding: nodeBlob, plaintext: nodeBytes, pad: true },
        { name: 'blob-gzip-padded', purpose: 'blob', key: 'content', binding: nodeBlob, plaintext: nodeBytes, gzipHex: hex(gzipped), pad: true },
        { name: 'blob-plain-unpadded', purpose: 'blob', key: 'content', binding: blobs[1].blob, plaintext: blobInputs[1].bytes, pad: false },
        {
            name: 'meta',
            purpose: 'meta',
            key: 'meta',
            binding: getPisiSyncMetaBinding(fid, 'put', nodeBlob),
            plaintext: utf8Encode(JSON.stringify(meta)),
            pad: true
        },
        { name: 'space-name', purpose: 'space-name', key: 'label', binding: spaceId, plaintext: utf8Encode('{"v":1,"name":"Pisi Projem"}'), pad: true },
        {
            name: 'device-label',
            purpose: 'device-label',
            key: 'label',
            binding: deviceId,
            plaintext: utf8Encode('{"v":1,"name":"Pixel 7","platform":"android"}'),
            pad: true
        },
        {
            name: 'pair-label',
            purpose: 'pair-label',
            key: 'kek',
            binding: pairingId,
            plaintext: utf8Encode('{"v":1,"name":"Pixel 7","platform":"android"}'),
            pad: true
        },
        { name: 'pair-key', purpose: 'pair-key', key: 'kek', binding: pairingId, plaintext: utf8Encode(JSON.stringify(keyPackage)), pad: true }
    ];
    const keyBytes = { ...subkeys, kek };
    const envelopes = [];
    for (const [index, input] of envelopeInputs.entries()) {
        const nonce = seeded(`nonce-${index}`, 12);
        const compressed = input.gzipHex ? Buffer.from(input.gzipHex, 'hex') : null;
        const envelope = await sealPisiSyncEnvelope({
            subtle,
            key: keyBytes[input.key],
            spaceId,
            purpose: input.purpose,
            binding: input.binding,
            plaintext: input.plaintext,
            nonce,
            gzip: compressed ? async () => new Uint8Array(compressed) : null,
            pad: input.pad
        });
        envelopes.push({
            name: input.name,
            purpose: input.purpose,
            key: input.key,
            binding: input.binding,
            nonceHex: hex(nonce),
            plaintextHex: hex(input.plaintext),
            gzipHex: input.gzipHex || null,
            pad: input.pad,
            envelope: toBase64Url(envelope)
        });
    }

    // Invalid inputs that must not open (§4.2, §4.3).
    const base = Buffer.from(envelopes[3].envelope, 'base64url');
    const changed = (mutate) => {
        const copy = Buffer.from(base);
        mutate(copy);
        return copy.toString('base64url');
    };
    const invalidEnvelopes = [
        { name: 'tampered-tag', envelope: changed((bytes) => (bytes[bytes.length - 1] ^= 1)), binding: envelopes[3].binding },
        { name: 'tampered-ciphertext', envelope: changed((bytes) => (bytes[30] ^= 1)), binding: envelopes[3].binding },
        { name: 'tampered-header-flags', envelope: changed((bytes) => (bytes[5] = 0)), binding: envelopes[3].binding },
        { name: 'unknown-version', envelope: changed((bytes) => (bytes[4] = 2)), binding: envelopes[3].binding },
        { name: 'unknown-flag', envelope: changed((bytes) => (bytes[5] |= 4)), binding: envelopes[3].binding },
        { name: 'unknown-magic', envelope: changed((bytes) => (bytes[0] = 0x58)), binding: envelopes[3].binding },
        { name: 'unknown-key-epoch', envelope: changed((bytes) => (bytes[9] = 2)), binding: envelopes[3].binding },
        { name: 'wrong-binding', envelope: envelopes[3].envelope, binding: getPisiSyncMetaBinding(pathVectors[1].fid, 'put', nodeBlob) },
        { name: 'truncated', envelope: base.subarray(0, 30).toString('base64url'), binding: envelopes[3].binding }
    ];

    const unsafePaths = [
        '',
        '/abs.node',
        'C:/abs.node',
        'a\\b.node',
        '../up.node',
        'a/./b.node',
        'a//b.node',
        'a/b.node/',
        'tab\there.node',
        'what?.node',
        'trailing /x.node',
        'dot./x.node',
        `${'a'.repeat(256)}.node`,
        `${'d/'.repeat(520)}x.node`,
        '.pisi-history/node_x/1.json.gz',
        '.pisi/mutations/mut_1/journal.json',
        '.pisi/trash/items/x.json',
        '.pisi/reminder-state.json',
        '.pisi/sync-state.json',
        '.pisi-sync/devices/a.json',
        'notes/.git/config',
        'node_modules/x/index.js',
        'Not.node.tmp',
        '.Not.node.mobile-1a2b.tmp',
        'Not.node.pisi-backup',
        '.pisi.lock/owner',
        'klasör/.DS_Store',
        'Thumbs.db',
        'desktop.ini',
        '~$rapor.docx'
    ].map((value) => ({ path: value, reason: checkPisiSyncPath(value).reason }));

    const token = formatPisiSyncRandomId('pst_', seeded('token'));
    return {
        description: 'Pisi Sync protokol 1 test vektörleri (docs/sync-protocol.md §13). scripts/generate-sync-vectors.mjs ile üretilir; elle düzenlenmez.',
        protocol: 1,
        projectKeyHex: hex(projectKey),
        spaceId,
        deviceId,
        pairingId,
        subkeys: Object.fromEntries(Object.entries(subkeys).map(([name, bytes]) => [name, hex(bytes)])),
        paths: pathVectors,
        blobs,
        token: { token, tokenHash: await hashPisiSyncToken(subtle, token) },
        padme: [1, 2, 9, 100, 255, 256, 257, 1000, 4096, 4097, 65535, 100000, 1048576, 67108863].map((length) => ({
            length,
            padme: padme(length),
            padded: getPisiSyncPaddedLength(length)
        })),
        pairing: {
            desktop,
            device,
            secretHex: hex(qrSecret),
            sharedSecretHex: hex(sharedSecret),
            kekHex: hex(kek),
            proof: await computePisiSyncPairingProof(subtle, qrSecret, pairingId, device.publicKey),
            sas,
            sasText: formatPisiSyncSas(sas)
        },
        envelopes,
        invalidEnvelopes,
        unsafePaths
    };
}

const text = `${JSON.stringify(await build(), null, 4)}\n`;
if (process.argv.includes('--write')) {
    fs.writeFileSync(target, text);
    console.log(`Yazıldı: ${path.relative(process.cwd(), target)}`);
} else {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== text) {
        console.error('tests/fixtures/sync-vectors.json güncel değil: node scripts/generate-sync-vectors.mjs --write');
        process.exit(1);
    }
    console.log('Senkron test vektörleri güncel.');
}
