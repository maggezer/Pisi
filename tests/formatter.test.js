'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('repository formatter is pinned and exposed through npm scripts', () => {
    const packageJson = JSON.parse(read('package.json'));

    assert.equal(packageJson.devDependencies.prettier, '3.9.9');
    assert.equal(packageJson.scripts.format, 'prettier . --write --ignore-unknown');
    assert.equal(packageJson.scripts['format:check'], 'prettier . --check --ignore-unknown');
    assert.match(packageJson.scripts.validate, /npm run format:check/);
    assert.equal(typeof packageJson.scripts['validate:source'], 'string');
});

test('Prettier configuration preserves Pisi source conventions and excludes generated output', () => {
    const config = JSON.parse(read('.prettierrc.json'));
    const ignore = read('.prettierignore');

    assert.equal(config.tabWidth, 4);
    assert.equal(config.singleQuote, true);
    assert.equal(config.semi, true);
    assert.equal(config.endOfLine, 'auto');

    for (const pattern of ['node_modules/', 'dist/', 'dist-store/', 'android/**/build/', '.pisi-types/', 'assets/']) {
        assert.ok(ignore.includes(pattern), 'missing Prettier ignore: ' + pattern);
    }
});

test('CI and release validation have explicit formatting gates', () => {
    for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
        const workflow = read(workflowPath);
        assert.match(workflow, /Check repository formatting/);
        assert.match(workflow, /npm run format:check/);
        assert.match(workflow, /npm run validate:source/);
    }
});
