import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylePath = path.join(repoRoot, 'style.css');
const stylesDir = path.join(repoRoot, 'styles');

const expectedImports = [
    './styles/00-foundation.css',
    './styles/10-shell-map-panels.css',
    './styles/40-editor.css',
    './styles/50-productivity.css',
    './styles/58-workspaces-platform.css',
    './styles/65-shared-ui.css',
    './styles/90-themes.css',
    './styles/92-compatibility.css',
    './styles/105-feature-polish.css',
];

test('global CSS uses the consolidated bundle manifest', () => {
    const source = fs.readFileSync(stylePath, 'utf8');
    const imports = [...source.matchAll(/@import url\('([^']+)'\) layer\(pisi\);/g)].map(
        (match) => match[1],
    );

    assert.deepEqual(imports, expectedImports);
    assert.equal(new Set(imports).size, imports.length);
});

test('styles directory contains only the consolidated global CSS bundles', () => {
    const actual = fs
        .readdirSync(stylesDir)
        .filter((name) => name.endsWith('.css'))
        .sort();

    const expected = expectedImports.map((entry) => path.basename(entry)).sort();
    assert.deepEqual(actual, expected);
});
