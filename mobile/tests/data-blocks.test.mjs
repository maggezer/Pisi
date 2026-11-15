import { describe, expect, it } from 'vitest';
import { applyBlockPatch, getNotePlainText, makeParagraphBlockHtml, parseTagAttributes, splitNoteBlocks, textToBlockHtml } from '../src/data/note-blocks.mjs';
import { paragraph } from './data-helpers.mjs';

// Shapes copied from notes the desktop app wrote (tests/fixtures/desktop-project).
const SHEET =
    '<div class="pisi-sheet-block" contenteditable="false" data-pisi-composite-align="center"><table class="pisi-sheet-table" data-pisi-sheet="1" data-pisi-sheet-asset="sheet/aa.json"><tbody><tr><th>1</th><td data-cell="A1">Kalem</td></tr></tbody></table></div>';
const CANVAS =
    '<div class="pisi-canvas-block" contenteditable="false" data-pisi-canvas-block="1"><canvas data-pisi-canvas="1" width="240" height="160" data-pisi-asset="paint/bb.png"></canvas></div>';
const IMAGE =
    '<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="blk_img" data-pisi-block-type="image" contenteditable="false"><img data-pisi-image-asset="image/cc.png" alt=""></div>';
const FILE =
    '<div class="pisi-editor-block pisi-file-block" data-pisi-block-id="blk_file" data-pisi-block-type="file" data-pisi-file-asset="file/dd.pdf" data-pisi-file-name="a &gt; b.pdf" contenteditable="false"><span class="pisi-file-name">a &gt; b.pdf</span></div>';
const TASK =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_task"><span class="pisi-todo-source" data-pisi-todo-for="todo.2.none">Raporu gönder</span> <span class="pisi-user-tag" data-pisi-tag="todo.2.none" contenteditable="false">todo.2.none</span></div>';
const MANAGED =
    '<!--PISI_DIARY_MANAGED_START-->\n<div class="pisi-diary-managed-block" data-pisi-task-id="task_1">\n    <span class="pisi-diary-task-text">Egzersiz</span>\n</div>\n<!--PISI_DIARY_MANAGED_END-->';
const NOTE = [
    paragraph('blk_a', 'Gündem'),
    paragraph('blk_b', '<strong>Kalın</strong> ve düz<br>ikinci satır'),
    SHEET,
    CANVAS,
    IMAGE,
    FILE,
    TASK,
    '\n',
    MANAGED
].join('');

const summary = (html) => splitNoteBlocks(html).map((segment) => [segment.kind, segment.blockType ?? '', segment.editable]);

describe('not blokları', () => {
    it('içeriği üst düzey parçalara böler; parçalar birleşince aynı metni verir', () => {
        const segments = splitNoteBlocks(NOTE);
        expect(segments.map((segment) => segment.html).join('')).toBe(NOTE);
        expect(summary(NOTE)).toEqual([
            ['element', 'paragraph', true],
            ['element', 'paragraph', true],
            ['element', 'sheet', false],
            ['element', 'canvas', false],
            ['element', 'image', false],
            ['element', 'file', false],
            ['element', 'task', false],
            ['text', '', false],
            ['comment', '', false],
            ['text', '', false],
            ['element', 'diary-managed', false],
            ['text', '', false],
            ['comment', '', false]
        ]);
        expect(segments[1]).toMatchObject({ blockId: 'blk_b', tag: 'div', inner: '<strong>Kalın</strong> ve düz<br>ikinci satır', closeTag: '</div>' });
        expect(segments[5].attributes['data-pisi-file-name']).toBe('a > b.pdf');
    });

    it('mobilin düzenleyemediği blokları korumalı sayar', () => {
        const protectedBlocks = [
            ['başlık', '<h3 class="pisi-editor-block" data-pisi-block-id="blk_h">Görevler</h3>'],
            ['başlık türü', '<div class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="heading2">Başlık</div>'],
            ['bölüm çizgisi', '<div class="pisi-editor-block pisi-section-break" data-pisi-block-type="paragraph" data-pisi-block-id="blk_hr"><hr></div>'],
            ['wiki-link', paragraph('blk_w', 'Bak: <a class="pisi-wiki-link" data-pisi-node-id="node_x" contenteditable="false">Hedef</a>')],
            ['kimliksiz', '<div class="pisi-editor-block">metin</div>'],
            ['bilinmeyen öğe', '<section data-future="1">yeni blok türü</section>'],
            ['rollup', '<div class="pisi-editor-block" data-pisi-block-id="blk_r" data-pisi-block-type="rollup">3</div>'],
            ['sınıfsız div', '<div><br></div>']
        ];
        for (const [name, html] of protectedBlocks) expect(splitNoteBlocks(html)[0].editable, name).toBe(false);
        expect(splitNoteBlocks('<div class="pisi-editor-block" data-pisi-block-id="blk_m"><br></div>')[0]).toMatchObject({
            editable: true,
            blockType: 'paragraph'
        });
    });

    it('izlenemeyen HTML tek korumalı parça olur, hiçbir yaması uygulanmaz', () => {
        for (const broken of [
            '<div class="pisi-editor-block" data-pisi-block-id="blk_a">açık kaldı',
            '<div><span></div></span>',
            '<div title="kapanmayan>x</div>',
            '<!-- yarım'
        ]) {
            const segments = splitNoteBlocks(broken);
            expect(segments).toHaveLength(1);
            expect(segments[0]).toMatchObject({ html: broken, editable: false });
        }
        expect(() =>
            applyBlockPatch('<div class="pisi-editor-block" data-pisi-block-id="blk_a">açık', [{ op: 'replace', blockId: 'blk_a', html: 'x' }])
        ).toThrow(/Block not found/);
        expect(splitNoteBlocks('')).toEqual([]);
        expect(splitNoteBlocks('3 < 5 düz metin')[0]).toMatchObject({ kind: 'text', html: '3 < 5 düz metin' });
    });

    it('öznitelik değerindeki > işareti etiketi bitirmez', () => {
        const html = '<div class="pisi-editor-block" data-pisi-block-id="blk_q" title="a > b">metin</div>';
        expect(splitNoteBlocks(html)[0]).toMatchObject({ inner: 'metin', blockId: 'blk_q' });
        expect(parseTagAttributes(`<img alt='tek "tırnak"' data-x=5 hidden>`)).toEqual({ alt: 'tek "tırnak"', 'data-x': '5', hidden: '' });
    });

    it('replace yalnız hedef bloğun içini değiştirir; diğer her şey karakter karakter aynı kalır (V8)', () => {
        const patched = applyBlockPatch(NOTE, [{ op: 'replace', blockId: 'blk_a', html: 'Yeni gündem' }]);
        expect(patched).toBe(NOTE.replace(paragraph('blk_a', 'Gündem'), paragraph('blk_a', 'Yeni gündem')));
        expect(applyBlockPatch(NOTE, [])).toBe(NOTE);
    });

    it('insert ve remove blok ekler ve siler', () => {
        const added = makeParagraphBlockHtml('blk_new', textToBlockHtml('a < b\nikinci'));
        expect(added).toBe('<div class="pisi-editor-block" data-pisi-block-id="blk_new" data-pisi-block-type="paragraph">a &lt; b<br>ikinci</div>');
        const afterSheet = applyBlockPatch(NOTE, [
            { op: 'insert', afterBlockId: 'blk_img', html: added },
            { op: 'remove', blockId: 'blk_b' },
            { op: 'insert', afterBlockId: null, html: paragraph('blk_end', 'son') }
        ]);
        expect(afterSheet).toBe(
            NOTE.replace(paragraph('blk_b', '<strong>Kalın</strong> ve düz<br>ikinci satır'), '').replace(IMAGE, IMAGE + added) + paragraph('blk_end', 'son')
        );
        expect(textToBlockHtml('')).toBe('<br>');
    });

    it('korumalı ya da olmayan bloğu hedefleyen yama hiçbir şeyi değiştirmeden reddedilir', () => {
        for (const blockId of ['blk_img', 'blk_file', 'blk_task']) {
            expect(
                () =>
                    applyBlockPatch(NOTE, [
                        { op: 'replace', blockId: 'blk_a', html: 'x' },
                        { op: 'replace', blockId, html: 'x' }
                    ]),
                blockId
            ).toThrow(expect.objectContaining({ code: 'BLOCK_PROTECTED' }));
            expect(() => applyBlockPatch(NOTE, [{ op: 'remove', blockId }])).toThrow(expect.objectContaining({ code: 'BLOCK_PROTECTED' }));
        }
        expect(() => applyBlockPatch(NOTE, [{ op: 'replace', blockId: 'blk_yok', html: 'x' }])).toThrow(expect.objectContaining({ code: 'BLOCK_NOT_FOUND' }));
        expect(() => applyBlockPatch(NOTE, [{ op: 'sil', blockId: 'blk_a' }])).toThrow(expect.objectContaining({ code: 'UNKNOWN_OPERATION' }));
    });

    it('düz metin bloklar arasında satır sonu bırakır ve yönetilen görev bölümünü atlar (G7)', () => {
        expect(getNotePlainText(NOTE)).toBe('Gündem\nKalın ve düz\nikinci satır\n1Kalem\na > b.pdf\nRaporu gönder todo.2.none');
        expect(getNotePlainText(paragraph('a', 'Gündem') + paragraph('b', 'Mobil &amp; masaüstü'))).toBe('Gündem\nMobil & masaüstü');
    });
});
