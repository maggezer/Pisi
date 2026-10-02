'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('direct updater is Store-aware and never embeds private GitHub credentials', () => {
    const updater = read('main/functions/auto-update.js');

    assert.match(updater, /process\.windowsStore === true/);
    assert.match(updater, /managedBy: 'microsoft-store'/);
    assert.match(updater, /distribution === 'portable'/);
    assert.match(updater, /distribution !== 'nsis'/);
    assert.match(updater, /PISI_UPDATE_FEED_URL/);
    assert.match(updater, /protocol !== 'https:'/);
    assert.match(updater, /downloadUrl\.origin !== feed\.origin/);
    assert.match(updater, /SHA-256 verification/);
    assert.doesNotMatch(updater, /GH_TOKEN|github[_-]?token|personal access token/i);
});

test('update API is bounded through preload IPC', () => {
    const preload = read('preload.js');

    assert.match(preload, /exposeInMainWorld\('pisiUpdates'/);
    assert.match(preload, /app:get-update-status/);
    assert.match(preload, /app:check-for-updates/);
    assert.match(preload, /app:install-update/);
    assert.match(preload, /app:update-status/);
});

test('release workflow emits update metadata for NSIS but not portable self-update', () => {
    const workflow = read('.github/workflows/release.yml');

    assert.match(workflow, /PISI_UPDATE_FEED_URL:\s*\$\{\{ vars\.PISI_UPDATE_FEED_URL \}\}/);
    assert.match(workflow, /pisiDistribution=nsis/);
    assert.match(workflow, /pisiDistribution=portable/);
    assert.match(workflow, /pisiUpdateFeedUrl/);
    assert.match(workflow, /Create direct auto-update feed manifest/);
    assert.match(workflow, /release\/latest\.json/);
    assert.match(workflow, /schemaVersion = 1/);
});

test('Store packaging marks its distribution and supports opt-in tag auto-publish', () => {
    const packageJson = JSON.parse(read('package.json'));
    const workflow = read('.github/workflows/store-msix.yml');

    assert.match(packageJson.scripts['dist:store:x64'], /pisiDistribution=store/);
    assert.match(packageJson.scripts['dist:store:arm64'], /pisiDistribution=store/);
    assert.match(workflow, /PISI_STORE_AUTO_PUBLISH/);
    assert.match(
        workflow,
        /github\.event_name == 'push' && vars\.PISI_STORE_AUTO_PUBLISH == 'true'/
    );
});

test('Windows release and Store workflow YAML remain parseable', () => {
    assert.doesNotThrow(() => yaml.load(read('.github/workflows/release.yml')));
    assert.doesNotThrow(() => yaml.load(read('.github/workflows/store-msix.yml')));
});
