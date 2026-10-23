import assert from 'node:assert/strict';

export async function testEditorNormalization(cdp) {
    const fixtures = [
        ['', ''],
        [' \n\t ', ''],
        ['<p><br></p><div></div>', ''],
        ['<p style="margin-top:12px;color:red"><strong>bold</strong> <em>italic</em></p>', 'bold italic'],
        ['<ul><li>parent <strong>bold</strong><ul><li>child</li></ul>tail</li><li>next</li></ul>', 'parent boldchildtailnext'],
        ['<pre><code>first\n  second\n\nlast</code></pre>', 'first\n  second\n\nlast'],
        ['hello <strong>bold</strong> world', 'hello bold world'],
        ['<div class="pisi-editor-block" data-pisi-block-id="blk_same">one</div><p class="pisi-editor-block" data-pisi-block-id="blk_same">two</p>', 'onetwo'],
        ['<div class="pisi-sheet-block" contenteditable="false"><p>sheet content</p></div><div>after</div>', 'sheet contentafter']
    ];
    for (const [html, expectedText] of fixtures) {
        const result = await cdp.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            editor.innerHTML = ${JSON.stringify(html)};
            window.ensurePisiEditorBlocks(editor);
            const first = editor.innerHTML;
            const nodes = Array.from(editor.childNodes);
            const ids = Array.from(editor.querySelectorAll('.pisi-editor-block')).map(el => el.dataset.pisiBlockId);
            const observer = new MutationObserver(() => {});
            observer.observe(editor, { subtree: true, childList: true, attributes: true, characterData: true });
            for (let i = 0; i < 5; i++) window.ensurePisiEditorBlocks(editor);
            const mutations = observer.takeRecords().length;
            observer.disconnect();
            return {
                stable: first === editor.innerHTML,
                sameNodes: nodes.length === editor.childNodes.length && nodes.every((node, i) => node === editor.childNodes[i]),
                sameIds: JSON.stringify(ids) === JSON.stringify(Array.from(editor.querySelectorAll('.pisi-editor-block')).map(el => el.dataset.pisiBlockId)),
                uniqueIds: new Set(ids).size === ids.length,
                text: editor.textContent,
                children: editor.children.length,
                mutations
            };
        })()`);
        assert.equal(result.stable, true, 'normalization must reach its final HTML in one call: ' + html);
        assert.equal(result.sameNodes, true, 'normalized nodes must retain their identity: ' + html);
        assert.equal(result.sameIds, true, 'normalization must retain block IDs: ' + html);
        assert.equal(result.uniqueIds, true, 'duplicate IDs must be repaired in the first call');
        assert.equal(result.text, expectedText, 'normalization must preserve text order and code whitespace');
        assert.ok(result.children > 0, 'empty editor must immediately have a caret target');
        assert.equal(result.mutations, 0, 'repeated normalization must not emit DOM mutations: ' + html);
        if (html === 'hello <strong>bold</strong> world') assert.equal(result.children, 1, 'adjacent inline content belongs to one paragraph');
    }

    for (const html of ['hello <strong>bold</strong> world', '<p><em>hello</em> world</p>', '<ul><li>hello<ul><li>world</li></ul></li></ul>']) {
        const result = await cdp.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            editor.innerHTML = ${JSON.stringify(html)};
            editor.focus();
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            const texts = [];
            while (walker.nextNode()) texts.push(walker.currentNode);
            const first = texts[0], last = texts[texts.length - 1];
            const selection = window.getSelection();
            selection.setBaseAndExtent(last, 2, first, 1);
            const selected = selection.toString();
            window.ensurePisiEditorBlocks(editor);
            for (let i = 0; i < 3; i++) window.ensurePisiEditorBlocks(editor);
            return { sameText: selected === selection.toString(), anchor: selection.anchorNode === last && selection.anchorOffset === 2, focus: selection.focusNode === first && selection.focusOffset === 1 };
        })()`);
        assert.deepEqual(result, { sameText: true, anchor: true, focus: true }, 'normalization must preserve text nodes and backward selection: ' + html);
    }
    console.log('EDITOR_NORMALIZATION_E2E_OK: repeated normalization preserves DOM, IDs, text order and backward selection');
}
