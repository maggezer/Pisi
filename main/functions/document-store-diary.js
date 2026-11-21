import * as path from 'node:path';
import * as fs from 'node:fs';
import { ensurePisiSidecar } from './document-store-io.js';
import { ensurePisiFileMetadata, makePisiDiaryNodeTitle, normalizePisiDiaryIsoDate } from './document-store-metadata.js';
import {
    PISI_DIARY_FOLDER,
    PISI_DIARY_MARKER_FILE,
    PISI_DIARY_MARKER_TEXT,
    PISI_DIARY_PARENT_MAP,
    getPisiDiaryDateFromFileName,
    getPisiDiaryNodeFileName,
    makePisiDiaryDocumentData
} from '../../shared/diary-rules.mjs';

function ensurePisiDiaryFolder(projectFolder) {
    if (!projectFolder || !fs.existsSync(projectFolder)) {
        return {
            ok: false,
            error: 'Proje klasörü bulunamadı.'
        };
    }

    const stat = fs.statSync(projectFolder);

    if (!stat.isDirectory()) {
        return {
            ok: false,
            error: 'Geçerli bir proje klasörü değil.'
        };
    }

    const diaryFolder = path.join(projectFolder, PISI_DIARY_FOLDER);
    const markerPath = path.join(diaryFolder, PISI_DIARY_MARKER_FILE);

    if (fs.existsSync(diaryFolder)) {
        const diaryStat = fs.statSync(diaryFolder);

        if (!diaryStat.isDirectory()) {
            return {
                ok: false,
                error: 'Projedeki mevcut "diary" yolu bir klasör değil. Kullanıcı verisini korumak için işlem durduruldu.'
            };
        }

        const diaryFolderIsEmpty = fs.readdirSync(diaryFolder).length === 0;

        if (!diaryFolderIsEmpty && !isPisiManagedDiaryFolder(diaryFolder)) {
            return {
                ok: false,
                error: 'Projedeki mevcut "diary" klasörü PISI tarafından yönetilmiyor. Kullanıcı klasörünü korumak için işlem durduruldu.'
            };
        }
    }

    markInternalFileChange(diaryFolder);
    fs.mkdirSync(diaryFolder, { recursive: true });
    sealInternalFileChange(diaryFolder);

    if (!fs.existsSync(markerPath)) {
        writeFileAtomic(markerPath, PISI_DIARY_MARKER_TEXT, { backup: false });
    }

    return {
        ok: true,
        diaryFolder
    };
}

function getPisiDiaryNodePath(projectFolder, isoDate) {
    return path.join(projectFolder, PISI_DIARY_FOLDER, getPisiDiaryNodeFileName(isoDate));
}

function getOrCreateDiaryNode(projectFolder, isoDate) {
    try {
        const normalizedDate = normalizePisiDiaryIsoDate(isoDate);

        if (!normalizedDate) {
            return {
                ok: false,
                error: 'Geçersiz diary tarihi. Beklenen format: YYYY-MM-DD.'
            };
        }

        const folderResult = ensurePisiDiaryFolder(projectFolder);

        if (!folderResult.ok) return folderResult;

        const nodePath = getPisiDiaryNodePath(projectFolder, normalizedDate);

        if (!fs.existsSync(nodePath)) {
            const data = makePisiDiaryDocumentData({
                isoDate: normalizedDate,
                id: generatePisiId('.node'),
                now: new Date().toISOString()
            });

            writePisiDocument(nodePath, data);
            ensurePisiSidecar(nodePath, data.pisi);
        }

        const ensured = ensurePisiFileMetadata(nodePath);

        if (!ensured.ok) return ensured;

        if (
            ensured.data?.pisi &&
            (ensured.data.pisi.diaryDate !== normalizedDate ||
                ensured.data.pisi.parentMap !== PISI_DIARY_PARENT_MAP ||
                ensured.data.pisi.title !== makePisiDiaryNodeTitle(normalizedDate))
        ) {
            ensured.data.pisi.diaryDate = normalizedDate;
            ensured.data.pisi.parentMap = PISI_DIARY_PARENT_MAP;
            ensured.data.pisi.title = makePisiDiaryNodeTitle(normalizedDate);
            ensured.data.pisi.updatedAt = new Date().toISOString();
            const repairedSidecarPath = ensurePisiSidecar(nodePath, ensured.data.pisi);
            ensured.data.pisi.sidecar = repairedSidecarPath ? path.basename(repairedSidecarPath) : ensured.data.pisi.sidecar;
            writePisiDocument(nodePath, ensured.data);
            ensured.metadata = ensured.data.pisi;
            ensured.sidecarPath = repairedSidecarPath;
        }

        return {
            ok: true,
            name: path.basename(nodePath),
            fileName: path.basename(nodePath),
            fullPath: nodePath,
            type: 'file',
            isDirectory: false,
            isFile: true,
            displayName: ensured.metadata?.title || makePisiDiaryNodeTitle(normalizedDate),
            metadata: ensured.metadata,
            sidecarPath: ensured.sidecarPath,
            data: ensured.data
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function listPisiDiaryNodePaths(projectFolder) {
    const diaryFolder = path.join(projectFolder, PISI_DIARY_FOLDER);

    if (!fs.existsSync(diaryFolder)) return [];

    return fs
        .readdirSync(diaryFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.node'))
        .map((entry) => path.join(diaryFolder, entry.name));
}

function listPisiDiaryDates(projectFolder) {
    try {
        if (!projectFolder || !fs.existsSync(projectFolder)) {
            return {
                ok: false,
                error: 'Proje klasörü bulunamadı.',
                dates: []
            };
        }

        const diaryFolder = path.join(projectFolder, PISI_DIARY_FOLDER);

        if (!fs.existsSync(diaryFolder) || !isPisiManagedDiaryFolder(diaryFolder)) {
            return {
                ok: true,
                dates: []
            };
        }

        const dates = new Set();

        for (const nodePath of listPisiDiaryNodePaths(projectFolder)) {
            let date = getPisiDiaryDateFromFileName(path.basename(nodePath));

            if (!date) {
                const ensured = ensurePisiFileMetadata(nodePath);
                date = normalizePisiDiaryIsoDate(ensured?.data?.pisi?.diaryDate);
            }

            if (date) {
                dates.add(date);
            }
        }

        return {
            ok: true,
            dates: Array.from(dates).sort()
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            dates: []
        };
    }
}

export { ensurePisiDiaryFolder, getOrCreateDiaryNode, getPisiDiaryNodePath, listPisiDiaryDates, listPisiDiaryNodePaths };
