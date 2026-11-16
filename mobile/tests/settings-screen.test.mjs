import { describe, expect, it } from 'vitest';
import eng from '../locales/eng.json';
import tr from '../locales/tr.json';
import { createI18n } from '../src/i18n/index.mjs';
import { formatAppVersion, renderSettingsScreen } from '../src/screens/settings/index.mjs';

const t = createI18n('tr').t;
const draw = (options = {}) =>
    renderSettingsScreen({ t, themePreference: 'system', language: 'tr', openOverlay: () => {}, version: { name: '0.1.0', build: '42' }, ...options });
const value = (screen, selector) => screen.querySelector(`${selector} .pisi-row-value`)?.textContent ?? null;
const project = (counts, readOnlyFiles = []) => ({ counts, readOnlyFiles });

describe('Ayarlar (M10)', () => {
    it('sürüm satırı: paket sürümü ve varsa APK sürüm kodu', () => {
        expect(formatAppVersion({ name: '0.1.0', build: '42' })).toBe('0.1.0 (42)');
        expect(formatAppVersion({ name: '0.1.0', build: '' })).toBe('0.1.0');
        expect(formatAppVersion(null)).toBe('—');
    });

    it('tema, dil, proje, hakkında; geliştirici bölümü yalnız debug derlemesinde', () => {
        const counts = { tasks: 6, notes: 3, diary: 1, maps: 1 };
        const screen = draw({ project: project(counts) });
        expect([...screen.querySelectorAll('.pisi-section-title')].map((title) => title.textContent)).toEqual(['Proje', 'Hakkında']);
        expect(['tasks', 'notes', 'diary', 'maps', 'integrity'].map((id) => value(screen, `[data-project="${id}"]`))).toEqual([
            '6',
            '3',
            '1',
            '1',
            'Sorun yok'
        ]);
        expect(screen.querySelector('[data-project="integrity"]').dataset.state).toBe('healthy');
        expect(value(screen, '[data-about="version"]')).toBe('0.1.0 (42)');
        expect(value(screen, '[data-about="transfer"]')).toBe('Yakında');
        expect(screen.querySelector('[data-about="transfer"] .pisi-row-meta').textContent).toMatch(/^Projeyi masaüstüyle/);
        expect(screen.querySelector('[data-developer]')).toBeNull();

        const debug = draw({ project: project(counts), developer: true, onLoadSample: () => {}, onLoadSampleMap: () => {} });
        expect([...debug.querySelectorAll('.pisi-section-title')].map((title) => title.textContent)).toEqual(['Proje', 'Hakkında', 'Geliştirici']);
        expect([...debug.querySelectorAll('[data-developer]')].map((row) => row.dataset.developer)).toEqual(['load-sample', 'load-sample-map']);
    });

    it('bütünlük: proje okunurken bekler; okunamayan dosyaları sayar ve listeler', () => {
        const checking = draw({ project: project(null) });
        expect(value(checking, '[data-project="integrity"]')).toBe('…');
        expect(checking.querySelector('[data-project="integrity"]').dataset.state).toBe('checking');

        const broken = draw({ project: project({ tasks: 0, notes: 1, diary: 0, maps: 0 }, ['.pisi/tasks.json', 'Bozuk.node']) });
        expect(value(broken, '[data-project="integrity"]')).toBe('2 dosya salt okunur');
        expect(broken.querySelector('[data-project="read-only"]').getAttribute('role')).toBe('alert');
        expect([...broken.querySelectorAll('.pisi-list')].at(-2).textContent).toContain('Bozuk.node');
    });

    it('proje yokken (çıplak kabuk) yalnız tema, dil ve hakkında görünür', () => {
        const screen = draw();
        expect(screen.querySelector('[data-project]')).toBeNull();
        expect(value(screen, '[data-about="version"]')).toBe('0.1.0 (42)');
    });

    it('İngilizcede çevrilir', () => {
        const screen = renderSettingsScreen({
            t: createI18n('eng').t,
            themePreference: 'dark',
            language: 'eng',
            openOverlay: () => {},
            version: { name: '0.1.0' },
            project: project({ tasks: 1, notes: 2, diary: 3, maps: 4 })
        });
        expect(screen.textContent).toContain('Transfer between devices');
        expect(value(screen, '[data-project="integrity"]')).toBe('No problems');
        expect(value(screen, '[data-project="diary"]')).toBe('3');
    });

    it('DriveSync ve iki yönlü eşitleme metni yoktur (G13)', () => {
        for (const catalog of [tr, eng]) {
            const texts = Object.entries(catalog).map(([key, text]) => `${key} ${text}`);
            expect(texts.filter((text) => /drive|two-way|iki yönlü|sync|senkron/i.test(text))).toEqual([]);
        }
    });
});
