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
    './styles/105-feature-polish.css'
];

test('global CSS uses the consolidated bundle manifest', () => {
    const source = fs.readFileSync(stylePath, 'utf8');
    const imports = [...source.matchAll(/@import url\('([^']+)'\) layer\(pisi\);/g)].map((match) => match[1]);

    assert.deepEqual(imports, expectedImports);
    assert.equal(new Set(imports).size, imports.length);
    assert.equal(source.trim(), expectedImports.map((entry) => `@import url('${entry}') layer(pisi);`).join('\n'));
});

test('styles directory contains only the consolidated global CSS bundles', () => {
    const actual = fs
        .readdirSync(stylesDir)
        .filter((name) => name.endsWith('.css'))
        .sort();

    const expected = expectedImports.map((entry) => path.basename(entry)).sort();
    assert.deepEqual(actual, expected);
});

test('global CSS entry and bundles are included in desktop packaging', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const { build } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    assert.equal((html.match(/href="style\.css"/g) || []).length, 1);
    assert.ok(build.files.includes('style.css'));
    assert.ok(build.files.includes('styles/**/*'));
});

test('consolidated CSS preserves valid local asset URLs without nested imports', () => {
    for (const entry of expectedImports) {
        const file = path.resolve(repoRoot, entry);
        const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, /@import\b/, `${entry} must not hide additional stylesheet requests`);
        for (const [, url] of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
            if (/^(?:data:|https?:|#)/.test(url)) continue;
            const asset = path.resolve(path.dirname(file), url.split(/[?#]/)[0]);
            assert.ok(fs.statSync(asset).isFile(), `${entry} references a missing asset: ${url}`);
        }
    }
});
