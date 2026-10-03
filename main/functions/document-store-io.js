import * as path from 'node:path';
import * as fs from 'node:fs';

function ensurePisiSidecar(filePath, metadata) {
    const ext = getPisiFileExt(filePath);
    const safeId = normalizePisiId(metadata?.id, ext);
    if (!ext || !safeId) return null;

    const dir = path.dirname(filePath);
    const desiredName = getPisiSidecarName(metadata.title, ext, safeId);
    if (!desiredName) return null;
    const desiredPath = path.join(dir, desiredName);

    const existingById = findExistingSidecarById(dir, ext, safeId);

    if (existingById && normalizePathForCompare(existingById) !== normalizePathForCompare(desiredPath)) {
        if (!fs.existsSync(desiredPath)) {
            renamePathInternal(existingById, desiredPath);
        }
    }

    if (!fs.existsSync(desiredPath)) {
        markInternalFileChange(desiredPath);
        fs.mkdirSync(desiredPath, { recursive: true });
        sealInternalFileChange(desiredPath);
    }

    return desiredPath;
}

function createUniquePisiFile(folderPath, ext, options = {}) {
    if (!folderPath || !fs.existsSync(folderPath)) {
        return {
            ok: false,
            error: 'Aktif klasör bulunamadı.'
        };
    }

    if (ext !== '.map' && ext !== '.node') {
        return {
            ok: false,
            error: 'Geçersiz PISI dosya türü.'
        };
    }

    const baseName = ext === '.map' ? translatePisiMain('Yeni Map') : translatePisiMain('Yeni Node');

    let fileName = baseName + ext;
    let fullPath = path.join(folderPath, fileName);
    let counter = 1;

    while (fs.existsSync(fullPath)) {
        fileName = `${baseName} ${counter}${ext}`;
        fullPath = path.join(folderPath, fileName);
        counter++;
    }

    const title = path.basename(fileName, ext);
    const id = generatePisiId(ext);

    const data = createPisiDocumentData({
        ext,
        title,
        id,
        parentMap: options.parentMap || 'none'
    });

    writePisiDocument(fullPath, data);

    const sidecarPath = ensurePisiSidecar(fullPath, data.pisi);

    return {
        ok: true,
        fileName,
        fullPath,
        sidecarPath,
        metadata: data.pisi
    };
}

export { createUniquePisiFile, ensurePisiSidecar };
