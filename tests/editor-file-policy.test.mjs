import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatPisiFileSize,
    getPisiFileKind,
    isPisiFileBlockAttributeAllowed,
    isPisiFileReference,
    makePisiFileBlockHtml,
    parsePisiFileMarkdownLine,
    serializePisiFileMarkdown,
    splitPisiDroppedFiles
} from '../renderer/editor/pisi-editor-file-policy.mjs';

const reference = `file/${'a'.repeat(64)}.pdf`;

test('file references accept only sidecar file assets', () => {
    assert.equal(isPisiFileReference(reference), true);
    assert.equal(isPisiFileReference(`file/${'a'.repeat(64)}.tar`), true);
    for (const value of [`image/${'a'.repeat(64)}.png`, `file/../${'a'.repeat(64)}.pdf`, `file/${'a'.repeat(64)}.PDF`, 'file/x.pdf', '']) {
        assert.equal(isPisiFileReference(value), false, value);
    }
});

test('kinds choose the icon and executables are recognized', () => {
    assert.equal(getPisiFileKind('PDF'), 'pdf');
    assert.equal(getPisiFileKind('xlsx'), 'sheet');
    assert.equal(getPisiFileKind('7z'), 'archive');
    assert.equal(getPisiFileKind('exe'), 'executable');
    assert.equal(getPisiFileKind('sh'), 'executable');
    assert.equal(getPisiFileKind('xyz'), 'file');
});

test('sizes are formatted and bounded', () => {
    assert.equal(formatPisiFileSize(512), '512 B');
    assert.equal(formatPisiFileSize(2048), '2 KB');
    assert.equal(formatPisiFileSize(5 * 1024 * 1024 + 1), '5.0 MB');
    assert.equal(formatPisiFileSize(-1), '0 B');
    assert.equal(formatPisiFileSize(21 * 1024 * 1024), '0 B');
});

test('block markup escapes the name and the sanitizer accepts only valid attachment attributes', () => {
    const html = makePisiFileBlockHtml({ reference, name: 'Rapor "<b>".pdf', size: 2048, blockId: 'blk_1' });
    assert.match(html, /data-pisi-block-type="file" data-pisi-file-block="1"/);
    assert.match(html, /data-pisi-file-name="Rapor &quot;&lt;b&gt;&quot;\.pdf"/);
    assert.match(html, /data-pisi-file-kind="pdf"/);
    assert.match(html, /<span class="pisi-file-name">Rapor &quot;&lt;b&gt;&quot;\.pdf<\/span><span class="pisi-file-size">2 KB<\/span>/);
    assert.equal(makePisiFileBlockHtml({ reference: 'file/../x.pdf', name: 'x' }), '');

    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-block', '1'), true);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-asset', reference), true);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-asset', 'file/../x.pdf'), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-name', 'a\nb'), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-name', 'x'.repeat(256)), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-size', '2048'), true);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-size', '-1'), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-size', '999999999'), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-kind', 'pdf'), true);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-file-kind', 'evil'), false);
    assert.equal(isPisiFileBlockAttributeAllowed('data-pisi-image-align', 'left'), null);
});

test('attachments round-trip through the Markdown source view', () => {
    const markdown = serializePisiFileMarkdown({ reference, name: 'Bütçe: Q3}.pdf', size: '4096' });
    assert.equal(markdown, `{{pisi-file:${reference}:4096:${encodeURIComponent('Bütçe: Q3}.pdf')}}}`);
    assert.deepEqual(parsePisiFileMarkdownLine(markdown), { reference, size: 4096, name: 'Bütçe: Q3}.pdf' });
    assert.equal(parsePisiFileMarkdownLine('{{pisi-file:file/../x.pdf:1:x}}'), null);
    assert.equal(serializePisiFileMarkdown({ reference: 'bad', name: 'x' }), '');
});

test('dropped files split into image blocks and attachments', () => {
    const files = [
        { name: 'a.png', type: 'image/png' },
        { name: 'b.pdf', type: 'application/pdf' },
        { name: 'c.svg', type: 'image/svg+xml' },
        { name: 'd', type: '' },
        null
    ];
    const { images, attachments } = splitPisiDroppedFiles(files);
    assert.deepEqual(
        images.map((file) => file.name),
        ['a.png', 'c.svg']
    );
    assert.deepEqual(
        attachments.map((file) => file.name),
        ['b.pdf', 'd']
    );
});
