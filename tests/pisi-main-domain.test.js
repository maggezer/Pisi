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

require('../main/functions/structured-nodes');
require('../main/functions/project-integrity');
require('../main/functions/portability');

Module._load = originalLoad;

test('portability helpers emit Markdown and a real ZIP-based DOCX', () => {
    assert.match(globalThis.pisiHtmlToMarkdown('<h2>Başlık</h2><p><strong>Kalın</strong> metin</p>'), /## Başlık[\s\S]*\*\*Kalın\*\*/);
    const docx = globalThis.makePisiDocxBuffer({
        metadata: { title: 'Deneme' },
        data: { content: '<p>İçerik</p>' }
    });
    assert.equal(Buffer.isBuffer(docx), true);
    assert.equal(docx.subarray(0, 4).toString('hex'), '504b0304');
    assert.ok(docx.includes(Buffer.from('word/document.xml')));
    // docs/task-plan.md G5: a note holds only the task id; the export draws the row from tasks.json.
    const { expandPisiTaskMarkupForExport } = require('../main/functions/portability-tasks-core.js');
    const open = 'task_00000000-0000-4000-9000-000000000001';
    const done = 'task_00000000-0000-4000-9000-000000000002';
    const note =
        '<p>Giriş</p>' +
        `<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_a" data-pisi-block-type="task" data-pisi-task-id="${open}" contenteditable="false"></div>` +
        `<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_b" data-pisi-block-type="task" data-pisi-task-id="${done}" contenteditable="false"></div>`;
    const tasks = [
        { id: open, title: 'Raporu <yaz>', status: 'todo' },
        { id: done, title: 'Bitir', status: 'done' }
    ];
    const markdown = globalThis.pisiHtmlToMarkdown(expandPisiTaskMarkupForExport(note, { tasks }));
    assert.equal(markdown, 'Giriş\n\n- [ ] Raporu <yaz>\n\n- [x] Bitir');
    // The old `todo.` marker of an old note is ordinary text now (§3.2.1).
    assert.match(
        globalThis.pisiHtmlToMarkdown('<p>Bitir<span class="pisi-user-tag" data-pisi-tag="todo.4.07-08-2026">todo.4.07-08-2026</span></p>'),
        /Bitir\s*todo\.4\.07-08-2026/
    );
});

test('main roadmap domains register unique public bindings', () => {
    const { modules } = require('../main/module-registry');
    assert.ok(modules['main.structuredNodes'].createPisiPropertyMap);
    assert.ok(modules['main.projectIntegrity'].auditPisiProjectIntegrity);
    assert.equal(Object.hasOwn(modules['main.portability'], 'auditPisiProjectIntegrity'), false);
    assert.ok(modules['main.portability'].restorePisiAtomicBackup);
    assert.ok(modules['main.structuredNodes'].applyPisiDatabaseTemplate);
});

test('relation ve rollup verileri sınırlı biçimde normalize edilir', () => {
    assert.deepEqual(globalThis.normalizePisiPropertyValue('relation', ['A.node', 'A.node', 'B.node']), ['A.node', 'B.node']);
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
});

test('Markdown içe aktarmada "- [ ]" satırı görev bloğu olur; "- [x]" satırı metin kalır (docs/task-plan.md G5)', () => {
    const titles = [];
    const html = globalThis.pisiMarkdownToHtml('# Plan\n- madde\n- [ ] Raporu yaz\n- [x] Eski iş\n', {
        makeTaskBlock: (title) => {
            titles.push(title);
            return `<div data-pisi-block-type="task" data-title="${title}"></div>`;
        }
    });
    assert.deepEqual(titles, ['Raporu yaz']);
    assert.equal(html, '<h1>Plan</h1>\n<ul>\n<li>madde</li>\n</ul>\n<div data-pisi-block-type="task" data-title="Raporu yaz"></div>\n<p>☑ Eski iş</p>');
    // Görev üreticisi verilmezse kutu metin olarak kalır.
    assert.equal(globalThis.pisiMarkdownToHtml('- [ ] Yalnız'), '<p>☐ Yalnız</p>');
});
