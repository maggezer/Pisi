'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const write = (filePath, content) =>
    fs.writeFileSync(path.join(root, filePath), content, 'utf8');
const decodeFile = (name) =>
    Buffer.from(
        read(`.tmp-sheet-overhaul/${name}.b64`).trim(),
        'base64'
    ).toString('utf8');

function replaceExactly(source, pattern, replacement, label) {
    let count = 0;
    const result = source.replace(pattern, (...args) => {
        count += 1;
        return typeof replacement === 'function'
            ? replacement(...args)
            : replacement;
    });

    if (count !== 1) {
        throw new Error(`${label}: expected 1 replacement, got ${count}`);
    }

    return result;
}

function makeModuleRegistration(moduleName, bindings) {
    const properties = bindings.map((name) => {
        return `    ${JSON.stringify(name)}: {\n` +
            '        enumerable: true,\n' +
            `        get() { return ${name}; }\n` +
            '    }';
    }).join(',\n');

    return `const moduleApi = {};\n` +
        `Object.defineProperties(moduleApi, {\n${properties}\n});\n` +
        `registerModule(${JSON.stringify(moduleName)}, moduleApi);\n`;
}

const coreBindings = [
    'runPisiExcelAction',
    'insertPisiSheet',
    'buildPisiSheetHtml',
    'PISI_SHEET_MAX_ROWS',
    'PISI_SHEET_MAX_COLS',
    'PISI_SHEET_MAX_RANGE_CELLS',
    'pisiBoundSheets',
    'pisiEditedSheetCells',
    'getActivePisiSheetForEditor',
    'applyPisiSheetFormula',
    'commitPisiSheetCell',
    'recalcPisiSheet',
    'evaluatePisiSheetFormula',
    'evaluatePisiArithmeticExpression',
    'getPisiSheetCellNumericValue',
    'getPisiSheetCellValue',
    'getPisiSheetRangeValues',
    'parsePisiCellRef',
    'pisiColumnName',
    'pisiColumnIndex',
    'formatPisiSheetNumber'
];

const interactionBindings = [
    'pisiSheetSelections',
    'pisiSheetNotifyTimers',
    'hydratePisiSheets',
    'getPisiSheetDimensions',
    'getPisiSheetCellPosition',
    'getPisiSheetCell',
    'getPisiSheetSelectionRect',
    'getPisiSelectedSheetCells',
    'renderPisiSheetSelection',
    'selectPisiSheetCell',
    'selectPisiSheetRow',
    'selectPisiSheetColumn',
    'focusPisiSheetCell',
    'syncPisiSheetFormulaInput',
    'extendPisiSheetSelectionByKeyboard',
    'movePisiSheetCellFocus'
];

const structureBindings = [
    'refreshPisiSheetCellMetadata',
    'getPisiSheetMutationFocus',
    'updatePisiSheetFormulaReferences',
    'addPisiSheetRow',
    'addPisiSheetColumn',
    'deletePisiSheetRows',
    'deletePisiSheetColumns',
    'applyPisiSheetCellFormat',
    'clearPisiSheetSelectedCells',
    'schedulePisiSheetEditorNotification',
    'setPisiSheetToolbarStatus',
    'syncPisiSheetToolbarForTable',
    'syncPisiSheetToolbarState'
];

let sheet = read('renderer/editor/pisi-editor-sheet.mjs');

sheet = replaceExactly(
    sheet,
    /function runPisiExcelAction\(toolbar, action\) \{[\s\S]*?\n\}\n\n(?=function insertPisiSheet)/,
    decodeFile('run') + '\n\n',
    'replace Excel action dispatcher'
);

sheet = replaceExactly(
    sheet,
    /function hydratePisiSheets\(root = document\) \{[\s\S]*?\n\}\n\nfunction selectPisiSheetCell\(cell\) \{[\s\S]*?\n\}\n\n(?=function getActivePisiSheetForEditor)/,
    '',
    'move sheet interactions'
);

sheet = replaceExactly(
    sheet,
    /function refreshPisiSheetCellMetadata\(table\) \{[\s\S]*?\n\}\n\nfunction addPisiSheetRow[\s\S]*?\n\}\n\n(?=const moduleApi = \{\};)/,
    '',
    'move sheet structure operations'
);

sheet = replaceExactly(
    sheet,
    /            const value = evaluatePisiSheetFormula\(table, cell\.dataset\.formula, new Set\(\[cell\.dataset\.cell\]\)\);\n            cell\.textContent = Number\.isFinite\(value\) \? formatPisiSheetNumber\(value\) : '#ERR';/,
    `            if (cell.dataset.formula.includes('#REF!')) {
                cell.textContent = '#REF!';
                continue;
            }

            const value = evaluatePisiSheetFormula(
                table,
                cell.dataset.formula,
                new Set([cell.dataset.cell])
            );
            cell.textContent = Number.isFinite(value)
                ? formatPisiSheetNumber(value)
                : '#ERR';`,
    'handle deleted formula references'
);

sheet = replaceExactly(
    sheet,
    /const moduleApi = \{\};[\s\S]*$/,
    makeModuleRegistration('editor.sheet', coreBindings),
    'rewrite sheet core registration'
);

write('renderer/editor/pisi-editor-sheet.mjs', sheet);

const interactionsSource =
    'import { registerModule } from "../core/module-registry.mjs";\n\n' +
    'const pisiSheetSelections = new WeakMap();\n\n' +
    'const pisiSheetNotifyTimers = new WeakMap();\n\n' +
    decodeFile('hydrate') + '\n\n' +
    decodeFile('selection') + '\n\n' +
    makeModuleRegistration('editor.sheetInteractions', interactionBindings);

write(
    'renderer/editor/pisi-editor-sheet-interactions.mjs',
    interactionsSource
);

const structureSource =
    'import { registerModule } from "../core/module-registry.mjs";\n' +
    'import { transformPisiSheetFormulaReferences } ' +
    'from "./pisi-editor-sheet-model.mjs";\n\n' +
    decodeFile('bottom') + '\n\n' +
    makeModuleRegistration('editor.sheetStructure', structureBindings);

write(
    'renderer/editor/pisi-editor-sheet-structure.mjs',
    structureSource
);

let paint = read('renderer/editor/pisi-editor-paint.mjs');

paint = replaceExactly(
    paint,
    /function buildPisiExcelToolbarControls\(controls\) \{[\s\S]*?\n\}\n\n(?=function setupPisiRichToolbars)/,
    decodeFile('toolbar') + '\n\n',
    'replace table toolbar controls'
);

const oldChange = `            if (event.target.matches('[data-pisi-paint-color], [data-pisi-paint-size]')) {
                updatePisiPaintStateFromToolbar(toolbar);
            }`;

const newChange = `            const sheetFormat = event.target.closest('[data-pisi-excel-format]');

            if (sheetFormat) {
                event.preventDefault();
                event.stopPropagation();
                runPisiExcelAction(
                    toolbar,
                    sheetFormat.dataset.pisiExcelFormat,
                    sheetFormat.value
                );
                return;
            }

            if (event.target.matches('[data-pisi-paint-color], [data-pisi-paint-size]')) {
                updatePisiPaintStateFromToolbar(toolbar);
            }`;

if (!paint.includes(oldChange)) {
    throw new Error('Paint toolbar change handler was not found.');
}

paint = paint.replace(oldChange, newChange);
write('renderer/editor/pisi-editor-paint.mjs', paint);

let css = read('styles/70-components.css');

css = css.replace(
    `.pisi-sheet-table td:focus,
.pisi-sheet-cell-selected {
    box-shadow: inset 0 0 0 2px #f39c12;
    background: #26231d;
}

`,
    ''
);

if (!css.includes('.pisi-sheet-toolbar-status')) {
    css = replaceExactly(
        css,
        /\n(?=\.pisi-sheet-table td\[data-formula\] \{)/,
        '\n' + decodeFile('css') + '\n',
        'insert table selection and toolbar CSS'
    );
}

write('styles/70-components.css', css);
write('tests/sheet-overhaul.test.js', decodeFile('test'));

let bootstrap = read('renderer/bootstrap.mjs');
bootstrap = bootstrap.replace(
    'import "./editor/pisi-editor-paint.mjs";\n' +
    'import "./editor/pisi-editor-sheet.mjs";',
    'import "./editor/pisi-editor-sheet.mjs";\n' +
    'import "./editor/pisi-editor-sheet-interactions.mjs";\n' +
    'import "./editor/pisi-editor-sheet-structure.mjs";\n' +
    'import "./editor/pisi-editor-paint.mjs";'
);

if (!bootstrap.includes('pisi-editor-sheet-interactions.mjs')) {
    throw new Error('Renderer bootstrap was not updated.');
}

write('renderer/bootstrap.mjs', bootstrap);

const manifestPath = 'renderer/module-manifest.json';
const manifest = JSON.parse(read(manifestPath));
const oldIndex = manifest.findIndex((entry) => entry.module === 'editor.sheet');

if (oldIndex < 0) {
    throw new Error('editor.sheet manifest entry was not found.');
}

manifest.splice(
    oldIndex,
    1,
    {
        module: 'editor.sheet',
        path: 'renderer/editor/pisi-editor-sheet.mjs',
        bindings: coreBindings
    },
    {
        module: 'editor.sheetInteractions',
        path: 'renderer/editor/pisi-editor-sheet-interactions.mjs',
        bindings: interactionBindings
    },
    {
        module: 'editor.sheetStructure',
        path: 'renderer/editor/pisi-editor-sheet-structure.mjs',
        bindings: structureBindings
    }
);

write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

for (const required of [
    'deletePisiSheetRows',
    'deletePisiSheetColumns',
    'schedulePisiSheetEditorNotification',
    'data-pisi-excel-action="deleteRow"',
    'data-pisi-excel-format="fillColor"'
]) {
    const combined = sheet + paint + interactionsSource + structureSource;
    if (!combined.includes(required)) {
        throw new Error(`Missing table feature: ${required}`);
    }
}

for (const filePath of [
    'renderer/editor/pisi-editor-sheet.mjs',
    'renderer/editor/pisi-editor-sheet-interactions.mjs',
    'renderer/editor/pisi-editor-sheet-structure.mjs'
]) {
    const lineCount = read(filePath).split(/\r?\n/).length;
    if (lineCount > 1000) {
        throw new Error(`${filePath} exceeds 1000 lines: ${lineCount}`);
    }
}

console.log('Table overhaul applied.');
