import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PISI_FILE_ASSET_PATTERN, writePisiContentAddressedAsset } from './editor-asset-store.js';

// Non-image attachments live beside images in the owning note's sidecar as
// file/<sha256>.<ext>. The content hash names the file, so the same bytes are
// stored once whatever they were called; the original name and size are kept
// on the block. Nothing here launches a file: main/functions/editor-asset-domain.js
// decides between opening and revealing, using isPisiExecutableFileExtension.

const PISI_FILE_MAX_BYTES = 20 * 1024 * 1024;
const PISI_FILE_NAME_MAX = 255;
const PISI_FILE_FALLBACK_EXT = 'bin';

// Opening any of these would run code, so Pisi only shows them in their folder.
const PISI_EXECUTABLE_FILE_EXTENSIONS = new Set(
    (
        'exe msi msix msp appx appxbundle bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse mjs cjs wsf wsh hta jar ' +
        'app command tool sh bash zsh csh fish ksh run bin desktop appimage deb rpm dmg pkg mpkg lnk url reg inf scf gadget ' +
        'py pyw pl rb php apk xpi'
    ).split(' ')
);

function normalizePisiFileName(value) {
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

function getPisiFileExtension(name) {
    const base = String(name || '');
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return PISI_FILE_FALLBACK_EXT;
    const ext = base.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,16}$/.test(ext) ? ext : PISI_FILE_FALLBACK_EXT;
}

function isPisiExecutableFileExtension(ext) {
    return PISI_EXECUTABLE_FILE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

function toPisiFileBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    return null;
}

function resolvePisiFileAssetPath(sidecarPath, reference) {
    const match = String(reference || '').match(PISI_FILE_ASSET_PATTERN);
    if (!sidecarPath || !match) return null;
    const directory = path.resolve(sidecarPath, 'file');
    const assetPath = path.join(directory, `${match[1]}.${match[2]}`);
    return path.dirname(assetPath) === directory ? { assetPath, hash: match[1], ext: match[2] } : null;
}

function writePisiFileAsset(sidecarPath, value, fileName = '') {
    if (!sidecarPath) throw new Error('Dosya için not yan klasörü bulunamadı.');
    const buffer = toPisiFileBuffer(value);
    if (!buffer || !buffer.length) return { ok: false, code: 'FILE_EMPTY', error: 'Dosya boş.' };
    if (buffer.length > PISI_FILE_MAX_BYTES) {
        return { ok: false, code: 'FILE_TOO_LARGE', error: 'Dosya 20 MB sınırını aşıyor.', maxBytes: PISI_FILE_MAX_BYTES };
    }
    const name = normalizePisiFileName(fileName);
    const ext = getPisiFileExtension(name);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const stored = writePisiContentAddressedAsset(sidecarPath, 'file', `${hash}.${ext}`, hash, buffer, 'Dosya');
    if (!stored.written) {
        // A re-attached file restarts the orphan grace period.
        const now = new Date();
        fs.utimesSync(stored.assetPath, now, now);
    }
    return {
        ok: true,
        reference: `file/${hash}.${ext}`,
        name,
        ext,
        size: buffer.length,
        executable: isPisiExecutableFileExtension(ext),
        written: stored.written
    };
}

/** Checks that the asset exists and still matches its hash; returns its path for main-only use. */
function statPisiFileAsset(sidecarPath, reference) {
    const resolved = resolvePisiFileAssetPath(sidecarPath, reference);
    if (!resolved) return { ok: false, code: 'FILE_REFERENCE_INVALID', error: 'Dosya referansı geçersiz.' };
    let stat = null;
    try {
        stat = fs.lstatSync(resolved.assetPath);
    } catch {
        return { ok: false, code: 'FILE_NOT_FOUND', error: 'Dosya bulunamadı.' };
    }
    if (!stat.isFile()) return { ok: false, code: 'FILE_NOT_FOUND', error: 'Dosya bulunamadı.' };
    if (stat.size > PISI_FILE_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE', error: 'Dosya 20 MB sınırını aşıyor.' };
    const hash = crypto.createHash('sha256').update(fs.readFileSync(resolved.assetPath)).digest('hex');
    if (hash !== resolved.hash) return { ok: false, code: 'FILE_CORRUPT', error: 'Dosya bozuk.' };
    return {
        ok: true,
        reference: String(reference),
        assetPath: resolved.assetPath,
        ext: resolved.ext,
        size: stat.size,
        executable: isPisiExecutableFileExtension(resolved.ext)
    };
}

/** Copies an attachment between two note sidecars; used when a block is pasted into another note. */
function copyPisiFileAsset(sourceSidecarPath, targetSidecarPath, reference) {
    const source = statPisiFileAsset(sourceSidecarPath, reference);
    if (!source.ok) return source;
    const match = String(reference).match(PISI_FILE_ASSET_PATTERN);
    const buffer = fs.readFileSync(source.assetPath);
    const stored = writePisiContentAddressedAsset(targetSidecarPath, 'file', `${match[1]}.${match[2]}`, match[1], buffer, 'Dosya');
    return { ok: true, reference: String(reference), size: buffer.length, written: stored.written };
}

export {
    PISI_FILE_MAX_BYTES,
    PISI_EXECUTABLE_FILE_EXTENSIONS,
    normalizePisiFileName,
    getPisiFileExtension,
    isPisiExecutableFileExtension,
    resolvePisiFileAssetPath,
    writePisiFileAsset,
    statPisiFileAsset,
    copyPisiFileAsset
};
