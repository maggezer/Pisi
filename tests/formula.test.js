'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'renderer/editor/pisi-editor-sheet.mjs'), 'utf8');
const formulaCorePath = path.resolve(__dirname, '..', 'renderer/editor/pisi-editor-sheet-formula-core.mjs');
const formulaFunctionNames = [
    'getPisiSheetFormulaLocale',
    'evaluatePisiSheetFormulaResult',
    'evaluatePisiSheetFormula',
    'evaluatePisiArithmeticExpression',
    'getPisiSheetCellNumericValue',
    'getPisiSheetCellValue',
    'getPisiSheetRangeCellValues',
    'getPisiSheetRangeValues',
    'parsePisiCellRef',
    'pisiColumnName',
    'pisiColumnIndex'
];

const formulaTestApiPromise = import(pathToFileURL(formulaCorePath).href).then(({ evaluatePisiFormulaExpression }) => {
    const formulaSource = `
            const PISI_SHEET_MAX_RANGE_CELLS = 80 * 26;
            ${formulaFunctionNames.map((name) => extractFunction(appSource, name)).join('\n')}
            globalThis.pisiFormulaTestApi = {
                evaluatePisiSheetFormula,
                evaluatePisiArithmeticExpression
            };
        `;
    const formulaContext = {
        evaluatePisiFormulaExpression,
        getPisiSheetDatabaseDimensions(table) {
            return {
                rows: table.__rowCount,
                cols: table.__colCount
            };
        },
        getPisiSheetCellSource(table, row, col) {
            return (
                table.__sources.get(row + ':' + col) || {
                    value: '',
                    formula: null,
                    format: {}
                }
            );
        },
        window: {
            pisiI18n: {
                getLanguage() {
                    return 'eng';
                }
            }
        }
    };
    vm.createContext(formulaContext);
    vm.runInContext(formulaSource, formulaContext);
    return formulaContext.pisiFormulaTestApi;
});

function columnIndex(name) {
    return (
        String(name || '')
            .toUpperCase()
            .split('')
            .reduce((sum, character) => {
                return sum * 26 + character.charCodeAt(0) - 64;
            }, 0) - 1
    );
}

function makeTable(values, rowCount = 2, colCount = 2) {
    const sources = new Map();

    for (const [ref, raw] of Object.entries(values)) {
        const match = ref.match(/^([A-Z]+)(\d+)$/);
        if (!match) continue;

        const row = Number(match[2]) - 1;
        const col = columnIndex(match[1]);

        sources.set(
            row + ':' + col,
            typeof raw === 'object'
                ? {
                      value: String(raw.text || ''),
                      formula: raw.formula || null,
                      format: {}
                  }
                : {
                      value: String(raw),
                      formula: null,
                      format: {}
                  }
        );
    }

    return {
        __sources: sources,
        __rowCount: rowCount,
        __colCount: colCount
    };
}

test('aritmetik ayrıştırıcı öncelik ve parantezleri güvenli hesaplar', async () => {
    const { evaluatePisiArithmeticExpression } = await formulaTestApiPromise;

    assert.equal(evaluatePisiArithmeticExpression('2 + 3 * 4'), 14);
    assert.equal(evaluatePisiArithmeticExpression('(2 + 3) * -4'), -20);
    assert.ok(Number.isNaN(evaluatePisiArithmeticExpression('1 / 0')));
    assert.ok(Number.isNaN(evaluatePisiArithmeticExpression('globalThis.process')));
});

test('SUM, COUNT ve AVG boş hücreleri doğru ele alır', async () => {
    const { evaluatePisiSheetFormula } = await formulaTestApiPromise;
    const table = makeTable({
        A1: '2',
        A2: '',
        B1: '4',
        B2: 'metin'
    });

    assert.equal(evaluatePisiSheetFormula(table, '=SUM(A1:B2)'), 6);
    assert.equal(evaluatePisiSheetFormula(table, '=COUNT(A1:B2)'), 2);
    assert.equal(evaluatePisiSheetFormula(table, '=AVG(A1:B2)'), 3);
});

test('döngüsel formül ve tablo dışı dev aralık hata üretir', async () => {
    const { evaluatePisiSheetFormula } = await formulaTestApiPromise;
    const cyclicTable = makeTable({
        A1: { formula: '=B1' },
        B1: { formula: '=A1' },
        A2: '',
        B2: ''
    });
    const smallTable = makeTable({
        A1: '1',
        A2: '2',
        B1: '3',
        B2: '4'
    });

    assert.ok(Number.isNaN(evaluatePisiSheetFormula(cyclicTable, '=B1', new Set(['A1']))));
    assert.ok(Number.isNaN(evaluatePisiSheetFormula(smallTable, '=SUM(A1:ZZZ999999)')));
});
