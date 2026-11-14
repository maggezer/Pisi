import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

function start(options = {}) {
    const platform = options.platform ?? createFakePlatform();
    const storage = options.storage ?? createFakeStorage();
    const systemTheme = options.systemTheme ?? createFakeSystemTheme(options.dark ?? false);
    app = createApp({
        root,
        platform,
        storage,
        systemTheme,
        deviceLanguage: options.deviceLanguage ?? 'tr-TR',
        // Saturday 14 November 2026, local time.
        now: () => new Date(2026, 10, 14, 9, 30)
    });
    return { platform, storage, systemTheme };
}

const screen = () => root.querySelector('[data-screen]')?.dataset.screen;
const title = () => root.querySelector('.pisi-header-title').textContent;
const tap = (selector) => root.querySelector(selector).click();
const tabLabels = () => [...root.querySelectorAll('.pisi-tab')].map((tab) => tab.textContent);

beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="" />';
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app');
});

afterEach(() => app?.destroy());

describe('uygulama kabuğu', () => {
    it('soğuk açılışta Pisi ekranı bugünün tarihiyle gelir', () => {
        start();
        expect(screen()).toBe('pisi');
        expect(title()).toBe('Pisi');
        expect(root.querySelector('time').getAttribute('datetime')).toBe('2026-11-14');
        expect(root.querySelector('time').textContent).toContain('14 Kasım 2026');
        expect(root.querySelector('time').textContent).toContain('Cumartesi');
        expect(root.querySelector('.pisi-day-today').textContent).toBe('Bugün');
        expect(root.querySelector('[data-tab="pisi"]').getAttribute('aria-current')).toBe('page');
    });

    it('alt menüde beş etiketli sekme vardır; Ayarlar başlıktan açılır', () => {
        start();
        expect(tabLabels()).toEqual(['Pisi', 'Görevler', 'Notlar', 'Takvim', 'Haritalar']);
        for (const tab of ['tasks', 'notes', 'calendar', 'maps']) {
            tap(`[data-tab="${tab}"]`);
            expect(screen()).toBe(tab);
            expect(root.querySelector(`[data-tab="${tab}"]`).getAttribute('aria-current')).toBe('page');
            expect(root.querySelectorAll('[aria-current="page"]').length).toBe(1);
        }
        expect(root.querySelector('[data-action="settings"]').getAttribute('aria-label')).toBe('Ayarları aç');
        tap('[data-action="settings"]');
        expect(screen()).toBe('settings');
        expect(title()).toBe('Ayarlar');
        expect(root.querySelector('.pisi-tabs')).toBe(null);
    });

    it('Android geri tuşu: sheet, alt ekran, Pisi sekmesi, sonra arka plan', () => {
        const { platform } = start();
        tap('[data-tab="tasks"]');
        tap('[data-action="settings"]');
        tap('[data-setting="theme"]');
        expect(root.querySelector('[role="dialog"]')).not.toBe(null);

        platform.pressBack();
        expect(root.querySelector('[role="dialog"]')).toBe(null);
        expect(screen()).toBe('settings');
        expect(document.activeElement.dataset.setting).toBe('theme');

        platform.pressBack();
        expect(screen()).toBe('tasks');
        platform.pressBack();
        expect(screen()).toBe('pisi');
        expect(platform.calls.minimize).toBe(0);

        platform.pressBack();
        expect(platform.calls.minimize).toBe(1);
        expect(screen()).toBe('pisi');
    });

    it('başlıktaki Geri düğmesi alt ekranı kapatır', () => {
        start();
        tap('[data-tab="notes"]');
        tap('[data-action="settings"]');
        tap('[data-action="back"]');
        expect(screen()).toBe('notes');
    });

    it('tema: sistemi izler, seçim saklanır ve sistem çubuklarına iletilir', () => {
        const { platform, storage, systemTheme } = start({ dark: true });
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(platform.calls.systemBars.at(-1)).toEqual({ dark: true, color: '#171310' });
        expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#171310');

        systemTheme.set(false);
        expect(document.documentElement.dataset.theme).toBe('light');

        tap('[data-action="settings"]');
        tap('[data-setting="theme"]');
        expect(root.querySelector('[role="radio"][aria-checked="true"]').dataset.value).toBe('system');
        expect(document.activeElement.dataset.value).toBe('system');
        tap('[role="radio"][data-value="dark"]');

        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(storage.values.get('pisi.mobile.theme')).toBe('dark');
        expect(root.querySelector('[role="dialog"]')).toBe(null);
        expect(root.querySelector('[data-setting="theme"] .pisi-setting-value').textContent).toBe('Koyu');
        expect(platform.calls.systemBars.at(-1).dark).toBe(true);

        // A forced theme no longer follows the system.
        systemTheme.set(false);
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('dil: cihaz dilinden gelir, değiştirilince bütün metinler ve html lang değişir', () => {
        const { storage } = start({ deviceLanguage: 'en-US' });
        expect(tabLabels()).toEqual(['Pisi', 'Tasks', 'Notes', 'Calendar', 'Maps']);
        expect(document.documentElement.lang).toBe('en');
        expect(root.querySelector('.pisi-day-today').textContent).toBe('Today');

        tap('[data-action="settings"]');
        tap('[data-setting="language"]');
        tap('[role="radio"][data-value="tr"]');
        expect(title()).toBe('Ayarlar');
        expect(document.documentElement.lang).toBe('tr');
        expect(storage.values.get('pisi.mobile.language')).toBe('tr');

        // The stored choice wins over the device language on the next start.
        app.destroy();
        start({ deviceLanguage: 'en-US', storage });
        expect(tabLabels()).toEqual(['Pisi', 'Görevler', 'Notlar', 'Takvim', 'Haritalar']);
    });

    it('bekleyen kayıtlar duraklatmada, ekran değişiminde ve geri tuşunda yazılır', async () => {
        const { platform } = start();
        let flushed = 0;
        app.lifecycle.registerFlush(() => void (flushed += 1));

        platform.pause();
        tap('[data-tab="tasks"]');
        platform.pressBack();
        await Promise.resolve();
        expect(flushed).toBe(3);
    });

    it('her düğmenin erişilebilir bir adı vardır', () => {
        start();
        tap('[data-action="settings"]');
        tap('[data-setting="language"]');
        for (const button of root.querySelectorAll('button')) {
            expect((button.getAttribute('aria-label') || button.textContent).trim()).not.toBe('');
        }
        const dialog = root.querySelector('[role="dialog"]');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Dil');
    });
});
