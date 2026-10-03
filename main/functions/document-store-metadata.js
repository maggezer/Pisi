import * as path from 'node:path';
import * as fs from 'node:fs';
import { ensurePisiSidecar } from './document-store-io.js';

function ensurePisiFileMetadata(filePath, options = {}) {
    const persist = options.persist !== false;
    const ensureSidecar = options.ensureSidecar !== false;
    const ext = getPisiFileExt(filePath);

    if (!ext) {
        return {
            ok: false,
            error: 'PISI dosyası değil.'
        };
    }

    const type = getPisiTypeFromExt(ext);
    const readResult = readJsonFileResult(filePath);
    let changed = false;

    if (!readResult.ok || !readResult.data || typeof readResult.data !== 'object' || Array.isArray(readResult.data)) {
        const backupPath = persist ? backupCorruptPisiFile(filePath) : null;

        return {
            ok: false,
            corrupt: true,
            recoverable: true,
            filePath,
            backupPath,
            error: backupPath
                ? `Dosya bozuk veya boş. Üzerine yazılmadı; kurtarma kopyası oluşturuldu: ${backupPath}`
                : `Dosya bozuk veya boş. Üzerine yazılmadı: ${readResult.error || 'Geçersiz JSON.'}`
        };
    }

    const data = readResult.data;

    if (!data.pisi || typeof data.pisi !== 'object' || Array.isArray(data.pisi)) {
        data.pisi = {};
        changed = true;
    }

    if (!data.pisi.version) {
        data.pisi.version = 1;
        changed = true;
    }

    if (data.pisi.type !== type) {
        data.pisi.type = type;
        changed = true;
    }

    if (!data.pisi.id) {
        data.pisi.id = generatePisiId(ext);
        changed = true;
    } else if (!normalizePisiId(data.pisi.id, ext)) {
        return {
            ok: false,
            unsafeId: true,
            filePath,
            error: 'Dosyadaki PISI kimliği güvenli biçimde değil. Dosya değiştirilmedi.'
        };
    }

    const diaryDate = ext === '.node' ? normalizePisiDiaryIsoDate(data.pisi.diaryDate) : null;
    const cleanVisibleTitle = diaryDate ? makePisiDiaryNodeTitle(diaryDate) : getVisibleTitleFromFilePath(filePath, ext, data.pisi.id);

    if (data.pisi.title !== cleanVisibleTitle) {
        data.pisi.title = cleanVisibleTitle;
        changed = true;
    }

    const desiredSidecar = getPisiSidecarName(data.pisi.title, ext, data.pisi.id);

    if (data.pisi.sidecar !== desiredSidecar) {
        data.pisi.sidecar = desiredSidecar;
        changed = true;
    }

    if (!data.pisi.createdAt) {
        data.pisi.createdAt = new Date().toISOString();
        changed = true;
    }

    if (!data.pisi.updatedAt) {
        data.pisi.updatedAt = data.pisi.createdAt;
        changed = true;
    }

    if (ext === '.node') {
        if (typeof data.content !== 'string') {
            data.content = '';
            changed = true;
        }

        if (!data.pisi.parentMap) {
            data.pisi.parentMap = diaryDate ? 'diary' : 'none';
            changed = true;
        }

        if (Object.prototype.hasOwnProperty.call(data.pisi, 'connectionTypes')) {
            delete data.pisi.connectionTypes;
            changed = true;
        }
    }

    if (ext === '.map' && (!data.map || typeof data.map !== 'object' || Array.isArray(data.map))) {
        data.map = {
            nodes: [],
            relationshipViews: [],
            relationshipViewVersion: 1,
            collapsedHubs: [],
            camera: { x: 0, y: 0, zoom: 1 }
        };
        changed = true;
    }

    if (ext === '.map') {
        if ('parentMap' in data.pisi) {
            delete data.pisi.parentMap;
            changed = true;
        }

        if ('connectionTypes' in data.pisi) {
            delete data.pisi.connectionTypes;
            changed = true;
        }
    }

    const desiredSidecarName = getPisiSidecarName(data.pisi.title, ext, data.pisi.id);
    const desiredSidecarPath = desiredSidecarName ? path.join(path.dirname(filePath), desiredSidecarName) : null;
    const sidecarPath = ensureSidecar
        ? ensurePisiSidecar(filePath, data.pisi)
        : desiredSidecarPath && fs.existsSync(desiredSidecarPath)
          ? desiredSidecarPath
          : findExistingSidecarById(path.dirname(filePath), ext, data.pisi.id);

    if (changed && persist) {
        writePisiDocument(filePath, data);
    }

    return {
        ok: true,
        filePath,
        metadata: data.pisi,
        sidecarPath,
        data,
        changed,
        persisted: changed && persist
    };
}

function normalizePisiDiaryIsoDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return raw;
}

function makePisiDiaryNodeTitle(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    return `${day}-${month}-${year}`;
}

export { ensurePisiFileMetadata, makePisiDiaryNodeTitle, normalizePisiDiaryIsoDate };
