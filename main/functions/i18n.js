import { app } from '../electron-bridge.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';
const supplementalTranslations = JSON.parse(fs.readFileSync(new URL('../../locales/ui-translations.json', import.meta.url), 'utf8'));
import { registerMainModule } from '../module-registry.js';

const PISI_DEFAULT_LANGUAGE = 'tr';
const PISI_SUPPORTED_LANGUAGES = new Set(['tr', 'eng']);
const pisiMainLocaleCache = new Map();

function normalizePisiLanguage(language) {
    const normalized = String(language || '')
        .trim()
        .toLowerCase();
    if (normalized === 'en' || normalized === 'en-us' || normalized === 'en-gb') {
        return 'eng';
    }
    return PISI_SUPPORTED_LANGUAGES.has(normalized) ? normalized : PISI_DEFAULT_LANGUAGE;
}

function getPisiLanguage() {
    const settings = readSettings();
    return normalizePisiLanguage(settings.language || settings.locale);
}

function setPisiLanguage(language) {
    const normalized = normalizePisiLanguage(language);
    const settings = readSettings();
    settings.language = normalized;
    delete settings.locale;
    writeSettings(settings);
    return normalized;
}

function escapePisiI18nRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadPisiMainLocale(language) {
    const normalized = normalizePisiLanguage(language);
    const cached = pisiMainLocaleCache.get(normalized);
    if (cached) return cached;

    const localePath = path.join(app.getAppPath(), 'locales', `lang-${normalized}.json`);

    let locale = { language: normalized, strings: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(localePath, 'utf8'));
        locale = {
            language: normalized,
            strings: {
                ...(parsed && typeof parsed.strings === 'object' ? parsed.strings : {}),
                ...(supplementalTranslations[normalized] || {})
            }
        };
    } catch (error) {
        console.error('[PISI] Locale file could not be read:', localePath, error);
        locale.strings = { ...(supplementalTranslations[normalized] || {}) };
    }

    const templates = [];
    const prefixes = [];
    for (const [source, translated] of Object.entries(locale.strings)) {
        if (source.includes('{value}')) {
            const pieces = source.split('{value}').map(escapePisiI18nRegExp);
            templates.push({
                source,
                translated,
                regexp: new RegExp(`^${pieces.join('(.+?)')}$`, 'u')
            });
        } else if (source.endsWith(':') || source.endsWith(': ')) {
            prefixes.push({ source, translated });
        }
    }

    templates.sort((left, right) => right.source.length - left.source.length);
    prefixes.sort((left, right) => right.source.length - left.source.length);
    const prepared = { ...locale, templates, prefixes };
    pisiMainLocaleCache.set(normalized, prepared);
    return prepared;
}

function translatePisiMain(source, language = getPisiLanguage()) {
    const raw = String(source ?? '');
    if (!raw) return raw;

    const locale = loadPisiMainLocale(language);
    const exact = locale.strings[raw];
    if (exact !== undefined) return exact;

    for (const template of locale.templates) {
        const match = raw.match(template.regexp);
        if (!match) continue;
        let captureIndex = 1;
        return String(template.translated).replace(/\{value\}/g, () => {
            const value = match[captureIndex] ?? '';
            captureIndex += 1;
            return value;
        });
    }

    for (const prefix of locale.prefixes) {
        if (raw.startsWith(prefix.source)) {
            return prefix.translated + raw.slice(prefix.source.length);
        }
    }

    return raw.replace(/PISI/g, 'Pisi');
}

registerMainModule('main.i18n', {
    normalizePisiLanguage,
    getPisiLanguage,
    setPisiLanguage,
    translatePisiMain
});
