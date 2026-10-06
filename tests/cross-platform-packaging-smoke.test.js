'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('cross-platform packaging smoke includes unsigned Windows x64 and ARM64 NSIS and Portable builds', () => {
    const workflow = read('.github/workflows/packaging-smoke.yml');

    assert.match(workflow, /windows-package:/);
    assert.match(workflow, /runs-on: windows-latest/);
    assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);

    assert.match(workflow, /npm run dist:installer --/);
    assert.match(workflow, /npm run dist:portable --/);
    assert.match(workflow, /--config\.extraMetadata\.pisiDistribution=nsis/);
    assert.match(workflow, /--config\.extraMetadata\.pisiDistribution=portable/);
    assert.doesNotMatch(workflow, /npm run dist:(?:installer|portable).* -c\.extraMetadata/m);

    const x64Flags = workflow.match(/--x64/g) || [];
    const arm64Flags = workflow.match(/--arm64/g) || [];
    assert.ok(x64Flags.length >= 2, 'NSIS and Portable smoke builds must both request x64');
    assert.ok(arm64Flags.length >= 2, 'NSIS and Portable smoke builds must both request ARM64');

    assert.match(workflow, /Pisi-\$version-Setup-x64\.exe/);
    assert.match(workflow, /Pisi-\$version-Setup-arm64\.exe/);
    assert.match(workflow, /Pisi-\$version-Portable-x64\.exe/);
    assert.match(workflow, /Pisi-\$version-Portable-arm64\.exe/);

    assert.match(workflow, /0x4D/);
    assert.match(workflow, /0x5A/);
    assert.match(workflow, /Expected exactly/);
});

test('packaging smoke keeps Windows, macOS and Linux jobs in one parseable workflow', () => {
    const workflow = read('.github/workflows/packaging-smoke.yml');
    const parsed = yaml.load(workflow);

    assert.ok(parsed.jobs['windows-package']);
    assert.ok(parsed.jobs['macos-package']);
    assert.ok(parsed.jobs['linux-package']);

    assert.equal(parsed.jobs['windows-package']['runs-on'], 'windows-latest');
    assert.equal(parsed.jobs['macos-package']['runs-on'], 'macos-latest');
    assert.equal(parsed.jobs['linux-package']['runs-on'], 'ubuntu-latest');
});
