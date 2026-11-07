'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Vincendo is bundled locally, licensed, and exposed in the editor font list', () => {
    const fontPath = path.join(root, 'assets/fonts/vincendo-regular.woff2');
    const fontBytes = fs.readFileSync(fontPath);
    const license = read('assets/fonts/vincendo-OFL.txt');
    const css = read('styles/105-feature-polish.css');
    const fontOptions = read('renderer/editor/pisi-editor-system-fonts.mjs');

    assert.equal(fontBytes.length, 28300);
    assert.equal(fontBytes.subarray(0, 4).toString('ascii'), 'wOF2');

    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/i);
    assert.match(license, /Copyright .*2024 GGBotNet/i);
    assert.match(license, /Reserved Font Name "Vincendo"/i);

    assert.match(css, /font-family:\s*["\']Vincendo["\']/);
    assert.match(css, /\.\.\/assets\/fonts\/vincendo-regular\.woff2/);
    assert.doesNotMatch(css, /https?:\/\//i);

    assert.match(fontOptions, /value:\s*'Vincendo'/);
    assert.match(fontOptions, /label:\s*'Vincendo'/);
    assert.match(fontOptions, /source:\s*'bundled'/);
});
