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
require('../main/functions/project-integrity');
require('../main/functions/portability');

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

test('main roadmap domains register unique public bindings', () => {
    const { modules } = require('../main/module-registry');
    assert.ok(modules['main.taskCapture'].quickAddPisiTask);
    assert.ok(modules['main.structuredNodes'].createPisiPropertyMap);
    assert.ok(modules['main.projectIntegrity'].auditPisiProjectIntegrity);
    assert.equal(
        Object.hasOwn(modules['main.portability'], 'auditPisiProjectIntegrity'),
        false
    );
    assert.ok(modules['main.portability'].restorePisiAtomicBackup);
    assert.ok(modules['main.structuredNodes'].applyPisiDatabaseTemplate);
});

test('relation ve rollup verileri sınırlı biçimde normalize edilir', () => {
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

});
