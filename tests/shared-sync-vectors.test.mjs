// Test vectors of the sync protocol (docs/sync-protocol.md §13). The values in
// tests/fixtures/sync-vectors.json are recomputed with shared/sync-crypto.mjs
// over Node's Web Crypto, and cross-checked with node:crypto's own HKDF, HMAC,
// AES-GCM and ECDH, so the vectors do not only agree with the code that wrote them.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
    PisiSyncError,
    computePisiSyncBlobId,
    computePisiSyncFid,
    computePisiSyncPairingProof,
    computePisiSyncSas,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    derivePisiSyncSubkeyBytes,
    formatPisiSyncSas,
    fromBase64Url,
    fromHex,
    getPisiSyncPaddedLength,
    hashPisiSyncToken,
    importPisiSyncEcdhPublicKey,
    openPisiSyncEnvelope,
    padme,
    sealPisiSyncEnvelope,
    toBase64Url,
    utf8Decode,
    utf8Encode,
    verifyPisiSyncPairingProof
} from '../shared/sync-crypto.mjs';
import { checkPisiSyncPath, getPisiSyncPathKey } from '../shared/sync-paths.mjs';
import { makePisiSyncConflictContent } from '../shared/sync-conflict.mjs';
import { mergePisiSyncAuthority } from '../shared/sync-merge-authority.mjs';
import { mergePisiSyncNode } from '../shared/sync-merge-node.mjs';
import { listPisiNoteTaskIds } from '../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const subtle = globalThis.crypto.subtle;
const vectors = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sync-vectors.json'), 'utf8'));
const projectKey = fromHex(vectors.projectKeyHex);
const gunzip = async (bytes) => new Uint8Array(zlib.gunzipSync(bytes));

async function keyBytes() {
    const subkeys = await derivePisiSyncSubkeyBytes(subtle, projectKey, vectors.spaceId);
    return { ...subkeys, kek: fromHex(vectors.pairing.kekHex) };
}

test('HKDF alt anahtarları vektörle ve node:crypto hkdfSync ile aynı', async () => {
    const subkeys = await derivePisiSyncSubkeyBytes(subtle, projectKey, vectors.spaceId);
    for (const [name, hex] of Object.entries(vectors.subkeys)) {
        assert.equal(Buffer.from(subkeys[name]).toString('hex'), hex, name);
        const node = crypto.hkdfSync('sha256', projectKey, Buffer.from(`pisi-sync/1|${vectors.spaceId}`), Buffer.from(name), 32);
        assert.equal(Buffer.from(node).toString('hex'), hex, `${name} (node:crypto)`);
    }
});

test('yol anahtarı ve fid: büyük-küçük harf ve NFC katlaması sabit', async () => {
    const byPath = new Map(vectors.paths.map((entry) => [entry.path, entry]));
    for (const entry of vectors.paths) {
        assert.equal(getPisiSyncPathKey(entry.path), entry.pathKey);
        assert.equal(await computePisiSyncFid(subtle, fromHex(vectors.subkeys.fid), entry.path), entry.fid, entry.path);
        const node = crypto.createHmac('sha256', Buffer.from(vectors.subkeys.fid, 'hex')).update(entry.pathKey, 'utf8').digest('base64url');
        assert.equal(entry.fid, `f_${node}`);
        assert.match(entry.fid, /^f_[A-Za-z0-9_-]{43}$/);
    }
    assert.equal(byPath.get('ISTANBUL.node').fid, byPath.get('istanbul.node').fid);
    assert.notEqual(byPath.get('İSTANBUL.node').fid, byPath.get('istanbul.node').fid);
    assert.equal(byPath.get('İSTANBUL.node').pathKey, 'i̇stanbul.node');
    assert.equal(byPath.get('Çiçek.node').fid, byPath.get('Çiçek.node').fid);
});

test('blob kimliği ve token özeti', async () => {
    for (const entry of vectors.blobs) {
        assert.equal(await computePisiSyncBlobId(subtle, fromHex(vectors.subkeys.blob), fromHex(entry.plainHex)), entry.blob, entry.label);
        const node = crypto.createHmac('sha256', Buffer.from(vectors.subkeys.blob, 'hex')).update(Buffer.from(entry.plainHex, 'hex')).digest('base64url');
        assert.equal(entry.blob, `b_${node}`);
    }
    assert.equal(await hashPisiSyncToken(subtle, vectors.token.token), vectors.token.tokenHash);
    assert.equal(crypto.createHash('sha256').update(vectors.token.token).digest('hex'), vectors.token.tokenHash);
    assert.match(vectors.token.token, /^pst_[A-Za-z0-9_-]{43}$/);
});

test('Padmé tablosu ve dolgu uzunluğu', () => {
    for (const row of vectors.padme) {
        assert.equal(padme(row.length), row.padme, `padme(${row.length})`);
        assert.equal(getPisiSyncPaddedLength(row.length), row.padded, `padded(${row.length})`);
        // The protocol's own formula, with exact integers.
        const E = Math.floor(Math.log2(row.length));
        const S = row.length >= 2 ? Math.floor(Math.log2(E)) + 1 : 0;
        const m = 2 ** Math.max(0, E - S) - 1;
        if (row.length >= 2) assert.equal(row.padme, Math.floor((row.length + m) / (m + 1)) * (m + 1));
    }
});

test('her amaç için zarf aynı baytlarla mühürlenir ve açılır', async () => {
    const keys = await keyBytes();
    for (const entry of vectors.envelopes) {
        const compressed = entry.gzipHex ? fromHex(entry.gzipHex) : null;
        const sealed = await sealPisiSyncEnvelope({
            subtle,
            key: keys[entry.key],
            spaceId: vectors.spaceId,
            purpose: entry.purpose,
            binding: entry.binding,
            plaintext: fromHex(entry.plaintextHex),
            nonce: fromHex(entry.nonceHex),
            gzip: compressed ? async () => compressed : null,
            pad: entry.pad
        });
        assert.equal(toBase64Url(sealed), entry.envelope, entry.name);
        const opened = await openPisiSyncEnvelope({
            subtle,
            key: keys[entry.key],
            spaceId: vectors.spaceId,
            purpose: entry.purpose,
            binding: entry.binding,
            envelope: fromBase64Url(entry.envelope),
            gunzip
        });
        assert.equal(Buffer.from(opened).toString('hex'), entry.plaintextHex, entry.name);

        // node:crypto opens the same bytes with the AAD of §4.2.
        const bytes = Buffer.from(entry.envelope, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', keys[entry.key], bytes.subarray(10, 22));
        decipher.setAAD(Buffer.concat([bytes.subarray(0, 22), Buffer.from(`pisi-sync/1|${vectors.spaceId}|${entry.purpose}|${entry.binding}`)]));
        decipher.setAuthTag(bytes.subarray(bytes.length - 16));
        const payload = Buffer.concat([decipher.update(bytes.subarray(22, bytes.length - 16)), decipher.final()]);
        assert.equal(bytes.subarray(0, 4).toString('latin1'), 'PISE');
        assert.equal(bytes[4], 1);
        assert.equal(bytes[5], (entry.gzipHex ? 1 : 0) | (entry.pad ? 2 : 0));
        assert.equal(bytes.readUInt32BE(6), 1);
        if (entry.pad) {
            assert.ok(payload.length >= 256 && payload.length === getPisiSyncPaddedLength(payload.lastIndexOf(0x80)), entry.name);
        }
    }
});

test('geçersiz zarflar DECRYPT_FAILED verir ve hiçbir içerik dönmez', async () => {
    const keys = await keyBytes();
    for (const entry of vectors.invalidEnvelopes) {
        await assert.rejects(
            openPisiSyncEnvelope({
                subtle,
                key: keys.meta,
                spaceId: vectors.spaceId,
                purpose: 'meta',
                binding: entry.binding,
                envelope: fromBase64Url(entry.envelope),
                gunzip
            }),
            (error) => error instanceof PisiSyncError && error.code === 'DECRYPT_FAILED',
            entry.name
        );
    }
    // The right envelope under another purpose or space does not open either.
    const meta = vectors.envelopes.find((entry) => entry.name === 'meta');
    for (const [purpose, spaceId] of [
        ['blob', vectors.spaceId],
        ['meta', 'sp_AAAAAAAAAAAAAAAAAAAAAA']
    ]) {
        await assert.rejects(
            openPisiSyncEnvelope({ subtle, key: keys.meta, spaceId, purpose, binding: meta.binding, envelope: fromBase64Url(meta.envelope) }),
            /Zarf çözülemedi/
        );
    }
});

test('eşleştirme: Z, KEK, proof ve doğrulama numarası', async () => {
    const { pairing, pairingId } = vectors;
    const importPrivate = (jwk) => subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const desktopPublic = await importPisiSyncEcdhPublicKey(subtle, pairing.desktop.publicKey);
    const devicePublic = await importPisiSyncEcdhPublicKey(subtle, pairing.device.publicKey);
    const fromDesktop = await derivePisiSyncSharedSecret(subtle, await importPrivate(pairing.desktop.jwk), devicePublic);
    const fromDevice = await derivePisiSyncSharedSecret(subtle, await importPrivate(pairing.device.jwk), desktopPublic);
    assert.equal(Buffer.from(fromDesktop).toString('hex'), pairing.sharedSecretHex);
    assert.equal(Buffer.from(fromDevice).toString('hex'), pairing.sharedSecretHex);

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(pairing.desktop.jwk.d, 'base64url'));
    assert.equal(ecdh.computeSecret(Buffer.from(pairing.device.publicKey, 'base64url')).toString('hex'), pairing.sharedSecretHex);
    assert.equal(pairing.desktop.publicKey.length, 87);

    const kek = await derivePisiSyncPairingKek(subtle, fromDevice, pairingId, pairing.desktop.publicKey, pairing.device.publicKey);
    assert.equal(Buffer.from(kek).toString('hex'), pairing.kekHex);
    const nodeKek = crypto.hkdfSync(
        'sha256',
        Buffer.from(pairing.sharedSecretHex, 'hex'),
        Buffer.from(`pisi-sync/1|pair|${pairingId}`),
        Buffer.from(`kek|${pairing.desktop.publicKey}|${pairing.device.publicKey}`),
        32
    );
    assert.equal(Buffer.from(nodeKek).toString('hex'), pairing.kekHex);

    const secret = fromHex(pairing.secretHex);
    assert.equal(await computePisiSyncPairingProof(subtle, secret, pairingId, pairing.device.publicKey), pairing.proof);
    assert.equal(await verifyPisiSyncPairingProof(subtle, secret, pairingId, pairing.device.publicKey, pairing.proof), true);
    assert.equal(await verifyPisiSyncPairingProof(subtle, secret, pairingId, pairing.desktop.publicKey, pairing.proof), false);

    const sas = await computePisiSyncSas(subtle, fromDesktop, pairingId, pairing.desktop.publicKey, pairing.device.publicKey);
    const nodeSas =
        Buffer.from(
            crypto.hkdfSync(
                'sha256',
                Buffer.from(pairing.sharedSecretHex, 'hex'),
                Buffer.from(`pisi-sync/1|sas|${pairingId}`),
                Buffer.from(`${pairing.desktop.publicKey}|${pairing.device.publicKey}`),
                4
            )
        ).readUInt32BE(0) % 1000000;
    assert.deepEqual([sas, nodeSas, formatPisiSyncSas(sas)], [pairing.sas, pairing.sas, pairing.sasText]);
    assert.match(pairing.sasText, /^\d{3} \d{3}$/);

    // The wrapped key package opens with the KEK and carries K.
    const wrapped = vectors.envelopes.find((entry) => entry.name === 'pair-key');
    const opened = await openPisiSyncEnvelope({
        subtle,
        key: kek,
        spaceId: vectors.spaceId,
        purpose: 'pair-key',
        binding: pairingId,
        envelope: fromBase64Url(wrapped.envelope)
    });
    assert.equal(JSON.parse(utf8Decode(opened)).key, toBase64Url(projectKey));
});

test('güvensiz ve senkron dışı yollar vektördeki nedenle reddedilir', () => {
    for (const entry of vectors.unsafePaths) assert.equal(checkPisiSyncPath(entry.path).reason, entry.reason, JSON.stringify(entry.path));
    for (const entry of vectors.paths) assert.equal(checkPisiSyncPath(entry.path).ok, true, entry.path);
});

test('UTF-8 ve base64url kodlamaları Node ile aynı, bozuk girdi reddedilir', () => {
    const samples = ['', 'a', 'çğıöşü İ', '😀 Pisi', '\u0000x', 'Ç'];
    for (const value of samples) {
        assert.deepEqual(Buffer.from(utf8Encode(value)), Buffer.from(value, 'utf8'));
        assert.equal(utf8Decode(Buffer.from(value, 'utf8')), value);
    }
    for (let length = 0; length < 40; length += 1) {
        const bytes = crypto.randomBytes(length);
        assert.equal(toBase64Url(bytes), bytes.toString('base64url'));
        assert.deepEqual(Buffer.from(fromBase64Url(bytes.toString('base64url'))), bytes);
    }
    for (const bad of [[0xc3], [0xed, 0xa0, 0x80], [0xff], [0xc0, 0x80]]) assert.throws(() => utf8Decode(Uint8Array.from(bad)), /UTF-8/);
    for (const bad of ['a', 'ab=', 'a+b', 'AB']) assert.throws(() => fromBase64Url(bad), /base64url/);
});

// docs/task-plan.md G9: the same input merges into the same value on both platforms
// (mobile/tests/sync-vectors.test.mjs reads the same rows).
test('birleştirme vektörleri: tasks.json tamamlamaları ve günlük görev bölümü', () => {
    for (const row of vectors.merges.tasks) assert.deepEqual(mergePisiSyncAuthority(row.path, row.base, row.local, row.remote), row.expected, row.name);
    for (const row of vectors.merges.notes) {
        const diary = row.path.startsWith('diary/');
        assert.deepEqual(mergePisiSyncNode({ base: row.base, local: row.local, remote: row.remote, diary }), row.expected, row.name);
        assert.equal(row.copyContent, row.expected.status === 'conflict' ? makePisiSyncConflictContent(row.local.content) : null, row.name);
    }

    // What the rows say, read independently of the code that wrote them.
    const byName = Object.fromEntries(vectors.merges.tasks.map((row) => [row.name, row.expected]));
    const only = (name) => byName[name].value.tasks[0];
    assert.equal(only('phone-completes-desktop-renames').title, 'Spor (masaüstü)');
    assert.equal(only('phone-completes-desktop-renames').completions.length, 1);
    assert.deepEqual(byName['phone-completes-desktop-renames'].conflicts, []);
    assert.equal(only('same-occurrence-on-both').completions.length, 1, 'tek tamamlama');
    assert.equal(only('same-occurrence-on-both').completions[0].at, '2026-11-21T07:05:00.000Z', 'önce tamamlanan kalır');
    assert.equal(only('same-occurrence-on-both').dueDate, '2026-11-22', 'tek ilerleme');
    assert.equal(only('progress-does-not-go-back').dueDate, '2026-11-23');
    assert.equal(only('progress-does-not-go-back').reminderAt, '2026-11-23T07:00');
    assert.equal(only('progress-does-not-go-back').title, 'Sabah sporu');
    assert.deepEqual(only('taken-back-and-renamed').completions, []);
    assert.equal(only('taken-back-and-renamed').dueDate, '2026-11-21');
    assert.equal(only('done-on-both-without-repeat').completedAt, '2026-11-21T09:00:00.000Z');
    const notes = Object.fromEntries(vectors.merges.notes.map((row) => [row.name, row]));
    for (const name of ['diary-section-changed-on-both', 'new-diary-on-both']) {
        assert.equal(notes[name].expected.status, 'merged', `${name}: bölüm çakışma değildir`);
        assert.equal(readPisiDiaryTaskSection(notes[name].expected.value.content).count, 1, `${name}: tek bölüm`);
        assert.equal(readPisiDiaryTaskSection(notes[name].expected.value.content).last, true, `${name}: bölüm son blok`);
    }
    assert.equal(notes['new-diary-on-both'].expected.value.pisi.id, notes['new-diary-on-both'].remote.pisi.id, 'uzak günlüğün kimliği kalır');
    const copy = notes['conflict-copy-keeps-tasks-in-the-note'];
    assert.deepEqual(listPisiNoteTaskIds(copy.expected.value.content), ['task_0a0a0a0a-0000-4000-8000-00000000000a'], 'görev asıl notta kalır');
    assert.deepEqual(listPisiNoteTaskIds(copy.copyContent), [], 'kopyada görev bloğu yok');
    assert.ok(copy.copyContent.includes('Bir telefon'), 'kopyada yerel metin');
});
