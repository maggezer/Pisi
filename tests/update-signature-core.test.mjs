import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    evaluatePisiAuthenticodeResult,
    getPisiCertificateCommonName,
    getPisiUpdateKeyId,
    parsePisiUpdatePublicKeys,
    signPisiUpdateManifest,
    verifyPisiUpdateManifest
} from '../main/functions/update-signature-core.js';
import { signPisiUpdateManifestFile } from '../scripts/sign-update-manifest.mjs';

function keyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    return {
        privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
        publicBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        publicPem: publicKey.export({ format: 'pem', type: 'spki' }),
        publicKey
    };
}

const manifest = Buffer.from(
    JSON.stringify({ schemaVersion: 1, channel: 'beta', version: '1.2.3', files: { x64: { url: 'Pisi-1.2.3-Setup-x64.exe', sha256: 'a'.repeat(64) } } })
);

test('a valid signature from a trusted key is accepted', () => {
    const key = keyPair();
    const signature = signPisiUpdateManifest(manifest, key.privatePem);
    assert.equal(signature.keyId, getPisiUpdateKeyId(key.publicKey));
    assert.match(signature.keyId, /^[a-f0-9]{16}$/);
    const result = verifyPisiUpdateManifest(manifest, JSON.stringify(signature), parsePisiUpdatePublicKeys(key.publicBase64));
    assert.deepEqual(result, { ok: true, keyId: signature.keyId });
});

test('a changed manifest or a damaged signature is rejected', () => {
    const key = keyPair();
    const keys = parsePisiUpdatePublicKeys(key.publicBase64);
    const signature = signPisiUpdateManifest(manifest, key.privatePem);
    const tampered = Buffer.from(manifest.toString().replace('a'.repeat(64), 'b'.repeat(64)));
    assert.equal(verifyPisiUpdateManifest(tampered, JSON.stringify(signature), keys).code, 'UPDATE_SIGNATURE_INVALID');
    const bytes = Buffer.from(signature.signature, 'base64');
    bytes[10] ^= 0xff;
    assert.equal(
        verifyPisiUpdateManifest(manifest, JSON.stringify({ ...signature, signature: bytes.toString('base64') }), keys).code,
        'UPDATE_SIGNATURE_INVALID'
    );
    assert.equal(verifyPisiUpdateManifest(manifest, '{ bozuk', keys).code, 'UPDATE_SIGNATURE_INVALID');
    assert.equal(verifyPisiUpdateManifest(manifest, JSON.stringify({ keyId: signature.keyId, signature: 'kisa' }), keys).code, 'UPDATE_SIGNATURE_INVALID');
    // Even a single changed whitespace byte breaks it: the exact bytes are signed.
    assert.equal(verifyPisiUpdateManifest(Buffer.concat([manifest, Buffer.from('\n')]), JSON.stringify(signature), keys).ok, false);
});

test('a signature from another key is rejected; so is a key id that is not trusted', () => {
    const trusted = keyPair();
    const attacker = keyPair();
    const keys = parsePisiUpdatePublicKeys(trusted.publicBase64);
    const forged = signPisiUpdateManifest(manifest, attacker.privatePem);
    assert.equal(verifyPisiUpdateManifest(manifest, JSON.stringify(forged), keys).code, 'UPDATE_SIGNATURE_UNKNOWN_KEY');
    // The attacker claims the trusted key id: the signature still does not verify.
    const claimed = { ...forged, keyId: getPisiUpdateKeyId(trusted.publicKey) };
    assert.equal(verifyPisiUpdateManifest(manifest, JSON.stringify(claimed), keys).code, 'UPDATE_SIGNATURE_INVALID');
});

test('a missing signature, or a build without keys, is rejected', () => {
    const key = keyPair();
    const keys = parsePisiUpdatePublicKeys(key.publicBase64);
    assert.equal(verifyPisiUpdateManifest(manifest, null, keys).code, 'UPDATE_SIGNATURE_MISSING');
    assert.equal(verifyPisiUpdateManifest(manifest, '   ', keys).code, 'UPDATE_SIGNATURE_MISSING');
    assert.equal(verifyPisiUpdateManifest(manifest, JSON.stringify(signPisiUpdateManifest(manifest, key.privatePem)), []).code, 'UPDATE_KEYS_MISSING');
    assert.equal(verifyPisiUpdateManifest(manifest, 'x'.repeat(5000), keys).code, 'UPDATE_SIGNATURE_INVALID', 'oversized signature files are refused');
});

test('key rotation: any key in the list is trusted; PEM, base64 and junk entries', () => {
    const oldKey = keyPair();
    const newKey = keyPair();
    const list = `${oldKey.publicBase64}, ${newKey.publicBase64}`;
    const keys = parsePisiUpdatePublicKeys(list);
    assert.equal(keys.length, 2);
    for (const key of [oldKey, newKey]) {
        assert.equal(verifyPisiUpdateManifest(manifest, JSON.stringify(signPisiUpdateManifest(manifest, key.privatePem)), keys).ok, true);
    }
    assert.equal(parsePisiUpdatePublicKeys([oldKey.publicPem, 'not-a-key', newKey.publicBase64]).length, 2);
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    assert.equal(parsePisiUpdatePublicKeys(rsa).length, 0, 'only Ed25519 keys count');
    assert.equal(parsePisiUpdatePublicKeys('').length, 0);
});

test('the release script writes latest.json.sig and refuses a key the app would not trust', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sign-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const manifestPath = path.join(dir, 'latest.json');
    fs.writeFileSync(manifestPath, manifest);
    const key = keyPair();
    const result = signPisiUpdateManifestFile(manifestPath, key.privatePem, key.publicBase64);
    const written = fs.readFileSync(path.join(dir, 'latest.json.sig'), 'utf8');
    assert.equal(result.keyId, JSON.parse(written).keyId);
    assert.equal(verifyPisiUpdateManifest(fs.readFileSync(manifestPath), written, parsePisiUpdatePublicKeys(key.publicBase64)).ok, true);
    assert.throws(() => signPisiUpdateManifestFile(manifestPath, keyPair().privatePem, key.publicBase64), /rejected by the app/);
});

test('Authenticode: valid signature from the expected publisher only; no identity skips', () => {
    const ok = JSON.stringify({ Status: 'Valid', Subject: 'CN=Pisi Ltd, O=Pisi Ltd, L=İstanbul, C=TR' });
    assert.deepEqual(evaluatePisiAuthenticodeResult(ok, 'Pisi Ltd'), { ok: true, publisher: 'Pisi Ltd' });
    assert.equal(evaluatePisiAuthenticodeResult(ok, 'pisi ltd').ok, true, 'case does not matter');
    assert.equal(evaluatePisiAuthenticodeResult(JSON.stringify({ Status: 0, Subject: 'CN=Pisi Ltd' }), 'Pisi Ltd').ok, true, 'numeric Valid');
    assert.equal(
        evaluatePisiAuthenticodeResult(JSON.stringify({ Status: 'Valid', Subject: 'CN=Evil Corp' }), 'Pisi Ltd').code,
        'AUTHENTICODE_PUBLISHER_MISMATCH'
    );
    assert.equal(evaluatePisiAuthenticodeResult(JSON.stringify({ Status: 'NotSigned', Subject: '' }), 'Pisi Ltd').code, 'AUTHENTICODE_INVALID');
    assert.equal(evaluatePisiAuthenticodeResult(JSON.stringify({ Status: 'HashMismatch', Subject: 'CN=Pisi Ltd' }), 'Pisi Ltd').code, 'AUTHENTICODE_INVALID');
    assert.equal(evaluatePisiAuthenticodeResult('not json', 'Pisi Ltd').code, 'AUTHENTICODE_UNREADABLE');
    assert.deepEqual(evaluatePisiAuthenticodeResult('', ''), { ok: true, skipped: true });
    assert.equal(getPisiCertificateCommonName('O=x, CN="Pisi, Ltd", C=TR'), 'Pisi, Ltd');
    assert.equal(getPisiCertificateCommonName('O=x'), '');
});
