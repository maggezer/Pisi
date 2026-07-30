'use strict';

const fs = require('node:fs');

function replaceOnce(source, pattern, replacement, label) {
    if (!pattern.test(source)) {
        throw new Error(`${label} fragment was not found.`);
    }
    return source.replace(pattern, replacement);
}

const htmlPath = 'index.html';
let html = fs.readFileSync(htmlPath, 'utf8');
html = replaceOnce(
    html,
    /\n\s*<div id="center-node-editor-header">[\s\S]*?<\/div>\n(?=\s*<div\n\s*class="pisi-word-toolbar pisi-editor-toolbar")/,
    '\n',
    'center node editor header'
);
fs.writeFileSync(htmlPath, html, 'utf8');

const cssPath = 'styles/40-editor.css';
let css = fs.readFileSync(cssPath, 'utf8');
css = replaceOnce(
    css,
    /\n#center-node-editor-header \{[\s\S]*?\n#center-node-editor-save:hover \{[\s\S]*?\n\}\n/,
    '\n',
    'center node editor header styles'
);
fs.writeFileSync(cssPath, css, 'utf8');

const testPath = 'tests/source-invariants.test.js';
let tests = fs.readFileSync(testPath, 'utf8');
tests = tests
    .replace(/\n\s*assert\.match\(html, \/id="center-node-editor-title"\/\);/, '')
    .replace(/\n\s*assert\.match\(html, \/id="center-node-editor-save"\/\);/, '');

const cleanupTest = `test('merkez node editöründe başlık ve kaydet şeridi bulunmaz', () => {
    const html = read('index.html');
    const editorCss = read('styles/40-editor.css');

    assert.doesNotMatch(
        html,
        /center-node-editor-(?:header|title|save)/
    );
    assert.doesNotMatch(
        editorCss,
        /#center-node-editor-(?:header|title|save)/
    );
});

`;

if (!tests.includes("test('merkez node editöründe başlık ve kaydet şeridi bulunmaz'")) {
    const marker = "test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {";
    if (!tests.includes(marker)) {
        throw new Error('source invariant insertion point was not found.');
    }
    tests = tests.replace(marker, cleanupTest + marker);
}
fs.writeFileSync(testPath, tests, 'utf8');

console.log('Center editor title and save bar removed.');
