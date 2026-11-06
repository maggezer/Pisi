import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PISI_PAINT_ASSET_PATTERN = /^paint\/([a-f0-9]{64})\.png$/;
const PISI_SHEET_ASSET_PATTERN = /^sheet\/([a-f0-9]{64})\.json$/;
const PISI_PAINT_MAX_BYTES = 20 * 1024 * 1024;
const PISI_SHEET_MAX_BYTES = 64 * 1024 * 1024;
const PISI_PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PISI_IMAGE_ASSET_PATTERN = /^image\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const PISI_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const PISI_IMAGE_MAX_DIMENSION = 32768;
// Image assets are written on insert, before the note is saved, and undo can
// bring a deleted image back. Unreferenced images are therefore only pruned
// once they are older than this grace period.
const PISI_IMAGE_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
// Attachments: any extension the store accepts (see editor-file-asset-store.js).
const PISI_FILE_ASSET_PATTERN = /^file\/([a-f0-9]{64})\.([a-z0-9]{1,16})$/;
const PISI_IMAGE_MIME_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' });

function escapePisiEditorAssetRegExp(value) {
    return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function getPisiHtmlAttribute(tag, attributeName) {
    const escaped = escapePisiEditorAssetRegExp(attributeName);
    const pattern = new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = String(tag || '').match(pattern);
    return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function hasPisiHtmlAttribute(tag, attributeName) {
    const escaped = escapePisiEditorAssetRegExp(attributeName);
    return new RegExp(`\\s${escaped}(?:\\s*=|\\s|/?>)`, 'i').test(String(tag || ''));
}

function removePisiHtmlAttribute(tag, attributeName) {
    const escaped = escapePisiEditorAssetRegExp(attributeName);
    return String(tag || '').replace(new RegExp(`\\s+${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'ig'), '');
}

function setPisiHtmlAttribute(tag, attributeName, value) {
    const withoutExisting = removePisiHtmlAttribute(tag, attributeName);
    const safeValue = String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return withoutExisting.replace(/\s*\/?>$/, (ending) => ` ${attributeName}="${safeValue}"${ending.trimStart()}`);
}

function decodePisiPaintPngDataUrl(value) {
    const match = String(value || '').match(/^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match) {
        return {
            ok: false,
            error: 'Paint canvas PNG verisi geçersiz.'
        };
    }

    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > PISI_PAINT_MAX_BYTES) {
        return {
            ok: false,
            error: 'Paint canvas PNG boyutu geçersiz.'
        };
    }
    if (buffer.length < PISI_PNG_SIGNATURE.length || !PISI_PNG_SIGNATURE.equals(buffer.subarray(0, PISI_PNG_SIGNATURE.length))) {
        return {
            ok: false,
            error: 'Paint canvas PNG imzası geçersiz.'
        };
    }

    return { ok: true, buffer };
}

function getPisiPaintAssetReference(buffer) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
        hash,
        relativePath: `paint/${hash}.png`
    };
}

function writePisiPaintAsset(sidecarPath, reference, buffer) {
    if (!sidecarPath) {
        throw new Error('Paint asset sidecar klasörü bulunamadı.');
    }
    return writePisiContentAddressedAsset(sidecarPath, 'paint', `${reference.hash}.png`, reference.hash, buffer, 'Paint');
}

// Writes an immutable, content-addressed sidecar file atomically. An existing
// file with the same name must already hold the same bytes (hash-verified).
function writePisiContentAddressedAsset(sidecarPath, directoryName, fileName, hash, buffer, label = 'Editor') {
    const paintDirectory = path.join(sidecarPath, directoryName);
    const assetPath = path.join(paintDirectory, fileName);
    const reference = { hash };

    globalThis.markInternalFileChange?.(paintDirectory, assetPath);
    fs.mkdirSync(paintDirectory, { recursive: true });

    if (fs.existsSync(assetPath)) {
        const existing = fs.readFileSync(assetPath);
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingHash !== reference.hash) {
            throw new Error(`${label} asset hash çakışması algılandı.`);
        }
        globalThis.sealInternalFileChange?.(paintDirectory, assetPath);
        return { assetPath, written: false };
    }

    const temporaryPath = path.join(paintDirectory, `.${reference.hash}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let descriptor = null;

    globalThis.markInternalFileChange?.(temporaryPath);

    try {
        descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;

        if (typeof globalThis.renamePathInternal === 'function') {
            globalThis.renamePathInternal(temporaryPath, assetPath);
        } else {
            fs.renameSync(temporaryPath, assetPath);
        }

        globalThis.sealInternalFileChange?.(paintDirectory, assetPath, temporaryPath);
        return { assetPath, written: true };
    } catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }
        try {
            if (fs.existsSync(temporaryPath)) {
                fs.unlinkSync(temporaryPath);
            }
        } catch {}
        globalThis.sealInternalFileChange?.(temporaryPath);
        throw error;
    }
}

function normalizePisiEditorPaintAssets(content = '', options = {}) {
    const sidecarPath = options.sidecarPath || null;
    const writeAssets = options.writeAssets !== false;
    const assets = [];
    const written = [];

    const normalized = String(content || '').replace(/<canvas\b[^>]*>/gi, (canvasTag) => {
        if (!hasPisiHtmlAttribute(canvasTag, 'data-pisi-canvas')) {
            return canvasTag;
        }

        const imageValue = getPisiHtmlAttribute(canvasTag, 'data-image');
        const existingAsset = getPisiHtmlAttribute(canvasTag, 'data-pisi-asset');

        if (!imageValue) {
            if (existingAsset && !PISI_PAINT_ASSET_PATTERN.test(existingAsset)) {
                return removePisiHtmlAttribute(canvasTag, 'data-pisi-asset');
            }
            return canvasTag;
        }

        const decoded = decodePisiPaintPngDataUrl(imageValue);
        if (!decoded.ok) {
            throw new Error(decoded.error);
        }

        const reference = getPisiPaintAssetReference(decoded.buffer);
        assets.push(reference.relativePath);

        if (writeAssets) {
            const stored = writePisiPaintAsset(sidecarPath, reference, decoded.buffer);
            if (stored.written) written.push(reference.relativePath);
        }

        let nextTag = removePisiHtmlAttribute(canvasTag, 'data-image');
        nextTag = setPisiHtmlAttribute(nextTag, 'data-pisi-asset', reference.relativePath);
        return nextTag;
    });

    return {
        content: normalized,
        assets: Array.from(new Set(assets)),
        written: Array.from(new Set(written))
    };
}

function hydratePisiEditorPaintAssets(content = '', options = {}) {
    const sidecarPath = options.sidecarPath || null;

    if (!sidecarPath || !fs.existsSync(sidecarPath)) {
        return String(content || '');
    }

    return String(content || '').replace(/<canvas\b[^>]*>/gi, (canvasTag) => {
        if (!hasPisiHtmlAttribute(canvasTag, 'data-pisi-canvas')) {
            return canvasTag;
        }

        const reference = getPisiHtmlAttribute(canvasTag, 'data-pisi-asset');
        const match = String(reference || '').match(PISI_PAINT_ASSET_PATTERN);
        if (!match) return canvasTag;

        const assetPath = path.join(sidecarPath, 'paint', `${match[1]}.png`);
        if (!fs.existsSync(assetPath)) return canvasTag;

        const buffer = fs.readFileSync(assetPath);
        if (
            !buffer.length ||
            buffer.length > PISI_PAINT_MAX_BYTES ||
            buffer.length < PISI_PNG_SIGNATURE.length ||
            !PISI_PNG_SIGNATURE.equals(buffer.subarray(0, PISI_PNG_SIGNATURE.length))
        ) {
            return canvasTag;
        }

        const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
        if (actualHash !== match[1]) return canvasTag;

        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

        return setPisiHtmlAttribute(canvasTag, 'data-image', dataUrl);
    });
}

function decodePisiHtmlAttributeValue(value) {
    // Decode the HTML boundary once; decoded text can itself contain literal
    // entity spellings (for example &#38;quot; must remain &quot;).
    return String(value || '').replace(/&(?:#x([0-9a-f]+)|#(\d+)|(quot|apos|lt|gt|amp));/gi, (_match, hex, decimal, named) => {
        if (named) return { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }[named.toLowerCase()];
        const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    });
}

function normalizePisiSheetSnapshot(value) {
    // Sidecar JSON and object serialization are already raw data, not HTML.
    const source = String(value || '');
    if (!source) {
        return { ok: false, error: 'Sheet modeli boş.' };
    }

    if (Buffer.byteLength(source, 'utf8') > PISI_SHEET_MAX_BYTES) {
        return { ok: false, error: 'Sheet modeli izin verilen boyutu aşıyor.' };
    }

    let snapshot;
    try {
        snapshot = JSON.parse(source);
    } catch {
        return { ok: false, error: 'Sheet modeli geçerli JSON değil.' };
    }

    const valid = Boolean(
        snapshot &&
        typeof snapshot === 'object' &&
        !Array.isArray(snapshot) &&
        typeof snapshot.databaseId === 'string' &&
        snapshot.databaseId.length >= 8 &&
        snapshot.databaseId.length <= 160 &&
        Array.isArray(snapshot.fields) &&
        Array.isArray(snapshot.items) &&
        Array.isArray(snapshot.views)
    );

    if (!valid) {
        return { ok: false, error: 'Sheet modeli beklenen yapıda değil.' };
    }

    const json = JSON.stringify(snapshot);
    if (Buffer.byteLength(json, 'utf8') > PISI_SHEET_MAX_BYTES) {
        return { ok: false, error: 'Sheet modeli izin verilen boyutu aşıyor.' };
    }

    return { ok: true, snapshot, json };
}

function getPisiSheetAssetReference(value) {
    const normalized = typeof value === 'string' ? normalizePisiSheetSnapshot(value) : normalizePisiSheetSnapshot(JSON.stringify(value || {}));

    if (!normalized.ok) {
        throw new Error(normalized.error);
    }

    const buffer = Buffer.from(normalized.json, 'utf8');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
        hash,
        relativePath: `sheet/${hash}.json`,
        json: normalized.json,
        buffer
    };
}

function writePisiSheetAsset(sidecarPath, reference) {
    if (!sidecarPath) {
        throw new Error('Sheet asset sidecar klasörü bulunamadı.');
    }

    const sheetDirectory = path.join(sidecarPath, 'sheet');
    const assetPath = path.join(sheetDirectory, `${reference.hash}.json`);
    const buffer = reference.buffer || Buffer.from(reference.json || '', 'utf8');

    globalThis.markInternalFileChange?.(sheetDirectory, assetPath);
    fs.mkdirSync(sheetDirectory, { recursive: true });

    if (fs.existsSync(assetPath)) {
        const existing = fs.readFileSync(assetPath);
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');

        if (existingHash !== reference.hash) {
            throw new Error('Sheet asset hash çakışması algılandı.');
        }

        globalThis.sealInternalFileChange?.(sheetDirectory, assetPath);
        return { assetPath, written: false };
    }

    const temporaryPath = path.join(sheetDirectory, `.${reference.hash}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let descriptor = null;

    globalThis.markInternalFileChange?.(temporaryPath);

    try {
        descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;

        if (typeof globalThis.renamePathInternal === 'function') {
            globalThis.renamePathInternal(temporaryPath, assetPath);
        } else {
            fs.renameSync(temporaryPath, assetPath);
        }

        globalThis.sealInternalFileChange?.(sheetDirectory, assetPath, temporaryPath);

        return { assetPath, written: true };
    } catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }

        try {
            if (fs.existsSync(temporaryPath)) {
                fs.unlinkSync(temporaryPath);
            }
        } catch {}

        globalThis.sealInternalFileChange?.(temporaryPath);
        throw error;
    }
}

function normalizePisiEditorSheetAssets(content = '', options = {}) {
    const sidecarPath = options.sidecarPath || null;
    const writeAssets = options.writeAssets !== false;
    const assets = [];
    const written = [];

    const normalized = String(content || '').replace(/<table\b[^>]*>/gi, (tableTag) => {
        if (!hasPisiHtmlAttribute(tableTag, 'data-pisi-sheet')) {
            return tableTag;
        }

        const modelValue = getPisiHtmlAttribute(tableTag, 'data-pisi-sheet-model');
        const existingAsset = getPisiHtmlAttribute(tableTag, 'data-pisi-sheet-asset');

        if (!modelValue) {
            if (existingAsset && PISI_SHEET_ASSET_PATTERN.test(existingAsset)) {
                assets.push(existingAsset);
                return tableTag;
            }

            if (existingAsset) {
                return removePisiHtmlAttribute(tableTag, 'data-pisi-sheet-asset');
            }

            return tableTag;
        }

        const reference = getPisiSheetAssetReference(decodePisiHtmlAttributeValue(modelValue));
        assets.push(reference.relativePath);

        if (writeAssets) {
            const stored = writePisiSheetAsset(sidecarPath, reference);
            if (stored.written) {
                written.push(reference.relativePath);
            }
        }

        let nextTag = removePisiHtmlAttribute(tableTag, 'data-pisi-sheet-model');
        nextTag = setPisiHtmlAttribute(nextTag, 'data-pisi-sheet-asset', reference.relativePath);

        return nextTag;
    });

    return {
        content: normalized,
        assets: Array.from(new Set(assets)),
        written: Array.from(new Set(written))
    };
}

function hydratePisiEditorSheetAssets(content = '', options = {}) {
    const sidecarPath = options.sidecarPath || null;

    if (!sidecarPath || !fs.existsSync(sidecarPath)) {
        return String(content || '');
    }

    return String(content || '').replace(/<table\b[^>]*>/gi, (tableTag) => {
        if (!hasPisiHtmlAttribute(tableTag, 'data-pisi-sheet')) {
            return tableTag;
        }

        const reference = getPisiHtmlAttribute(tableTag, 'data-pisi-sheet-asset');
        const match = String(reference || '').match(PISI_SHEET_ASSET_PATTERN);

        if (!match) return tableTag;

        const assetPath = path.join(sidecarPath, 'sheet', `${match[1]}.json`);

        if (!fs.existsSync(assetPath)) return tableTag;

        const buffer = fs.readFileSync(assetPath);
        if (!buffer.length || buffer.length > PISI_SHEET_MAX_BYTES) {
            return tableTag;
        }

        const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');

        if (actualHash !== match[1]) return tableTag;

        const normalized = normalizePisiSheetSnapshot(buffer.toString('utf8'));

        if (!normalized.ok) return tableTag;

        return setPisiHtmlAttribute(tableTag, 'data-pisi-sheet-model', normalized.json);
    });
}

function readPisiJpegDimensions(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) return null;
        const marker = buffer[offset + 1];
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2) return null;
        // SOF0..SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
        }
        offset += 2 + length;
    }
    return null;
}

function readPisiWebpDimensions(buffer) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.length >= 30) {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && buffer.length >= 30) {
        return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    }
    return null;
}

/**
 * Identifies an image by its leading bytes, never by file name or declared MIME.
 * @param {Buffer} buffer
 */
function detectPisiImageFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    let ext = null;
    let size = null;
    if (buffer.length >= 24 && PISI_PNG_SIGNATURE.equals(buffer.subarray(0, 8)) && buffer.toString('ascii', 12, 16) === 'IHDR') {
        ext = 'png';
        size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        ext = 'jpg';
        size = readPisiJpegDimensions(buffer);
    } else if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) {
        ext = 'gif';
        size = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    } else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        ext = 'webp';
        size = readPisiWebpDimensions(buffer);
    }
    if (!ext || !size) return null;
    return { ext, mime: PISI_IMAGE_MIME_TYPES[ext], width: size.width, height: size.height };
}

function validatePisiImageBuffer(value) {
    const buffer = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!buffer || !buffer.length) {
        return { ok: false, code: 'IMAGE_EMPTY', error: 'Görsel verisi boş.' };
    }
    if (buffer.length > PISI_IMAGE_MAX_BYTES) {
        return { ok: false, code: 'IMAGE_TOO_LARGE', error: 'Görsel 20 MB sınırını aşıyor.', maxBytes: PISI_IMAGE_MAX_BYTES };
    }
    const format = detectPisiImageFormat(buffer);
    if (!format) {
        return { ok: false, code: 'IMAGE_UNSUPPORTED', error: 'Desteklenmeyen görsel biçimi. PNG, JPEG, GIF veya WebP kullanın.' };
    }
    if (!format.width || !format.height || format.width > PISI_IMAGE_MAX_DIMENSION || format.height > PISI_IMAGE_MAX_DIMENSION) {
        return { ok: false, code: 'IMAGE_INVALID_DIMENSIONS', error: 'Görsel boyutları geçersiz.' };
    }
    return { ok: true, buffer, ...format };
}

function getPisiImageAssetReference(buffer, ext) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { hash, relativePath: `image/${hash}.${ext}` };
}

function resolvePisiImageAssetPath(sidecarPath, reference) {
    const match = String(reference || '').match(PISI_IMAGE_ASSET_PATTERN);
    if (!sidecarPath || !match) return null;
    const directory = path.resolve(sidecarPath, 'image');
    const assetPath = path.join(directory, `${match[1]}.${match[2]}`);
    return path.dirname(assetPath) === directory ? { assetPath, hash: match[1], ext: match[2] } : null;
}

function writePisiImageAsset(sidecarPath, value) {
    if (!sidecarPath) throw new Error('Görsel için not yan klasörü bulunamadı.');
    const result = validatePisiImageBuffer(value);
    if (!result.ok) return result;
    const validated = /** @type {{ buffer: Buffer, ext: string, mime: string, width: number, height: number }} */ (result);
    const reference = getPisiImageAssetReference(validated.buffer, validated.ext);
    const stored = writePisiContentAddressedAsset(sidecarPath, 'image', `${reference.hash}.${validated.ext}`, reference.hash, validated.buffer, 'Görsel');
    if (!stored.written) {
        // A re-inserted image restarts the orphan grace period.
        const now = new Date();
        fs.utimesSync(stored.assetPath, now, now);
    }
    return {
        ok: true,
        reference: reference.relativePath,
        mime: validated.mime,
        width: validated.width,
        height: validated.height,
        bytes: validated.buffer.length,
        written: stored.written
    };
}

function readPisiImageAsset(sidecarPath, reference) {
    const resolved = resolvePisiImageAssetPath(sidecarPath, reference);
    if (!resolved) return { ok: false, code: 'IMAGE_REFERENCE_INVALID', error: 'Görsel referansı geçersiz.' };
    if (!fs.existsSync(resolved.assetPath) || !fs.statSync(resolved.assetPath).isFile()) {
        return { ok: false, code: 'IMAGE_NOT_FOUND', error: 'Görsel dosyası bulunamadı.' };
    }
    if (fs.statSync(resolved.assetPath).size > PISI_IMAGE_MAX_BYTES) {
        return { ok: false, code: 'IMAGE_TOO_LARGE', error: 'Görsel 20 MB sınırını aşıyor.' };
    }
    const buffer = fs.readFileSync(resolved.assetPath);
    const format = detectPisiImageFormat(buffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (!format || format.ext !== resolved.ext || hash !== resolved.hash) {
        return { ok: false, code: 'IMAGE_CORRUPT', error: 'Görsel dosyası bozuk.' };
    }
    return { ok: true, reference: String(reference), buffer, mime: format.mime, width: format.width, height: format.height };
}

// Live image elements carry a runtime-only blob: src. Persisted HTML keeps only
// the asset reference; an image tag with an invalid reference is dropped.
function normalizePisiEditorImageAssets(content = '') {
    const assets = [];
    const normalized = String(content || '').replace(/<img\b[^>]*>/gi, (imageTag) => {
        if (!hasPisiHtmlAttribute(imageTag, 'data-pisi-image-asset')) return imageTag;
        const reference = getPisiHtmlAttribute(imageTag, 'data-pisi-image-asset');
        if (!PISI_IMAGE_ASSET_PATTERN.test(String(reference || ''))) return '';
        assets.push(String(reference));
        return removePisiHtmlAttribute(imageTag, 'src');
    });
    return { content: normalized, assets: Array.from(new Set(assets)), written: [] };
}

function collectPisiEditorImageReferences(content = '') {
    const references = new Set();
    String(content || '').replace(/<img\b[^>]*>/gi, (imageTag) => {
        const reference = getPisiHtmlAttribute(imageTag, 'data-pisi-image-asset');
        if (PISI_IMAGE_ASSET_PATTERN.test(String(reference || ''))) references.add(String(reference));
        return imageTag;
    });
    return Array.from(references);
}

function collectPisiEditorFileReferences(content = '') {
    const references = new Set();
    String(content || '').replace(/<div\b[^>]*>/gi, (divTag) => {
        const reference = getPisiHtmlAttribute(divTag, 'data-pisi-file-asset');
        if (PISI_FILE_ASSET_PATTERN.test(String(reference || ''))) references.add(String(reference));
        return divTag;
    });
    return Array.from(references);
}

function collectPisiEditorAssetReferences(content = '') {
    const references = new Set();

    String(content || '').replace(/<canvas\b[^>]*>/gi, (canvasTag) => {
        if (!hasPisiHtmlAttribute(canvasTag, 'data-pisi-canvas')) {
            return canvasTag;
        }

        const reference = getPisiHtmlAttribute(canvasTag, 'data-pisi-asset');
        if (PISI_PAINT_ASSET_PATTERN.test(String(reference || ''))) {
            references.add(String(reference));
        }
        return canvasTag;
    });

    String(content || '').replace(/<table\b[^>]*>/gi, (tableTag) => {
        if (!hasPisiHtmlAttribute(tableTag, 'data-pisi-sheet')) {
            return tableTag;
        }

        const reference = getPisiHtmlAttribute(tableTag, 'data-pisi-sheet-asset');
        if (PISI_SHEET_ASSET_PATTERN.test(String(reference || ''))) {
            references.add(String(reference));
        }
        return tableTag;
    });

    for (const reference of collectPisiEditorImageReferences(content)) references.add(reference);
    for (const reference of collectPisiEditorFileReferences(content)) references.add(reference);

    return Array.from(references).sort();
}

/**
 * @param {string | null | undefined} sidecarPath
 * @param {Iterable<string>} [referencedAssets]
 * @param {{ now?: number }} [options]
 */
function prunePisiEditorAssetStore(sidecarPath, referencedAssets = [], options = {}) {
    if (!sidecarPath || !fs.existsSync(sidecarPath)) {
        return {
            ok: true,
            skipped: true,
            kept: [],
            removed: [],
            ignored: []
        };
    }

    const rawReferences = Array.from(referencedAssets || []);
    const references = new Set(
        rawReferences
            .map((value) => String(value || ''))
            .filter(
                (value) =>
                    PISI_PAINT_ASSET_PATTERN.test(value) ||
                    PISI_SHEET_ASSET_PATTERN.test(value) ||
                    PISI_IMAGE_ASSET_PATTERN.test(value) ||
                    PISI_FILE_ASSET_PATTERN.test(value)
            )
    );
    const kept = [];
    const removed = [];
    const ignored = [];

    const stores = [
        {
            directoryName: 'paint',
            filePattern: /^[a-f0-9]{64}\.png$/,
            relativePath(name) {
                return `paint/${name}`;
            }
        },
        {
            directoryName: 'sheet',
            filePattern: /^[a-f0-9]{64}\.json$/,
            relativePath(name) {
                return `sheet/${name}`;
            }
        },
        {
            directoryName: 'image',
            filePattern: /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/,
            graceMs: PISI_IMAGE_ORPHAN_GRACE_MS,
            relativePath(name) {
                return `image/${name}`;
            }
        },
        {
            directoryName: 'file',
            filePattern: /^[a-f0-9]{64}\.[a-z0-9]{1,16}$/,
            graceMs: PISI_IMAGE_ORPHAN_GRACE_MS,
            relativePath(name) {
                return `file/${name}`;
            }
        }
    ];
    const now = Number.isFinite(options.now) ? options.now : Date.now();

    try {
        for (const store of stores) {
            const directory = path.join(sidecarPath, store.directoryName);
            if (!fs.existsSync(directory)) continue;

            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const relativePath = store.relativePath(entry.name);

                if (!entry.isFile() || !store.filePattern.test(entry.name)) {
                    ignored.push(relativePath);
                    continue;
                }

                if (references.has(relativePath)) {
                    kept.push(relativePath);
                    continue;
                }

                const assetPath = path.join(directory, entry.name);
                if (store.graceMs && now - fs.statSync(assetPath).mtimeMs < store.graceMs) {
                    kept.push(relativePath);
                    continue;
                }
                globalThis.markInternalFileChange?.(directory, assetPath);
                try {
                    fs.unlinkSync(assetPath);
                    removed.push(relativePath);
                } finally {
                    globalThis.sealInternalFileChange?.(directory, assetPath);
                }
            }
        }

        return {
            ok: true,
            skipped: false,
            kept: kept.sort(),
            removed: removed.sort(),
            ignored: ignored.sort()
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error || 'Editor asset cleanup başarısız.'),
            kept: kept.sort(),
            removed: removed.sort(),
            ignored: ignored.sort()
        };
    }
}

function normalizePisiEditorAssets(content = '', options = {}) {
    const paint = normalizePisiEditorPaintAssets(content, options);
    const sheet = normalizePisiEditorSheetAssets(paint.content, options);
    const image = normalizePisiEditorImageAssets(sheet.content);

    return {
        content: image.content,
        assets: Array.from(new Set([...(paint.assets || []), ...(sheet.assets || []), ...image.assets])),
        written: Array.from(new Set([...(paint.written || []), ...(sheet.written || [])]))
    };
}

function hydratePisiEditorAssets(content = '', options = {}) {
    return hydratePisiEditorSheetAssets(hydratePisiEditorPaintAssets(content, options), options);
}

export {
    PISI_FILE_ASSET_PATTERN,
    writePisiContentAddressedAsset,
    collectPisiEditorFileReferences,
    PISI_IMAGE_ASSET_PATTERN,
    PISI_IMAGE_MAX_BYTES,
    PISI_IMAGE_MIME_TYPES,
    PISI_IMAGE_ORPHAN_GRACE_MS,
    detectPisiImageFormat,
    validatePisiImageBuffer,
    getPisiImageAssetReference,
    writePisiImageAsset,
    readPisiImageAsset,
    normalizePisiEditorImageAssets,
    PISI_PAINT_ASSET_PATTERN,
    PISI_SHEET_ASSET_PATTERN,
    PISI_SHEET_MAX_BYTES,
    PISI_PAINT_MAX_BYTES,
    decodePisiPaintPngDataUrl,
    getPisiPaintAssetReference,
    getPisiSheetAssetReference,
    collectPisiEditorAssetReferences,
    prunePisiEditorAssetStore,
    normalizePisiEditorPaintAssets,
    hydratePisiEditorPaintAssets,
    normalizePisiEditorSheetAssets,
    hydratePisiEditorSheetAssets,
    normalizePisiEditorAssets,
    hydratePisiEditorAssets
};
