'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Comic Neue is bundled offline with its OFL license', () => {
    const source = read('renderer/editor/pisi-editor-bundled-fonts.mjs');
    const license = read('assets/fonts/comic-neue-OFL.txt');
    const bootstrap = read('renderer/bootstrap.mjs');

    const match = source.match(/PISI_COMIC_NEUE_REGULAR_BASE64\s*=\s*`([\s\S]*?)`;/);
    assert.ok(match, 'embedded Comic Neue payload should exist');

    const fontBytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    assert.equal(fontBytes.length, 19572);
    assert.equal(fontBytes.subarray(0, 4).toString('ascii'), 'wOF2');

    assert.match(source, /new FontFace\(/);
    assert.match(source, /option\.value = 'Comic Neue'/);
    assert.doesNotMatch(source, /https?:\/\//i);
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/i);
    assert.match(license, /Copyright 2014 The Comic Neue Project Authors/);
    assert.match(bootstrap, /import\s+["\']\.\/editor\/pisi-editor-bundled-fonts\.mjs["\'];/);
});
