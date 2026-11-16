import { describe, expect, it } from 'vitest';
import { parseTagAttributes } from '../../shared/html-tokens.mjs';
import { getNotePlainText, splitNoteBlocks } from '../../shared/note-blocks.mjs';
import { inlineToHtml, inlineToText, parseInlineHtml } from '../src/data/note-inline.mjs';
import { applyBlockPatch, makeBlockHtml, makeParagraphBlockHtml, retypeOpenTag, textToBlockHtml } from '../src/data/note-patch.mjs';
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
            ['başlık 4', '<h4 class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="heading4">Alt başlık</h4>'],
            ['alıntı', '<blockquote class="pisi-editor-block" data-pisi-block-id="blk_q" data-pisi-block-type="quote">Söz</blockquote>'],
            ['başlık türü', '<div class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="heading2">Başlık</div>'],
            ['bölüm çizgisi', '<div class="pisi-editor-block pisi-section-break" data-pisi-block-type="paragraph" data-pisi-block-id="blk_hr"><hr></div>'],
            ['biçimli span', paragraph('blk_s', 'Bak: <span style="color:red">kırmızı</span>')],
            ['öznitelikli kalın', paragraph('blk_s', '<b class="x">kalın</b>')],
            ['içinde etiket olan link', paragraph('blk_s', '<a href="https://pisi.app"><b>Pisi</b></a>')],
            ['bilinmeyen entity', paragraph('blk_s', 'caf&eacute;')],
            ['kapalı madde', '<div class="pisi-editor-block pisi-bullet-collapsed" data-pisi-block-id="blk_c" data-pisi-block-type="bullet">Madde</div>'],
            ['bilinmeyen tür', '<div class="pisi-editor-block" data-pisi-block-id="blk_c" data-pisi-block-type="callout">Not</div>'],
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

    it('başlık 1–3, madde ve numaralı liste düzenlenebilir; link içeren paragraf da (M7)', () => {
        const editable = [
            ['heading1', '<h1 class="pisi-editor-block" data-pisi-block-id="blk_1" data-pisi-block-type="heading1">Bir</h1>'],
            ['heading3', '<h3 class="pisi-editor-block" data-pisi-block-id="blk_3">Türü etiketten</h3>'],
            ['bullet', '<div class="pisi-editor-block" data-pisi-block-id="blk_b" data-pisi-block-type="bullet">Madde</div>'],
            [
                'bullet',
                '<div class="pisi-editor-block pisi-bullet-has-children" data-pisi-block-id="blk_b" data-pisi-block-type="bullet" data-pisi-bullet-indent="1" style="--pisi-bullet-indent:1;">İç madde</div>'
            ],
            ['number', '<div class="pisi-editor-block" data-pisi-block-id="blk_n" data-pisi-block-type="number">Bir</div>'],
            [
                'paragraph',
                paragraph(
                    'blk_w',
                    'Bak: <a class="pisi-wiki-link" data-pisi-node-id="node_x" data-pisi-node-title="Hedef" contenteditable="false">Hedef</a> ve <i>eğik</i>&nbsp;'
                )
            ]
        ];
        for (const [type, html] of editable) expect(splitNoteBlocks(html)[0], html).toMatchObject({ editable: true, blockType: type });
    });

    it('görsel, çizim, ayırıcı ve günlük görev bölümü kendi türüyle tanınır', () => {
        const [sheet, canvas, image] = splitNoteBlocks(SHEET + CANVAS + IMAGE);
        expect([sheet.blockType, canvas.asset, image.asset]).toEqual(['sheet', 'paint/bb.png', 'image/cc.png']);
        const diary =
            paragraph('blk_a', 'Sabah') +
            '\n<div class="pisi-editor-block pisi-diary-task-divider pisi-section-break" data-pisi-block-type="paragraph" data-pisi-block-id="blk_d"><hr></div>' +
            '\n<h3 class="pisi-editor-block" data-pisi-block-id="blk_h">Görevler</h3>\n' +
            MANAGED;
        const elements = splitNoteBlocks(diary).filter((segment) => segment.kind === 'element');
        expect(elements.map((segment) => [segment.blockType, segment.editable])).toEqual([
            ['paragraph', true],
            ['divider', false],
            ['diary-heading', false],
            ['diary-managed', false]
        ]);
        expect(elements[3].taskId).toBe('task_1');
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

    it('konumla hedefleme: kimliği olmayan parçanın ardına ve en başa eklenir; kimlik tutmazsa reddedilir', () => {
        const segments = splitNoteBlocks(NOTE);
        const sheetAt = segments.findIndex((segment) => segment.blockType === 'sheet');
        const first = makeBlockHtml('heading2', 'blk_h', 'Başlık');
        const afterSheet = makeBlockHtml('bullet', 'blk_m', 'Madde', { indent: 2 });
        expect(first).toBe('<h2 class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="heading2">Başlık</h2>');
        expect(afterSheet).toBe(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_m" data-pisi-block-type="bullet" data-pisi-bullet-indent="2" style="--pisi-bullet-indent:2;">Madde</div>'
        );
        const patched = applyBlockPatch(NOTE, [
            { op: 'insert', afterIndex: -1, html: first },
            { op: 'insert', afterIndex: sheetAt, html: afterSheet },
            { op: 'replace', index: 1, blockId: 'blk_b', html: 'düz' }
        ]);
        expect(patched).toBe(
            first +
                NOTE.replace(SHEET, SHEET + afterSheet).replace(paragraph('blk_b', '<strong>Kalın</strong> ve düz<br>ikinci satır'), paragraph('blk_b', 'düz'))
        );
        expect(() => applyBlockPatch(NOTE, [{ op: 'replace', index: 0, blockId: 'blk_b', html: 'x' }])).toThrow(
            expect.objectContaining({ code: 'BLOCK_NOT_FOUND' })
        );
        expect(() => applyBlockPatch(NOTE, [{ op: 'replace', index: sheetAt, html: 'x' }])).toThrow(expect.objectContaining({ code: 'BLOCK_PROTECTED' }));
        expect(() => applyBlockPatch(NOTE, [{ op: 'remove', index: 99 }])).toThrow(expect.objectContaining({ code: 'BLOCK_NOT_FOUND' }));
        expect(() => makeBlockHtml('quote', 'blk_q', 'x')).toThrow(expect.objectContaining({ code: 'UNKNOWN_BLOCK_TYPE' }));
    });

    it('tür değişince etiket ve tür özniteliği masaüstü biçimine geçer; kimlik ve diğer öznitelikler kalır', () => {
        const retyped = applyBlockPatch(NOTE, [{ op: 'replace', blockId: 'blk_a', type: 'heading2' }]);
        expect(retyped).toBe(
            NOTE.replace(
                paragraph('blk_a', 'Gündem'),
                '<h2 class="pisi-editor-block" data-pisi-block-id="blk_a" data-pisi-block-type="heading2" data-pisi-section-level="0">Gündem</h2>'
            )
        );
        expect(splitNoteBlocks(retyped)[0]).toMatchObject({ editable: true, blockType: 'heading2', tag: 'h2' });
        // Aynı tür: açılış etiketi karakter karakter aynı kalır.
        expect(applyBlockPatch(NOTE, [{ op: 'replace', blockId: 'blk_a', type: 'paragraph' }])).toBe(NOTE);

        const item =
            '<div class="pisi-editor-block pisi-bullet-has-children" data-pisi-block-id="blk_i" data-pisi-block-type="bullet" data-pisi-bullet-indent="1" style="--pisi-bullet-indent:1;">Madde</div>';
        expect(retypeOpenTag(splitNoteBlocks(item)[0].openTag, 'number')).toBe(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_i" data-pisi-block-type="number">'
        );
        expect(retypeOpenTag('<h3 class="pisi-editor-block" data-pisi-block-id="blk_3" title="a > b">', 'bullet')).toBe(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_3" data-pisi-block-type="bullet" title="a > b">'
        );
        expect(() => applyBlockPatch(NOTE, [{ op: 'replace', blockId: 'blk_a', type: 'code' }])).toThrow(
            expect.objectContaining({ code: 'UNKNOWN_BLOCK_TYPE' })
        );
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

describe('satır içi içerik', () => {
    const LINK = '<a class="pisi-wiki-link" data-pisi-node-id="node_x" data-pisi-node-title="A &amp; B" contenteditable="false">A &amp; B</a>';

    it('düzenlenebilir bloğun içi okunup aynen geri yazılır; link karakter karakter korunur', () => {
        for (const inner of [
            'düz metin',
            'a &lt; b &amp; c&nbsp;',
            '<strong>Kalın</strong> ve <i>eğik <u>altı çizili</u></i><br>ikinci satır',
            `Bak: ${LINK} ve <b>${LINK}</b>`,
            'satır<br><br>',
            '<br>'
        ]) {
            expect(inlineToHtml(parseInlineHtml(inner)), inner).toBe(inner);
        }
        const nodes = parseInlineHtml(`Bak: ${LINK}<br>son`);
        expect(nodes[1]).toMatchObject({ type: 'link', html: LINK, text: 'A & B', attributes: { 'data-pisi-node-id': 'node_x', class: 'pisi-wiki-link' } });
        expect(inlineToText(nodes)).toBe('Bak: A & B\nson');
    });

    it('boş içerik tek <br> olur; boş biçim etiketi yazılmaz; no-break space korunur', () => {
        expect(inlineToHtml([])).toBe('<br>');
        expect(
            inlineToHtml([
                { type: 'format', tag: 'b', children: [] },
                { type: 'text', text: 'a\u00a0b' }
            ])
        ).toBe('a&nbsp;b');
        expect(parseInlineHtml('&#305;&#x131;&bilinmez;')[0].text).toBe('ıı&bilinmez;');
    });

    it('tanımadığı etiketleri atar, metinlerini tutar (korumalı blokların gösterimi)', () => {
        const nodes = parseInlineHtml('<span class="pisi-todo-source">Raporu gönder</span> <span class="pisi-user-tag">todo.2</span><!-- not -->');
        expect(inlineToText(nodes)).toBe('Raporu gönder todo.2');
        expect(inlineToText(parseInlineHtml('yarım <a href="x">link'))).toBe('yarım link');
    });
});
