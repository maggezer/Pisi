'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'app.js'),
    'utf8'
);
const formulaFunctionNames = [
    'evaluateKediSheetFormula',
    'evaluateKediArithmeticExpression',
    'getKediSheetCellNumericValue',
    'getKediSheetCellValue',
    'getKediSheetRangeValues',
    'parseKediCellRef',
    'kediColumnName',
    'kediColumnIndex'
];
const formulaSource = `
    const KEDI_SHEET_MAX_RANGE_CELLS = 80 * 26;
    ${formulaFunctionNames
        .map((name) => extractFunction(appSource, name))
        .join('\n')}
    globalThis.kediFormulaTestApi = {
        evaluateKediSheetFormula,
        evaluateKediArithmeticExpression
    };
`;
const formulaContext = {};
vm.createContext(formulaContext);
vm.runInContext(formulaSource, formulaContext);

const {
    evaluateKediSheetFormula,
    evaluateKediArithmeticExpression
} = formulaContext.kediFormulaTestApi;

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

test('aritmetik ayrıştırıcı öncelik ve parantezleri güvenli hesaplar', () => {
    assert.equal(evaluateKediArithmeticExpression('2 + 3 * 4'), 14);
    assert.equal(evaluateKediArithmeticExpression('(2 + 3) * -4'), -20);
    assert.ok(Number.isNaN(evaluateKediArithmeticExpression('1 / 0')));
    assert.ok(
        Number.isNaN(
            evaluateKediArithmeticExpression('globalThis.process')
        )
    );
});

test('SUM, COUNT ve AVG boş hücreleri doğru ele alır', () => {
    const table = makeTable({
        A1: '2',
        A2: '',
        B1: '4',
        B2: 'metin'
    });

    assert.equal(evaluateKediSheetFormula(table, '=SUM(A1:B2)'), 6);
    assert.equal(evaluateKediSheetFormula(table, '=COUNT(A1:B2)'), 2);
    assert.equal(evaluateKediSheetFormula(table, '=AVG(A1:B2)'), 3);
});

test('döngüsel formül ve tablo dışı dev aralık hata üretir', () => {
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
            evaluateKediSheetFormula(
                cyclicTable,
                '=B1',
                new Set(['A1'])
            )
        )
    );
    assert.ok(
        Number.isNaN(
            evaluateKediSheetFormula(
                smallTable,
                '=SUM(A1:ZZZ999999)'
            )
        )
    );
});
