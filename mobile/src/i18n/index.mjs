// Every text the user sees comes from locales/tr.json and locales/eng.json.
// scripts/check-i18n.mjs keeps the two files' keys identical.

import eng from '../../locales/eng.json';
import tr from '../../locales/tr.json';

export const PISI_LANGUAGES = Object.freeze(['tr', 'eng']);
const CATALOGS = Object.freeze({ tr, eng });
const LOCALES = Object.freeze({ tr: 'tr-TR', eng: 'en-GB' });

/** Turkish devices get Turkish; every other device language gets English. */
export function detectLanguage(deviceLanguage) {
    return String(deviceLanguage || '')
        .toLowerCase()
        .startsWith('tr')
        ? 'tr'
        : 'eng';
}

export function createI18n(language) {
    const active = PISI_LANGUAGES.includes(language) ? language : 'tr';
    const catalog = CATALOGS[active];

    return {
        language: active,
        /** BCP 47 tag for Intl formatting and the html lang attribute. */
        locale: LOCALES[active],
        t(key, params = {}) {
            const template = catalog[key] ?? CATALOGS.tr[key] ?? key;
            return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        }
    };
}
