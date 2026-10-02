'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('electron-builder declares macOS and Linux multi-architecture packages', () => {
    const packageJson = JSON.parse(read('package.json'));
    const build = packageJson.build;

    assert.equal(build.mac.icon, 'assets/pisi.png');
    assert.equal(build.mac.hardenedRuntime, true);
    assert.equal(build.mac.entitlements, 'build/entitlements.mac.plist');
    assert.equal(build.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');

    const macTargets = Object.fromEntries(build.mac.target.map((entry) => [entry.target, entry.arch]));
    assert.deepEqual(macTargets.dmg, ['x64', 'arm64', 'universal']);
    assert.deepEqual(macTargets.zip, ['x64', 'arm64', 'universal']);

    const linuxTargets = Object.fromEntries(build.linux.target.map((entry) => [entry.target, entry.arch]));
    assert.deepEqual(linuxTargets.AppImage, ['x64', 'arm64']);
    assert.deepEqual(linuxTargets.deb, ['x64', 'arm64']);

    assert.match(packageJson.scripts['dist:mac'], /--x64 --arm64 --universal/);
    assert.match(packageJson.scripts['dist:linux'], /AppImage deb --x64 --arm64/);
});

test('macOS release signing and notarization are credential-gated', () => {
    const workflow = read('.github/workflows/release.yml');

    assert.match(workflow, /MAC_CSC_LINK/);
    assert.match(workflow, /PISI_APPLE_API_KEY_BASE64/);
    assert.match(workflow, /APPLE_API_KEY_ID/);
    assert.match(workflow, /APPLE_API_ISSUER/);
    assert.match(workflow, /PISI_MAC_SIGNING_ENABLED/);
    assert.match(workflow, /PISI_MAC_NOTARIZE_ENABLED/);
    assert.match(workflow, /-c\.mac\.identity=null/);
    assert.match(workflow, /-c\.mac\.hardenedRuntime=false/);
    assert.match(workflow, /codesign --verify --deep --strict/);
    assert.match(workflow, /spctl --assess --verbose --type execute/);
    assert.match(workflow, /xcrun stapler validate/);
});

test('Linux release provides AppImage, deb, checksums and optional GPG signature', () => {
    const workflow = read('.github/workflows/release.yml');

    assert.match(workflow, /Build Linux AppImage and deb packages/);
    assert.match(workflow, /SHA256SUMS-Linux\.txt/);
    assert.match(workflow, /PISI_GPG_PRIVATE_KEY_BASE64/);
    assert.match(workflow, /--detach-sign/);
    assert.match(workflow, /gpg --verify/);
});

test('one final release is created after all platform jobs', () => {
    const workflow = read('.github/workflows/release.yml');

    const windowsPublish = workflow.indexOf('Publish GitHub beta release');
    const finalJob = workflow.indexOf('publish-release:');
    assert.ok(finalJob >= 0);
    assert.ok(windowsPublish > finalJob, 'GitHub release creation must live in final publish job');

    assert.match(workflow, /pisi-release-windows/);
    assert.match(workflow, /pisi-release-macos/);
    assert.match(workflow, /pisi-release-linux/);
    assert.match(workflow, /merge-multiple: true/);
    assert.match(workflow, /needs:\s*\n\s*- windows-release\s*\n\s*- macos-release\s*\n\s*- linux-release/);
});

test('cross-platform release workflow and entitlements remain parseable', () => {
    assert.doesNotThrow(() => yaml.load(read('.github/workflows/release.yml')));

    for (const plist of ['build/entitlements.mac.plist', 'build/entitlements.mac.inherit.plist']) {
        const content = read(plist);
        assert.match(content, /com\.apple\.security\.cs\.allow-jit/);
        assert.match(content, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
    }
});
