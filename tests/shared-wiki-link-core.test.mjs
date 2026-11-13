import test from 'node:test';
import assert from 'node:assert/strict';
import * as wikiLinkCore from '../shared/wiki-link-core.mjs';
import { buildPisiRelationshipModel, pisiSearchPathKey } from '../renderer/search/pisi-search-core.mjs';

const {
    buildPisiWikiMenuItems,
    findPisiLegacyWikiLinkAt,
    getPisiWikiTrigger,
    isPisiWikiLinkAttributeAllowed,
    makePisiWikiLinkHtml,
    normalizePisiWikiTitle,
    replacePisiWikiLinkMarkdown,
    resolvePisiLegacyWikiTitle,
    serializePisiWikiLinkMarkdown
} = wikiLinkCore;

const notes = [
    { id: 'node_a1', title: 'Proje Planı', relativePath: 'Proje Planı.node' },
    { id: 'node_b2', title: 'Proje planı', relativePath: 'arşiv/Proje planı.node' },
    { id: 'node_c3', title: 'İstanbul', relativePath: 'İstanbul.node' }
];

test('[[ opens a trigger at the caret and closes on ]], a line break or a new [[', () => {
    assert.deepEqual(getPisiWikiTrigger('Bkz. [[Proj'), { start: 5, end: 11, query: 'Proj', title: 'Proj', block: '', hasBlock: false });
    assert.deepEqual(getPisiWikiTrigger('[[Proje Planı#giri'), {
        start: 0,
        end: 18,
        query: 'Proje Planı#giri',
        title: 'Proje Planı',
        block: 'giri',
        hasBlock: true
    });
    assert.deepEqual(getPisiWikiTrigger('[['), { start: 0, end: 2, query: '', title: '', block: '', hasBlock: false });
    assert.equal(getPisiWikiTrigger('[[Proje]] devam'), null);
    assert.equal(getPisiWikiTrigger('[[Proje\nPlan'), null);
    assert.equal(getPisiWikiTrigger('[[Proje] x'), null);
    assert.equal(getPisiWikiTrigger(`[[${'a'.repeat(201)}`), null);
    assert.equal(getPisiWikiTrigger('tek [ köşeli'), null);
});

test('menu items list matches and offer "create" only when no note has the exact title', () => {
    const trigger = getPisiWikiTrigger('[[Yeni Fikir');
    const items = buildPisiWikiMenuItems({ trigger, matches: [notes[0]], createLabel: 'Yeni not oluştur' });
    assert.deepEqual(
        items.map((item) => [item.kind, item.title]),
        [
            ['wiki-note', 'Proje Planı'],
            ['wiki-create', 'Yeni Fikir']
        ]
    );
    assert.equal(items[1].description, 'Yeni not oluştur');
    const exact = buildPisiWikiMenuItems({ trigger: getPisiWikiTrigger('[[proje planı'), matches: notes.slice(0, 2) });
    assert.equal(
        exact.some((item) => item.kind === 'wiki-create'),
        false
    );
    assert.deepEqual(buildPisiWikiMenuItems({ trigger: getPisiWikiTrigger('[['), matches: [] }), []);
    const blocks = buildPisiWikiMenuItems({
        trigger: getPisiWikiTrigger('[[Proje Planı#hed'),
        matches: [],
        blocks: [
            { blockId: 'blk_1', text: 'Hedefler', nodeId: 'node_a1', title: 'Proje Planı' },
            { blockId: 'blk_2', text: 'Bütçe', nodeId: 'node_a1', title: 'Proje Planı' },
            { blockId: 'not-a-block', text: 'Hedef dışı', nodeId: 'node_a1', title: 'Proje Planı' }
        ]
    });
    assert.deepEqual(
        blocks.map((item) => [item.kind, item.blockId]),
        [['wiki-block', 'blk_1']]
    );
});

test('legacy [[Başlık]] resolves case-insensitively and reports ambiguity', () => {
    assert.deepEqual(
        resolvePisiLegacyWikiTitle(notes, 'PROJE  PLANI').map((note) => note.id),
        ['node_a1', 'node_b2']
    );
    assert.deepEqual(
        resolvePisiLegacyWikiTitle(notes, 'istanbul').map((note) => note.id),
        ['node_c3']
    );
    assert.deepEqual(resolvePisiLegacyWikiTitle(notes, 'Yok'), []);
    assert.deepEqual(findPisiLegacyWikiLinkAt('önce [[İstanbul#blk_9]] sonra', 9), {
        start: 5,
        end: 23,
        raw: '[[İstanbul#blk_9]]',
        title: 'İstanbul',
        block: 'blk_9',
        hasBlock: true
    });
    assert.equal(findPisiLegacyWikiLinkAt('önce [[İstanbul]] sonra', 2), null);
});

test('link markup escapes the title, title identity ignores case and spacing, and the sanitizer accepts only valid ids', () => {
    const link = { nodeId: 'node_a1', title: 'A & "B" <C>', blockId: 'blk_7' };
    assert.equal(
        makePisiWikiLinkHtml(link),
        '<a class="pisi-wiki-link" data-pisi-node-id="node_a1" data-pisi-node-title="A &amp; &quot;B&quot; &lt;C&gt;" data-pisi-link-block="blk_7" contenteditable="false">A &amp; &quot;B&quot; &lt;C&gt;</a>'
    );
    assert.equal(makePisiWikiLinkHtml({ nodeId: 'javascript:alert(1)', title: 'x' }), '');
    assert.equal(normalizePisiWikiTitle('  İstanbul  '), 'istanbul');
    assert.equal(normalizePisiWikiTitle('A &amp; B'), 'a & b');
    assert.equal(normalizePisiWikiTitle('Ilık'), 'ılık');
    assert.equal(normalizePisiWikiTitle('PROJE   Planı'), 'proje planı');
    assert.equal(isPisiWikiLinkAttributeAllowed('data-pisi-node-id', 'node_a1'), true);
    assert.equal(isPisiWikiLinkAttributeAllowed('data-pisi-node-id', 'node_a1" onclick="x'), false);
    assert.equal(isPisiWikiLinkAttributeAllowed('data-pisi-link-block', 'blk_1'), true);
    assert.equal(isPisiWikiLinkAttributeAllowed('data-pisi-link-block', '../x'), false);
    assert.equal(isPisiWikiLinkAttributeAllowed('href', 'https://x.test'), false);
});

test('id links round-trip through the Markdown source view', () => {
    const markdown = serializePisiWikiLinkMarkdown({ nodeId: 'node_a1', title: 'Proje [Planı] | v2', blockId: 'blk_3' });
    assert.equal(markdown, '[[Proje Planı v2#blk_3|node_a1]]');
    assert.equal(
        replacePisiWikiLinkMarkdown('Bkz. [[Proje Planı#blk_3|node_a1]] ve [[Eski]]'),
        `Bkz. ${makePisiWikiLinkHtml({ nodeId: 'node_a1', title: 'Proje Planı', blockId: 'blk_3' })} ve [[Eski]]`
    );
    assert.equal(replacePisiWikiLinkMarkdown('[[A &amp; B|node_a1]]'), makePisiWikiLinkHtml({ nodeId: 'node_a1', title: 'A & B' }));
    assert.equal(replacePisiWikiLinkMarkdown('[[X#bad|node_a1]]'), '[[X#bad|node_a1]]');
});

test('backlinks follow id links even after the target was renamed', () => {
    const target = { path: '/p/Yeni Ad.node', title: 'Yeni Ad', metadata: { id: 'node_target' }, directTitles: [], directIds: [], memberships: [] };
    const source = { path: '/p/Kaynak.node', title: 'Kaynak', metadata: { id: 'node_source' }, directTitles: [], directIds: ['node_target'], memberships: [] };
    const index = {
        documents: new Map([
            [pisiSearchPathKey(target.path), target],
            [pisiSearchPathKey(source.path), source]
        ]),
        maps: []
    };
    assert.deepEqual(
        buildPisiRelationshipModel(index, target.path).inbound.map((item) => item.path || item.nodePath),
        [source.path]
    );
    assert.deepEqual(
        buildPisiRelationshipModel(index, source.path).outbound.map((item) => item.path || item.nodePath),
        [target.path]
    );
});
