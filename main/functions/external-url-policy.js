import { URL } from 'node:url';

// Single authority for which URLs Pisi hands to the operating system. Pure: no
// Electron imports, so it is unit-tested directly. The renderer keeps an
// identical copy (renderer/editor/pisi-external-url-policy.mjs) only to show
// errors early; main always re-validates before opening anything.

const PISI_EXTERNAL_URL_PROTOCOLS = Object.freeze(['http:', 'https:', 'mailto:']);
const PISI_EXTERNAL_URL_MAX_LENGTH = 8192;
// C0 controls, space, DEL and C1 controls. Whitespace is never valid in a URL
// we open, so it is rejected rather than trimmed or encoded away.
const PISI_EXTERNAL_URL_FORBIDDEN_CHARACTERS = /[\u0000- \u007f-\u009f]/;

function rejectPisiExternalUrl(code, error) {
    return { ok: false, code, error };
}

function validatePisiExternalUrl(value) {
    if (typeof value !== 'string' || !value || value.length > PISI_EXTERNAL_URL_MAX_LENGTH) {
        return rejectPisiExternalUrl('URL_INVALID', 'Bağlantı adresi geçersiz.');
    }
    if (PISI_EXTERNAL_URL_FORBIDDEN_CHARACTERS.test(value)) {
        return rejectPisiExternalUrl('URL_FORBIDDEN_CHARACTERS', 'Bağlantı adresi boşluk veya kontrol karakteri içeremez.');
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        return rejectPisiExternalUrl('URL_INVALID', 'Bağlantı adresi geçersiz.');
    }
    if (!PISI_EXTERNAL_URL_PROTOCOLS.includes(url.protocol)) {
        return rejectPisiExternalUrl('URL_PROTOCOL_BLOCKED', 'Yalnız http, https ve mailto bağlantıları açılabilir.');
    }
    if (url.username || url.password) {
        return rejectPisiExternalUrl('URL_CREDENTIALS', 'Kullanıcı adı veya parola içeren bağlantılar açılmaz.');
    }
    if (url.protocol === 'mailto:' ? !url.pathname : !url.hostname) {
        return rejectPisiExternalUrl('URL_INVALID', 'Bağlantı adresi geçersiz.');
    }
    return { ok: true, url: url.href };
}

export { PISI_EXTERNAL_URL_MAX_LENGTH, PISI_EXTERNAL_URL_PROTOCOLS, validatePisiExternalUrl };
