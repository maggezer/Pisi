import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PISI_FORMULA_CATALOG,
    evaluatePisiFormulaExpression
} from '../renderer/editor/pisi-editor-sheet-formula-core.mjs';

function formulaValue(formula, context = {}) {
    const result = evaluatePisiFormulaExpression(formula, context);
    assert.equal(result.ok, true, `${formula} should be valid`);
    return result.value;
}

const cells = {
    A1: 12,
    A2: -3,
    A3: 'Pisi',
    B1: 4,
    B2: '  merhaba   dünya  ',
    B3: ''
};

const context = {
    locale: 'tr-TR',
    resolveCell(ref) {
        return Object.hasOwn(cells, ref)
            ? { ok: true, value: cells[ref] }
            : { ok: false, error: '#REF!' };
    },
    resolveRange(start, end) {
        const ranges = {
            'A1:A3': [12, -3, 'Pisi'],
            'A1:B1': [12, 4],
            'A3:B3': ['Pisi', '']
        };
        const values = ranges[`${start}:${end}`];
        return values
            ? { ok: true, values }
            : { ok: false, error: '#REF!' };
    }
};

test('mantıksal formüller karşılaştırma, kısa devre ve hata yakalama uygular', () => {
    assert.equal(
        formulaValue('=IF(A1>10,CONCAT("P","isi"),1/0)', context),
        'Pisi'
    );
    assert.equal(formulaValue('=AND(A1>0,B1=4)', context), true);
    assert.equal(formulaValue('=OR(A2>0,NOT(FALSE()))', context), true);
    assert.equal(formulaValue('=XOR(TRUE,FALSE,TRUE)', context), false);
    assert.equal(formulaValue('=IFERROR(1/0,"safe")', context), 'safe');
});

test('metin formülleri hücre, Unicode ve aralık değerleriyle çalışır', () => {
    assert.equal(formulaValue('=CONCAT(A3," notes")', context), 'Pisi notes');
    assert.equal(formulaValue('=LEN("Pisi 🐈")', context), 6);
    assert.equal(formulaValue('=LEFT("Merhaba",3)'), 'Mer');
    assert.equal(formulaValue('=RIGHT("Merhaba",4)'), 'haba');
    assert.equal(formulaValue('=MID("Merhaba",2,4)'), 'erha');
    assert.equal(formulaValue('=TRIM(B2)', context), 'merhaba dünya');
    assert.equal(
        formulaValue('=SUBSTITUTE("bir iki bir","bir","üç",2)'),
        'bir iki üç'
    );
    assert.equal(
        formulaValue('=TEXTJOIN(" / ",TRUE,A3:B3)', context),
        'Pisi'
    );
});

test('absolute hücre referansları normal hücrelerle aynı hesaplanır', () => {
    assert.equal(formulaValue('=$A$1+$B$1', context), 16);
    assert.equal(formulaValue('=SUM($A$1:$B$1)', context), 16);
});

test('geniş matematik formülleri aralık ve bilimsel işlemleri hesaplar', () => {
    assert.equal(formulaValue('=SUM(A1:B1)', context), 16);
    assert.equal(formulaValue('=COUNT(A3:B3)', context), 0);
    assert.equal(formulaValue('=PRODUCT(A1:B1)', context), 48);
    assert.equal(formulaValue('=MEDIAN(9,1,5,3)'), 4);
    assert.equal(formulaValue('=ROUND(12.345,2)'), 12.35);
    assert.equal(formulaValue('=MOD(17,5)'), 2);
    assert.equal(formulaValue('=POWER(3,4)'), 81);
    assert.equal(formulaValue('=SQRT(81)'), 9);
    assert.equal(formulaValue('=FACT(5)'), 120);
    assert.equal(formulaValue('=2^3+50%'), 8.5);
});

test('temel bilimsel hesap makinesi fonksiyonları doğru sonuç verir', () => {
    assert.ok(Math.abs(formulaValue('=SIN(PI()/2)') - 1) < 1e-12);
    assert.ok(Math.abs(formulaValue('=COS(PI())') + 1) < 1e-12);
    assert.ok(Math.abs(formulaValue('=LN(E())') - 1) < 1e-12);
    assert.ok(Math.abs(formulaValue('=LOG(1000,10)') - 3) < 1e-12);
    assert.equal(formulaValue('=DEGREES(PI())'), 180);
    assert.ok(Math.abs(formulaValue('=RADIANS(180)') - Math.PI) < 1e-12);
});

test('geçersiz ve tanımsız formüller güvenli hata sonucu üretir', () => {
    assert.equal(evaluatePisiFormulaExpression('=1/0').ok, false);
    assert.equal(evaluatePisiFormulaExpression('=SQRT(-1)').ok, false);
    assert.equal(evaluatePisiFormulaExpression('=UNKNOWN(1)').ok, false);
    assert.equal(evaluatePisiFormulaExpression('=A1+1').ok, false);
});

test('formül menüsü yalnızca etkin işlevleri ve geniş kataloğu sunar', () => {
    assert.ok(PISI_FORMULA_CATALOG.logical.length >= 6);
    assert.ok(PISI_FORMULA_CATALOG.text.length >= 10);
    assert.ok(PISI_FORMULA_CATALOG.math.length >= 25);

    for (const item of Object.values(PISI_FORMULA_CATALOG).flat()) {
        assert.equal(item.disabled, undefined);
        assert.match(item.formula, /^=/);
    }
});
