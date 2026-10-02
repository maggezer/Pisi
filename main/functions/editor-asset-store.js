'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PISI_PAINT_ASSET_PATTERN = /^paint\/([a-f0-9]{64})\.png$/;
const PISI_SHEET_ASSET_PATTERN = /^sheet\/([a-f0-9]{64})\.json$/;
const PISI_PAINT_MAX_BYTES = 20 * 1024 * 1024;
const PISI_SHEET_MAX_BYTES = 64 * 1024 * 1024;
const PISI_PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
        .replace(/"/g, '&quot;');
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

    const paintDirectory = path.join(sidecarPath, 'paint');
    const assetPath = path.join(paintDirectory, `${reference.hash}.png`);

    globalThis.markInternalFileChange?.(paintDirectory, assetPath);
    fs.mkdirSync(paintDirectory, { recursive: true });

    if (fs.existsSync(assetPath)) {
        const existing = fs.readFileSync(assetPath);
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingHash !== reference.hash) {
            throw new Error('Paint asset hash çakışması algılandı.');
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
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
            const codePoint = Number.parseInt(hex, 16);
            return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
        })
        .replace(/&#(\d+);/g, (_match, decimal) => {
            const codePoint = Number.parseInt(decimal, 10);
            return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
        })
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function normalizePisiSheetSnapshot(value) {
    const decoded = decodePisiHtmlAttributeValue(value);
    if (!decoded) {
        return { ok: false, error: 'Sheet modeli boş.' };
    }

    if (Buffer.byteLength(decoded, 'utf8') > PISI_SHEET_MAX_BYTES) {
        return { ok: false, error: 'Sheet modeli izin verilen boyutu aşıyor.' };
    }

    let snapshot;
    try {
        snapshot = JSON.parse(decoded);
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

        const reference = getPisiSheetAssetReference(modelValue);
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

function normalizePisiEditorAssets(content = '', options = {}) {
    const paint = normalizePisiEditorPaintAssets(content, options);
    const sheet = normalizePisiEditorSheetAssets(paint.content, options);

    return {
        content: sheet.content,
        assets: Array.from(new Set([...(paint.assets || []), ...(sheet.assets || [])])),
        written: Array.from(new Set([...(paint.written || []), ...(sheet.written || [])]))
    };
}

function hydratePisiEditorAssets(content = '', options = {}) {
    return hydratePisiEditorSheetAssets(hydratePisiEditorPaintAssets(content, options), options);
}

module.exports = {
    PISI_PAINT_ASSET_PATTERN,
    PISI_SHEET_ASSET_PATTERN,
    PISI_SHEET_MAX_BYTES,
    PISI_PAINT_MAX_BYTES,
    decodePisiPaintPngDataUrl,
    getPisiPaintAssetReference,
    getPisiSheetAssetReference,
    normalizePisiEditorPaintAssets,
    hydratePisiEditorPaintAssets,
    normalizePisiEditorSheetAssets,
    hydratePisiEditorSheetAssets,
    normalizePisiEditorAssets,
    hydratePisiEditorAssets
};
