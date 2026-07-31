'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function assertFound(condition, message) {
    if (!condition) throw new Error(message);
}

function replaceToolbarDivContents(html) {
    const needle = 'class="pisi-word-toolbar pisi-editor-toolbar"';
    let cursor = 0;
    let replaced = 0;

    while (true) {
        const classIndex = html.indexOf(needle, cursor);
        if (classIndex === -1) break;
        const start = html.lastIndexOf('<div', classIndex);
        const openEnd = html.indexOf('>', classIndex);
        assertFound(start !== -1 && openEnd !== -1, 'Toolbar opening div not found.');

        const tagPattern = /<div\b|<\/div>/g;
        tagPattern.lastIndex = start;
        let depth = 0;
        let closeStart = -1;
        let closeEnd = -1;
        let match;

        while ((match = tagPattern.exec(html))) {
            if (match[0].startsWith('</')) depth -= 1;
            else depth += 1;
            if (depth === 0) {
                closeStart = match.index;
                closeEnd = tagPattern.lastIndex;
                break;
            }
        }

        assertFound(closeStart !== -1, 'Toolbar closing div not found.');
        const opening = html.slice(start, openEnd + 1);
        const closing = html.slice(closeStart, closeEnd);
        const replacement = `${opening}\n                            <div class="pisi-unified-toolbar-root"></div>\n                        ${closing}`;
        html = html.slice(0, start) + replacement + html.slice(closeEnd);
        cursor = start + replacement.length;
        replaced += 1;
    }

    assertFound(replaced === 2, `Expected 2 toolbar blocks, replaced ${replaced}.`);
    return html;
}

function updateIndex() {
    const file = 'index.html';
    let source = read(file);
    source = replaceToolbarDivContents(source);
    write(file, source);
}

function updateStyleImports() {
    const file = 'style.css';
    let source = read(file);
    const line = '@import url("./styles/65-unified-toolbar.css") layer(pisi);';
    if (!source.includes(line)) {
        source = source.replace(
            '@import url("./styles/60-customization.css") layer(pisi);',
            '@import url("./styles/60-customization.css") layer(pisi);\n' + line
        );
    }
    write(file, source);
}

function removeOldToolbarCss() {
    const file = 'styles/60-customization.css';
    let source = read(file);
    const startMarker = '/* PISI EDITOR TOOLBAR MODE RAIL + WORD / PAINT / EXCEL */';
    const start = source.indexOf(startMarker);
    const end = source.indexOf('.center-tab-rename-input {', start);
    assertFound(start !== -1 && end !== -1, 'Old toolbar CSS block not found.');
    source = source.slice(0, start) + source.slice(end);
    write(file, source);
}

function updateBootstrap() {
    const file = 'renderer/bootstrap.mjs';
    let source = read(file);
    const marker = 'import "./editor/pisi-editor-paint.mjs";';
    const imports = [
        marker,
        'import "./editor/pisi-editor-toolbar-popovers.mjs";',
        'import "./editor/pisi-editor-toolbar-menus.mjs";',
        'import "./editor/pisi-editor-unified-toolbar.mjs";'
    ].join('\n');
    assertFound(source.includes(marker), 'Paint import not found.');
    source = source.replace(marker, imports);
    write(file, source);
}

function updatePaintModule() {
    const file = 'renderer/editor/pisi-editor-paint.mjs';
    let source = read(file);

    const commandStart = source.indexOf('function runPisiEditorCommand');
    const focusLine = '    editor.focus({ preventScroll: true });';
    const focusIndex = source.indexOf(focusLine, commandStart);
    assertFound(commandStart !== -1 && focusIndex !== -1, 'Editor command focus line not found.');
    source = source.slice(0, focusIndex) + [
        '    const activeElement = document.activeElement;',
        '    if (!activeElement || !editor.contains(activeElement)) {',
        '        editor.focus({ preventScroll: true });',
        '    }'
    ].join('\n') + source.slice(focusIndex + focusLine.length);

    const setupStart = source.indexOf('function setupPisiRichToolbars()');
    const setupEnd = source.indexOf('function switchPisiToolbarTab', setupStart);
    assertFound(setupStart !== -1 && setupEnd !== -1, 'Toolbar setup function not found.');
    const setup = `function setupPisiRichToolbars() {
    document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar').forEach((toolbar) => {
        setupPisiUnifiedToolbar(toolbar);
    });

    bindPisiAdvancedEditorDropTargets();
}

`;
    source = source.slice(0, setupStart) + setup + source.slice(setupEnd);

    source = source.split("['pencil', 'eraser']").join("['pencil', 'brush', 'eraser']");
    source = source.replace(
        "if (state.tool === 'pencil' || state.tool === 'eraser') {",
        "if (['pencil', 'brush', 'eraser'].includes(state.tool)) {"
    );

    write(file, source);
}

function updateSheetStructure() {
    const file = 'renderer/editor/pisi-editor-sheet-structure.mjs';
    let source = read(file);
    const marker = `    } else if (action === 'alignLeft') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'left';
        });`;
    assertFound(source.includes(marker), 'Sheet alignment format branch not found.');
    const replacement = `    } else if (action === 'toggleUnderline') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine
                .split(/\\s+/)
                .includes('underline');
        });
        cells.forEach((cell) => {
            const values = new Set(
                cell.style.textDecorationLine.split(/\\s+/).filter(Boolean)
            );
            if (enable) values.add('underline');
            else values.delete('underline');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'toggleStrikeThrough') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine
                .split(/\\s+/)
                .includes('line-through');
        });
        cells.forEach((cell) => {
            const values = new Set(
                cell.style.textDecorationLine.split(/\\s+/).filter(Boolean)
            );
            if (enable) values.add('line-through');
            else values.delete('line-through');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'fontFamily' && value) {
        cells.forEach((cell) => {
            cell.style.fontFamily = value;
        });
    } else if (action === 'fontSize' && value) {
        const sizes = {
            '1': '8px',
            '2': '10px',
            '3': '12px',
            '4': '14px',
            '5': '18px',
            '6': '24px',
            '7': '32px'
        };
        const size = sizes[String(value)] || String(value);
        cells.forEach((cell) => {
            cell.style.fontSize = size;
        });
    } else if (action === 'alignLeft') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'left';
        });`;
    source = source.replace(marker, replacement);

    const clearMarker = `            cell.style.fontWeight = '';
            cell.style.fontStyle = '';
            cell.style.textAlign = '';
            cell.style.color = '';
            cell.style.backgroundColor = '';`;
    assertFound(source.includes(clearMarker), 'Sheet clear format block not found.');
    source = source.replace(clearMarker, `            cell.style.fontWeight = '';
            cell.style.fontStyle = '';
            cell.style.textDecorationLine = '';
            cell.style.fontFamily = '';
            cell.style.fontSize = '';
            cell.style.textAlign = '';
            cell.style.color = '';
            cell.style.backgroundColor = '';`);
    write(file, source);
}

function updateSheetActions() {
    const file = 'renderer/editor/pisi-editor-sheet.mjs';
    let source = read(file);
    const marker = `            'toggleBold',
            'toggleItalic',
            'alignLeft',`;
    assertFound(source.includes(marker), 'Sheet action list not found.');
    source = source.replace(marker, `            'toggleBold',
            'toggleItalic',
            'toggleUnderline',
            'toggleStrikeThrough',
            'fontFamily',
            'fontSize',
            'alignLeft',`);
    write(file, source);
}

function updateManifest() {
    const file = 'renderer/module-manifest.json';
    const manifest = JSON.parse(read(file));
    const paintIndex = manifest.findIndex((entry) => entry.module === 'editor.paint');
    assertFound(paintIndex !== -1, 'Paint manifest entry not found.');
    const modules = [
        {
            module: 'editor.toolbarPopovers',
            path: 'renderer/editor/pisi-editor-toolbar-popovers.mjs',
            bindings: [
                'PISI_TOOLBAR_COLORS', 'PISI_TOOLBAR_SYMBOLS',
                'closePisiToolbarPopover', 'positionPisiToolbarPopover',
                'createPisiToolbarPopover', 'openPisiToolbarColorPopover',
                'openPisiToolbarSymbolPopover', 'openPisiToolbarTablePopover'
            ]
        },
        {
            module: 'editor.toolbarMenus',
            path: 'renderer/editor/pisi-editor-toolbar-menus.mjs',
            bindings: [
                'PISI_TOOLBAR_FORMULA_GROUPS', 'getPisiPersonalFormulas',
                'savePisiPersonalFormula', 'applyPisiToolbarFormula',
                'openPisiToolbarFormulaPopover', 'openPisiToolbarSizePopover',
                'openPisiToolbarShapePopover'
            ]
        },
        {
            module: 'editor.unifiedToolbar',
            path: 'renderer/editor/pisi-editor-unified-toolbar.mjs',
            bindings: [
                'PISI_FONT_SIZE_LABELS', 'buildPisiUnifiedToolbarMarkup',
                'getPisiUnifiedToolbarActiveTable', 'runPisiUnifiedTextCommand',
                'insertPisiToolbarSymbol', 'syncPisiUnifiedToolbarContext',
                'bindPisiUnifiedToolbarEvents', 'setupPisiUnifiedToolbar'
            ]
        }
    ];
    const existing = new Set(manifest.map((entry) => entry.module));
    manifest.splice(
        paintIndex + 1,
        0,
        ...modules.filter((entry) => !existing.has(entry.module))
    );
    write(file, JSON.stringify(manifest, null, 2) + '\n');
}

function addRegressionTest() {
    const file = path.join(root, 'tests', 'unified-toolbar.test.js');
    const content = `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('editor uses one five-section unified toolbar without mode tabs', () => {
    const html = read('index.html');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    assert.equal((html.match(/pisi-unified-toolbar-root/g) || []).length, 2);
    assert.doesNotMatch(html, /data-pisi-toolbar-tab/);
    assert.doesNotMatch(html, /pisi-editor-toolbar-modes/);
    assert.match(toolbar, /pisi-toolbar-section-text/);
    assert.match(toolbar, /pisi-toolbar-section-styles/);
    assert.match(toolbar, /pisi-toolbar-section-table/);
    assert.match(toolbar, /pisi-toolbar-section-drawing/);
    assert.match(toolbar, /pisi-toolbar-section-reserved/);
    for (const button of ['logical', 'text', 'math', 'financial', 'personal']) {
        assert.match(toolbar, new RegExp('data-pisi-formula-trigger="' + button + '"'));
    }
});

test('unified text controls also target selected table cells', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const structure = read('renderer/editor/pisi-editor-sheet-structure.mjs');
    for (const action of [
        'toggleBold', 'toggleItalic', 'toggleUnderline',
        'toggleStrikeThrough', 'fontFamily', 'fontSize',
        'textColor', 'fillColor'
    ]) {
        assert.match(toolbar + structure, new RegExp(action));
    }
});

test('drawing toolbar supports brush and size popovers', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const paint = read('renderer/editor/pisi-editor-paint.mjs');
    assert.match(toolbar, /data-pisi-paint-tool="brush"/);
    assert.match(toolbar, /data-pisi-size-trigger="Brush"/);
    assert.match(paint, /'pencil', 'brush', 'eraser'/);
});
`;
    fs.writeFileSync(file, content);
}

updateIndex();
updateStyleImports();
removeOldToolbarCss();
updateBootstrap();
updatePaintModule();
updateSheetStructure();
updateSheetActions();
updateManifest();
addRegressionTest();
console.log('Unified Office-style toolbar source changes applied.');
