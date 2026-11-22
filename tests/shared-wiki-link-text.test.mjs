// Note links in plain text (task titles, docs/task-plan.md G6): finding,
// drawing and the rewrite after a rename.

import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPisiWikiTextLinkTo, listPisiWikiTextLinks, rewritePisiWikiTextForRename, splitPisiWikiText } from '../shared/wiki-link-core.mjs';

test('links are found in order with their title and block', () => {
    const links = listPisiWikiTextLinks('Oku [[Proje Planı]], sonra [[Notlar#blk_a1]] ve [[ ]]');
    assert.deepEqual(
        links.map((link) => [link.start, link.end, link.title, link.block, link.hasBlock]),
        [
            [4, 19, 'Proje Planı', '', false],
            [27, 44, 'Notlar', 'blk_a1', true]
        ]
    );
    assert.deepEqual(listPisiWikiTextLinks('[[açık kalan'), []);
    assert.deepEqual(listPisiWikiTextLinks(null), []);
});

test('a text splits into text and link parts that join back to the text', () => {
    const text = '[[A]] ile [[B#blk_x1]] ve [[C#yanlış]] son';
    const parts = splitPisiWikiText(text);
    assert.deepEqual(parts, [
        { kind: 'link', text: '[[A]]', title: 'A', block: '' },
        { kind: 'text', text: ' ile ' },
        { kind: 'link', text: '[[B#blk_x1]]', title: 'B', block: 'blk_x1' },
        { kind: 'text', text: ' ve ' },
        { kind: 'link', text: '[[C#yanlış]]', title: 'C', block: '' },
        { kind: 'text', text: ' son' }
    ]);
    assert.equal(parts.map((part) => part.text).join(''), text);
    assert.deepEqual(splitPisiWikiText(''), []);
    assert.deepEqual(splitPisiWikiText('düz metin'), [{ kind: 'text', text: 'düz metin' }]);
});

test('a link matches its note title with Turkish case folding and white space', () => {
    assert.equal(hasPisiWikiTextLinkTo('Bak [[ıSPARTA  notu]]', 'Isparta notu'), true);
    assert.equal(hasPisiWikiTextLinkTo('Bak [[İzmir#blk_a]]', 'izmir'), true);
    assert.equal(hasPisiWikiTextLinkTo('Bak [[İzmir]]', 'İzmit'), false);
    assert.equal(hasPisiWikiTextLinkTo('Bak [[İzmir]]', ''), false);
});

test('a rename rewrites every link to the old title, keeps blocks and touches nothing else', () => {
    assert.deepEqual(rewritePisiWikiTextForRename('[[plan]] ve [[Plan#blk_1]] ve [[Planlar]]', { oldTitle: 'Plan', newTitle: 'Yeni Plan' }), {
        text: '[[Yeni Plan]] ve [[Yeni Plan#blk_1]] ve [[Planlar]]',
        count: 2,
        changed: true
    });
    assert.deepEqual(rewritePisiWikiTextForRename('Plan yok', { oldTitle: 'Plan', newTitle: 'X' }), { text: 'Plan yok', count: 0, changed: false });
    assert.deepEqual(rewritePisiWikiTextForRename('[[a & b]]', { oldTitle: 'a & b', newTitle: 'c < d' }).text, '[[c < d]]', 'plain text is not escaped');
});

test('a new title that cannot stand inside [[…]] changes nothing', () => {
    for (const newTitle of ['a]b', 'a[b', 'iki\nsatır', '', '   ']) {
        assert.equal(rewritePisiWikiTextForRename('[[Plan]]', { oldTitle: 'Plan', newTitle }).changed, false, JSON.stringify(newTitle));
    }
});
