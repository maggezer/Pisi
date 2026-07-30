'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const write = (filePath, content) => fs.writeFileSync(path.join(root, filePath), content, 'utf8');

function replaceExactly(source, pattern, replacement, expectedCount, label) {
    let count = 0;
    const result = source.replace(pattern, (...args) => {
        count += 1;
        return typeof replacement === 'function' ? replacement(...args) : replacement;
    });

    if (count !== expectedCount) {
        throw new Error(`${label}: expected ${expectedCount} replacements, got ${count}`);
    }

    return result;
}

const modeRailHtml = `
                            <div class="pisi-editor-toolbar-modes" role="tablist" aria-label="Editör modu">
                                <button
                                    class="pisi-editor-toolbar-tab active"
                                    data-pisi-toolbar-tab="word"
                                    type="button"
                                    role="tab"
                                    title="Metin"
                                    aria-label="Metin araçları"
                                    aria-selected="true"
                                >
                                    <img src="assets/editor-text.svg" alt="" aria-hidden="true">
                                </button>
                                <button
                                    class="pisi-editor-toolbar-tab"
                                    data-pisi-toolbar-tab="paint"
                                    type="button"
                                    role="tab"
                                    title="Çizim"
                                    aria-label="Çizim araçları"
                                    aria-selected="false"
                                >
                                    <img src="assets/editor-paint.svg" alt="" aria-hidden="true">
                                </button>
                                <button
                                    class="pisi-editor-toolbar-tab"
                                    data-pisi-toolbar-tab="excel"
                                    type="button"
                                    role="tab"
                                    title="Tablo"
                                    aria-label="Tablo araçları"
                                    aria-selected="false"
                                >
                                    <img src="assets/editor-table.svg" alt="" aria-hidden="true">
                                </button>
                            </div>`;

let html = read('index.html');
if (!html.includes('pisi-editor-toolbar-modes')) {
    html = replaceExactly(
        html,
        /\n\s*<div class="pisi-editor-toolbar-tabs">[\s\S]*?<\/div>\s*(?=<div class="pisi-editor-toolbar-panel active")/g,
        '\n',
        2,
        'remove horizontal editor tabs'
    );

    html = replaceExactly(
        html,
        /(<div class="pisi-editor-toolbar-panel" data-pisi-toolbar-panel="excel">\s*<div class="pisi-excel-toolbar-controls"><\/div>\s*<\/div>)/g,
        (match) => `${match}${modeRailHtml}`,
        2,
        'insert vertical editor mode rails'
    );
}
write('index.html', html);

let css = read('styles/60-customization.css');
const newToolbarCss = `/* PISI EDITOR TOOLBAR MODE RAIL + WORD / PAINT / EXCEL */
.pisi-editor-toolbar {
    min-height: 86px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 42px;
    grid-template-rows: minmax(84px, auto);
    align-items: stretch;
    gap: 0;
    padding: 0;
    overflow: hidden;
}

.pisi-editor-toolbar-modes {
    grid-column: 2;
    grid-row: 1;
    min-width: 42px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: stretch;
    background: #202020;
    border-left: 1px solid #333;
}

.pisi-editor-toolbar-tab {
    width: 42px;
    min-height: 28px;
    flex: 1 1 0;
    border: none;
    border-left: 2px solid transparent;
    border-bottom: 1px solid #333;
    background: #2d2d30;
    color: #aaa;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.pisi-editor-toolbar-tab:last-child {
    border-bottom: none;
}

.pisi-editor-toolbar-tab:hover {
    background: #333;
}

.pisi-editor-toolbar-tab.active {
    background: #1e1e1e;
    border-left-color: #f39c12;
}

.pisi-editor-toolbar-tab img {
    width: 18px;
    height: 18px;
    display: block;
    object-fit: contain;
    opacity: 0.72;
    pointer-events: none;
}

.pisi-editor-toolbar-tab:hover img,
.pisi-editor-toolbar-tab.active img {
    opacity: 1;
}

.pisi-editor-toolbar-panel {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    min-height: 84px;
    display: none;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
}

.pisi-editor-toolbar-panel.active {
    display: flex;
}

.pisi-editor-toolbar-panel .pisi-word-toolbar-controls,
.pisi-paint-toolbar-controls,
.pisi-excel-toolbar-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: max-content;
}

`;

if (!css.includes('PISI EDITOR TOOLBAR MODE RAIL')) {
    css = replaceExactly(
        css,
        /\/\* PISI EDITOR TOOLBAR TABS \+ WORD \/ PAINT \/ EXCEL \*\/[\s\S]*?(?=\.pisi-toolbar-field \{)/,
        newToolbarCss,
        1,
        'replace editor toolbar tab CSS'
    );
}
write('styles/60-customization.css', css);

let toolbarSource = read('renderer/editor/pisi-editor-paint.mjs');
if (!toolbarSource.includes("button.setAttribute('aria-selected'")) {
    toolbarSource = replaceExactly(
        toolbarSource,
        /toolbar\.querySelectorAll\('\[data-pisi-toolbar-tab\]'\)\.forEach\(\(button\) => \{\s*button\.classList\.toggle\('active', button\.dataset\.pisiToolbarTab === tabName\);\s*\}\);/,
        `toolbar.querySelectorAll('[data-pisi-toolbar-tab]').forEach((button) => {
        const isActive = button.dataset.pisiToolbarTab === tabName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });`,
        1,
        'add toolbar mode accessibility state'
    );
}
write('renderer/editor/pisi-editor-paint.mjs', toolbarSource);

const svgAssets = {
    'assets/editor-text.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 5h14"/>
  <path d="M12 5v14"/>
  <path d="M8 19h8"/>
  <path d="M7 9h10" opacity=".5"/>
</svg>
`,
    'assets/editor-paint.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 20c2.4.2 4.2-.4 5.2-1.8.8-1.1.5-2.4-.5-3.4-1-1-2.3-1.3-3.4-.5C4 15.3 3.6 17.2 4 20Z"/>
  <path d="m9 14 8.7-8.7a2.1 2.1 0 0 1 3 3L12 17"/>
</svg>
`,
    'assets/editor-table.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3.5" y="4" width="17" height="16" rx="1.5"/>
  <path d="M3.5 9.3h17M3.5 14.7h17M9.2 4v16M14.8 4v16"/>
</svg>
`
};

for (const [filePath, content] of Object.entries(svgAssets)) {
    write(filePath, content);
}

let tests = read('tests/source-invariants.test.js');
const testName = "editör modları toolbarın sağında dikey ikon rayı olarak görünür";
if (!tests.includes(testName)) {
    tests += `\n\ntest('${testName}', () => {
    const html = read('index.html');
    const css = read('styles/60-customization.css');
    const toolbarSource = read('renderer/editor/pisi-editor-paint.mjs');

    assert.equal((html.match(/class="pisi-editor-toolbar-modes"/g) || []).length, 2);
    assert.equal((html.match(/data-pisi-toolbar-tab=/g) || []).length, 6);
    assert.doesNotMatch(html, /class="pisi-editor-toolbar-tabs"/);
    assert.doesNotMatch(html, />\\s*(?:Word|Paint|Excel)\\s*<\\/button>/);
    assert.match(html, /assets\\/editor-text\\.svg/);
    assert.match(html, /assets\\/editor-paint\\.svg/);
    assert.match(html, /assets\\/editor-table\\.svg/);
    assert.match(css, /grid-template-columns:\\s*minmax\\(0, 1fr\\) 42px/);
    assert.match(css, /\\.pisi-editor-toolbar-modes \\{[\\s\\S]*?flex-direction:\\s*column/);
    assert.match(toolbarSource, /setAttribute\\('aria-selected'/);

    for (const asset of [
        'assets/editor-text.svg',
        'assets/editor-paint.svg',
        'assets/editor-table.svg'
    ]) {
        assert.ok(fs.existsSync(path.join(root, asset)), `Eksik editör modu ikonu: ${asset}`);
    }
});\n`;
}
write('tests/source-invariants.test.js', tests);

const finalHtml = read('index.html');
if ((finalHtml.match(/class="pisi-editor-toolbar-modes"/g) || []).length !== 2) {
    throw new Error('Both editor toolbars must contain a vertical mode rail.');
}
if (finalHtml.includes('pisi-editor-toolbar-tabs')) {
    throw new Error('Horizontal editor toolbar tabs remain in index.html.');
}

console.log('Editor mode icon rail applied successfully.');
