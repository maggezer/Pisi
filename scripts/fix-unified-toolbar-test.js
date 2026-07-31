'use strict';

const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'tests', 'source-invariants.test.js');
let source = fs.readFileSync(file, 'utf8');
const marker = "\ntest('editör modları toolbarın sağında dikey ikon rayı olarak görünür'";
const start = source.indexOf(marker);
if (start === -1) {
    throw new Error('Obsolete editor mode rail invariant not found.');
}
source = source.slice(0, start) + `

test('editör iki görünümde tek beş bölümlü toolbar kullanır', () => {
    const html = read('index.html');
    const css = read('styles/65-unified-toolbar.css');
    const toolbarSource = read('renderer/editor/pisi-editor-unified-toolbar.mjs');

    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab=/);
    assert.match(css, /grid-template-columns:\s*225px 145px 335px 335px/);

    for (const section of [
        'pisi-toolbar-section-text',
        'pisi-toolbar-section-styles',
        'pisi-toolbar-section-table',
        'pisi-toolbar-section-drawing',
        'pisi-toolbar-section-reserved'
    ]) {
        assert.match(toolbarSource, new RegExp(section));
    }
});
`;
fs.writeFileSync(file, source);
console.log('Obsolete editor mode rail invariant replaced.');
