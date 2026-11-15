import assert from 'node:assert/strict';
import test from 'node:test';
import * as searchCore from '../renderer/search/pisi-search-core.mjs';
import { normalizePisiSearchText, tokenizePisiSearchQuery } from '../shared/search-text.mjs';

test('Türkçe harfler düz karşılıklarıyla eşleşir: İ↔i, I↔ı, ş, ğ, ü, ö, ç', () => {
    assert.equal(normalizePisiSearchText('IŞIK'), 'isik');
    assert.equal(normalizePisiSearchText('ışık'), 'isik');
    assert.equal(normalizePisiSearchText('İstanbul'), normalizePisiSearchText('ISTANBUL'));
    assert.equal(normalizePisiSearchText('INBOX'), 'inbox');
    assert.equal(normalizePisiSearchText('Çağrı Öğüt'), 'cagri ogut');
});

test('aksanlar düşer, harf ve rakam dışındaki her şey sözcük ayırır', () => {
    assert.equal(normalizePisiSearchText('  Café—2026/11: plan!  '), 'cafe 2026 11 plan');
    assert.equal(normalizePisiSearchText(null), '');
    assert.deepEqual(tokenizePisiSearchQuery(' Proje   PLANI '), ['proje', 'plani']);
    assert.deepEqual(tokenizePisiSearchQuery('—'), []);
});

test('masaüstü arama çekirdeği aynı fonksiyonları dışa verir', () => {
    assert.equal(searchCore.normalizePisiSearchText, normalizePisiSearchText);
    assert.equal(searchCore.tokenizePisiSearchQuery, tokenizePisiSearchQuery);
});
