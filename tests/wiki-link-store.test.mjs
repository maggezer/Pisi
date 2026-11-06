import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as atomic from '../main/functions/atomic-mutation-core.js';
import { makePisiWikiLinkHtml, normalizePisiWikiTitle, repairPisiWikiLinks, rewritePisiWikiLinksForRename } from '../main/functions/wiki-link-core.js';
import { applyPisiWikiRename, applyPisiWikiRepair, getPisiWikiRenameImpact, previewPisiWikiRepair } from '../main/functions/wiki-link-store.js';

const TARGET = 'node_target01';
const OTHER = 'node_other02';

function withProject(run) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-wiki-links-'));
    try {
        return run(project);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
}

function writeNode(project, relativePath, { id, title, content }) {
    const filePath = path.join(project, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ pisi: { id, title, type: 'node' }, content }), 'utf8');
    return filePath;
}

const readContent = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')).content;
const writeDocument = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');

test('rename rewrites id links and legacy [[Old]] text, but never code, other links or other titles', () => {
    const link = makePisiWikiLinkHtml({ nodeId: TARGET, title: 'Eski Ad', blockId: 'blk_1' });
    const html =
        `<div>${link} ve [[eski ad]] ile [[Eski Ad#blk_2]]</div>` +
        '<pre>[[Eski Ad]]</pre><div><code>[[Eski Ad]]</code> <a href="https://x.test">[[Eski Ad]]</a></div>' +
        '<div>[[Eski Adlar]] [[Başka]] &amp; [[Eski&nbsp;Ad]]</div>';
    const result = rewritePisiWikiLinksForRename(html, { nodeId: TARGET, oldTitle: 'Eski Ad', newTitle: 'Yeni & <Ad>' });
    assert.equal(result.count, 4);
    assert.equal(
        result.content,
        '<div><a class="pisi-wiki-link" data-pisi-node-id="node_target01" data-pisi-node-title="Yeni &amp; &lt;Ad&gt;" data-pisi-link-block="blk_1" contenteditable="false">Yeni &amp; &lt;Ad&gt;</a>' +
            ' ve [[Yeni &amp; &lt;Ad&gt;]] ile [[Yeni &amp; &lt;Ad&gt;#blk_2]]</div>' +
            '<pre>[[Eski Ad]]</pre><div><code>[[Eski Ad]]</code> <a href="https://x.test">[[Eski Ad]]</a></div>' +
            '<div>[[Eski Adlar]] [[Başka]] &amp; [[Yeni &amp; &lt;Ad&gt;]]</div>'
    );
    const idOnly = rewritePisiWikiLinksForRename(`<div>${link} [[Eski Ad]]</div>`, {
        nodeId: TARGET,
        oldTitle: 'Eski Ad',
        newTitle: 'Yeni',
        rewriteLegacy: false
    });
    assert.equal(idOnly.count, 1);
    assert.match(idOnly.content, /\[\[Eski Ad\]\]/);
});

test('legacy titles resolve with Turkish case folding and whitespace normalization', () => {
    assert.equal(normalizePisiWikiTitle('  İSTANBUL   Notları '), normalizePisiWikiTitle('istanbul notları'));
    assert.equal(normalizePisiWikiTitle('A &amp; B'), normalizePisiWikiTitle('a & b'));
    assert.notEqual(normalizePisiWikiTitle('Ilık'), normalizePisiWikiTitle('ilik'));
});

test('repair converts unique legacy titles and reports ambiguous, missing and unsupported ones', () => {
    const resolve = (key) =>
        ({
            [normalizePisiWikiTitle('Hedef')]: { status: 'unique', nodeId: TARGET, title: 'Hedef' },
            [normalizePisiWikiTitle('İkiz')]: { status: 'ambiguous' }
        })[key] || {
            status: 'missing'
        };
    const result = repairPisiWikiLinks('<div>[[hedef]] [[Hedef#blk_9]] [[İkiz]] [[Yok]] [[Hedef#başlık]]</div><pre>[[Hedef]]</pre>', resolve);
    assert.deepEqual([result.converted, result.ambiguous, result.missing, result.unsupported], [2, 1, 1, 1]);
    assert.equal(
        result.content,
        `<div>${makePisiWikiLinkHtml({ nodeId: TARGET, title: 'Hedef' })} ${makePisiWikiLinkHtml({ nodeId: TARGET, title: 'Hedef', blockId: 'blk_9' })} [[İkiz]] [[Yok]] [[Hedef#başlık]]</div><pre>[[Hedef]]</pre>`
    );
});

test('impact counts affected notes before the rename and the rename updates the whole project', () =>
    withProject((project) => {
        const target = writeNode(project, 'Hedef.node', { id: TARGET, title: 'Hedef', content: '<div>[[Hedef]] kendine</div>' });
        const source = writeNode(project, 'klasör/Kaynak.node', {
            id: OTHER,
            title: 'Kaynak',
            content: `<div>${makePisiWikiLinkHtml({ nodeId: TARGET, title: 'Hedef' })} ve [[hedef]]</div>`
        });
        const untouched = writeNode(project, 'Ilgisiz.node', { id: 'node_unrelated3', title: 'İlgisiz', content: '<div>[[Başka]]</div>' });
        writeNode(project, '.pisi-history/Kaynak.node', { id: OTHER, title: 'Kaynak', content: '[[Hedef]]' });

        assert.deepEqual(getPisiWikiRenameImpact(project, target, 'Yeni Hedef'), { ok: true, notes: 2, links: 3, legacyIncluded: true });

        const renamed = applyPisiWikiRename(project, { nodeId: TARGET, oldTitle: 'Hedef', newTitle: 'Yeni Hedef' }, { writeDocument });
        assert.deepEqual([renamed.notes, renamed.links], [2, 3]);
        assert.match(readContent(source), /data-pisi-node-title="Yeni Hedef"[^>]*>Yeni Hedef<\/a> ve \[\[Yeni Hedef\]\]/);
        assert.equal(readContent(target), '<div>[[Yeni Hedef]] kendine</div>');
        assert.equal(readContent(untouched), '<div>[[Başka]]</div>');
        assert.equal(readContent(path.join(project, '.pisi-history/Kaynak.node')), '[[Hedef]]', 'hidden history copies are never rewritten');
    }));

test('legacy text is left alone when another note still carries the old title', () =>
    withProject((project) => {
        const target = writeNode(project, 'A.node', { id: TARGET, title: 'İkiz', content: '' });
        writeNode(project, 'B.node', { id: OTHER, title: 'ikiz', content: '' });
        const source = writeNode(project, 'C.node', {
            id: 'node_source04',
            title: 'C',
            content: `<div>[[İkiz]] ${makePisiWikiLinkHtml({ nodeId: TARGET, title: 'İkiz' })}</div>`
        });
        assert.equal(getPisiWikiRenameImpact(project, target, 'Tekil').legacyIncluded, false);
        applyPisiWikiRename(project, { nodeId: TARGET, oldTitle: 'İkiz', newTitle: 'Tekil' }, { writeDocument });
        assert.match(readContent(source), /^<div>\[\[İkiz\]\] <a [^>]*data-pisi-node-title="Tekil"/);
    }));

test('project repair preview and apply agree', () =>
    withProject((project) => {
        writeNode(project, 'Hedef.node', { id: TARGET, title: 'Hedef', content: '' });
        const source = writeNode(project, 'Kaynak.node', { id: OTHER, title: 'Kaynak', content: '<div>[[Hedef]] [[Yok]]</div>' });
        const preview = previewPisiWikiRepair(project);
        assert.deepEqual([preview.notes, preview.converted, preview.missing], [1, 1, 1]);
        const applied = applyPisiWikiRepair(project, { writeDocument });
        assert.deepEqual([applied.notes, applied.converted], [1, 1]);
        assert.match(readContent(source), /data-pisi-node-id="node_target01"[^>]*>Hedef<\/a> \[\[Yok\]\]/);
    }));

test('a crash between link rewrites rolls every note back through the atomic journal', () =>
    withProject((project) => {
        const notes = ['A', 'B', 'C'].map((name) =>
            writeNode(project, `${name}.node`, { id: `node_${name.toLowerCase()}source`, title: name, content: `<div>[[Hedef]] ${name}</div>` })
        );
        writeNode(project, 'Hedef.node', { id: TARGET, title: 'Hedef', content: '' });
        const before = notes.map(readContent);
        const transaction = atomic.beginAtomicMutation(project, 'project.item.rename.v1', { transactionId: 'mut_wiki_link_crash' });
        let writes = 0;
        assert.throws(
            () =>
                applyPisiWikiRename(
                    project,
                    { nodeId: TARGET, oldTitle: 'Hedef', newTitle: 'Yeni' },
                    {
                        writeDocument(filePath, data) {
                            atomic.capturePathBeforeMutation(transaction, filePath);
                            writeDocument(filePath, data);
                            writes += 1;
                            if (writes === 2) throw new Error('simulated crash');
                        }
                    }
                ),
            /simulated crash/
        );
        assert.equal(notes.filter((filePath) => readContent(filePath).includes('[[Yeni]]')).length, 2, 'two notes were half-written');

        const recovery = atomic.recoverAtomicMutations(project);
        assert.equal(recovery.ok, true);
        assert.equal(recovery.recovered, 1);
        assert.deepEqual(notes.map(readContent), before);
    }));
