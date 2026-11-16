import { describe, expect, it } from 'vitest';
import { PISI_TABS, createRouter } from '../src/app/router.mjs';

const start = () => createRouter({ today: '2026-11-14' });

describe('router', () => {
    it('soğuk açılışta Pisi sekmesi ve bugünün tarihi gelir', () => {
        expect(start().getState()).toEqual({ tab: 'pisi', stack: [], overlays: [], selectedDate: '2026-11-14', note: null, map: null });
        expect(PISI_TABS).toEqual(['pisi', 'tasks', 'notes', 'calendar', 'maps']);
    });

    it('harita görüntüleyici Haritalar sekmesinin üstünde açılır; haritadan açılan not onun üstüne gelir ve geri haritaya döner', () => {
        const router = start();
        router.selectTab('maps');
        router.openMap({ key: 'Yol Haritası.map', title: 'Yol Haritası' });
        expect(router.getState()).toMatchObject({ tab: 'maps', stack: ['map'], map: { key: 'Yol Haritası.map', title: 'Yol Haritası' } });
        router.openNote({ path: 'nd_Yol/Not.node', title: 'Not' });
        expect(router.getState().stack).toEqual(['map', 'note']);
        expect(router.back()).toBe('screen-closed');
        expect(router.getState()).toMatchObject({ stack: ['map'], map: { key: 'Yol Haritası.map' } });
        expect(router.back()).toBe('screen-closed');
        expect(router.getState().stack).toEqual([]);
        // Opening another map replaces the one on screen; a map without a key and push('map') are ignored.
        router.openMap({ key: 'A.map', title: 'A' });
        router.openMap({ key: 'B.map', title: 'B' });
        router.push('map');
        router.openMap({ title: 'Yok' });
        expect(router.getState()).toMatchObject({ stack: ['map'], map: { key: 'B.map' } });
    });

    it("sekme değiştirmek alt ekranı ve açık sheet'i kapatır; bilinmeyen sekme yok sayılır", () => {
        const router = start();
        router.push('settings');
        router.openOverlay('theme');
        router.selectTab('notes');
        expect(router.getState()).toMatchObject({ tab: 'notes', stack: [], overlays: [] });
        router.selectTab('nope');
        expect(router.getState().tab).toBe('notes');
    });

    it("geri tuşu sırayla sheet'i, alt ekranı kapatır, Pisi'ye döner ve Pisi'de uygulamayı arka plana alır", () => {
        const router = start();
        router.selectTab('tasks');
        router.push('settings');
        router.openOverlay('theme');

        expect(router.back()).toBe('overlay-closed');
        expect(router.getState()).toMatchObject({ tab: 'tasks', stack: ['settings'], overlays: [] });
        expect(router.back()).toBe('screen-closed');
        expect(router.getState()).toMatchObject({ tab: 'tasks', stack: [] });
        expect(router.back()).toBe('home');
        expect(router.getState().tab).toBe('pisi');
        expect(router.back()).toBe('minimize');
        expect(router.back()).toBe('minimize');
        expect(router.getState()).toMatchObject({ tab: 'pisi', stack: [], overlays: [] });
    });

    it('openDay Pisi sekmesini o günle tek adımda açar; alt ekran ve sheet kapanır, geçersiz gün yok sayılır', () => {
        const router = start();
        const seen = [];
        router.subscribe((state) => seen.push(state.tab));
        router.selectTab('calendar');
        router.openOverlay('theme');
        router.openDay('2026-12-02');
        expect(router.getState()).toMatchObject({ tab: 'pisi', stack: [], overlays: [], selectedDate: '2026-12-02' });
        expect(seen).toEqual(['calendar', 'calendar', 'pisi']);
        router.openDay('2 Aralık');
        expect(router.getState().selectedDate).toBe('2026-12-02');
        expect(router.back()).toBe('minimize');
    });

    it("not ekranı bir notla açılır, açık sheet'leri kapatır; geri tuşu sekmeye döner", () => {
        const router = start();
        router.selectTab('tasks');
        router.openOverlay('task:1');
        router.openNote({ path: 'Ev.node', title: 'Ev' });
        expect(router.getState()).toMatchObject({ tab: 'tasks', stack: ['note'], overlays: [], note: { path: 'Ev.node', title: 'Ev' } });
        router.openNote({ path: 'Rapor.node', title: 'Rapor' });
        expect(router.getState()).toMatchObject({ stack: ['note'], note: { path: 'Rapor.node', title: 'Rapor' } });
        expect(router.back()).toBe('screen-closed');
        expect(router.getState()).toMatchObject({ tab: 'tasks', stack: [] });

        // Notu olmayan çağrı ve push('note') bir şey açmaz.
        router.openNote({ path: '', title: '' });
        router.push('note');
        expect(router.getState().stack).toEqual([]);
    });

    it('Pisi sekmesindeki alt ekrandan geri, Pisi sekmesine döner', () => {
        const router = start();
        router.push('settings');
        expect(router.back()).toBe('screen-closed');
        expect(router.back()).toBe('minimize');
    });

    it('aboneler her değişikliği görür; aynı duruma geçiş bildirim üretmez', () => {
        const router = start();
        const seen = [];
        const stop = router.subscribe((state) => seen.push(state.tab + '/' + state.stack.join(',') + '/' + state.overlays.join(',')));
        router.selectTab('pisi');
        router.push('unknown');
        router.closeOverlay();
        router.selectTab('maps');
        router.push('settings');
        router.push('settings');
        router.openOverlay('language');
        stop();
        router.selectTab('pisi');
        expect(seen).toEqual(['maps//', 'maps/settings/', 'maps/settings/language']);
    });
});
