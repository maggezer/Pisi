import * as path from 'node:path';
import * as fs from 'node:fs';
import { createUniquePisiFile } from './document-store-io.js';
import { ensurePisiFileMetadata } from './document-store-metadata.js';

function createNodeUnderMap(mapPath) {
    try {
        if (!mapPath || !fs.existsSync(mapPath)) {
            return {
                ok: false,
                error: 'Map dosyası bulunamadı.'
            };
        }

        const ext = getPisiFileExt(mapPath);

        if (ext !== '.map') {
            return {
                ok: false,
                error: 'Node sadece .map dosyası altında oluşturulabilir.'
            };
        }

        const mapInfo = ensurePisiFileMetadata(mapPath);

        if (!mapInfo.ok) {
            return mapInfo;
        }

        const mapId = mapInfo.metadata.id;
        const mapSidecarPath = mapInfo.sidecarPath;

        if (!mapSidecarPath || !fs.existsSync(mapSidecarPath)) {
            return {
                ok: false,
                error: 'Map bağlantı klasörü bulunamadı.'
            };
        }

        const nodeInfo = createUniquePisiFile(mapSidecarPath, '.node', {
            parentMap: mapId
        });

        const nodeList = listNodesForMap(mapPath);
        const createdNode = nodeList.ok ? nodeList.nodes.find((node) => node.id === nodeInfo.metadata.id) : null;

        return {
            ...nodeInfo,
            parentMap: mapId,
            mapPath,
            mapSidecarPath,
            node: createdNode
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function renamePisiFile(oldPath, newBaseName) {
    let newPath = null;
    let oldSidecarPath = null;
    let newSidecarPath = null;
    let fileMoved = false;
    let sidecarMoved = false;
    let originalContent = null;

    try {
        if (!oldPath || !fs.existsSync(oldPath)) {
            return {
                ok: false,
                error: 'Yeniden adlandırılacak dosya bulunamadı.'
            };
        }

        const ext = getPisiFileExt(oldPath);

        if (ext !== '.node' && ext !== '.map') {
            return {
                ok: false,
                error: 'Sadece .node ve .map dosyaları yeniden adlandırılabilir.'
            };
        }

        const ensuredBefore = ensurePisiFileMetadata(oldPath);
        if (!ensuredBefore.ok) return ensuredBefore;

        const dir = path.dirname(oldPath);
        const id = ensuredBefore.metadata.id;
        originalContent = fs.readFileSync(oldPath, 'utf-8');
        oldSidecarPath = ensuredBefore.sidecarPath && fs.existsSync(ensuredBefore.sidecarPath) ? ensuredBefore.sidecarPath : null;

        let cleanTitle = sanitizePisiBaseName(newBaseName);

        if (cleanTitle.toLowerCase().endsWith(ext)) {
            cleanTitle = cleanTitle.slice(0, -ext.length);
            cleanTitle = sanitizePisiBaseName(cleanTitle);
        }

        // Aynı görünen title'a izin veriyoruz.
        // Eğer plain dosya adı doluysa gerçek dosya adı title__id.ext olur.
        newPath = getUniquePisiPhysicalPath(dir, cleanTitle, ext, id, oldPath);
        const newSidecarName = getPisiSidecarName(cleanTitle, ext, id);
        newSidecarPath = newSidecarName ? path.join(dir, newSidecarName) : null;

        if (
            oldSidecarPath &&
            newSidecarPath &&
            fs.existsSync(newSidecarPath) &&
            normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(newSidecarPath)
        ) {
            return {
                ok: false,
                error: 'Yeni başlıkla eşleşen yan klasör zaten var.'
            };
        }

        if (normalizePathForCompare(oldPath) !== normalizePathForCompare(newPath)) {
            renamePathInternal(oldPath, newPath);
            fileMoved = true;
        }

        if (oldSidecarPath && newSidecarPath && normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(newSidecarPath)) {
            renamePathInternal(oldSidecarPath, newSidecarPath);
            sidecarMoved = true;
        }

        const data = structuredClone(ensuredBefore.data);

        if (!data.pisi) data.pisi = {};

        data.pisi.title = cleanTitle;
        data.pisi.sidecar = newSidecarName;
        data.pisi.updatedAt = new Date().toISOString();

        writePisiDocument(newPath, data);

        const ensuredAfter = ensurePisiFileMetadata(newPath);

        return {
            ok: true,
            fullPath: newPath,
            fileName: path.basename(newPath),
            displayName: ensuredAfter.metadata.title,
            metadata: ensuredAfter.metadata,
            sidecarPath: ensuredAfter.sidecarPath,
            oldSidecarPath,
            pathChanges: [
                {
                    oldPath,
                    newPath
                },
                ...(oldSidecarPath && ensuredAfter.sidecarPath
                    ? [
                          {
                              oldPath: oldSidecarPath,
                              newPath: ensuredAfter.sidecarPath
                          }
                      ]
                    : [])
            ]
        };
    } catch (error) {
        const rollbackErrors = [];

        try {
            if (sidecarMoved && newSidecarPath && oldSidecarPath && fs.existsSync(newSidecarPath) && !fs.existsSync(oldSidecarPath)) {
                renamePathInternal(newSidecarPath, oldSidecarPath);
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        try {
            if (fileMoved && newPath && fs.existsSync(newPath) && !fs.existsSync(oldPath)) {
                renamePathInternal(newPath, oldPath);
            }

            if (originalContent !== null && fs.existsSync(oldPath)) {
                writeFileAtomic(oldPath, originalContent, { backup: false });
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        return {
            ok: false,
            error: rollbackErrors.length ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}` : error.message,
            rolledBack: rollbackErrors.length === 0
        };
    }
}

export { createNodeUnderMap, renamePisiFile };
