// Pure rules for note attachment blocks: no DOM access, unit-tested directly.
// A block stores a content-addressed reference into the owning note's sidecar
// (file/<sha256>.<ext>) plus the original name and byte size. Main decides
// whether a click opens the file or only reveals it; the executable list here
// only chooses the label shown to the user.

import { isPisiImageFileTypeAccepted } from './pisi-editor-image-policy.mjs';

export const PISI_FILE_REFERENCE_PATTERN = /^file\/[a-f0-9]{64}\.[a-z0-9]{1,16}$/;
export const PISI_FILE_MAX_BYTES = 20 * 1024 * 1024;
const PISI_FILE_NAME_MAX = 255;

const PISI_FILE_KIND_EXTENSIONS = Object.freeze({
    pdf: ['pdf'],
    doc: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages'],
    sheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
    slides: ['ppt', 'pptx', 'odp', 'key'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
    video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic', 'ico']
});
export const PISI_FILE_KINDS = Object.freeze([...Object.keys(PISI_FILE_KIND_EXTENSIONS), 'executable', 'file']);

// Mirrors PISI_EXECUTABLE_FILE_EXTENSIONS in main/functions/editor-file-asset-store.js.
const PISI_EXECUTABLE_EXTENSIONS = new Set(
    (
        'exe msi msix msp appx appxbundle bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse mjs cjs wsf wsh hta jar ' +
        'app command tool sh bash zsh csh fish ksh run bin desktop appimage deb rpm dmg pkg mpkg lnk url reg inf scf gadget ' +
        'py pyw pl rb php apk xpi'
    ).split(' ')
);

export function isPisiFileReference(value) {
    return PISI_FILE_REFERENCE_PATTERN.test(String(value || ''));
}

export function getPisiFileReferenceExtension(reference) {
    return isPisiFileReference(reference) ? String(reference).slice(String(reference).lastIndexOf('.') + 1) : '';
}

export function isPisiExecutableFileExtension(ext) {
    return PISI_EXECUTABLE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

export function getPisiFileKind(ext) {
    const value = String(ext || '').toLowerCase();
    if (isPisiExecutableFileExtension(value)) return 'executable';
    for (const [kind, extensions] of Object.entries(PISI_FILE_KIND_EXTENSIONS)) {
        if (extensions.includes(value)) return kind;
    }
    return 'file';
}

export function normalizePisiFileName(value) {
    const name = String(value ?? '')
        .normalize('NFC')
        .replace(/[\u0000-\u001f\u007f/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+$/, '')
        .slice(0, PISI_FILE_NAME_MAX)
        .trim();
    return name || 'dosya';
}

export function normalizePisiFileSize(value) {
    const size = Number(value);
    return Number.isSafeInteger(size) && size >= 0 && size <= PISI_FILE_MAX_BYTES ? size : 0;
}

export function formatPisiFileSize(bytes) {
    const value = normalizePisiFileSize(bytes);
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
}

/** Returns null when the attribute is not an attachment-block attribute. */
export function isPisiFileBlockAttributeAllowed(name, value) {
    const text = String(value ?? '');
    if (name === 'data-pisi-file-block') return text === '1';
    if (name === 'data-pisi-file-asset') return isPisiFileReference(text);
    if (name === 'data-pisi-file-name') return text.length > 0 && text.length <= PISI_FILE_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(text);
    if (name === 'data-pisi-file-size') return /^\d{1,9}$/.test(text) && normalizePisiFileSize(text) === Number(text);
    if (name === 'data-pisi-file-kind') return PISI_FILE_KINDS.includes(text);
    return null;
}

function escapePisiFileHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Inner markup is derived from the attributes and rebuilt on load. */
export function makePisiFileBlockInnerHtml(config = {}) {
    const name = escapePisiFileHtml(normalizePisiFileName(config.name));
    const size = escapePisiFileHtml(formatPisiFileSize(config.size));
    return `<span class="pisi-file-icon" aria-hidden="true"></span><span class="pisi-file-name">${name}</span><span class="pisi-file-size">${size}</span>`;
}

export function makePisiFileBlockHtml(config = {}) {
    if (!isPisiFileReference(config.reference)) return '';
    const blockId = escapePisiFileHtml(config.blockId || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const name = normalizePisiFileName(config.name);
    const size = normalizePisiFileSize(config.size);
    const kind = getPisiFileKind(getPisiFileReferenceExtension(config.reference));
    return (
        `<div class="pisi-editor-block pisi-file-block" data-pisi-block-id="${blockId}" data-pisi-block-type="file" data-pisi-file-block="1" ` +
        `data-pisi-file-asset="${config.reference}" data-pisi-file-name="${escapePisiFileHtml(name)}" data-pisi-file-size="${size}" ` +
        `data-pisi-file-kind="${kind}" contenteditable="false">${makePisiFileBlockInnerHtml({ name, size })}</div>`
    );
}

export function serializePisiFileMarkdown(config = {}) {
    if (!isPisiFileReference(config.reference)) return '';
    return `{{pisi-file:${config.reference}:${normalizePisiFileSize(config.size)}:${encodeURIComponent(normalizePisiFileName(config.name))}}}`;
}

export function parsePisiFileMarkdownLine(line = '') {
    const match = String(line).match(/^\{\{pisi-file:(file\/[a-f0-9]{64}\.[a-z0-9]{1,16}):(\d{1,9}):([^}]*)\}\}/);
    if (!match) return null;
    let name = '';
    try {
        name = decodeURIComponent(match[3]);
    } catch {}
    return { reference: match[1], size: normalizePisiFileSize(match[2]), name: normalizePisiFileName(name) };
}

/** Image files become image blocks; every other dropped or pasted file becomes an attachment. */
export function splitPisiDroppedFiles(files = []) {
    const images = [];
    const attachments = [];
    for (const file of Array.from(files || [])) {
        if (!file) continue;
        if (isPisiImageFileTypeAccepted(file.type)) images.push(file);
        else attachments.push(file);
    }
    return { images, attachments };
}

const PISI_FILE_ERROR_MESSAGES = Object.freeze({
    FILE_TOO_LARGE: 'Dosya 20 MB sınırını aşıyor.',
    FILE_EMPTY: 'Dosya boş.',
    FILE_NO_NOTE: 'Dosya eklemek için önce bir not açın.',
    FILE_NOT_FOUND: 'Ek dosyası bulunamadı.',
    FILE_CORRUPT: 'Ek dosyası bozuk.',
    FILE_OPEN_FAILED: 'Dosya açılamadı.',
    FILE_REFERENCE_INVALID: 'Ek referansı geçersiz.'
});

export function getPisiFileErrorMessage(code, fallback = '') {
    return PISI_FILE_ERROR_MESSAGES[code] || fallback || 'Dosya eklenemedi.';
}
