import { describe, expect, it } from 'vitest';
import { createLifecycle } from '../src/app/lifecycle.mjs';
import { createPreferences } from '../src/app/preferences.mjs';
import { resolveTheme } from '../src/app/theme.mjs';
import { PISI_LANGUAGES, createI18n, detectLanguage } from '../src/i18n/index.mjs';
import eng from '../locales/eng.json';
import tr from '../locales/tr.json';
import { createFakeStorage } from './helpers.mjs';

describe('i18n', () => {
    it('Türkçe cihaz Türkçe, diğerleri İngilizce açılır', () => {
        expect(detectLanguage('tr-TR')).toBe('tr');
        expect(detectLanguage('TR')).toBe('tr');
        expect(detectLanguage('en-US')).toBe('eng');
        expect(detectLanguage('de')).toBe('eng');
        expect(detectLanguage(undefined)).toBe('eng');
    });

    it('iki katalogda anahtarlar aynıdır ve metinler katalogdan gelir', () => {
        expect(Object.keys(tr)).toEqual(Object.keys(eng));
        expect(createI18n('tr').t('tab.tasks')).toBe('Görevler');
        expect(createI18n('eng').t('tab.tasks')).toBe('Tasks');
        expect(createI18n('tr').locale).toBe('tr-TR');
        expect(createI18n('eng').locale).toBe('en-GB');
        expect(createI18n('xx').language).toBe('tr');
        expect(createI18n('tr').t('yok.boyle.anahtar')).toBe('yok.boyle.anahtar');
        expect(PISI_LANGUAGES).toEqual(['tr', 'eng']);
    });
});

describe('tercihler', () => {
    it('tema ve dil saklanır; geçersiz değerler yazılmaz ve okunmaz', () => {
        const storage = createFakeStorage({ 'pisi.mobile.theme': 'mor', 'pisi.mobile.language': 'de' });
        const preferences = createPreferences(storage, PISI_LANGUAGES);
        expect(preferences.getTheme()).toBe('system');
        expect(preferences.getLanguage()).toBe(null);

        preferences.setTheme('dark');
        preferences.setLanguage('eng');
        preferences.setTheme('mor');
        preferences.setLanguage('de');
        expect(preferences.getTheme()).toBe('dark');
        expect(preferences.getLanguage()).toBe('eng');
        expect(createPreferences(storage, PISI_LANGUAGES).getTheme()).toBe('dark');
    });

    it('depolama yoksa ya da hata verirse varsayılanlarla çalışır', () => {
        const broken = {
            getItem() {
                throw new Error('denied');
            },
            setItem() {
                throw new Error('denied');
            }
        };
        for (const storage of [null, broken]) {
            const preferences = createPreferences(storage, PISI_LANGUAGES);
            expect(() => preferences.setTheme('dark')).not.toThrow();
            expect(preferences.getTheme()).toBe('system');
            expect(preferences.getLanguage()).toBe(null);
        }
    });
});

describe('tema', () => {
    it('sistem tercihi yalnız "sistem" seçiliyken belirleyicidir', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
        expect(resolveTheme('mor', true)).toBe('dark');
    });
});

describe('yaşam döngüsü', () => {
    it('flush kayıtlı bütün işleri çalıştırır; biri hata verse de diğerleri tamamlanır', async () => {
        const errors = [];
        const done = [];
        const lifecycle = createLifecycle({ onError: (error) => errors.push(error.message) });
        lifecycle.registerFlush(async () => done.push('a'));
        lifecycle.registerFlush(() => {
            throw new Error('yazılamadı');
        });
        const stop = lifecycle.registerFlush(() => done.push('c'));

        await lifecycle.flush();
        expect(done).toEqual(['a', 'c']);
        expect(errors).toEqual(['yazılamadı']);

        stop();
        await lifecycle.flush();
        expect(done).toEqual(['a', 'c', 'a']);
    });
});
