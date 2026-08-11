'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'renderer/editor/pisi-editor-sheet.mjs'),
    'utf8'
);
const formulaCorePath = path.resolve(
    __dirname,
    '..',
    'renderer/editor/pisi-editor-sheet-formula-core.mjs'
);
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

const formulaTestApiPromise = import(pathToFileURL(formulaCorePath).href)
    .then(({ evaluatePisiFormulaExpression }) => {
        const formulaSource = `
            const PISI_SHEET_MAX_RANGE_CELLS = 80 * 26;
            ${formulaFunctionNames
                .map((name) => extractFunction(appSource, name))
                .join('\n')}
            globalThis.pisiFormulaTestApi = {
                evaluatePisiSheetFormula,
                evaluatePisiArithmeticExpression
            };
        `;
        const formulaContext = {
            evaluatePisiFormulaExpression,
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

function makeTable(values, rowCount = 2, colCount = 2) {
    const cells = new Map(
        Object.entries(values).map(([ref, value]) => {
            const cell = typeof value === 'object'
                ? {
                    textContent: value.text || '',
                    dataset: {
                        cell: ref,
                        ...(value.formula
                            ? { formula: value.formula }
                            : {})
                    }
                }
                : {
                    textContent: String(value),
                    dataset: { cell: ref }
                };
            return [ref, cell];
        })
    );
    const rows = Array.from({ length: rowCount }, () => ({
        querySelectorAll(selector) {
            return selector === 'td'
                ? Array.from({ length: colCount }, () => ({}))
                : [];
        }
    }));

    return {
        querySelector(selector) {
            const match = selector.match(
                /^td\[data-cell="([A-Z]+\d+)"\]$/
            );
            return match ? cells.get(match[1]) || null : null;
        },
        querySelectorAll(selector) {
            return selector === 'tbody tr' ? rows : [];
        }
    };
}

test('aritmetik ayrıştırıcı öncelik ve parantezleri güvenli hesaplar', async () => {
    const { evaluatePisiArithmeticExpression } = await formulaTestApiPromise;

    assert.equal(evaluatePisiArithmeticExpression('2 + 3 * 4'), 14);
    assert.equal(evaluatePisiArithmeticExpression('(2 + 3) * -4'), -20);
    assert.ok(Number.isNaN(evaluatePisiArithmeticExpression('1 / 0')));
    assert.ok(
        Number.isNaN(
            evaluatePisiArithmeticExpression('globalThis.process')
        )
    );
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

    assert.ok(
        Number.isNaN(
            evaluatePisiSheetFormula(
                cyclicTable,
                '=B1',
                new Set(['A1'])
            )
        )
    );
    assert.ok(
        Number.isNaN(
            evaluatePisiSheetFormula(
                smallTable,
                '=SUM(A1:ZZZ999999)'
            )
        )
    );
});
