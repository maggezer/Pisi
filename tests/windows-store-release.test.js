'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Store pipeline builds a multi-architecture unsigned MSIX bundle', () => {
    const workflow = read('.github/workflows/store-msix.yml');

    assert.match(workflow, /microsoft\/setup-WinAppCli@v0\.2/);
    assert.match(workflow, /npm run dist:store:x64/);
    assert.match(workflow, /npm run dist:store:arm64/);
    assert.match(workflow, /winapp pack/);
    assert.match(workflow, /PISI_STORE_X64_LAYOUT/);
    assert.match(workflow, /PISI_STORE_ARM64_LAYOUT/);
    assert.match(workflow, /--no-sign/);
    assert.match(workflow, /\.msixbundle/);
    assert.match(workflow, /\.msixupload/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
});

test('Store publication is explicit and credential-gated', () => {
    const workflow = read('.github/workflows/store-msix.yml');

    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /publish:/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.publish/);
    assert.match(workflow, /microsoft\/microsoft-store-apppublisher@v1\.1/);
    assert.match(workflow, /PISI_STORE_TENANT_ID/);
    assert.match(workflow, /PISI_STORE_SELLER_ID/);
    assert.match(workflow, /PISI_STORE_CLIENT_ID/);
    assert.match(workflow, /PISI_STORE_CLIENT_SECRET/);
    assert.match(workflow, /msstore publish/);
});

test('Store manifest preparation keeps Partner Center identity external to source', () => {
    const workflow = read('.github/workflows/store-msix.yml');
    const script = read('scripts/prepare-store-msix.ps1');
    const packageJson = JSON.parse(read('package.json'));

    assert.match(workflow, /vars\.PISI_STORE_IDENTITY_NAME/);
    assert.match(workflow, /vars\.PISI_STORE_PUBLISHER/);
    assert.match(workflow, /vars\.PISI_STORE_PUBLISHER_DISPLAY_NAME/);
    assert.match(script, /Windows\.FullTrustApplication/);
    assert.match(script, /runFullTrust/);
    assert.match(script, /10\.0\.17763\.0/);
    assert.match(script, /Square44x44Logo\.png/);
    assert.match(script, /Wide310x150Logo\.png/);
    assert.equal(typeof packageJson.scripts['dist:store:x64'], 'string');
    assert.equal(typeof packageJson.scripts['dist:store:arm64'], 'string');
});
