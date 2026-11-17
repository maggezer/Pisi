import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { PISI_NOTE_SAVE_DELAY_MS } from '../src/screens/notes/note.mjs';
import { NOW, TODAY, createMemoryProject, noteFile, paragraph, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

// Masaüstünün yazdığı biçimler (tests/fixtures/desktop-project).
const SHEET =
    '<div class="pisi-sheet-block" contenteditable="false" data-pisi-composite-align="center"><table class="pisi-sheet-table" data-pisi-sheet="1" data-pisi-sheet-asset="sheet/aa.json"><tbody><tr><th>1</th><td data-cell="A1">Kalem</td></tr></tbody></table></div>';
const IMAGE =
    '<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="blk_img" data-pisi-block-type="image" contenteditable="false"><img data-pisi-image-asset="image/cc.png" alt=""></div>';
const FILE =
    '<div class="pisi-editor-block pisi-file-block" data-pisi-block-id="blk_file" data-pisi-block-type="file" data-pisi-file-name="Rapor.pdf" contenteditable="false"><span class="pisi-file-name">Rapor.pdf</span></div>';
const QUOTE = '<blockquote class="pisi-editor-block" data-pisi-block-id="blk_q" data-pisi-block-type="quote">Söz uçar</blockquote>';
const TASK =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_task"><span class="pisi-todo-source" data-pisi-todo-for="todo.2.none">Raporu gönder</span> <span class="pisi-user-tag" data-pisi-tag="todo.2.none" data-pisi-todo-status="todo" contenteditable="false">todo.2.none</span></div>';
const LINK = '<a class="pisi-wiki-link" data-pisi-node-id="node_hedef" data-pisi-node-title="Hedef" contenteditable="false">Hedef</a>';
const HEADING = '<h2 class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="heading2" data-pisi-section-level="2">Kararlar</h2>';
const BULLET = '<div class="pisi-editor-block" data-pisi-block-id="blk_m" data-pisi-block-type="bullet">Madde</div>';

const CONTENT = [
    paragraph('blk_a', 'Gündem'),
    SHEET,
    paragraph('blk_b', `Bak: ${LINK} ve <b>kalın</b>`),
    IMAGE,
    FILE,
    QUOTE,
    TASK,
    HEADING,
    BULLET,
    '\n<!-- yorum -->'
].join('');
const TASKS = [
    {
        id: 'task_source_1',
        title: 'Raporu gönder',
        status: 'todo',
        priority: 2,
        dueDate: null,
        scheduledAt: null,
        deadline: null,
        reminderAt: null,
        reminderMode: 'none',
        repeat: 'none',
        manualOrder: 1,
        todoTag: 'todo.2.none',
        source: { nodePath: 'Toplantı.node', blockId: 'blk_task', mapPath: null, nodeTitle: 'Toplantı', mapTitle: '' }
    }
];
const FILES = {
    '.pisi/tasks.json': storeJson({ version: 1, updatedAt: null, tasks: TASKS }),
    'Toplantı.node': noteFile({ id: 'node_t', title: 'Toplantı', content: CONTENT, extra: { properties: { durum: { id: 'durum', value: 'açık' } } } }),
    'Hedef.node': noteFile({ id: 'node_hedef', title: 'Hedef', content: paragraph('blk_h1', 'Hedef notu') }),
    'Boş.node': noteFile({ id: 'node_b', title: 'Boş', content: '' })
};

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const blocks = () => all('.pisi-note-editor > .pisi-note-block');
const blockTexts = () => blocks().map((block) => `${block.dataset.type}:${block.textContent}`);
const snackbar = () => $('.pisi-snackbar-message')?.textContent ?? null;
const settle = () => vi.advanceTimersByTimeAsync(0);
const afterSave = () => vi.advanceTimersByTimeAsync(PISI_NOTE_SAVE_DELAY_MS + 1);
const stored = (driver, key = 'Toplantı.node') => JSON.parse(driver.snapshot()[key]);
const writes = (driver, key = 'Toplantı.node') => driver.calls.filter(([name, , to]) => name === 'rename' && to === key).length;

async function start({ files = FILES, note = { path: 'Toplantı.node', title: 'Toplantı' } } = {}) {
    const platform = createFakePlatform();
    const memory = createMemoryProject(files);
    const errors = [];
    app = createApp({
        root,
        platform,
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage: 'tr-TR',
        project: memory.project,
        now: () => new Date(NOW),
        onError: (error) => errors.push(error)
    });
    await app.ready;
    if (note) {
        app.router.selectTab('notes');
        app.router.openNote(note);
        await settle();
    }
    return { ...memory, platform, errors };
}

/** Caret inside `block`: at `offset` of its first text node, or at its start. */
function caretIn(block, offset = 0) {
    block.focus();
    const range = document.createRange();
    const text = [...block.childNodes].find((node) => node.nodeType === 3);
    if (text) range.setStart(text, Math.min(offset, text.nodeValue.length));
    else range.setStart(block, 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

function type(block, text) {
    block.focus();
    block.textContent = text;
    block.dispatchEvent(new Event('input', { bubbles: true }));
}

const press = (block, inputType) => block.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
const tool = (id) => $(`[data-tool="${id}"]`);

beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.append(root);
});

afterEach(() => {
    app?.destroy();
    app = null;
    root.remove();
    vi.useRealTimers();
});

describe('Not ekranı: görünüm', () => {
    it('düzenlenebilen bloklar alan, diğerleri "Masaüstünde düzenlenir" kartı olur', async () => {
        const { driver, errors } = await start();
        expect($('.pisi-header-title').textContent).toBe('Toplantı');
        expect($('[data-screen="note"]').dataset.state).toBe('ready');
        expect(blockTexts()).toEqual(['paragraph:Gündem', 'paragraph:Bak: Hedef ve kalın', 'heading2:Kararlar', 'bullet:Madde']);
        expect(blocks().every((block) => block.getAttribute('contenteditable') === 'true' && block.getAttribute('aria-label'))).toBe(true);
        expect(all('.pisi-note-protected').map((card) => [card.dataset.protected, card.querySelector('.pisi-note-protected-caption').textContent])).toEqual([
            ['sheet', 'Tablo · Masaüstünde düzenlenir'],
            ['image', 'Görsel · Masaüstünde düzenlenir'],
            ['file', 'Dosya · Masaüstünde düzenlenir'],
            ['quote', 'Alıntı · Masaüstünde düzenlenir']
        ]);
        expect($('[data-protected="file"] .pisi-note-protected-text').textContent).toBe('Rapor.pdf');
        expect($('[data-protected="quote"] .pisi-note-protected-text').textContent).toBe('Söz uçar');
        // Ekranın kendi işaretleri dosyaya ait değil; açmak hiçbir şey yazmaz (V4).
        await afterSave();
        expect(writes(driver)).toBe(0);
        expect(driver.snapshot()['Toplantı.node']).toBe(FILES['Toplantı.node']);
        expect(errors).toEqual([]);
    });

    it('görsel sidecar klasöründen okunur ve data: adresiyle gösterilir', async () => {
        const memory = createMemoryProject(FILES);
        memory.driver.putBase64('inv_Toplantı__node_t/image/cc.png', 'iVBORw0KGgo=');
        app = createApp({
            root,
            platform: createFakePlatform(),
            storage: createFakeStorage(),
            systemTheme: createFakeSystemTheme(),
            deviceLanguage: 'tr-TR',
            project: memory.project,
            now: () => new Date(NOW)
        });
        await app.ready;
        app.router.openNote({ path: 'Toplantı.node', title: 'Toplantı' });
        await settle();
        expect($('[data-protected="image"] img').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(memory.driver.snapshot()['Toplantı.node']).toBe(FILES['Toplantı.node']);
    });

    it('sidecar görseli yoksa kart bunu söyler', async () => {
        await start();
        expect($('[data-protected="image"] .pisi-note-protected-text').textContent).toBe('Görsel gösterilemiyor.');
    });

    it('görev bloğu görev satırıdır: durumu tasks.json’dan gelir, kutu TaskRepo üzerinden değiştirir, not dosyası değişmez', async () => {
        const { driver } = await start();
        const row = $('.pisi-note-task .pisi-task');
        expect(row.dataset.task).toBe('task_source_1');
        expect(row.querySelector('.pisi-task-title').textContent).toBe('Raporu gönder');
        row.querySelector('[data-task-toggle]').click();
        await settle();
        expect(JSON.parse(driver.snapshot()['.pisi/tasks.json']).tasks[0].status).toBe('done');
        expect($('.pisi-note-task .pisi-task').classList.contains('pisi-task-done')).toBe(true);
        expect(driver.snapshot()['Toplantı.node']).toBe(FILES['Toplantı.node']);

        $('.pisi-note-task [data-task-open]').click();
        expect($('[role="dialog"] [data-task-field="status"] .pisi-row-value').textContent).toBe('Tamamlandı');
    });

    it('wiki-link’e dokununca hedef not açılır; hedefi olmayan link bildirilir', async () => {
        await start();
        $('.pisi-note-link').click();
        await settle();
        expect(app.router.getState().note).toEqual({ path: 'Hedef.node', title: 'Hedef' });
        expect($('.pisi-header-title').textContent).toBe('Hedef');
        expect(blockTexts()).toEqual(['paragraph:Hedef notu']);

        app.destroy();
        const missing = {
            ...FILES,
            'Toplantı.node': noteFile({ id: 'node_t', title: 'Toplantı', content: paragraph('blk_b', LINK.replace('node_hedef', 'node_yok')) })
        };
        await start({ files: missing });
        $('.pisi-note-link').click();
        expect(snackbar()).toBe('Bağlantının gösterdiği not bulunamadı.');
    });

    it('olmayan not ve okunamayan not açıkça söylenir; okunamayan dosya ezilmez (V7)', async () => {
        const files = { ...FILES, 'Bozuk.node': '{ "pisi": ' };
        const { driver } = await start({ files, note: { path: 'Yok.node', title: 'Yok' } });
        expect($('[data-screen="note"] .pisi-empty-title').textContent).toBe('Bu not bulunamadı.');
        app.router.openNote({ path: 'Bozuk.node', title: 'Bozuk' });
        await settle();
        expect($('[data-screen="note"] .pisi-empty-title').textContent).toBe('Bu notun dosyası okunamadı; değiştirilmeyecek.');
        expect(driver.snapshot()['Bozuk.node']).toBe('{ "pisi": ');
    });

    it('yalnız başlığı bilinen not (görevin kaynağı) başlığıyla bulunur', async () => {
        await start({ note: { path: null, title: 'Hedef' } });
        expect(blockTexts()).toEqual(['paragraph:Hedef notu']);
    });
});

describe('Not ekranı: düzenleme ve kayıt', () => {
    it('tek blok düzenlenince yalnız o blok değişir; diğer her şey karakter karakter aynı kalır (V8)', async () => {
        const { driver } = await start();
        type(blocks()[0], 'Yeni gündem & <konu>');
        expect(writes(driver)).toBe(0);
        await afterSave();
        const after = stored(driver);
        const before = JSON.parse(FILES['Toplantı.node']);
        expect(after.content).toBe(CONTENT.replace(paragraph('blk_a', 'Gündem'), paragraph('blk_a', 'Yeni gündem &amp; &lt;konu&gt;')));
        expect(after).toEqual({ ...before, pisi: { ...before.pisi, updatedAt: NOW.toISOString() }, content: after.content });
        expect(writes(driver)).toBe(1);
        // Ekrandaki sınıf ve öznitelikler dosyaya geçmez (V2).
        expect(after.content).not.toMatch(/pisi-note-|data-type|aria-|role=|spellcheck/);

        // Aynı metin yeniden "yazılırsa" dosya yazılmaz (V4).
        type(blocks()[0], 'Yeni gündem & <konu>');
        await afterSave();
        expect(writes(driver)).toBe(1);
    });

    it('link içeren paragraf düzenlenince link karakter karakter korunur', async () => {
        const { driver } = await start();
        const block = blocks()[1];
        block.firstChild.nodeValue = 'Oku: ';
        block.dispatchEvent(new Event('input', { bubbles: true }));
        await afterSave();
        expect(stored(driver).content).toContain(paragraph('blk_b', `Oku: ${LINK} ve <b>kalın</b>`));
    });

    it('Enter bloğu imleçten böler; yeni blok masaüstü biçiminde ve doğru yerde yazılır', async () => {
        const { driver } = await start();
        const first = blocks()[0];
        caretIn(first, 3);
        expect(press(first, 'insertParagraph')).toBe(false);
        expect(blockTexts().slice(0, 2)).toEqual(['paragraph:Gün', 'paragraph:dem']);
        expect(document.activeElement).toBe(blocks()[1]);
        await afterSave();
        const added = '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000001" data-pisi-block-type="paragraph">dem</div>';
        expect(stored(driver).content).toBe(CONTENT.replace(paragraph('blk_a', 'Gündem'), paragraph('blk_a', 'Gün') + added));
        expect(writes(driver)).toBe(1);

        // Kayıttan sonra yeni blok artık dosyadaki bloktur: düzenlemesi ekleme değil değiştirmedir.
        type(blocks()[1], 'dem!');
        await afterSave();
        expect(stored(driver).content).toBe(CONTENT.replace(paragraph('blk_a', 'Gündem'), paragraph('blk_a', 'Gün') + added.replace('dem', 'dem!')));
    });

    it('kimliği olmayan Sheet bloğunun ardına eklenen blok Sheet’ten hemen sonra yazılır', async () => {
        const { driver } = await start({
            files: { ...FILES, 'Toplantı.node': noteFile({ id: 'node_t', title: 'Toplantı', content: paragraph('blk_a', 'Gündem') + SHEET }) }
        });
        expect(blockTexts()).toEqual(['paragraph:Gündem']);
        $('[data-action="write-at-end"]').click();
        expect(blockTexts()).toEqual(['paragraph:Gündem', 'paragraph:']);
        // Hiçbir şey yazılmamış boş satır kaydedilmez.
        await afterSave();
        expect(writes(driver)).toBe(0);
        type(blocks()[1], 'Tablodan sonra');
        await afterSave();
        expect(stored(driver).content).toBe(
            `${paragraph('blk_a', 'Gündem')}${SHEET}<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000001" data-pisi-block-type="paragraph">Tablodan sonra</div>`
        );
    });

    it('liste: Enter yeni madde açar, boş maddede Enter listeyi bitirir; başlıktan sonra paragraf gelir', async () => {
        await start();
        const bullet = blocks()[3];
        caretIn(bullet, 5);
        press(bullet, 'insertParagraph');
        expect(blockTexts().slice(3)).toEqual(['bullet:Madde', 'bullet:']);
        press(blocks()[4], 'insertParagraph');
        expect(blockTexts().slice(3)).toEqual(['bullet:Madde', 'paragraph:']);

        const heading = blocks()[2];
        caretIn(heading, 8);
        press(heading, 'insertParagraph');
        expect(blockTexts().slice(2, 4)).toEqual(['heading2:Kararlar', 'paragraph:']);
    });

    it('satır başında silme: başlık ve madde paragrafa döner, paragraf üstteki düzenlenebilir blokla birleşir; korumalı blok silinmez', async () => {
        const { driver } = await start();
        const heading = blocks()[2];
        caretIn(heading, 0);
        expect(press(heading, 'deleteContentBackward')).toBe(false);
        expect(blockTexts()[2]).toBe('paragraph:Kararlar');
        // Üstünde görev satırı (korumalı) var: birleşmez, hiçbir şey silinmez.
        press(blocks()[2], 'deleteContentBackward');
        expect(blockTexts()).toHaveLength(4);
        expect($('.pisi-note-task')).not.toBe(null);

        const bullet = blocks()[3];
        caretIn(bullet, 0);
        press(bullet, 'deleteContentBackward');
        caretIn(blocks()[3], 0);
        press(blocks()[3], 'deleteContentBackward');
        expect(blockTexts()).toEqual(['paragraph:Gündem', 'paragraph:Bak: Hedef ve kalın', 'paragraph:KararlarMadde']);
        await afterSave();
        expect(stored(driver).content).toBe(
            CONTENT.replace(
                HEADING,
                '<div class="pisi-editor-block" data-pisi-block-id="blk_h" data-pisi-block-type="paragraph" data-pisi-section-level="2">KararlarMadde</div>'
            ).replace(BULLET, '')
        );
        // İmleç satır ortasındayken silme tarayıcıya bırakılır.
        caretIn(blocks()[0], 2);
        expect(press(blocks()[0], 'deleteContentBackward')).toBe(true);
    });

    it('araç çubuğu odakla görünür; başlık düğmesi H1→H2→H3→paragraf döner, liste düğmeleri türü değiştirir', async () => {
        const { driver } = await start();
        expect($('.pisi-note-toolbar').hidden).toBe(true);
        caretIn(blocks()[0], 0);
        expect($('.pisi-note-toolbar').hidden).toBe(false);
        expect(all('.pisi-note-tool').map((button) => button.getAttribute('aria-label'))).toEqual([
            'Kalın',
            'İtalik',
            'Başlık',
            'Madde listesi',
            'Numaralı liste'
        ]);
        expect(all('.pisi-note-tool svg')).toHaveLength(5);

        tool('heading').click();
        expect(blocks()[0].dataset.type).toBe('heading1');
        expect(tool('heading').getAttribute('aria-pressed')).toBe('true');
        expect(tool('heading').getAttribute('aria-label')).toBe('Başlık 1');
        expect(tool('bold').disabled).toBe(true);
        tool('heading').click();
        tool('heading').click();
        expect(blocks()[0].dataset.type).toBe('heading3');
        await afterSave();
        expect(stored(driver).content).toContain(
            '<h3 class="pisi-editor-block" data-pisi-block-id="blk_a" data-pisi-block-type="heading3" data-pisi-section-level="0">Gündem</h3>'
        );
        tool('heading').click();
        expect(blocks()[0].dataset.type).toBe('paragraph');
        tool('number').click();
        expect(tool('number').getAttribute('aria-pressed')).toBe('true');
        tool('bullet').click();
        expect(blocks()[0].dataset.type).toBe('bullet');
        tool('bullet').click();
        await afterSave();
        expect(stored(driver).content).toBe(CONTENT);
    });

    it('boş not: ipucu görünür, hiçbir şey yazmadan çıkınca dosya yazılmaz; ilk yazı ilk paragrafı oluşturur', async () => {
        const { driver } = await start({ note: { path: 'Boş.node', title: 'Boş' } });
        expect(blocks()).toHaveLength(1);
        expect(blocks()[0].dataset.placeholder).toBe('Yazmaya başla…');
        await afterSave();
        app.handleBack();
        await settle();
        expect(writes(driver, 'Boş.node')).toBe(0);

        app.router.openNote({ path: 'Boş.node', title: 'Boş' });
        await settle();
        type(blocks()[0], 'İlk satır');
        expect(blocks()[0].dataset.placeholder).toBeUndefined();
        await afterSave();
        expect(stored(driver, 'Boş.node').content).toBe(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_00000000-0000-4000-8000-000000000002" data-pisi-block-type="paragraph">İlk satır</div>'
        );
    });

    it('geri tuşu ve duraklama bekleyen yazıyı hemen kaydeder; yeniden açılınca içerik oradadır', async () => {
        const { driver, platform } = await start();
        type(blocks()[0], 'Yarım kalan');
        platform.pause();
        await settle();
        expect(stored(driver).content).toContain(paragraph('blk_a', 'Yarım kalan'));

        type(blocks()[0], 'Geri dönmeden önce');
        platform.pressBack();
        await settle();
        expect($('[data-screen="notes"]')).not.toBe(null);
        expect(stored(driver).content).toContain(paragraph('blk_a', 'Geri dönmeden önce'));

        app.router.openNote({ path: 'Toplantı.node', title: 'Toplantı' });
        await settle();
        expect(blockTexts()[0]).toBe('paragraph:Geri dönmeden önce');
    });

    it('not ekran açıkken diskte değiştiyse eski yama uygulanmaz; disktekiyle birleşir, yazılan korunur ve yeniden kaydedilir (S4)', async () => {
        const { driver, project } = await start();
        await project.notes.updateContent('Toplantı.node', [{ op: 'replace', blockId: 'blk_a', html: 'Başka yerden' }]);
        const item = blocks()[3];
        type(item, 'Madde 2');
        await afterSave();
        await afterSave();
        expect(stored(driver).content).toContain(paragraph('blk_a', 'Başka yerden'));
        expect(stored(driver).content).toContain(BULLET.replace('Madde', 'Madde 2'));
        expect(blockTexts()[0]).toBe('paragraph:Başka yerden');
        // The field typed in is the same element: nothing was drawn again around it.
        expect(blocks()[3]).toBe(item);
        expect(snackbar()).toBeNull();
    });

    it('aynı blok diskte de değiştiyse iki metin de kalır: diskteki blok, altında yazılan yeni blok (SV3)', async () => {
        const { driver, project } = await start();
        await project.notes.updateContent('Toplantı.node', [{ op: 'replace', blockId: 'blk_a', html: 'Başka yerden' }]);
        type(blocks()[0], 'Burada yazılan');
        await afterSave();
        await afterSave();
        expect(snackbar()).toBe('Not başka bir cihazda da değişti; yazdıkların ayrı blok olarak korundu.');
        const content = stored(driver).content;
        expect(content).toContain(paragraph('blk_a', 'Başka yerden'));
        expect(content.indexOf('Burada yazılan')).toBeGreaterThan(content.indexOf('Başka yerden'));
        expect(blockTexts().slice(0, 2)).toEqual(['paragraph:Başka yerden', 'paragraph:Burada yazılan']);
    });

    it('kayıt başarısız olursa bildirilir ve sonraki denemede yazılır', async () => {
        const { driver } = await start();
        type(blocks()[0], 'Kaydedilemeyen');
        driver.failOn('rename');
        await afterSave();
        expect(snackbar()).toBe('Not kaydedilemedi.');
        driver.heal();
        type(blocks()[3], 'Madde 2');
        await afterSave();
        expect(stored(driver).content).toContain(paragraph('blk_a', 'Kaydedilemeyen'));
        expect(stored(driver).content).toContain(BULLET.replace('Madde', 'Madde 2'));
    });

    it('günlük notu: masaüstünün görev bölümü ve başlığı düzenlenmez; yazılan Pisi sekmesindeki günlükle aynı dosyadır', async () => {
        const managed =
            '<!--PISI_DIARY_MANAGED_START-->\n<div class="pisi-diary-managed-block" data-pisi-task-id="task_source_1">\n    <span class="pisi-diary-task-text">Raporu gönder</span>\n</div>\n<!--PISI_DIARY_MANAGED_END-->';
        const content =
            paragraph('blk_d', 'Sabah') +
            '\n<div class="pisi-editor-block pisi-diary-task-divider pisi-section-break" data-pisi-block-type="paragraph" data-pisi-block-id="blk_hr"><hr></div>' +
            '\n<h3 class="pisi-editor-block" data-pisi-block-id="blk_g">Görevler</h3>\n' +
            managed;
        const key = `diary/${TODAY}.node`;
        const files = { ...FILES, [key]: noteFile({ id: 'node_d', title: '14-11-2026', content, pisi: { parentMap: 'diary', diaryDate: TODAY } }) };
        const { driver } = await start({ files, note: { path: key, title: '14-11-2026' } });
        expect(blockTexts()).toEqual(['paragraph:Sabah', 'heading3:Görevler']);
        expect(blocks()[1].getAttribute('contenteditable')).toBe(null);
        expect($('.pisi-note-divider')).not.toBe(null);
        expect($('.pisi-note-task .pisi-task-title').textContent).toBe('Raporu gönder');

        type(blocks()[0], 'Sabah yürüdüm');
        await afterSave();
        expect(stored(driver, key).content).toBe(content.replace('Sabah', 'Sabah yürüdüm'));
        app.router.selectTab('pisi');
        await settle();
        expect($('[data-screen="pisi"] textarea').value).toBe('Sabah yürüdüm');
    });
});
