import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPisiReplacements, findPisiTextMatches, foldPisiFindText, locatePisiFindOffset } from '../renderer/editor/pisi-find-core.mjs';

const count = (groups, query, options) => findPisiTextMatches(groups, query, options).length;

test('Turkish case rules: İ↔i and I↔ı, but i does not match I', () => {
    assert.equal(foldPisiFindText('İSTANBUL ISI'), 'istanbul ısı');
    assert.equal(foldPisiFindText('İstanbul').length, 'İstanbul'.length, 'folding keeps every position');
    assert.equal(count([['İstanbul ve istanbul']], 'istanbul'), 2);
    assert.equal(count([['ISI ısı Isı']], 'ısı'), 3);
    assert.equal(count([['Iğdır']], 'iğdır'), 0, 'I is the capital of ı, not of i');
    assert.equal(count([['iğdır İĞDIR igdir']], 'İğdır'), 2, 'İĞDIR folds to iğdır; igdir has no ğ/ı');
    assert.equal(count([['İstanbul istanbul']], 'İstanbul', { caseSensitive: true }), 1);
    assert.equal(count([['Straße STRASSE']], 'straße'), 1, 'non-Turkish letters fold normally');
});

test('whole word uses Unicode letters, digits and underscore as word characters', () => {
    const groups = [['kat katı kat_1 (kat) çatıkat kat.']];
    assert.equal(count(groups, 'kat'), 6);
    assert.deepEqual(
        findPisiTextMatches(groups, 'kat', { wholeWord: true }).map((match) => match.start),
        [0, 16, 29]
    );
    assert.equal(count([['şeker şekerli']], 'şeker', { wholeWord: true }), 1);
});

test('a match may span text nodes of one block but never two blocks', () => {
    const groups = [['Bu ', 'Ra', 'por', ' hazır'], ['Ra', ''], ['por']];
    assert.deepEqual(findPisiTextMatches(groups, 'rapor'), [{ group: 0, start: 3, end: 8 }]);
    assert.deepEqual(locatePisiFindOffset(groups[0], 3, true), { node: 1, offset: 0 });
    assert.deepEqual(locatePisiFindOffset(groups[0], 8), { node: 2, offset: 3 });
    assert.deepEqual(findPisiTextMatches([['aaaa']], 'aa'), [
        { group: 0, start: 0, end: 2 },
        { group: 0, start: 2, end: 4 }
    ]);
    assert.deepEqual(findPisiTextMatches(groups, ''), []);
});

test('replacements keep every text node and put new text where a match starts', () => {
    const groups = [['Bu ', 'Ra', 'por', ' hazır; rapor tamam'], ['Başka rapor']];
    const matches = findPisiTextMatches(groups, 'rapor');
    assert.equal(matches.length, 3);
    assert.deepEqual(applyPisiReplacements(groups, matches, 'Belge'), [['Bu ', 'Belge', '', ' hazır; Belge tamam'], ['Başka Belge']]);
    // Only the current match.
    assert.deepEqual(applyPisiReplacements(groups, [matches[1]], 'X'), [['Bu ', 'Ra', 'por', ' hazır; X tamam'], ['Başka rapor']]);
    // A replacement longer or shorter than the match, and an empty one.
    assert.deepEqual(applyPisiReplacements([['a-b-a']], findPisiTextMatches([['a-b-a']], 'a'), 'uzun'), [['uzun-b-uzun']]);
    assert.deepEqual(applyPisiReplacements([['xAx']], findPisiTextMatches([['xAx']], 'a'), ''), [['xx']]);
    assert.deepEqual(applyPisiReplacements(groups, [], 'y'), groups);
});
