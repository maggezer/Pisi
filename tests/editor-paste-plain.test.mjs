import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePisiPlainPaste } from '../renderer/tags/pisi-paste-plain.mjs';
import { safePisiPasteHref } from '../renderer/tags/pisi-paste-sanitize.mjs';

test('plain paste retains CRLF paragraphs, blank and trailing lines, Unicode and spaces', () => {
    const value = '  İ😀 e\u0301\r\n\r\nlast\r\n';
    assert.deepEqual(
        parsePisiPlainPaste(value).map((item) => item.text),
        ['  İ😀 e\u0301', '', 'last', '']
    );
    assert.deepEqual(
        parsePisiPlainPaste('\n').map((item) => item.text),
        ['', '']
    );
});

test('code fences retain indentation and empty lines including an unclosed fence', () => {
    assert.equal(parsePisiPlainPaste('```js\n  first\n\n    last\n```')[0].text, '  first\n\n    last');
    assert.equal(parsePisiPlainPaste('```\n  first\n\n')[0].text, '  first\n\n');
});

test('supported Markdown block types remain explicit and nested bullets keep indentation', () => {
    const blocks = parsePisiPlainPaste('# Title\n- one\n  - nested\n1. numbered\n> quote\n- [x] done');
    assert.deepEqual(
        blocks.map((item) => item.type),
        ['heading1', 'bullet', 'bullet', 'number', 'quote', 'task']
    );
    assert.equal(blocks[2].indent, 1);
    assert.equal(blocks[5].checked, true);
    assert.equal(blocks[5].text, 'done');
});

test('ordinary text does not acquire Markdown styling and HTML-looking plain text stays literal', () => {
    assert.equal(parsePisiPlainPaste('2 * 3 ** 4')[0].html, undefined);
    assert.equal(parsePisiPlainPaste('<img src=x onerror=bad()>')[0].text, '<img src=x onerror=bad()>');
});

test('Markdown inline output escapes HTML before supported formatting is applied', () => {
    const item = parsePisiPlainPaste('# **Bold** and <script>bad()</script>')[0];
    assert.match(item.html, /<strong>Bold<\/strong>/);
    assert.doesNotMatch(item.html, /<script>/);
    assert.match(item.html, /&lt;script&gt;/);
});

test('clipboard links allow supported web, mail and anchor destinations only', () => {
    for (const value of ['https://example.com/a?b=1', 'http://example.com', 'mailto:me@example.com', '#blk_target'])
        assert.equal(safePisiPasteHref(value), value);
    for (const value of [
        'javascript:alert(1)',
        'java\nscript:alert(1)',
        'data:text/html,<script>',
        'file:///etc/passwd',
        '//example.com',
        'https://example.com/\u0000'
    ])
        assert.equal(safePisiPasteHref(value), '');
});
