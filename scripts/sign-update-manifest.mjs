import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    PISI_UPDATE_SIGNATURE_FILE,
    getPisiUpdateKeyId,
    parsePisiUpdatePublicKeys,
    signPisiUpdateManifest,
    verifyPisiUpdateManifest
} from '../main/functions/update-signature-core.js';

// Signs the direct-update manifest in the release workflow.
//
//   node scripts/sign-update-manifest.mjs release/latest.json
//     reads the Ed25519 private key (PEM) from PISI_UPDATE_SIGNING_KEY, writes
//     release/latest.json.sig next to the manifest, then verifies it against
//     PISI_UPDATE_PUBLIC_KEYS (the keys built into the app) and fails if the
//     signature would be rejected by the app.
//
//   node scripts/sign-update-manifest.mjs --public-key private-key.pem
//     prints the base64 SPKI public key for PISI_UPDATE_PUBLIC_KEYS and its key id.
//
// The private key never touches the repository or the release artifacts.

export function signPisiUpdateManifestFile(manifestPath, privateKeyPem, publicKeysValue) {
    const bytes = fs.readFileSync(manifestPath);
    const signature = signPisiUpdateManifest(bytes, privateKeyPem);
    const verified = verifyPisiUpdateManifest(bytes, JSON.stringify(signature), parsePisiUpdatePublicKeys(publicKeysValue));
    if (!verified.ok) throw new Error(`The signed manifest would be rejected by the app: ${verified.error}`);
    const signaturePath = path.join(path.dirname(manifestPath), PISI_UPDATE_SIGNATURE_FILE);
    fs.writeFileSync(signaturePath, JSON.stringify(signature) + '\n', 'utf8');
    return { signaturePath, keyId: signature.keyId };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const [first, second] = process.argv.slice(2);
    try {
        if (first === '--public-key') {
            const publicKey = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(second, 'utf8')));
            console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
            console.error(`key id: ${getPisiUpdateKeyId(publicKey)}`);
        } else {
            if (!first) throw new Error('Usage: node scripts/sign-update-manifest.mjs <latest.json>');
            if (!process.env.PISI_UPDATE_SIGNING_KEY) throw new Error('PISI_UPDATE_SIGNING_KEY is not set.');
            if (!process.env.PISI_UPDATE_PUBLIC_KEYS) throw new Error('PISI_UPDATE_PUBLIC_KEYS is not set.');
            const result = signPisiUpdateManifestFile(first, process.env.PISI_UPDATE_SIGNING_KEY, process.env.PISI_UPDATE_PUBLIC_KEYS);
            console.log(`Signed ${first} with key ${result.keyId} → ${result.signaturePath}`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
