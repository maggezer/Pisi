// The sync test vectors (docs/sync-protocol.md §13) in the mobile test
// runtime: the same file the desktop tests read, checked with the Web Crypto
// and DecompressionStream the app gets in the WebView.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    computePisiSyncBlobId,
    computePisiSyncFid,
    computePisiSyncPairingProof,
    computePisiSyncSas,
    derivePisiSyncPairingKek,
    derivePisiSyncSharedSecret,
    derivePisiSyncSubkeyBytes,
    fromBase64Url,
    fromHex,
    getPisiSyncPaddedLength,
    hashPisiSyncToken,
    importPisiSyncEcdhPublicKey,
    openPisiSyncEnvelope,
    padme,
    sealPisiSyncEnvelope,
    toBase64Url,
    toHex
} from '../../shared/sync-crypto.mjs';
import { checkPisiSyncPath, getPisiSyncPathKey } from '../../shared/sync-paths.mjs';
import { makePisiSyncConflictContent } from '../../shared/sync-conflict.mjs';
import { mergePisiSyncAuthority } from '../../shared/sync-merge-authority.mjs';
import { mergePisiSyncNode } from '../../shared/sync-merge-node.mjs';

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'sync-vectors.json'), 'utf8'));
const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;

// The WebView's own gzip (CompressionStream API), as the app will use it.
async function gunzip(bytes) {
    const { Blob, DecompressionStream, Response } = globalThis;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function keyBytes() {
    const subkeys = await derivePisiSyncSubkeyBytes(subtle, fromHex(vectors.projectKeyHex), vectors.spaceId);
    return { ...subkeys, kek: fromHex(vectors.pairing.kekHex) };
}

describe('senkron test vektörleri', () => {
    it('alt anahtarlar, fid, blob ve token özeti', async () => {
        const subkeys = await derivePisiSyncSubkeyBytes(subtle, fromHex(vectors.projectKeyHex), vectors.spaceId);
        expect(Object.fromEntries(Object.entries(subkeys).map(([name, bytes]) => [name, toHex(bytes)]))).toEqual(vectors.subkeys);
        for (const entry of vectors.paths) {
            expect(getPisiSyncPathKey(entry.path)).toBe(entry.pathKey);
            expect(await computePisiSyncFid(subtle, subkeys.fid, entry.path)).toBe(entry.fid);
        }
        for (const entry of vectors.blobs) expect(await computePisiSyncBlobId(subtle, subkeys.blob, fromHex(entry.plainHex))).toBe(entry.blob);
        expect(await hashPisiSyncToken(subtle, vectors.token.token)).toBe(vectors.token.tokenHash);
    });

    it('Padmé ve güvensiz yollar', () => {
        for (const row of vectors.padme) {
            expect(padme(row.length)).toBe(row.padme);
            expect(getPisiSyncPaddedLength(row.length)).toBe(row.padded);
        }
        for (const entry of vectors.unsafePaths) expect(checkPisiSyncPath(entry.path).reason).toBe(entry.reason);
    });

    it('zarflar aynı baytlarla mühürlenir ve açılır; geçersizler açılmaz', async () => {
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
            expect(toBase64Url(sealed)).toBe(entry.envelope);
            const opened = await openPisiSyncEnvelope({
                subtle,
                key: keys[entry.key],
                spaceId: vectors.spaceId,
                purpose: entry.purpose,
                binding: entry.binding,
                envelope: fromBase64Url(entry.envelope),
                gunzip
            });
            expect(toHex(opened)).toBe(entry.plaintextHex);
        }
        for (const entry of vectors.invalidEnvelopes) {
            await expect(
                openPisiSyncEnvelope({
                    subtle,
                    key: keys.meta,
                    spaceId: vectors.spaceId,
                    purpose: 'meta',
                    binding: entry.binding,
                    envelope: fromBase64Url(entry.envelope),
                    gunzip
                })
            ).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
        }
    });

    it('eşleştirme: Z, KEK, proof ve doğrulama numarası', async () => {
        const { pairing, pairingId } = vectors;
        const privateKey = await subtle.importKey('jwk', pairing.device.jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const desktopKey = await importPisiSyncEcdhPublicKey(subtle, pairing.desktop.publicKey);
        const shared = await derivePisiSyncSharedSecret(subtle, privateKey, desktopKey);
        expect(toHex(shared)).toBe(pairing.sharedSecretHex);
        expect(toHex(await derivePisiSyncPairingKek(subtle, shared, pairingId, pairing.desktop.publicKey, pairing.device.publicKey))).toBe(pairing.kekHex);
        expect(await computePisiSyncPairingProof(subtle, fromHex(pairing.secretHex), pairingId, pairing.device.publicKey)).toBe(pairing.proof);
        expect(await computePisiSyncSas(subtle, shared, pairingId, pairing.desktop.publicKey, pairing.device.publicKey)).toBe(pairing.sas);
    });

    // docs/task-plan.md G9: the phone merges the same input into the same value as the desktop.
    it('birleştirme vektörleri: tasks.json tamamlamaları ve günlük görev bölümü', () => {
        for (const row of vectors.merges.tasks) expect(mergePisiSyncAuthority(row.path, row.base, row.local, row.remote)).toEqual(row.expected);
        for (const row of vectors.merges.notes) {
            expect(mergePisiSyncNode({ base: row.base, local: row.local, remote: row.remote, diary: row.path.startsWith('diary/') })).toEqual(row.expected);
            expect(row.expected.status === 'conflict' ? makePisiSyncConflictContent(row.local.content) : null).toBe(row.copyContent);
        }
    });
});
