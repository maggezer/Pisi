// Renderer copy of main/functions/external-url-policy.js. It only gives early
// feedback in the link editor; the main process re-validates before opening.
// Both copies are exercised by the same vectors in tests/external-url-policy.test.mjs.

const PISI_EXTERNAL_URL_PROTOCOLS = Object.freeze(['http:', 'https:', 'mailto:']);
const PISI_EXTERNAL_URL_MAX_LENGTH = 8192;
const PISI_EXTERNAL_URL_FORBIDDEN_CHARACTERS = /[\u0000- \u007f-\u009f]/;

function rejectPisiExternalUrl(code, error) {
    return { ok: false, code, error };
}

export function validatePisiExternalUrl(value) {
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

/**
 * Turns what a user types in the link editor into a URL: a bare e-mail address
 * becomes mailto:, anything else without a scheme gets https://.
 */
export function normalizePisiLinkInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    // An explicit scheme is kept so that dangerous ones are rejected, never
    // hidden behind https://. "host:8080" is a port, not a scheme.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:mailto|javascript|vbscript|data|file|blob|about|tel|ftp):/i.test(text)) return text;
    if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
    return `https://${text.replace(/^\/\/+/, '')}`;
}

export function preparePisiLinkUrl(value) {
    const normalized = normalizePisiLinkInput(value);
    return normalized ? validatePisiExternalUrl(normalized) : rejectPisiExternalUrl('URL_INVALID', 'Bağlantı adresi geçersiz.');
}
