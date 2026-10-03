import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { ensurePisiSidecar } from './document-store-io.js';
import { ensurePisiFileMetadata, makePisiDiaryNodeTitle, normalizePisiDiaryIsoDate } from './document-store-metadata.js';

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

export {
    buildPisiDiaryManagedSection,
    ensurePisiDiaryFolder,
    escapeHtmlForPisiDiary,
    getOrCreateDiaryNode,
    getPisiDiaryNodePath,
    listPisiDiaryDates,
    listPisiDiaryNodePaths,
    normalizePisiDiarySyncEntry,
    sanitizePisiDiaryBlockHtml,
    stripPisiDiaryManagedSection,
    syncDiaryMissions
};
