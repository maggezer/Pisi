// Pure rules for note image blocks: no DOM access, unit-tested directly.
// Persisted HTML only carries a content-addressed reference into the owning
// note's sidecar folder; the displayed src is a runtime blob: URL.

export const PISI_IMAGE_REFERENCE_PATTERN = /^image\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
export const PISI_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PISI_IMAGE_STORED_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// SVG is never stored; it is rasterized to PNG before upload.
export const PISI_IMAGE_RASTERIZED_TYPES = Object.freeze(['image/svg+xml']);
export const PISI_IMAGE_PICKER_ACCEPT = [...PISI_IMAGE_STORED_TYPES, ...PISI_IMAGE_RASTERIZED_TYPES].join(',');
export const PISI_IMAGE_MIN_WIDTH = 40;
export const PISI_IMAGE_MAX_WIDTH = 4000;
const PISI_IMAGE_ALIGNMENTS = new Set(['left', 'center', 'right']);
const PISI_IMAGE_ALT_MAX = 500;
const PISI_LEGACY_IMAGE_SRC = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|\.{0,2}\/?assets\/)/i;

export function isPisiImageReference(value) {
    return PISI_IMAGE_REFERENCE_PATTERN.test(String(value || ''));
}

export function isPisiImageFileTypeAccepted(type) {
    const value = String(type || '').toLowerCase();
    return PISI_IMAGE_STORED_TYPES.includes(value) || PISI_IMAGE_RASTERIZED_TYPES.includes(value);
}

export function normalizePisiImageAlign(value) {
    const align = String(value || '').toLowerCase();
    return PISI_IMAGE_ALIGNMENTS.has(align) ? align : 'center';
}

export function normalizePisiImageWidth(value) {
    const width = Math.round(Number(value));
    if (!Number.isFinite(width) || width <= 0) return '';
    return String(Math.min(PISI_IMAGE_MAX_WIDTH, Math.max(PISI_IMAGE_MIN_WIDTH, width)));
}

export function normalizePisiImageAlt(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, PISI_IMAGE_ALT_MAX);
}

/**
 * Attribute policy for IMG elements in saved and loaded editor HTML.
 * An image with an asset reference never keeps a src: the blob: URL is runtime only.
 */
export function isPisiImageElementAttributeAllowed(name, value, hasAssetReference) {
    if (name === 'data-pisi-image-asset') return isPisiImageReference(value);
    if (name === 'data-pisi-image-width') return normalizePisiImageWidth(value) === String(value);
    if (name === 'src') return !hasAssetReference && PISI_LEGACY_IMAGE_SRC.test(String(value || ''));
    if (name === 'alt') return String(value).length <= PISI_IMAGE_ALT_MAX;
    return name === 'width' || name === 'height';
}

/** Returns null when the attribute is not an image-block attribute. */
export function isPisiImageBlockAttributeAllowed(name, value) {
    if (name === 'data-pisi-image-block') return value === '1';
    if (name === 'data-pisi-image-align') return PISI_IMAGE_ALIGNMENTS.has(String(value));
    return null;
}

function escapePisiImageAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function makePisiImageBlockHtml(config = {}) {
    if (!isPisiImageReference(config.reference)) return '';
    const blockId = escapePisiImageAttribute(config.blockId || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const align = normalizePisiImageAlign(config.align);
    const width = normalizePisiImageWidth(config.width);
    const widthAttr = width ? ` data-pisi-image-width="${width}"` : '';
    const alt = escapePisiImageAttribute(normalizePisiImageAlt(config.alt));
    return (
        `<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="${blockId}" data-pisi-block-type="image" data-pisi-image-block="1" ` +
        `data-pisi-image-align="${align}" contenteditable="false"${config.extra || ''}>` +
        `<img data-pisi-image-asset="${config.reference}" alt="${alt}"${widthAttr}></div>`
    );
}

export function serializePisiImageMarkdown(config = {}) {
    if (!isPisiImageReference(config.reference)) return '';
    const align = normalizePisiImageAlign(config.align);
    const width = normalizePisiImageWidth(config.width);
    return `{{pisi-image:${config.reference}:${align}:${width}:${encodeURIComponent(normalizePisiImageAlt(config.alt))}}}`;
}

export function parsePisiImageMarkdownLine(line = '') {
    const match = String(line).match(/^\{\{pisi-image:(image\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)):(left|center|right):(\d{0,4}):([^}]*)\}\}/);
    if (!match) return null;
    let alt = '';
    try {
        alt = decodeURIComponent(match[4]);
    } catch {}
    return { reference: match[1], align: match[2], width: normalizePisiImageWidth(match[3]), alt: normalizePisiImageAlt(alt) };
}

/**
 * Decides whether a paste should become image blocks. Files win only when the
 * accompanying HTML is not Pisi block HTML and carries no text: a browser image
 * copy qualifies, a Word selection that also ships a rendered PNG does not.
 */
export function shouldPisiPasteAsImageFiles({ fileTypes = [], html = '' } = {}) {
    if (!fileTypes.some(isPisiImageFileTypeAccepted)) return false;
    const markup = String(html || '');
    if (!markup.trim()) return true;
    if (/data-pisi-block-id\s*=/.test(markup)) return false;
    const text = markup
        .replace(/<(?:style|script|head)[\s\S]*?<\/(?:style|script|head)>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .trim();
    return !text;
}

export function formatPisiImageBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
}

const PISI_IMAGE_ERROR_MESSAGES = Object.freeze({
    IMAGE_TOO_LARGE: 'Görsel 20 MB sınırını aşıyor.',
    IMAGE_UNSUPPORTED: 'Desteklenmeyen görsel biçimi. PNG, JPEG, GIF, WebP veya SVG kullanın.',
    IMAGE_INVALID_DIMENSIONS: 'Görsel boyutları geçersiz.',
    IMAGE_EMPTY: 'Görsel verisi boş.',
    IMAGE_NO_NOTE: 'Görsel eklemek için önce bir not açın.',
    IMAGE_SVG_FAILED: 'SVG görseli dönüştürülemedi.'
});

export function getPisiImageErrorMessage(code, fallback = '') {
    return PISI_IMAGE_ERROR_MESSAGES[code] || fallback || 'Görsel eklenemedi.';
}
