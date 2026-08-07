'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function pisiTestElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            BrowserWindow: class BrowserWindow {},
            dialog: {},
            net: { fetch: async () => ({ ok: false, status: 500 }) }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

require('../main/functions/task-capture');
require('../main/functions/structured-nodes');
require('../main/functions/portability');
require('../main/functions/research');
require('../main/functions/team-api');

Module._load = originalLoad;

test('portability helpers emit Markdown and a real ZIP-based DOCX', () => {
    assert.match(
        globalThis.pisiHtmlToMarkdown('<h2>Başlık</h2><p><strong>Kalın</strong> metin</p>'),
        /## Başlık[\s\S]*\*\*Kalın\*\*/
    );
    const docx = globalThis.makePisiDocxBuffer({
        metadata: { title: 'Deneme' },
        data: { content: '<p>İçerik</p>' }
    });
    assert.equal(Buffer.isBuffer(docx), true);
    assert.equal(docx.subarray(0, 4).toString('hex'), '504b0304');
    assert.ok(docx.includes(Buffer.from('word/document.xml')));
    assert.match(
        globalThis.pisiHtmlToMarkdown(
            '<div class="pisi-editor-block" data-pisi-block-type="task"><span class="pisi-block-task-marker">☑</span> Bitir<span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="todo.4.07-08-2026">todo.4.07-08-2026</span><span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="done">done</span></div>'
        ),
        /- \[x\] Bitir/
    );
    assert.doesNotMatch(
        globalThis.pisiHtmlToMarkdown(
            '<p>Bitir<span class="pisi-user-tag" data-pisi-tag="todo.4.07-08-2026">todo.4.07-08-2026</span></p>'
        ),
        /todo\.4|done/
    );
});

test('web metadata extracts source title, author, date and DOI', () => {
    const meta = globalThis.extractPisiWebMeta(`
        <html><head>
        <title>Makale</title>
        <meta name="author" content="Ada Lovelace">
        <meta name="citation_publication_date" content="2026-08-06">
        <meta name="citation_doi" content="10.1234/pisi.2026">
        </head><body><p>Özet</p></body></html>
    `, 'https://example.com');
    assert.equal(meta.title, 'Makale');
    assert.equal(meta.author, 'Ada Lovelace');
    assert.equal(meta.publicationDate, '2026-08-06');
    assert.equal(meta.doi, '10.1234/pisi.2026');
});

test('main roadmap domains register unique public bindings', () => {
    const { modules } = require('../main/module-registry');
    assert.ok(modules['main.taskCapture'].quickAddPisiTask);
    assert.ok(modules['main.structuredNodes'].createPisiPropertyMap);
    assert.ok(modules['main.portability'].restorePisiAtomicBackup);
    assert.ok(modules['main.research'].capturePisiWebSource);
    assert.ok(modules['main.structuredNodes'].applyPisiDatabaseTemplate);
    assert.ok(modules['main.teamApi'].appendPisiTeamEvent);
});

test('relation, rollup ve team verileri sınırlı biçimde normalize edilir', () => {
    assert.deepEqual(
        globalThis.normalizePisiPropertyValue('relation', ['A.node', 'A.node', 'B.node']),
        ['A.node', 'B.node']
    );
    assert.deepEqual(
        globalThis.normalizePisiPropertyValue('rollup', {
            relationProperty: 'Görevler',
            targetProperty: 'Efor',
            aggregate: 'sum'
        }),
        {
            relationProperty: 'gorevler',
            targetProperty: 'efor',
            aggregate: 'sum',
            separator: ', '
        }
    );
    const config = globalThis.normalizePisiTeamConfig({
        name: 'Araştırma',
        members: [{ name: 'Ada', role: 'editor' }]
    });
    assert.equal(config.members[0].name, 'Ada');
    assert.equal(globalThis.getPisiTeamCapabilities().realtimeSync, false);
});
