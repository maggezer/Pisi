import { describe, expect, it } from 'vitest';
import { PISI_TABS, createRouter } from '../src/app/router.mjs';

const start = () => createRouter({ today: '2026-11-14' });

describe('router', () => {
    it('soğuk açılışta Pisi sekmesi ve bugünün tarihi gelir', () => {
        expect(start().getState()).toEqual({ tab: 'pisi', stack: [], overlays: [], selectedDate: '2026-11-14' });
        expect(PISI_TABS).toEqual(['pisi', 'tasks', 'notes', 'calendar', 'maps']);
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
