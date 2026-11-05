import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_IMAGE_PICKER_ACCEPT,
    getPisiImageErrorMessage,
    isPisiImageBlockAttributeAllowed,
    isPisiImageElementAttributeAllowed,
    isPisiImageFileTypeAccepted,
    makePisiImageBlockHtml,
    normalizePisiImageWidth,
    parsePisiImageMarkdownLine,
    serializePisiImageMarkdown,
    shouldPisiPasteAsImageFiles
} from '../renderer/editor/pisi-editor-image-policy.mjs';

const reference = `image/${'c'.repeat(64)}.webp`;

test('accepted image types cover PNG, JPEG, GIF, WebP and rasterized SVG', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'IMAGE/PNG']) {
        assert.equal(isPisiImageFileTypeAccepted(type), true, type);
    }
    for (const type of ['image/tiff', 'image/heic', 'application/pdf', '']) assert.equal(isPisiImageFileTypeAccepted(type), false, type);
    assert.match(PISI_IMAGE_PICKER_ACCEPT, /image\/svg\+xml/);
});

test('saved image elements keep the reference and never a runtime src', () => {
    assert.equal(isPisiImageElementAttributeAllowed('data-pisi-image-asset', reference, true), true);
    assert.equal(isPisiImageElementAttributeAllowed('data-pisi-image-asset', 'image/../x.png', true), false);
    assert.equal(isPisiImageElementAttributeAllowed('src', 'blob:file:///x', true), false);
    assert.equal(isPisiImageElementAttributeAllowed('src', 'data:image/png;base64,AAAA', true), false);
    assert.equal(isPisiImageElementAttributeAllowed('src', 'data:image/png;base64,AAAA', false), true);
    assert.equal(isPisiImageElementAttributeAllowed('src', 'javascript:alert(1)', false), false);
    assert.equal(isPisiImageElementAttributeAllowed('data-pisi-image-width', '480', true), true);
    assert.equal(isPisiImageElementAttributeAllowed('data-pisi-image-width', '9999', true), false);
    assert.equal(isPisiImageElementAttributeAllowed('onerror', 'alert(1)', true), false);
    assert.equal(isPisiImageBlockAttributeAllowed('data-pisi-image-align', 'right'), true);
    assert.equal(isPisiImageBlockAttributeAllowed('data-pisi-image-align', 'justify'), false);
    assert.equal(isPisiImageBlockAttributeAllowed('data-pisi-image-block', '1'), true);
    assert.equal(isPisiImageBlockAttributeAllowed('data-pisi-canvas-block', '1'), null);
});

test('image block HTML escapes alt text and normalizes width and alignment', () => {
    const html = makePisiImageBlockHtml({ reference, alt: '"><img src=x onerror=alert(1)>', width: 12, align: 'diagonal', blockId: 'blk_1' });
    assert.equal(
        html,
        `<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="blk_1" data-pisi-block-type="image" data-pisi-image-block="1" ` +
            `data-pisi-image-align="center" contenteditable="false"><img data-pisi-image-asset="${reference}" ` +
            `alt="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-pisi-image-width="40"></div>`
    );
    assert.equal(makePisiImageBlockHtml({ reference: '../x.png' }), '');
    assert.equal(normalizePisiImageWidth('abc'), '');
    assert.equal(normalizePisiImageWidth(99999), '4000');
});

test('image blocks round-trip through the Markdown source view', () => {
    const config = { reference, align: 'right', width: '320', alt: 'Ekran görüntüsü: 100% ölçek }' };
    const markdown = serializePisiImageMarkdown(config);
    assert.match(markdown, /^\{\{pisi-image:image\/c{64}\.webp:right:320:[^}]*\}\}$/);
    assert.deepEqual(parsePisiImageMarkdownLine(markdown), config);
    assert.deepEqual(parsePisiImageMarkdownLine(`{{pisi-image:${reference}:left::}}`), { reference, align: 'left', width: '', alt: '' });
    assert.equal(parsePisiImageMarkdownLine('{{pisi-image:image/../x.png:left::}}'), null);
});

test('clipboard files become image blocks only for image-only pastes', () => {
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: ['image/png'], html: '' }), true);
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: ['image/png'], html: '<meta charset="utf-8"><img src="https://example.com/a.png">' }), true);
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: ['image/png'], html: '<p>Word paragraph</p><img src="x">' }), false);
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: ['image/png'], html: '<div class="pisi-editor-block" data-pisi-block-id="b1"><br></div>' }), false);
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: ['application/pdf'], html: '' }), false);
    assert.equal(shouldPisiPasteAsImageFiles({ fileTypes: [], html: '' }), false);
});

test('image error codes map to user messages with a safe fallback', () => {
    assert.equal(getPisiImageErrorMessage('IMAGE_TOO_LARGE'), 'Görsel 20 MB sınırını aşıyor.');
    assert.equal(getPisiImageErrorMessage('UNKNOWN', 'Özel hata'), 'Özel hata');
    assert.equal(getPisiImageErrorMessage('UNKNOWN'), 'Görsel eklenemedi.');
});
