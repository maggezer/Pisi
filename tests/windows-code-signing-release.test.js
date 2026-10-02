'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Windows beta release supports optional Authenticode signing', () => {
    const workflow = read('.github/workflows/release.yml');

    assert.match(workflow, /WIN_CSC_LINK:\s*\$\{\{ secrets\.WIN_CSC_LINK \}\}/);
    assert.match(workflow, /WIN_CSC_KEY_PASSWORD:\s*\$\{\{ secrets\.WIN_CSC_KEY_PASSWORD \}\}/);
    assert.match(workflow, /PISI_WINDOWS_CERT_SHA1:\s*\$\{\{ secrets\.PISI_WINDOWS_CERT_SHA1 \}\}/);
    assert.match(workflow, /PISI_SIGNING_ENABLED=/);
    assert.match(workflow, /GitHub beta EXE artifacts will be unsigned/);
    assert.doesNotMatch(workflow, /Production releases must never be unsigned/);

    const forceSigningMatches = workflow.match(/-c\.forceCodeSigning=true/g) || [];
    assert.equal(forceSigningMatches.length, 2);

    const verifyIndex = workflow.indexOf('Verify Windows Authenticode signatures');
    const publishIndex = workflow.indexOf('Publish GitHub beta release');

    assert.ok(verifyIndex >= 0, 'signature verification step must exist');
    assert.ok(publishIndex > verifyIndex, 'release publication must happen after optional signature verification');
    assert.match(workflow, /if: env\.PISI_SIGNING_ENABLED == 'true'/);
    assert.match(workflow, /verify-windows-signatures\.ps1/);
});

test('Windows signing config uses SHA-256 and RFC3161 timestamping when enabled', () => {
    const packageJson = JSON.parse(read('package.json'));
    const signtool = packageJson.build?.win?.signtoolOptions;

    assert.deepEqual(signtool?.signingHashAlgorithms, ['sha256']);
    assert.equal(
        signtool?.rfc3161TimeStampServer,
        'http://timestamp.digicert.com'
    );
});

test('signature verifier rejects invalid, untimestamped, or mixed-certificate artifacts', () => {
    const verifier = read('scripts/verify-windows-signatures.ps1');

    assert.match(verifier, /SignatureStatus\]::Valid/);
    assert.match(verifier, /TimeStamperCertificate/);
    assert.match(verifier, /different certificates/);
    assert.match(verifier, /Code Signing EKU/);
});
