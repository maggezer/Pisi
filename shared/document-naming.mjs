// File and sidecar naming rules for .node and .map documents. Pure string
// rules only: looking at the disk (does this name exist?) stays with the caller.

import { normalizePisiId } from './ids.mjs';

function isPisiVisibleFile(fileName) {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.map') || lower.endsWith('.node');
}

function isPisiManagedSidecarFolder(folderName) {
    if (!folderName) return false;

    return folderName === '.pisi.lock' || /^(?:inv|nd)_.+__(?:node|map)_[A-Za-z0-9_-]{1,96}$/.test(folderName);
}

function getPisiFileExt(fileNameOrPath) {
    const lower = fileNameOrPath.toLowerCase();

    if (lower.endsWith('.node')) return '.node';
    if (lower.endsWith('.map')) return '.map';

    return '';
}

function getPisiTypeFromExt(ext) {
    if (ext === '.node') return 'node';
    if (ext === '.map') return 'map';
    return '';
}

function getPisiSidecarPrefix(ext) {
    if (ext === '.node') return 'inv_';
    if (ext === '.map') return 'nd_';
    return '';
}

function sanitizePisiBaseName(name) {
    let cleaned = String(name || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .slice(0, 120);

    const windowsStem = cleaned.split('.')[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)) {
        cleaned = `_${cleaned}`;
    }

    return cleaned || 'Yeni Dosya';
}

function stripPisiIdSuffix(baseName, id) {
    if (!baseName || !id) return baseName;

    const suffix = `__${id}`;

    if (baseName.endsWith(suffix)) {
        return baseName.slice(0, -suffix.length);
    }

    return baseName;
}

function sanitizeForSidecarName(name) {
    return sanitizePisiBaseName(name).replace(/\s+/g, ' ').slice(0, 80);
}

function getPisiSidecarName(title, ext, id) {
    const prefix = getPisiSidecarPrefix(ext);
    const safeId = normalizePisiId(id, ext);
    if (!prefix || !safeId) return null;

    const safeTitle = sanitizeForSidecarName(title);
    return `${prefix}${safeTitle}__${safeId}`;
}

/** Title shown for a document whose file is named `<rawBaseName><ext>`. */
function getPisiVisibleTitleFromBaseName(rawBaseName, id = '') {
    return sanitizePisiBaseName(stripPisiIdSuffix(rawBaseName, id));
}

/**
 * File name candidates for a document, in the order they are tried until one
 * is free: `Title.ext` (attempt 0), `Title__id.ext` (attempt 1), then
 * `Title__id_1.ext`, `Title__id_2.ext`, …
 */
function getPisiPhysicalFileName(wantedTitle, ext, id, attempt = 0) {
    const cleanTitle = sanitizePisiBaseName(wantedTitle);

    if (attempt <= 0) return cleanTitle + ext;
    if (attempt === 1) return `${cleanTitle}__${id}${ext}`;
    return `${cleanTitle}__${id}_${attempt - 1}${ext}`;
}

export {
    getPisiFileExt,
    getPisiPhysicalFileName,
    getPisiSidecarName,
    getPisiSidecarPrefix,
    getPisiTypeFromExt,
    getPisiVisibleTitleFromBaseName,
    isPisiManagedSidecarFolder,
    isPisiVisibleFile,
    sanitizeForSidecarName,
    sanitizePisiBaseName,
    stripPisiIdSuffix
};
