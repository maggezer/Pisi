import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { ensurePisiSidecar } from './document-store-io.js';
import { ensurePisiFileMetadata, makePisiDiaryNodeTitle, normalizePisiDiaryIsoDate } from './document-store-metadata.js';

const PISI_DIARY_MANAGED_START =
    typeof globalThis.PISI_DIARY_MANAGED_START === 'string' ? globalThis.PISI_DIARY_MANAGED_START : '<!--PISI_DIARY_MANAGED_START-->';
const PISI_DIARY_MANAGED_END = typeof globalThis.PISI_DIARY_MANAGED_END === 'string' ? globalThis.PISI_DIARY_MANAGED_END : '<!--PISI_DIARY_MANAGED_END-->';

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
            data.content = '<div><br></div>';

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

function isSamePisiPath(pathA, pathB, baseFolder = '') {
    if (!pathA || !pathB) return false;
    const rawA = String(pathA).trim();
    const rawB = String(pathB).trim();
    const resolvedA = baseFolder && !path.isAbsolute(rawA) ? path.resolve(baseFolder, rawA) : path.resolve(rawA);
    const resolvedB = baseFolder && !path.isAbsolute(rawB) ? path.resolve(baseFolder, rawB) : path.resolve(rawB);
    return resolvedA.replace(/[\\/]+/g, '/').toLowerCase() === resolvedB.replace(/[\\/]+/g, '/').toLowerCase();
}

function isTaskBlock(html = '') {
    if (!html) return false;
    return /data-pisi-block-type=["']task["']|class=["'][^"']*pisi-block-task-marker|data-pisi-tag=["']todo\.|data-pisi-todo-checkbox|data-pisi-task-id|class=["'][^"']*pisi-todo-source/i.test(
        html
    );
}

function isGorevlerHeading(html = '') {
    if (!html) return false;
    return /<h[1-6][^>]*>[\s\S]*?Görevler[\s\S]*?<\/h[1-6]>/i.test(html);
}

function splitHtmlBlocks(html = '') {
    const raw = String(html || '').trim();
    if (!raw) return [];

    const blocks = [];
    let i = 0;
    while (i < raw.length) {
        while (i < raw.length && /\s/.test(raw[i])) i++;
        if (i >= raw.length) break;

        if (raw[i] === '<') {
            const tagMatch = raw.slice(i).match(/^<([a-z0-9]+)\b([^>]*)>/i);
            if (!tagMatch) {
                const nextTag = raw.indexOf('<', i + 1);
                const chunk = nextTag === -1 ? raw.slice(i) : raw.slice(i, nextTag);
                if (chunk.trim()) blocks.push(chunk.trim());
                i = nextTag === -1 ? raw.length : nextTag;
                continue;
            }

            const tagName = tagMatch[1].toLowerCase();
            const isSelfClosing = tagMatch[0].endsWith('/>') || ['br', 'hr', 'img', 'input'].includes(tagName);

            if (isSelfClosing) {
                blocks.push(tagMatch[0]);
                i += tagMatch[0].length;
                continue;
            }

            let depth = 1;
            let cursor = i + tagMatch[0].length;
            const openRegex = new RegExp('(<' + tagName + '\\b[^>]*>)|(<\\/' + tagName + '>)', 'gi');
            openRegex.lastIndex = cursor;

            let m;
            let endIndex = -1;
            while ((m = openRegex.exec(raw)) !== null) {
                if (m[1]) {
                    if (!m[1].endsWith('/>')) {
                        depth++;
                    }
                } else if (m[2]) {
                    depth--;
                    if (depth === 0) {
                        endIndex = openRegex.lastIndex;
                        break;
                    }
                }
            }

            if (endIndex !== -1) {
                blocks.push(raw.slice(i, endIndex));
                i = endIndex;
            } else {
                blocks.push(raw.slice(i));
                break;
            }
        } else {
            const nextTag = raw.indexOf('<', i);
            const chunk = nextTag === -1 ? raw.slice(i) : raw.slice(i, nextTag);
            if (chunk.trim()) blocks.push(chunk.trim());
            i = nextTag === -1 ? raw.length : nextTag;
        }
    }

    return blocks;
}

// Only remove separators owned by diary task synchronization, never user rules.
const PISI_DIARY_TASK_DIVIDER =
    '<div class="pisi-editor-block pisi-diary-task-divider pisi-section-break" data-pisi-block-type="paragraph" data-pisi-section-break="true" data-pisi-section-exit="1"><hr></div>';
function stripPisiDiaryTaskDividers(content = '') {
    return String(content || '').replace(/<div\b[^>]*class=["'][^"']*\bpisi-diary-task-divider\b[^"']*["'][^>]*>\s*<hr\b[^>]*>\s*<\/div>/gi, '');
}

function organizeDiaryManualTasks(content = '', _fileDate = '', options = {}) {
    const allBlocks = splitHtmlBlocks(stripPisiDiaryTaskDividers(content));
    const taskBlocks = allBlocks.filter(isTaskBlock);
    if (!taskBlocks.length && !options.forceSection) return content;

    const existingHeading = allBlocks.find(isGorevlerHeading);
    // Keep the heading's block identity and formatting while removing the date.
    const heading = existingHeading ? existingHeading.replace(/(<h[1-6]\b[^>]*>)[\s\S]*?(<\/h[1-6]>)/i, '$1Görevler$2') : '<h3>Görevler</h3>';
    const notes = allBlocks.filter((block) => !isTaskBlock(block) && !isGorevlerHeading(block));
    return [
        notes.length ? notes.join('\n') : '<div><br></div>',
        PISI_DIARY_TASK_DIVIDER,
        heading,
        ...taskBlocks,
        ...(options.closeSection === false ? [] : [PISI_DIARY_TASK_DIVIDER])
    ].join('\n');
}

function composePisiDiaryTaskContent(content = '', fileDate = '', externalEntries = []) {
    const manual = stripPisiDiaryTaskDividers(stripPisiDiaryManagedSection(content)).trim();
    const organized = organizeDiaryManualTasks(manual, fileDate, { closeSection: !externalEntries.length, forceSection: Boolean(externalEntries.length) });
    const managed = buildPisiDiaryManagedSection(fileDate, externalEntries, { includeHeading: false });
    return managed ? `${organized || '<div><br></div>'}\n${managed}` : organized || '<div><br></div>';
}

function stripPisiDiaryManagedSection(content = '') {
    const escapedStart = PISI_DIARY_MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = PISI_DIARY_MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');

    let stripped = String(content || '').replace(regex, '');
    stripped = stripped.replace(/<div\b[^>]*class=["'][^"']*pisi-diary-managed-block[^"']*["'][\s\S]*?<\/div>(?:\s*<\/div>)?/gi, '');
    return stripped;
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
    const allowedStatuses = new Set(['todo', 'doing', 'waiting', 'blocked', 'done']);
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

function buildPisiDiaryManagedSection(isoDate, entries = [], options = {}) {
    if (!entries.length) return '';

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
            const safeNodePath = escapeHtmlForPisiDiary(entry.nodePath || '');
            const safeBlockId = escapeHtmlForPisiDiary(entry.blockId || '');
            const safeNodeTitle = escapeHtmlForPisiDiary(entry.nodeTitle || 'Node');
            const safeTag = escapeHtmlForPisiDiary(entry.tag || '');
            const safeText = escapeHtmlForPisiDiary(entry.text || '');
            const safeRepeat = escapeHtmlForPisiDiary(repeatLabels[entry.repeat] || '');
            const safeParent = escapeHtmlForPisiDiary(entry.parentId || '');
            const parentClass = entry.parentId ? ' has-parent' : '';
            const repeatMeta = safeRepeat ? ` · ${safeRepeat}` : '';
            const isCompleted = entry.status === 'done';

            return `<div class="pisi-diary-managed-block${parentClass}" data-pisi-diary-source="${safeSourceKey}" data-pisi-diary-node-path="${safeNodePath}" data-pisi-diary-block-id="${safeBlockId}" data-pisi-diary-status="${entry.status}" data-pisi-diary-parent="${safeParent}" data-pisi-task-id="${safeBlockId}" title="Nota git: ${safeNodeTitle}">
    <span class="pisi-block-task-marker pisi-diary-task-marker" contenteditable="false" role="checkbox" aria-checked="${String(isCompleted)}" aria-label="${isCompleted ? 'Görevi yeniden aç' : 'Görevi tamamla'}" data-pisi-task-id="${safeBlockId}" data-pisi-todo-checkbox="${safeTag}" tabindex="0">${isCompleted ? '☑' : '☐'}</span>
    <span class="pisi-diary-task-text">${safeText || '(boş blok)'}</span>
    <span class="pisi-diary-managed-meta" contenteditable="false" title="Nota git: ${safeNodeTitle}">· ${safeNodeTitle}${repeatMeta}</span>
</div>`;
        })
        .join('\n');

    const includeHeading = options.includeHeading !== false;
    const headingHtml = includeHeading ? `${PISI_DIARY_TASK_DIVIDER}\n<h3>Görevler</h3>\n` : '';

    return `${PISI_DIARY_MANAGED_START}\n${headingHtml}${blocks}\n${PISI_DIARY_TASK_DIVIDER}\n${PISI_DIARY_MANAGED_END}`;
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

            const externalEntries = [];
            for (const entry of entries) {
                if (!isSamePisiPath(entry.nodePath, nodePath, projectFolder)) {
                    externalEntries.push(entry);
                }
            }

            const nextContent = composePisiDiaryTaskContent(manualContent, fileDate, externalEntries);

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
    isGorevlerHeading,
    isSamePisiPath,
    isTaskBlock,
    listPisiDiaryDates,
    listPisiDiaryNodePaths,
    normalizePisiDiarySyncEntry,
    organizeDiaryManualTasks,
    composePisiDiaryTaskContent,
    sanitizePisiDiaryBlockHtml,
    stripPisiDiaryManagedSection,
    syncDiaryMissions
};
