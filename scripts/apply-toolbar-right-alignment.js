'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolbarPath = path.join(root, 'renderer/editor/pisi-editor-unified-toolbar.mjs');
const cssPath = path.join(root, 'styles/65-unified-toolbar.css');
const sourceInvariantPath = path.join(root, 'tests/source-invariants.test.js');
const unifiedTestPath = path.join(root, 'tests/unified-toolbar.test.js');
const refinementTestPath = path.join(root, 'tests/toolbar-refinement.test.js');

function replaceOnce(source, before, after, label) {
    if (!source.includes(before)) {
        throw new Error(`Missing ${label}`);
    }
    return source.replace(before, after);
}

let toolbar = fs.readFileSync(toolbarPath, 'utf8');
const alignStart = toolbar.indexOf('                    <div class="pisi-toolbar-align-grid" aria-label="Paragraf hizalama">');
const actionStart = toolbar.indexOf('                    <div class="pisi-toolbar-text-action-stack">', alignStart);
if (alignStart < 0 || actionStart < 0) {
    throw new Error('Alignment or action block not found');
}
const alignBlock = toolbar.slice(alignStart, actionStart);
toolbar = toolbar.slice(0, alignStart) + toolbar.slice(actionStart);

const closeMarker = '                    </div>\n                </div>\n            </section>\n\n            <section class="pisi-toolbar-section pisi-toolbar-section-styles"';
const closeReplacement = '                    </div>\n' + alignBlock + '                </div>\n            </section>\n\n            <section class="pisi-toolbar-section pisi-toolbar-section-styles"';
toolbar = replaceOnce(toolbar, closeMarker, closeReplacement, 'text controls closing marker');

toolbar = replaceOnce(
    toolbar,
    '\n            <section class="pisi-toolbar-section pisi-toolbar-section-reserved" aria-label="Ayrılmış toolbar alanı"></section>',
    '',
    'reserved toolbar section'
);
fs.writeFileSync(toolbarPath, toolbar);

let css = fs.readFileSync(cssPath, 'utf8');
css = replaceOnce(css, '    min-width: 982px;', '    min-width: 870px;', 'toolbar minimum width');
css = replaceOnce(
    css,
    '    grid-template-columns: 250px 118px 104px 76px 282px minmax(40px, 1fr);',
    '    grid-template-columns: 250px 118px 104px 76px minmax(282px, 1fr);',
    'toolbar grid columns'
);
css = replaceOnce(
    css,
    `.pisi-toolbar-section-reserved {\n    border-right: 0;\n    background: transparent;\n    box-shadow: none;\n}`,
    `.pisi-toolbar-section:last-child {\n    border-right: 0;\n}`,
    'reserved section CSS'
);
css = replaceOnce(
    css,
    '    grid-template-columns: 56px minmax(0, 1fr);',
    '    grid-template-columns: minmax(0, 1fr) 56px;',
    'text control columns'
);
fs.writeFileSync(cssPath, css);

let sourceInvariant = fs.readFileSync(sourceInvariantPath, 'utf8');
sourceInvariant = sourceInvariant
    .replace('güncel altı bölümlü toolbarı', 'güncel beş bölümlü toolbarı')
    .replace("        'pisi-toolbar-section-drawing',\n        'pisi-toolbar-section-reserved'", "        'pisi-toolbar-section-drawing'");
sourceInvariant = replaceOnce(
    sourceInvariant,
    "    assert.ok(css.includes('grid-template-columns: 250px 118px 104px 76px 282px'));",
    "    assert.ok(css.includes('grid-template-columns: 250px 118px 104px 76px minmax(282px, 1fr)'));\n    assert.doesNotMatch(toolbarSource, /pisi-toolbar-section-reserved/);",
    'source invariant grid assertion'
);
fs.writeFileSync(sourceInvariantPath, sourceInvariant);

let unifiedTest = fs.readFileSync(unifiedTestPath, 'utf8');
unifiedTest = unifiedTest
    .replace('current six-section toolbar selection', 'current five-section toolbar selection')
    .replace("        'pisi-toolbar-section-drawing',\n        'pisi-toolbar-section-reserved'", "        'pisi-toolbar-section-drawing'");
unifiedTest = replaceOnce(
    unifiedTest,
    '    for (const formula of',
    '    assert.doesNotMatch(toolbar, /pisi-toolbar-section-reserved/);\n    for (const formula of',
    'unified reserved assertion'
);
fs.writeFileSync(unifiedTestPath, unifiedTest);

let refinementTest = fs.readFileSync(refinementTestPath, 'utf8');
refinementTest = replaceOnce(
    refinementTest,
    '    assert.deepEqual([...order].sort((a, b) => a - b), order);',
    `    assert.deepEqual([...order].sort((a, b) => a - b), order);\n\n    const actionStack = toolbar.indexOf('pisi-toolbar-text-action-stack');\n    const alignGrid = toolbar.indexOf('pisi-toolbar-align-grid');\n    assert.ok(actionStack >= 0 && alignGrid > actionStack);\n    assert.doesNotMatch(toolbar, /pisi-toolbar-section-reserved/);\n    assert.match(css, /grid-template-columns: minmax\\(0, 1fr\\) 56px/);`,
    'right alignment regression assertions'
);
fs.writeFileSync(refinementTestPath, refinementTest);

console.log('Removed reserved section and right-aligned paragraph controls.');
