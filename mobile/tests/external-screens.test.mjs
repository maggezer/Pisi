// S4: screens take a change from outside (sync) in place. The "outside" is
// data/external-source.mjs, the stand-in the sync engine (S5) will replace:
// it asks the open screen to write what is waiting, then changes the file
// through ProjectWriter.applyExternal / removeExternal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { createExternalSource } from '../src/data/external-source.mjs';
import { PISI_DIARY_SAVE_DELAY_MS } from '../src/screens/pisi/diary-autosave.mjs';
import { NOW, TODAY, createMemoryProject, json, noteFile, paragraph, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

const BLOCKS = ['Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı'];
const NOTE_A = noteFile({ id: 'node_a', title: 'A', content: BLOCKS.map((text, index) => paragraph(`blk_${index + 1}`, text)).join('') });
const NOTE_B = noteFile({ id: 'node_b', title: 'B', content: paragraph('blk_b', 'Bee') });
const DAY = `diary/${TODAY}.node`;
const dayFile = (text) => noteFile({ id: 'node_day', title: '14-11-2026', content: paragraph('blk_d', text) });
const task = (id, title, fields = {}) => ({
    id,
    title,
    status: 'todo',
    priority: 3,
    dueDate: TODAY,
    scheduledAt: null,
    deadline: null,
    repeat: 'none',
    source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' },
    ...fields
});
const tasksFile = (tasks) => storeJson({ version: 1, updatedAt: null, tasks });
const MAP_ID = 'map_k';
const SIDECAR = `nd_Kroki__${MAP_ID}`;
const mapFile = (nodes) =>
    json({
        pisi: { version: 1, type: 'map', id: MAP_ID, title: 'Kroki', sidecar: SIDECAR },
        map: { nodes, relationshipViews: [{ relationshipId: 'edge_1' }] }
    });
const layout = (id, x, y) => ({ id, x, y, width: 220, height: 92 });
const FILES = {
    'A.node': NOTE_A,
    'B.node': NOTE_B,
    'diary/.pisi-diary': '',
    [DAY]: dayFile('Sabah'),
    '.pisi/tasks.json': tasksFile([task('task_milk', 'Süt al')]),
    'Kroki.map': mapFile([layout('node_k1', 0, 0), layout('node_k2', 400, 0)]),
    [`${SIDECAR}/K1.node`]: noteFile({ id: 'node_k1', title: 'K1' }),
    [`${SIDECAR}/K2.node`]: noteFile({ id: 'node_k2', title: 'K2' }),
    '.pisi/relationships.json': json({ version: 1, relationships: [] })
};

let app;
let root;

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const blocks = () => all('.pisi-note-editor > .pisi-note-block');
const texts = () => blocks().map((block) => block.textContent);
const snackbar = () => $('.pisi-snackbar-message')?.textContent ?? null;
const settle = async () => {
    for (let round = 0; round < 4; round += 1) await vi.advanceTimersByTimeAsync(0);
    await app.whenExternalSettled();
    await vi.advanceTimersByTimeAsync(0);
};
const stored = (driver, key) => driver.snapshot()[key];
const writes = (driver, key) => driver.calls.filter(([name, , to]) => name === 'rename' && to === key).length;

async function start(files = FILES) {
    const memory = createMemoryProject(files);
    app = createApp({
        root,
        platform: createFakePlatform(),
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage: 'tr-TR',
        project: memory.project,
        now: () => new Date(NOW),
        onError: (error) => memory.errors.push(error)
    });
    await app.ready;
    return { ...memory, external: createExternalSource(memory.project, { now: () => new Date(NOW) }) };
}

async function openNote(path = 'A.node', title = 'A') {
    app.router.selectTab('notes');
    app.router.openNote({ path, title });
    await settle();
}

function type(block, text, caret = text.length) {
    block.focus();
    block.textContent = text;
    block.dispatchEvent(new Event('input', { bubbles: true }));
    const range = document.createRange();
    range.setStart(block.firstChild, caret);
    range.collapse(true);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = document.createElement('div');
    document.body.append(root);
});

afterEach(() => {
    app?.destroy();
    app = null;
    root.remove();
    vi.useRealTimers();
});

describe('açık not dış değişikliği yerinde alır (S4)', () => {
    it('3. blok yazılırken 5. blok dışarıdan değişir: 5. blok güncellenir, imleç 3. blokta aynı yerde, yazılan metin durur ve diske gider', async () => {
        const { driver, external } = await start();
        await openNote();
        const before = blocks();
        type(before[2], 'Üç ve devamı', 4);
        const result = await external.setBlockText('A.node', 'blk_5', 'Beş (masaüstü)');
        await settle();

        expect(result).toMatchObject({ written: true });
        expect(texts()).toEqual(['Bir', 'İki', 'Üç ve devamı', 'Dört', 'Beş (masaüstü)', 'Altı']);
        // The same elements: the note was not drawn again, and the caret is where it was.
        expect(blocks().every((block, index) => block === before[index])).toBe(true);
        const selection = document.getSelection();
        expect([selection.anchorNode.parentNode === before[2], selection.anchorOffset]).toEqual([true, 4]);
        expect(document.activeElement).toBe(before[2]);

        const content = JSON.parse(stored(driver, 'A.node')).content;
        expect(content).toContain(paragraph('blk_3', 'Üç ve devamı'));
        expect(content).toContain(paragraph('blk_5', 'Beş (masaüstü)'));
        // One write for the save the outside asked for, one for the change itself, and nothing after it.
        await vi.advanceTimersByTimeAsync(2000);
        expect(writes(driver, 'A.node')).toBe(2);
    });

    it('kirli 3. bloğa gelen dış değişiklik uygulanmaz ve ertelendiği görünür; kayıttan sonra uyarı kalır, dosya yalnız yerel kaydı alır', async () => {
        const { driver, project, external } = await start();
        await openNote();
        type(blocks()[2], 'Burada yazılan');
        const result = await external.setBlockText('A.node', 'blk_3', 'Uzaktan', { flush: false });
        await settle();

        expect(result).toMatchObject({ written: false, reason: 'dirty' });
        expect(project.documents.getDeferred()).toEqual([{ key: 'A.node', reason: 'dirty' }]);
        expect($('[data-note="external-deferred"]').hidden).toBe(false);
        expect(texts()[2]).toBe('Burada yazılan');
        expect(stored(driver, 'A.node')).toBe(NOTE_A);

        await vi.advanceTimersByTimeAsync(1000);
        expect(project.documents.isDirty('A.node')).toBe(false);
        expect(JSON.parse(stored(driver, 'A.node')).content).toContain(paragraph('blk_3', 'Burada yazılan'));
    });

    it('B notu dışarıdan değişince açık A notunun DOM’u yeniden kurulmaz ve hiçbir şey yazılmaz', async () => {
        const { driver, external } = await start();
        await openNote();
        const editor = $('.pisi-note-editor');
        const children = [...editor.childNodes];
        await external.setBlockText('B.node', 'blk_b', 'Yeni bee');
        await settle();
        expect($('.pisi-note-editor')).toBe(editor);
        expect([...editor.childNodes].every((node, index) => node === children[index])).toBe(true);
        expect(writes(driver, 'A.node')).toBe(0);
        expect(writes(driver, 'B.node')).toBe(1);
    });

    it('dışarıdan eklenen ve silinen bloklar sırasına girer; değişmeyen bloklar aynı öğedir', async () => {
        const { external } = await start();
        await openNote();
        const before = blocks();
        await external.editDocument('A.node', (data) => ({
            ...data,
            content: data.content.replace(paragraph('blk_2', 'İki'), paragraph('blk_new', 'Yeni')).concat(paragraph('blk_7', 'Yedi'))
        }));
        await settle();
        expect(texts()).toEqual(['Bir', 'Yeni', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi']);
        expect(blocks()[0]).toBe(before[0]);
        expect(blocks()[2]).toBe(before[2]);
    });

    it('açık not masaüstünde silinince kullanıcıya söylenir, not ekranı kapanır, hiçbir şey yazılmaz; uygulama çökmez', async () => {
        const { driver, errors, external } = await start();
        await openNote();
        const result = await external.remove('A.node');
        await settle();
        expect(result).toMatchObject({ written: true, removed: true });
        expect(snackbar()).toBe('Bu not masaüstünde silindi.');
        expect(app.router.getState().stack).toEqual([]);
        expect($('[data-screen]').dataset.screen).toBe('notes');
        expect(all('[data-note="A.node"]')).toEqual([]);
        expect(stored(driver, 'A.node')).toBeUndefined();
        expect(driver.calls.filter(([name]) => name === 'writeText')).toEqual([]);
        expect(errors).toEqual([]);
    });
});

describe('Pisi sekmesi, görevler ve takvim dış değişikliği alır (S4)', () => {
    it('günün günlüğü ve görevler dışarıdan değişince yerinde güncellenir; hiçbir repo dosyayı yeniden yazmaz', async () => {
        const { driver, external } = await start();
        await settle();
        const textarea = $('[data-diary="text"]');
        expect(textarea.value).toBe('Sabah');

        await external.put(DAY, dayFile('Sabah, masaüstünden'));
        await external.put(
            '.pisi/tasks.json',
            tasksFile([task('task_milk', 'Süt al', { manualOrder: 1 }), task('task_bread', 'Ekmek al', { manualOrder: 2 })])
        );
        await settle();
        expect($('[data-diary="text"]')).toBe(textarea);
        expect(textarea.value).toBe('Sabah, masaüstünden');
        expect(all('.pisi-task-title').map((title) => title.textContent)).toEqual(['Süt al', 'Ekmek al']);

        app.router.selectTab('tasks');
        await settle();
        expect(all('.pisi-task-title').map((title) => title.textContent)).toEqual(['Süt al', 'Ekmek al']);
        await vi.advanceTimersByTimeAsync(2000);
        expect([writes(driver, DAY), writes(driver, '.pisi/tasks.json')]).toEqual([1, 1]);
    });

    it('günlük yazılırken gelen değişiklik önce yazılanı diske aldırır; flush olmadan gelirse ertelenir ve günlükte görünür', async () => {
        const { driver, project, external } = await start();
        await settle();
        const textarea = $('[data-diary="text"]');
        textarea.value = 'Sabah\n\nYazılan';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        const refused = await external.put(DAY, dayFile('Uzak'), { flush: false });
        await settle();
        expect(refused).toMatchObject({ written: false, reason: 'dirty' });
        expect($('#pisi-diary-note').textContent).toBe('Başka cihazdan gelen bir değişiklik, yazdıklarının kaydedilmesini bekliyor.');
        expect(textarea.value).toBe('Sabah\n\nYazılan');

        // With the flush first, the typed text is on disk before the change is merged against it.
        await external.editDocument(DAY, (data) => ({ ...data, content: `${data.content}${paragraph('blk_u', 'Uzak')}` }));
        await settle();
        expect(project.documents.getDeferred()).toEqual([]);
        expect(textarea.value).toBe('Sabah\n\nYazılan\n\nUzak');
        expect((await project.diary.read(TODAY)).text).toBe('Sabah\n\nYazılan\n\nUzak');
        expect(driver.snapshot()[DAY]).toContain('Yazılan');
    });

    it('kayıt ile dış yazma yarışırsa iki metin de kalır (SV3)', async () => {
        const { driver } = await start();
        await settle();
        const textarea = $('[data-diary="text"]');
        textarea.value = 'Sabah\n\nBurada';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        // The file changes under the waiting text without going through the writer (a race the lease cannot see).
        await driver.writeText(DAY, noteFile({ id: 'node_day', title: '14-11-2026', content: paragraph('blk_d', 'Sabah') + paragraph('blk_o', 'Orada') }));
        await vi.advanceTimersByTimeAsync(PISI_DIARY_SAVE_DELAY_MS + 1);
        await settle();
        await vi.advanceTimersByTimeAsync(PISI_DIARY_SAVE_DELAY_MS + 1);
        await settle();
        expect(snackbar()).toBe('Günlük başka bir cihazda da değişti; iki metin de korundu.');
        expect(textarea.value).toBe('Sabah\n\nOrada\n\nBurada');
        const content = JSON.parse(driver.snapshot()[DAY]).content;
        expect(content.indexOf('Orada')).toBeGreaterThan(-1);
        expect(content.indexOf('Burada')).toBeGreaterThan(content.indexOf('Orada'));
    });

    it('takvim dışarıdan gelen günlük gününü ve görevi gösterir', async () => {
        const { external } = await start();
        app.router.selectTab('calendar');
        await settle();
        const cell = (day) => $(`[data-calendar="grid"] [data-date="${day}"]`);
        expect(cell('2026-11-20').getAttribute('aria-label')).not.toContain('günlük var');
        await external.put('diary/2026-11-20.node', noteFile({ id: 'node_20', title: '20-11-2026', content: paragraph('blk_20', 'Gün') }));
        await settle();
        expect(cell('2026-11-20').getAttribute('aria-label')).toContain('günlük var');
        await external.remove('diary/2026-11-20.node');
        await settle();
        expect(cell('2026-11-20').getAttribute('aria-label')).not.toContain('günlük var');
    });
});

describe('harita görüntüleyici ve Ayarlar dış değişikliği alır (S4)', () => {
    it('açık haritanın ilişkileri ve üyeleri değişince yeniden çizilir; kullanıcının oynattığı kamera korunur; silinen harita bulunamadı olur', async () => {
        const { external } = await start();
        app.router.openMap({ key: 'Kroki.map', title: 'Kroki' });
        await settle();
        const viewport = $('[data-map="viewport"]');
        expect([viewport.dataset.nodes, viewport.dataset.edges]).toEqual(['2', '0']);
        $('[data-action="zoom-in"]').click();
        const zoom = viewport.dataset.zoom;

        await external.put(
            '.pisi/relationships.json',
            json({ version: 1, relationships: [{ id: 'edge_1', sourceId: 'node_k1', targetId: 'node_k2', type: 'co-level' }] })
        );
        await external.put(`${SIDECAR}/K3.node`, noteFile({ id: 'node_k3', title: 'K3', pisi: { parentMap: MAP_ID } }));
        await settle();
        expect([viewport.dataset.nodes, viewport.dataset.edges, viewport.dataset.zoom]).toEqual(['3', '1', zoom]);

        await external.remove('Kroki.map');
        await settle();
        expect($('[data-screen="map"]').textContent).toContain('Bu harita bulunamadı.');
    });

    it('Ayarlar’daki proje sayıları dış değişiklikle güncellenir', async () => {
        const { external } = await start();
        app.router.push('settings');
        await settle();
        const value = (id) => $(`[data-project="${id}"] .pisi-row-value`).textContent;
        expect(value('notes')).toBe('4');
        await external.put('Yeni.node', noteFile({ id: 'node_n', title: 'Yeni' }));
        await settle();
        expect(value('notes')).toBe('5');
    });
});
