import { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } from '../electron-bridge.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { registerMainModule } from '../module-registry.js';

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

        const normalizedConnections = normalizeNodeConnectionTypes(data.pisi.connectionTypes);

        if (JSON.stringify(data.pisi.connectionTypes) !== JSON.stringify(normalizedConnections)) {
            data.pisi.connectionTypes = normalizedConnections;
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

    const diaryFolder = path.join(projectFolder, 'diary');
    const markerPath = path.join(diaryFolder, '.pisi-diary');

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
        writeFileAtomic(markerPath, 'Bu klasör PISI diary özelliği tarafından yönetilir.\n', { backup: false });
    }

    return {
        ok: true,
        diaryFolder
    };
}

function makePisiDiaryNodeTitle(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    return `${day}-${month}-${year}`;
}

function getPisiDiaryNodePath(projectFolder, isoDate) {
    return path.join(projectFolder, 'diary', `${isoDate}.node`);
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
            const id = generatePisiId('.node');
            const title = makePisiDiaryNodeTitle(normalizedDate);

            const data = createPisiDocumentData({
                ext: '.node',
                title,
                id,
                parentMap: 'diary'
            });

            data.pisi.diaryDate = normalizedDate;
            data.content = `<h2>${escapeHtmlForPisiDiary(title)}</h2><div><br></div>`;

            writePisiDocument(nodePath, data);
            ensurePisiSidecar(nodePath, data.pisi);
        }

        const ensured = ensurePisiFileMetadata(nodePath);

        if (!ensured.ok) return ensured;

        if (
            ensured.data?.pisi &&
            (ensured.data.pisi.diaryDate !== normalizedDate ||
                ensured.data.pisi.parentMap !== 'diary' ||
                ensured.data.pisi.title !== makePisiDiaryNodeTitle(normalizedDate))
        ) {
            ensured.data.pisi.diaryDate = normalizedDate;
            ensured.data.pisi.parentMap = 'diary';
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

function stripPisiDiaryManagedSection(content = '') {
    const escapedStart = PISI_DIARY_MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = PISI_DIARY_MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');

    return String(content || '').replace(regex, '');
}

function escapeHtmlForPisiDiary(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizePisiDiaryBlockHtml(html = '') {
    return String(html || '')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
        .replace(/<(iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(iframe|object|embed|link|meta|base|form)\b[^>]*\/?>/gi, '')
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
        .replace(/\s(href|src|xlink:href|formaction)\s*=\s*(["'])\s*(?:javascript|vbscript|data\s*:\s*text\/html)[\s\S]*?\2/gi, '')
        .replace(/\s(href|src|xlink:href|formaction)\s*=\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^\s>]*/gi, '')
        .replace(/\sstyle\s*=\s*(["'])[\s\S]*?(?:expression\s*\(|url\s*\(\s*["']?\s*(?:javascript|vbscript|data\s*:\s*text\/html))[\s\S]*?\1/gi, '')
        .replace(/\sstyle\s*=\s*[^\s>]*(?:expression\s*\(|url\s*\()[^\s>]*/gi, '');
}

function normalizePisiDiarySyncEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const date = normalizePisiDiaryIsoDate(entry?.date);
    if (!date) return null;

    const nodePath = String(entry.nodePath || '')
        .trim()
        .slice(0, 32768);
    const blockId = String(entry.blockId || '')
        .trim()
        .slice(0, 500);
    const tag = String(entry.tag || '')
        .trim()
        .slice(0, 200);
    const text = String(entry.text || '')
        .trim()
        .slice(0, 250000);
    if (!nodePath || !tag) return null;

    const sourceIdentity = blockId || crypto.createHash('sha256').update(text).digest('hex');
    const sourceKey = [nodePath, sourceIdentity, tag].join('::');
    const rawPriority = Number(entry.priority);
    const priority = Number.isFinite(rawPriority) ? Math.max(-1000000, Math.min(1000000, rawPriority)) : 0;
    const allowedStatuses = new Set(['todo', 'doing', 'waiting', 'blocked']);
    const allowedRepeats = new Set(['none', 'daily', 'weekdays', 'weekly', 'monthly']);
    const status = String(entry.status || 'todo').toLowerCase();
    const repeat = String(entry.repeat || 'none').toLowerCase();
    const rawOrder = Number(entry.manualOrder);

    return {
        date,
        sourceKey,
        nodePath,
        nodeTitle: String(entry.nodeTitle || 'Node').slice(0, 500),
        blockId,
        tag,
        priority,
        status: allowedStatuses.has(status) ? status : 'todo',
        repeat: allowedRepeats.has(repeat) ? repeat : 'none',
        parentId: String(entry.parentId || '').slice(0, 2000),
        manualOrder: Number.isFinite(rawOrder) ? Math.max(0, Math.min(1000000, rawOrder)) : null,
        text,
        html: sanitizePisiDiaryBlockHtml(String(entry.html || '').slice(0, 2000000))
    };
}
function buildPisiDiaryManagedSection(isoDate, entries = []) {
    if (!entries.length) return '';

    const safeDate = escapeHtmlForPisiDiary(isoDate);
    const statusLabels = {
        todo: 'Yapılacak',
        doing: 'Devam ediyor',
        waiting: 'Beklemede',
        blocked: 'Engellendi'
    };
    const repeatLabels = {
        none: '',
        daily: 'Her gün',
        weekdays: 'Hafta içi',
        weekly: 'Her hafta',
        monthly: 'Her ay'
    };
    const blocks = entries
        .slice()
        .sort((a, b) => {
            const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.POSITIVE_INFINITY;
            const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return b.priority - a.priority;
        })
        .map((entry) => {
            const safeSourceKey = escapeHtmlForPisiDiary(entry.sourceKey);
            const safeNodeTitle = escapeHtmlForPisiDiary(entry.nodeTitle || 'Node');
            const safeTag = escapeHtmlForPisiDiary(entry.tag || '');
            const safeText = escapeHtmlForPisiDiary(entry.text || '');
            const safeStatus = escapeHtmlForPisiDiary(statusLabels[entry.status] || statusLabels.todo);
            const safeRepeat = escapeHtmlForPisiDiary(repeatLabels[entry.repeat] || '');
            const safeParent = escapeHtmlForPisiDiary(entry.parentId || '');
            const parentClass = entry.parentId ? ' has-parent' : '';
            const repeatMeta = safeRepeat ? ` · ${safeRepeat}` : '';
            const blockHtml = entry.html || `<div>${safeText || '(boş blok)'}</div>`;

            return `
<div class="pisi-diary-managed-block${parentClass}" data-pisi-diary-source="${safeSourceKey}" data-pisi-diary-status="${entry.status}" data-pisi-diary-parent="${safeParent}">
    <div class="pisi-diary-managed-meta">${safeNodeTitle} · ..${safeTag} · ${safeStatus}${repeatMeta}</div>
    ${blockHtml}
</div>`;
        })
        .join('\n');

    return `${PISI_DIARY_MANAGED_START}
<h3>Görevler · ${safeDate}</h3>
${blocks}
${PISI_DIARY_MANAGED_END}`;
}
function listPisiDiaryNodePaths(projectFolder) {
    const diaryFolder = path.join(projectFolder, 'diary');

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

        const diaryFolder = path.join(projectFolder, 'diary');

        if (!fs.existsSync(diaryFolder) || !isPisiManagedDiaryFolder(diaryFolder)) {
            return {
                ok: true,
                dates: []
            };
        }

        const dates = new Set();

        for (const nodePath of listPisiDiaryNodePaths(projectFolder)) {
            let date = normalizePisiDiaryIsoDate(path.basename(nodePath, '.node'));

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

function syncDiaryMissions(projectFolder, payload = {}) {
    try {
        const isEnvelope = payload && !Array.isArray(payload);
        const rawEntries = isEnvelope ? payload.entries : payload;
        const indexComplete = isEnvelope ? payload.complete === true : false;

        if (!indexComplete) {
            return {
                ok: false,
                error: 'Diary eşitlemesi tamamlanmış bir görev indeksi gerektiriyor.'
            };
        }

        if (!Array.isArray(rawEntries)) {
            return {
                ok: false,
                error: 'Diary eşitleme girdisi geçerli bir görev listesi olmalı.'
            };
        }

        const diaryFolderPath = path.join(projectFolder, 'diary');
        const entriesInput = rawEntries;

        if (entriesInput.length > 50000) {
            return {
                ok: false,
                error: 'Diary eşitleme girdisi 50.000 görev sınırını aşıyor.'
            };
        }

        if (!entriesInput.length && (!fs.existsSync(diaryFolderPath) || !isPisiManagedDiaryFolder(diaryFolderPath))) {
            return {
                ok: true,
                updatedCount: 0,
                dateCount: 0
            };
        }

        const entriesByDate = new Map();
        const seenByDate = new Map();
        let invalidEntryCount = 0;

        for (const rawEntry of entriesInput) {
            const entry = normalizePisiDiarySyncEntry(rawEntry);

            if (!entry) {
                invalidEntryCount++;
                continue;
            }

            if (!entriesByDate.has(entry.date)) {
                entriesByDate.set(entry.date, []);
                seenByDate.set(entry.date, new Set());
            }

            const seen = seenByDate.get(entry.date);

            if (seen.has(entry.sourceKey)) continue;

            seen.add(entry.sourceKey);
            entriesByDate.get(entry.date).push(entry);
        }

        if (invalidEntryCount > 0) {
            return {
                ok: false,
                error: `${invalidEntryCount} geçersiz görev girdisi nedeniyle diary eşitlemesi durduruldu.`
            };
        }

        const folderResult = ensurePisiDiaryFolder(projectFolder);

        if (!folderResult.ok) return folderResult;

        for (const date of entriesByDate.keys()) {
            const createResult = getOrCreateDiaryNode(projectFolder, date);

            if (!createResult.ok) {
                return createResult;
            }
        }

        const allDiaryNodes = listPisiDiaryNodePaths(projectFolder);
        let updatedCount = 0;
        const diaryChanges = [];

        for (const nodePath of allDiaryNodes) {
            const ensured = ensurePisiFileMetadata(nodePath);

            if (!ensured.ok || ensured.metadata?.type !== 'node') continue;

            const fileDate = normalizePisiDiaryIsoDate(ensured.data?.pisi?.diaryDate) || normalizePisiDiaryIsoDate(path.basename(nodePath, '.node'));

            if (!fileDate) continue;

            const manualContent = stripPisiDiaryManagedSection(ensured.data.content || '');
            const entries = entriesByDate.get(fileDate) || [];
            const managedSection = buildPisiDiaryManagedSection(fileDate, entries);
            const nextContent = managedSection ? `${manualContent}${managedSection}` : manualContent;

            if (nextContent !== String(ensured.data.content || '')) {
                ensured.data.content = nextContent;
                ensured.data.pisi.parentMap = 'diary';
                ensured.data.pisi.diaryDate = fileDate;
                ensured.data.pisi.updatedAt = new Date().toISOString();
                diaryChanges.push({
                    filePath: nodePath,
                    data: ensured.data
                });
                updatedCount++;
            }
        }

        writePisiDocumentsTransaction(diaryChanges);

        return {
            ok: true,
            updatedCount,
            dateCount: entriesByDate.size
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

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

const moduleApi = {};
Object.defineProperties(moduleApi, {
    ensurePisiSidecar: {
        enumerable: true,
        get() {
            return ensurePisiSidecar;
        }
    },
    ensurePisiFileMetadata: {
        enumerable: true,
        get() {
            return ensurePisiFileMetadata;
        }
    },
    createUniquePisiFile: {
        enumerable: true,
        get() {
            return createUniquePisiFile;
        }
    },
    normalizePisiDiaryIsoDate: {
        enumerable: true,
        get() {
            return normalizePisiDiaryIsoDate;
        }
    },
    ensurePisiDiaryFolder: {
        enumerable: true,
        get() {
            return ensurePisiDiaryFolder;
        }
    },
    makePisiDiaryNodeTitle: {
        enumerable: true,
        get() {
            return makePisiDiaryNodeTitle;
        }
    },
    getPisiDiaryNodePath: {
        enumerable: true,
        get() {
            return getPisiDiaryNodePath;
        }
    },
    getOrCreateDiaryNode: {
        enumerable: true,
        get() {
            return getOrCreateDiaryNode;
        }
    },
    stripPisiDiaryManagedSection: {
        enumerable: true,
        get() {
            return stripPisiDiaryManagedSection;
        }
    },
    escapeHtmlForPisiDiary: {
        enumerable: true,
        get() {
            return escapeHtmlForPisiDiary;
        }
    },
    sanitizePisiDiaryBlockHtml: {
        enumerable: true,
        get() {
            return sanitizePisiDiaryBlockHtml;
        }
    },
    normalizePisiDiarySyncEntry: {
        enumerable: true,
        get() {
            return normalizePisiDiarySyncEntry;
        }
    },
    buildPisiDiaryManagedSection: {
        enumerable: true,
        get() {
            return buildPisiDiaryManagedSection;
        }
    },
    listPisiDiaryNodePaths: {
        enumerable: true,
        get() {
            return listPisiDiaryNodePaths;
        }
    },
    listPisiDiaryDates: {
        enumerable: true,
        get() {
            return listPisiDiaryDates;
        }
    },
    syncDiaryMissions: {
        enumerable: true,
        get() {
            return syncDiaryMissions;
        }
    },
    createNodeUnderMap: {
        enumerable: true,
        get() {
            return createNodeUnderMap;
        }
    },
    renamePisiFile: {
        enumerable: true,
        get() {
            return renamePisiFile;
        }
    }
});
registerMainModule('main.documentStore', moduleApi);
