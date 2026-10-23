import assert from 'node:assert/strict';

export async function testEditorPaste(cdp) {
    const paste = (html, plain = '', initial = '<div><br></div>', start = 0, end = start, startIndex = 0, endIndex = startIndex) =>
        cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, ${JSON.stringify(initial)});
        editor.focus();
        const block = editor.children[${startIndex}];
        const last = editor.children[${endIndex}];
        const range = document.createRange();
        if (${start} < 0) range.selectNodeContents(editor);
        else {
            range.setStart(block.firstChild?.nodeType === Node.TEXT_NODE ? block.firstChild : block, ${start});
            range.setEnd(last.firstChild?.nodeType === Node.TEXT_NODE ? last.firstChild : last, ${end});
        }
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const data = new DataTransfer();
        data.setData('text/html', ${JSON.stringify(html)});
        data.setData('text/plain', ${JSON.stringify(plain)});
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        return { handled: event.defaultPrevented, html: editor.innerHTML, blocks: Array.from(editor.children).map(el => ({ type: el.dataset.pisiBlockType, text: el.textContent, id: el.dataset.pisiBlockId })) };
    })()`);

    let result = await paste('', 'İlk satır\n\nSon 👨‍👩‍👧‍👦 e\u0301\n');
    assert.equal(result.handled, true);
    assert.deepEqual(
        result.blocks.map((b) => b.text),
        ['İlk satır', '', 'Son 👨‍👩‍👧‍👦 e\u0301', ''],
        'plain text must retain blank lines and Unicode'
    );
    result = await paste('<pre>  one\n\n    two\n</pre>');
    assert.equal(result.blocks[0].text, '  one\n\n    two\n', 'code whitespace is content');
    result = await paste(
        '<p><span style="font-weight:700;color:rgb(255, 0, 0);font-size:18pt" onclick="window.__pasteAttack=1">Word</span><br>web <a href="https://example.com/a?b=1" onmouseover="window.__pasteAttack=1">link</a></p><p><br></p><p>end</p>'
    );
    assert.equal(result.blocks.length, 3);
    assert.match(result.html, /font-weight:\s*700/);
    assert.match(result.html, /font-size:\s*18pt/);
    assert.match(result.html, /https:\/\/example.com/);
    assert.doesNotMatch(result.html, /onclick|onmouseover/);
    assert.match(result.html, /<br/);
    result = await paste('<ol><li>one<ul><li>nested</li></ul>tail</li><li>two</li></ol>');
    assert.deepEqual(
        result.blocks.map((b) => b.text),
        ['one', 'nested', 'tail', 'two']
    );
    assert.equal(result.blocks[1].type, 'bullet');
    result = await paste(
        '<script>window.__pasteAttack=1</script><p><a href="javascript:alert(1)">safe text</a><img src=x onerror="window.__pasteAttack=1" alt="image label"></p>'
    );
    assert.doesNotMatch(result.html, /javascript:|onerror|<script|src="x"/i);
    assert.equal(await cdp.evaluate('window.__pasteAttack || 0'), 0);
    assert.match(result.blocks.map((b) => b.text).join(''), /safe text/);
    result = await paste('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
    assert.equal(result.handled, true, 'external tables must be sanitized by the app');
    assert.match(result.html, /<table/);
    assert.match(result.html, /<td>2<\/td>/);
    result = await paste('<b>XY</b>', 'XY', '<div>abcdef</div>', 2, 4);
    assert.equal(result.blocks[0].text, 'abXYef', 'partial selection must retain both unselected ends');
    assert.match(result.html, /<b>XY<\/b>/);
    result = await paste('', 'replacement\n\nlast', '<div>first</div><div>second</div>', -1);
    assert.deepEqual(
        result.blocks.map((b) => b.text),
        ['replacement', '', 'last'],
        'whole-note replacement must insert all content'
    );
    result = await paste('<b>XY</b>', 'XY', '<div>abcdef</div><div>ghijkl</div>', 2, 3, 0, 1);
    assert.deepEqual(
        result.blocks.map((b) => b.text),
        ['abXYjkl'],
        'cross-block selection retains its prefix and suffix'
    );
    result = await paste('', '## Title', '<div>abcdef</div>', 2, 4);
    assert.deepEqual(
        result.blocks.map((b) => b.text),
        ['ab', 'Title', 'ef'],
        'block paste must not absorb trailing text into a heading'
    );
    result = await paste('', '  x\n\n y', '<pre>abCD</pre>', 2);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].type, 'code');
    assert.equal(result.blocks[0].text, 'ab  x\n\n yCD');
    result = await paste(
        '<h2 class="pisi-editor-block" data-pisi-block-id="blk_original_heading" data-pisi-block-type="heading2">Pisi heading</h2><div class="pisi-editor-block" data-pisi-block-id="blk_original_body" data-pisi-block-type="paragraph" data-pisi-heading-parent="blk_original_heading"><strong>Pisi body</strong></div>'
    );
    assert.deepEqual(
        result.blocks.map((b) => b.type),
        ['heading2', 'paragraph']
    );
    assert.ok(
        result.blocks.every((b) => !['blk_original_heading', 'blk_original_body'].includes(b.id)),
        'copied block IDs must be new'
    );
    assert.equal(await cdp.evaluate(`document.getElementById('center-node-editor-content').children[1].dataset.pisiHeadingParent`), result.blocks[0].id);
    result = await paste(
        '<div class="pisi-editor-block" data-pisi-block-id="blk_source_task" data-pisi-block-type="task" data-pisi-task-id="task_source"><span class="pisi-user-tag pisi-task-metadata" data-pisi-tag="todo.1.none" data-pisi-task-id="task_source" contenteditable="false">todo.1.none</span><span class="pisi-todo-source" data-pisi-todo-for="todo.1.none">Copied task</span></div>'
    );
    assert.equal(result.blocks[0].type, 'task');
    assert.notEqual(await cdp.evaluate(`document.getElementById('center-node-editor-content').firstElementChild.dataset.pisiTaskId`), 'task_source');
    result = await paste('', '# Markdown\n\n- one\n  - nested\n1. numbered\n> quote\n- [x] done');
    assert.deepEqual(
        result.blocks.map((b) => b.type),
        ['heading1', 'paragraph', 'bullet', 'bullet', 'number', 'quote', 'task']
    );
    result = await paste('<p><a href="#anchor">anchor</a></p><table><tr><td colspan="2">merged</td></tr></table>');
    const persisted = await cdp.evaluate(`window.getPisiEditorContent(document.getElementById('center-node-editor-content'))`);
    assert.match(persisted, /href="#anchor"/);
    assert.match(persisted, /colspan="2"/);
    console.log('EDITOR_PASTE_E2E_OK: Word/web/Unicode/code/tables and partial selections');
}
