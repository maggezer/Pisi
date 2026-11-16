import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { getNoteDay, getNotePreview, listNotes } from '../src/screens/notes/list-model.mjs';
import { createVirtualList } from '../src/ui/virtual-list.mjs';
import { NOW, TODAY, createMemoryProject, noteFile, paragraph } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

const note = (id, title, text, updatedAt, pisi = {}) =>
    noteFile({ id, title, content: text.map((line, index) => paragraph(`${id}_${index}`, line)).join(''), pisi: { updatedAt, ...pisi } });
const FILES = {
    'Işık.node': note('node_1', 'Işık', ['Gündem', 'Mobil veri katmanı'], '2026-11-10T08:00:00.000Z'),
    'İstanbul gezisi.node': note('node_2', 'İstanbul gezisi', ['Vapur saatleri'], '2026-11-13T08:00:00.000Z'),
    'Plan.node': note('node_3', 'Plan', ['ışık hızında bitecek'], '2025-12-30T08:00:00.000Z'),
    'Boş.node': note('node_4', 'Boş', [], '2026-11-01T08:00:00.000Z'),
    [`diary/${TODAY}.node`]: note('node_5', '14-11-2026', ['Bugün yürüdüm'], '2026-11-14T06:00:00.000Z', { parentMap: 'diary', diaryDate: TODAY })
};

const $ = (selector) => root.querySelector(selector);
const all = (selector) => [...root.querySelectorAll(selector)];
const titles = () => all('.pisi-note-card-title').map((title) => title.textContent);
const settle = () => vi.advanceTimersByTimeAsync(0);

async function start(files = FILES) {
    const memory = createMemoryProject(files);
    const errors = [];
    app = createApp({
        root,
        platform: createFakePlatform(),
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage: 'tr-TR',
        project: memory.project,
        now: () => new Date(NOW),
        onError: (error) => errors.push(error)
    });
    await app.ready;
    app.router.selectTab('notes');
    return { ...memory, errors };
}

function search(text) {
    const input = $('#pisi-notes-search');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

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

describe('Notlar sekmesi', () => {
    it('notları son değişikliğe göre sıralar; kart sade: başlık, aralıklı önizleme, gün (G7, G8)', async () => {
        await start();
        expect($('.pisi-header-title').textContent).toBe('Notlar');
        expect(titles()).toEqual(['14-11-2026', 'İstanbul gezisi', 'Işık', 'Boş', 'Plan']);
        const card = $('[data-note="Işık.node"]');
        expect(card.querySelector('.pisi-note-card-preview').textContent).toBe('Gündem Mobil veri katmanı');
        expect(card.querySelector('.pisi-note-card-meta').textContent).toBe('10 Kas');
        expect($('[data-note="Plan.node"] .pisi-note-card-meta').textContent).toBe('30 Ara 2025');
        expect($('[data-note="Boş.node"] .pisi-note-card-preview').textContent).toBe('Boş not');
        expect($(`[data-note="diary/${TODAY}.node"] .pisi-note-card-kind`).textContent).toBe('Günlük');
        // Sabitleme ve süs yok: kartta yalnız üç satır var.
        expect([...card.children].map((child) => child.className)).toEqual(['pisi-note-card-title', 'pisi-note-card-preview', 'pisi-note-card-meta']);
        expect(root.innerHTML).not.toMatch(/pin|sabit/i);
    });

    it('filtre: Tümü, Notlar, Günlükler', async () => {
        await start();
        expect(all('.pisi-notes-filter [role="radio"]').map((option) => option.textContent)).toEqual(['Tümü', 'Notlar', 'Günlükler']);
        $('.pisi-notes-filter [data-value="diary"]').click();
        expect(titles()).toEqual(['14-11-2026']);
        expect($('.pisi-notes-filter [data-value="diary"]').getAttribute('aria-checked')).toBe('true');
        $('.pisi-notes-filter [data-value="notes"]').click();
        expect(titles()).toEqual(['İstanbul gezisi', 'Işık', 'Boş', 'Plan']);
    });

    it('arama başlıkta ve metinde, Türkçe harf kurallarıyla eşleştirir; başlık eşleşmesi önce gelir', async () => {
        await start();
        search('IŞIK');
        expect(titles()).toEqual(['Işık', 'Plan']);
        search('istanbul');
        expect(titles()).toEqual(['İstanbul gezisi']);
        // Masaüstünün katlama kuralı (shared/search-text.mjs) büyük I'yı da i ile eşler.
        search('ISTANBUL');
        expect(titles()).toEqual(['İstanbul gezisi']);
        search('xyzzy');
        expect($('[data-notes="empty"] .pisi-empty-title').textContent).toBe('Aramayla eşleşen not yok.');
        search('yürüdüm');
        $('.pisi-notes-filter [data-value="notes"]').click();
        expect(titles()).toEqual([]);
        $('[data-action="clear-search"]').click();
        expect($('#pisi-notes-search').value).toBe('');
        expect(titles()).toHaveLength(4);
    });

    it('2.000 notta yalnız ekrana yakın satırlar çizilir', async () => {
        const files = Object.fromEntries(
            Array.from({ length: 2000 }, (_, index) => [
                `Not ${index}.node`,
                note(`node_${index}`, `Not ${index}`, ['metin'], new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString())
            ])
        );
        await start(files);
        const list = $('.pisi-virtual');
        expect(list.style.getPropertyValue('--pisi-virtual-count')).toBe('2000');
        expect(all('.pisi-note-card').length).toBeGreaterThan(5);
        expect(all('.pisi-note-card').length).toBeLessThan(40);
        expect(titles()[0]).toBe('Not 1999');
        expect($('.pisi-virtual-row').getAttribute('aria-setsize')).toBe('2000');
    });

    it('boş projede boş durum ve "Yeni not" düğmesi vardır', async () => {
        await start({});
        expect($('[data-notes="empty"] .pisi-empty-title').textContent).toBe('Henüz not yok.');
        expect($('[data-action="new-note"]').textContent).toBe('Yeni not');
    });

    it('yeni not: başlık sorulur, boş başlıkla oluşmaz; oluşan not masaüstü biçimindedir ve açılır', async () => {
        const { driver } = await start();
        $('[data-action="new-note"]').click();
        expect($('[role="dialog"] .pisi-sheet-title').textContent).toBe('Yeni not');
        const input = $('#pisi-new-note-title');
        expect(document.activeElement).toBe(input);
        const create = $('[data-action="create-note"]');
        expect(create.disabled).toBe(true);
        input.value = '   ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(create.disabled).toBe(true);
        input.value = 'Alışveriş listesi';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Yazarken başka bir çizim sheet'i yeniden kurmaz.
        app.router.setSelectedDate('2026-11-20');
        expect($('#pisi-new-note-title')).toBe(input);
        create.click();
        await settle();

        const written = JSON.parse(driver.snapshot()['Alışveriş listesi.node']);
        expect(written).toEqual({
            pisi: {
                version: 1,
                type: 'node',
                id: 'node_00000000-0000-4000-8000-000000000001',
                title: 'Alışveriş listesi',
                sidecar: 'inv_Alışveriş listesi__node_00000000-0000-4000-8000-000000000001',
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
                parentMap: 'none'
            },
            content: ''
        });
        expect(app.router.getState()).toMatchObject({ stack: ['note'], overlays: [], note: { path: 'Alışveriş listesi.node', title: 'Alışveriş listesi' } });
        expect($('.pisi-header-title').textContent).toBe('Alışveriş listesi');
        expect($('.pisi-note-block').dataset.placeholder).toBe('Yazmaya başla…');

        app.handleBack();
        await settle();
        expect(titles()[0]).toBe('Alışveriş listesi');
    });

    it('karta dokununca not açılır; geri tuşu listeye, aramaya ve filtreye döner', async () => {
        await start();
        search('ışık');
        $('[data-note="Plan.node"]').click();
        await settle();
        expect($('[data-screen="note"] .pisi-note-block').textContent).toBe('ışık hızında bitecek');
        app.handleBack();
        expect($('#pisi-notes-search').value).toBe('ışık');
        expect(titles()).toEqual(['Işık', 'Plan']);
    });
});

describe('not listesi kuralları', () => {
    const notes = [
        { key: 'a', kind: 'note', title: 'A', preview: 'bir\niki\n\nüç', updatedAt: '2026-11-14T21:30:00.000Z' },
        { key: 'b', kind: 'diary', title: 'B', preview: '', updatedAt: '' }
    ];

    it('filtre ve arama', () => {
        const found = [];
        const search = (text) => (found.push(text), [notes[1]]);
        expect(listNotes({ notes, search })).toEqual(notes);
        expect(listNotes({ notes, filter: 'diary', query: '  ', search })).toEqual([notes[1]]);
        expect(listNotes({ notes, filter: 'notes', query: 'b', search })).toEqual([]);
        expect(found).toEqual(['b']);
    });

    it('önizleme tek satırdır ve bloklar bitişmez; gün yerel takvim günüdür', () => {
        expect(getNotePreview(notes[0])).toBe('bir iki üç');
        const local = new Date('2026-11-14T21:30:00.000Z');
        expect(getNoteDay(notes[0])).toBe(
            `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
        );
        expect(getNoteDay(notes[1])).toBe(null);
    });
});

describe('sanal liste', () => {
    it('öğe aynı kaldıkça satırı yeniden kurmaz; liste değişince yalnız değişen satırlar çizilir', () => {
        const items = Array.from({ length: 300 }, (_, index) => ({ index }));
        let rendered = 0;
        const list = createVirtualList({ label: 'Deneme', renderRow: (item) => ((rendered += 1), document.createTextNode(String(item.index))) });
        document.body.append(list.element);
        list.setItems(items);
        const first = rendered;
        expect(first).toBe(list.getDrawnCount());
        expect(first).toBeLessThan(40);
        list.setItems([...items]);
        expect(rendered).toBe(first);
        list.setItems([{ index: 'yeni' }, ...items.slice(1)]);
        expect(rendered).toBe(first + 1);
        expect(list.element.firstElementChild.style.getPropertyValue('--pisi-virtual-index')).toBeDefined();
        list.setItems([]);
        expect(list.getDrawnCount()).toBe(0);
        list.destroy();
        list.element.remove();
    });
});
