const { app, BrowserWindow, Menu, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

const appIconPath = path.join(__dirname, 'assets', 'kedi.ico');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.kedi.app');
}

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'kedi-settings.json');
}

function readSettings() {
    const settingsPath = getSettingsPath();

    try {
        if (!fs.existsSync(settingsPath)) {
            return {};
        }

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw || '{}');
    } catch (error) {
        console.error('[KEDI] Settings okunamadı:', error);
        return {};
    }
}

function writeSettings(settings) {
    const settingsPath = getSettingsPath();

    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.error('[KEDI] Settings yazılamadı:', error);
    }
}

function getDefaultWindowState() {
    return {
        width: 1400,
        height: 900,
        x: undefined,
        y: undefined,
        isMaximized: false,
        isFullScreen: false
    };
}

function getSavedWindowState() {
    const settings = readSettings();
    const saved = settings.windowState || {};
    const defaults = getDefaultWindowState();

    const width = Number(saved.width || defaults.width);
    const height = Number(saved.height || defaults.height);

    const state = {
        width: Number.isFinite(width) ? width : defaults.width,
        height: Number.isFinite(height) ? height : defaults.height,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : undefined,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : undefined,
        isMaximized: Boolean(saved.isMaximized),
        isFullScreen: Boolean(saved.isFullScreen)
    };

    return keepWindowStateInsideDisplay(state);
}

function keepWindowStateInsideDisplay(state) {
    const fallback = getDefaultWindowState();

    const width = Math.max(900, Number(state.width || fallback.width));
    const height = Math.max(600, Number(state.height || fallback.height));

    let x = state.x;
    let y = state.y;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
            ...state,
            width,
            height,
            x: undefined,
            y: undefined
        };
    }

    const displays = screen.getAllDisplays();
    const visibleOnSomeDisplay = displays.some((display) => {
        const area = display.workArea;

        return (
            x < area.x + area.width &&
            x + width > area.x &&
            y < area.y + area.height &&
            y + height > area.y
        );
    });

    if (!visibleOnSomeDisplay) {
        const primaryArea = screen.getPrimaryDisplay().workArea;

        x = Math.round(primaryArea.x + (primaryArea.width - width) / 2);
        y = Math.round(primaryArea.y + (primaryArea.height - height) / 2);
    }

    return {
        ...state,
        width,
        height,
        x,
        y
    };
}

function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const settings = readSettings();
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();

    const previousState = settings.windowState || {};
    const bounds = (!isMaximized && !isFullScreen)
        ? mainWindow.getBounds()
        : {
            x: previousState.x,
            y: previousState.y,
            width: previousState.width,
            height: previousState.height
        };

    settings.windowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width || 1400,
        height: bounds.height || 900,
        isMaximized,
        isFullScreen
    };

    writeSettings(settings);
}

function scheduleWindowStateSave() {
    if (scheduleWindowStateSave.timer) {
        clearTimeout(scheduleWindowStateSave.timer);
    }

    scheduleWindowStateSave.timer = setTimeout(() => {
        scheduleWindowStateSave.timer = null;
        saveWindowState();
    }, 350);
}

scheduleWindowStateSave.timer = null;

function isKediVisibleFile(fileName) {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.map') || lower.endsWith('.node');
}

function isKediManagedSidecarFolder(folderName) {
    if (!folderName) return false;

    return (
        folderName === '.kedi.lock' ||
        folderName.startsWith('inv_') ||
        folderName.startsWith('nd_')
    );
}

function getKediFileExt(fileNameOrPath) {
    const lower = fileNameOrPath.toLowerCase();

    if (lower.endsWith('.node')) return '.node';
    if (lower.endsWith('.map')) return '.map';

    return '';
}

function getKediTypeFromExt(ext) {
    if (ext === '.node') return 'node';
    if (ext === '.map') return 'map';
    return '';
}

function getKediSidecarPrefix(ext) {
    if (ext === '.node') return 'inv_';
    if (ext === '.map') return 'nd_';
    return '';
}

function sanitizeKediBaseName(name) {
    const cleaned = String(name || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');

    return cleaned || 'Yeni Dosya';
}

function stripKediIdSuffix(baseName, id) {
    if (!baseName || !id) return baseName;

    const suffix = `__${id}`;

    if (baseName.endsWith(suffix)) {
        return baseName.slice(0, -suffix.length);
    }

    return baseName;
}

function getVisibleTitleFromFilePath(filePath, ext, id = '') {
    const rawBaseName = path.basename(filePath, ext);
    return sanitizeKediBaseName(stripKediIdSuffix(rawBaseName, id));
}

function getUniqueKediPhysicalPath(dir, wantedTitle, ext, id, currentPath = null) {
    const cleanTitle = sanitizeKediBaseName(wantedTitle);

    const plainPath = path.join(dir, cleanTitle + ext);

    if (
        !fs.existsSync(plainPath) ||
        (currentPath && normalizePathForCompare(plainPath) === normalizePathForCompare(currentPath))
    ) {
        return plainPath;
    }

    const hybridPath = path.join(dir, `${cleanTitle}__${id}${ext}`);

    if (
        !fs.existsSync(hybridPath) ||
        (currentPath && normalizePathForCompare(hybridPath) === normalizePathForCompare(currentPath))
    ) {
        return hybridPath;
    }

    let counter = 1;

    while (true) {
        const fallbackPath = path.join(dir, `${cleanTitle}__${id}_${counter}${ext}`);

        if (
            !fs.existsSync(fallbackPath) ||
            (currentPath && normalizePathForCompare(fallbackPath) === normalizePathForCompare(currentPath))
        ) {
            return fallbackPath;
        }

        counter++;
    }
}

function sanitizeForSidecarName(name) {
    return sanitizeKediBaseName(name)
        .replace(/\s+/g, ' ')
        .slice(0, 80);
}

function generateKediId(ext) {
    const prefix = ext === '.map' ? 'map' : 'node';
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${stamp}_${random}`;
}

function getDefaultNodeConnectionTypes() {
    return {
        "up-hub": [],
        "down-hub": [],
        "co-level": [],
        "upstream": [],
        "downstream": []
    };
}

function normalizeNodeConnectionTypes(value) {
    const defaults = getDefaultNodeConnectionTypes();

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaults;
    }

    return {
        "up-hub": Array.isArray(value["up-hub"]) ? value["up-hub"] : [],
        "down-hub": Array.isArray(value["down-hub"]) ? value["down-hub"] : [],
        "co-level": Array.isArray(value["co-level"]) ? value["co-level"] : [],
        "upstream": Array.isArray(value["upstream"]) ? value["upstream"] : [],
        "downstream": Array.isArray(value["downstream"]) ? value["downstream"] : []
    };
}

const KEDI_CONNECTION_KEYS = [
    'up-hub',
    'down-hub',
    'co-level',
    'upstream',
    'downstream'
];

function normalizeConnectionRole(role) {
    const value = String(role || '').trim();

    if (value === 'colevel') return 'co-level';
    if (value === 'co-level') return 'co-level';

    if (KEDI_CONNECTION_KEYS.includes(value)) {
        return value;
    }

    return null;
}

function getConnectionRoleFromPort(port) {
    if (port === 'top') return 'up-hub';
    if (port === 'bottom') return 'down-hub';
    if (port === 'left') return 'upstream';
    if (port === 'right') return 'downstream';

    return null;
}

function getEdgeVisualTypeFromRoles(sourceRole, targetRole) {
    if (sourceRole === 'co-level' || targetRole === 'co-level') {
        return 'co-level';
    }

    if (
        sourceRole === 'upstream' ||
        sourceRole === 'downstream' ||
        targetRole === 'upstream' ||
        targetRole === 'downstream'
    ) {
        return 'stream';
    }

    return 'down-hub';
}

function normalizeMapEdge(edge) {
    if (!edge || !edge.sourceId || !edge.targetId) {
        return null;
    }

    let type = edge.type || 'down-hub';

    if (type === 'colevel') {
        type = 'co-level';
    }

    let sourceRole = normalizeConnectionRole(edge.sourceRole);
    let targetRole = normalizeConnectionRole(edge.targetRole);

    // Eski kayıtlar için fallback.
    // Burada portlara bakmıyoruz. Type neyse roller ondan çıkar.
    if (!sourceRole || !targetRole) {
        if (type === 'co-level') {
            sourceRole = 'co-level';
            targetRole = 'co-level';
        } else if (type === 'stream') {
            sourceRole = 'downstream';
            targetRole = 'upstream';
        } else {
            type = 'down-hub';
            sourceRole = 'down-hub';
            targetRole = 'up-hub';
        }
    }

    return {
        id: edge.id || `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,

        // Bunlar sadece çizgi geometrisi.
        sourcePort: edge.sourcePort || 'bottom',
        targetPort: edge.targetPort || 'top',

        // Bunlar semantik ilişki.
        type,
        sourceRole,
        targetRole
    };
}

function isHierarchyEdge(edge) {
    return (
        edge?.type === 'down-hub' &&
        edge?.sourceRole === 'down-hub' &&
        edge?.targetRole === 'up-hub'
    );
}

function convertEdgeToStream(edge) {
    return {
        ...edge,
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    };
}

function enforceSingleParentForTargetInMap(newEdge, existingEdges = []) {
    if (!isHierarchyEdge(newEdge)) {
        return newEdge;
    }

    const targetAlreadyHasParent = existingEdges.some((existingEdge) => {
        const normalizedExisting = normalizeMapEdge(existingEdge);

        if (!normalizedExisting) return false;
        if (!isHierarchyEdge(normalizedExisting)) return false;

        // Burada kritik nokta targetId kontrolü.
        // Aynı child node ikinci parent alamaz.
        if (normalizedExisting.targetId !== newEdge.targetId) return false;

        // Aynı source-target bağlantısını güncelliyorsak engel sayma.
        if (normalizedExisting.sourceId === newEdge.sourceId) return false;

        return true;
    });

    if (!targetAlreadyHasParent) {
        return newEdge;
    }

    return convertEdgeToStream(newEdge);
}

function resetNodeConnectionTypes(metadata) {
    metadata.connectionTypes = getDefaultNodeConnectionTypes();
}

function getKediSidecarName(title, ext, id) {
    const prefix = getKediSidecarPrefix(ext);
    if (!prefix || !id) return null;

    const safeTitle = sanitizeForSidecarName(title);
    return `${prefix}${safeTitle}__${id}`;
}

function createKediDocumentData({ ext, title, id, parentMap = 'none' }) {
    const now = new Date().toISOString();
    const type = getKediTypeFromExt(ext);
    const sidecar = getKediSidecarName(title, ext, id);

    const base = {
        kedi: {
            version: 1,
            type,
            id,
            title,
            sidecar,
            createdAt: now,
            updatedAt: now
        }
    };

    if (ext === '.node') {
        base.kedi.parentMap = parentMap || 'none';
        base.kedi.connectionTypes = getDefaultNodeConnectionTypes();

        return {
            ...base,
            content: ''
        };
    }

    if (ext === '.map') {
        return {
            ...base,
            map: {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            }
        };
    }

    return base;
}

function readJsonFileSafe(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');

        if (!raw || !raw.trim()) {
            return null;
        }

        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeKediDocument(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function findExistingSidecarById(dir, ext, id) {
    if (!id || !fs.existsSync(dir)) return null;

    const prefix = getKediSidecarPrefix(ext);
    if (!prefix) return null;

    const suffix = `__${id}`;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (
                entry.isDirectory() &&
                entry.name.startsWith(prefix) &&
                entry.name.endsWith(suffix)
            ) {
                return path.join(dir, entry.name);
            }
        }
    } catch {
        return null;
    }

    return null;
}

function ensureKediSidecar(filePath, metadata) {
    const ext = getKediFileExt(filePath);
    if (!ext || !metadata?.id) return null;

    const dir = path.dirname(filePath);
    const desiredName = getKediSidecarName(metadata.title, ext, metadata.id);
    const desiredPath = path.join(dir, desiredName);

    const existingById = findExistingSidecarById(dir, ext, metadata.id);

    if (existingById && normalizePathForCompare(existingById) !== normalizePathForCompare(desiredPath)) {
        if (!fs.existsSync(desiredPath)) {
            fs.renameSync(existingById, desiredPath);
        }
    }

    if (!fs.existsSync(desiredPath)) {
        fs.mkdirSync(desiredPath, { recursive: true });
    }

    return desiredPath;
}

function ensureKediFileMetadata(filePath) {
    const ext = getKediFileExt(filePath);

    if (!ext) {
        return {
            ok: false,
            error: 'KEDI dosyası değil.'
        };
    }

    const dir = path.dirname(filePath);
    const type = getKediTypeFromExt(ext);

    let data = readJsonFileSafe(filePath);
    let changed = false;

    if (!data || typeof data !== 'object') {
        const id = generateKediId(ext);
        const title = sanitizeKediBaseName(visibleTitle);
        data = createKediDocumentData({ ext, title, id });
        changed = true;
    }

    if (!data.kedi || typeof data.kedi !== 'object') {
        data.kedi = {};
        changed = true;
    }

    if (!data.kedi.version) {
        data.kedi.version = 1;
        changed = true;
    }

    if (data.kedi.type !== type) {
        data.kedi.type = type;
        changed = true;
    }

    if (!data.kedi.id) {
        data.kedi.id = generateKediId(ext);
        changed = true;
    }

    // Windows üzerinden dosya adı değişirse görünen başlık dosya adından alınır.
    const cleanVisibleTitle = getVisibleTitleFromFilePath(filePath, ext, data.kedi.id);

    if (data.kedi.title !== cleanVisibleTitle) {
    data.kedi.title = cleanVisibleTitle;
    changed = true;
    }

    const desiredSidecar = getKediSidecarName(data.kedi.title, ext, data.kedi.id);

    if (data.kedi.sidecar !== desiredSidecar) {
        data.kedi.sidecar = desiredSidecar;
        changed = true;
    }

    if (!data.kedi.createdAt) {
        data.kedi.createdAt = new Date().toISOString();
        changed = true;
    }

    data.kedi.updatedAt = new Date().toISOString();

    if (ext === '.node') {
    if (typeof data.content !== 'string') {
        data.content = '';
        changed = true;
    }

    // parentMap sadece .node dosyalarında bulunur.
    // none = herhangi bir map içinde değil.
    // ileride map altında oluşturulursa burada map id tutulacak.
    if (!data.kedi.parentMap) {
        data.kedi.parentMap = 'none';
        changed = true;
    }

    // connectionTypes sadece .node dosyalarında bulunur.
    // Her alan bağlantılı node id listesi tutar.
    const normalizedConnections = normalizeNodeConnectionTypes(data.kedi.connectionTypes);

    if (JSON.stringify(data.kedi.connectionTypes) !== JSON.stringify(normalizedConnections)) {
        data.kedi.connectionTypes = normalizedConnections;
        changed = true;
    }
}
    
    if (ext === '.map' && (!data.map || typeof data.map !== 'object')) {
        data.map = {
            nodes: [],
            edges: [],
            camera: { x: 0, y: 0, zoom: 1 }
        };
        changed = true;
    }

    if (ext === '.map') {
    if ('parentMap' in data.kedi) {
        delete data.kedi.parentMap;
        changed = true;
    }

    if ('connectionTypes' in data.kedi) {
        delete data.kedi.connectionTypes;
        changed = true;
    }
}

    const sidecarPath = ensureKediSidecar(filePath, data.kedi);

    if (changed) {
        writeKediDocument(filePath, data);
    }

    return {
        ok: true,
        filePath,
        metadata: data.kedi,
        sidecarPath,
        data
    };
}

function createUniqueKediFile(folderPath, ext, options = {}) {
    if (!folderPath || !fs.existsSync(folderPath)) {
        return {
            ok: false,
            error: 'Aktif klasör bulunamadı.'
        };
    }

    if (ext !== '.map' && ext !== '.node') {
        return {
            ok: false,
            error: 'Geçersiz KEDI dosya türü.'
        };
    }

    const baseName = ext === '.map' ? 'Yeni Map' : 'Yeni Node';

    let fileName = baseName + ext;
    let fullPath = path.join(folderPath, fileName);
    let counter = 1;

    while (fs.existsSync(fullPath)) {
        fileName = `${baseName} ${counter}${ext}`;
        fullPath = path.join(folderPath, fileName);
        counter++;
    }

    const title = path.basename(fileName, ext);
    const id = generateKediId(ext);

    const data = createKediDocumentData({
        ext,
        title,
        id,
        parentMap: options.parentMap || 'none'
    });

    writeKediDocument(fullPath, data);

    const sidecarPath = ensureKediSidecar(fullPath, data.kedi);

    return {
        ok: true,
        fileName,
        fullPath,
        sidecarPath,
        metadata: data.kedi
    };
}


function normalizeKediDiaryIsoDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return raw;
}

function ensureKediDiaryFolder(projectFolder) {
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
    fs.mkdirSync(diaryFolder, { recursive: true });

    return {
        ok: true,
        diaryFolder
    };
}

function makeKediDiaryNodeTitle(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    return `${day}-${month}-${year}`;
}

function getKediDiaryNodePath(projectFolder, isoDate) {
    return path.join(projectFolder, 'diary', `${isoDate}.node`);
}

function getOrCreateDiaryNode(projectFolder, isoDate) {
    try {
        const normalizedDate = normalizeKediDiaryIsoDate(isoDate);

        if (!normalizedDate) {
            return {
                ok: false,
                error: 'Geçersiz diary tarihi. Beklenen format: YYYY-MM-DD.'
            };
        }

        const folderResult = ensureKediDiaryFolder(projectFolder);

        if (!folderResult.ok) return folderResult;

        const nodePath = getKediDiaryNodePath(projectFolder, normalizedDate);

        if (!fs.existsSync(nodePath)) {
            const id = generateKediId('.node');
            const title = makeKediDiaryNodeTitle(normalizedDate);

            const data = createKediDocumentData({
                ext: '.node',
                title,
                id,
                parentMap: 'diary'
            });

            data.kedi.diaryDate = normalizedDate;
            data.content = `<h2>${escapeHtmlForKediDiary(title)}</h2><div><br></div>`;

            writeKediDocument(nodePath, data);
            ensureKediSidecar(nodePath, data.kedi);
        }

        const ensured = ensureKediFileMetadata(nodePath);

        if (!ensured.ok) return ensured;

        if (ensured.data?.kedi && ensured.data.kedi.diaryDate !== normalizedDate) {
            ensured.data.kedi.diaryDate = normalizedDate;
            ensured.data.kedi.parentMap = 'diary';
            ensured.data.kedi.updatedAt = new Date().toISOString();
            writeKediDocument(nodePath, ensured.data);
        }

        return {
            ok: true,
            name: path.basename(nodePath),
            fileName: path.basename(nodePath),
            fullPath: nodePath,
            type: 'file',
            isDirectory: false,
            isFile: true,
            displayName: ensured.metadata?.title || makeKediDiaryNodeTitle(normalizedDate),
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

const KEDI_DIARY_MANAGED_START = '<!--KEDI_DIARY_MANAGED_START-->';
const KEDI_DIARY_MANAGED_END = '<!--KEDI_DIARY_MANAGED_END-->';

function stripKediDiaryManagedSection(content = '') {
    const escapedStart = KEDI_DIARY_MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = KEDI_DIARY_MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');

    return String(content || '').replace(regex, '').trim();
}

function escapeHtmlForKediDiary(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeKediDiaryBlockHtml(html = '') {
    return String(html || '')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
}

function normalizeKediDiarySyncEntry(entry) {
    const date = normalizeKediDiaryIsoDate(entry?.date);

    if (!date) return null;

    const nodePath = String(entry?.nodePath || '').trim();
    const blockId = String(entry?.blockId || '').trim();
    const tag = String(entry?.tag || '').trim();
    const text = String(entry?.text || '').trim();

    if (!nodePath || !tag) return null;

    const sourceKey = [nodePath, blockId || text, tag].join('::');

    return {
        date,
        sourceKey,
        nodePath,
        nodeTitle: String(entry?.nodeTitle || 'Node'),
        blockId,
        tag,
        priority: Number(entry?.priority || 0),
        text,
        html: sanitizeKediDiaryBlockHtml(entry?.html || '')
    };
}

function buildKediDiaryManagedSection(isoDate, entries = []) {
    if (!entries.length) return '';

    const safeDate = escapeHtmlForKediDiary(isoDate);
    const blocks = entries.map((entry) => {
        const safeSourceKey = escapeHtmlForKediDiary(entry.sourceKey);
        const safeNodeTitle = escapeHtmlForKediDiary(entry.nodeTitle || 'Node');
        const safeTag = escapeHtmlForKediDiary(entry.tag || '');
        const safeText = escapeHtmlForKediDiary(entry.text || '');
        const blockHtml = entry.html || `<div>${safeText || '(boş blok)'}</div>`;

        return `
<div class="kedi-diary-managed-block" data-kedi-diary-source="${safeSourceKey}">
    <div class="kedi-diary-managed-meta">${safeNodeTitle} · ..${safeTag}</div>
    ${blockHtml}
</div>`;
    }).join('\n');

    return `${KEDI_DIARY_MANAGED_START}
<h3>Görevler · ${safeDate}</h3>
${blocks}
${KEDI_DIARY_MANAGED_END}`;
}

function listKediDiaryNodePaths(projectFolder) {
    const diaryFolder = path.join(projectFolder, 'diary');

    if (!fs.existsSync(diaryFolder)) return [];

    return fs.readdirSync(diaryFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.node'))
        .map((entry) => path.join(diaryFolder, entry.name));
}

function listKediDiaryDates(projectFolder) {
    try {
        if (!projectFolder || !fs.existsSync(projectFolder)) {
            return {
                ok: false,
                error: 'Proje klasörü bulunamadı.',
                dates: []
            };
        }

        const diaryFolder = path.join(projectFolder, 'diary');

        if (!fs.existsSync(diaryFolder)) {
            return {
                ok: true,
                dates: []
            };
        }

        const dates = new Set();

        for (const nodePath of listKediDiaryNodePaths(projectFolder)) {
            let date = normalizeKediDiaryIsoDate(path.basename(nodePath, '.node'));

            if (!date) {
                const ensured = ensureKediFileMetadata(nodePath);
                date = normalizeKediDiaryIsoDate(ensured?.data?.kedi?.diaryDate);
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

function syncDiaryMissions(projectFolder, rawEntries = []) {
    try {
        const folderResult = ensureKediDiaryFolder(projectFolder);

        if (!folderResult.ok) return folderResult;

        const entriesByDate = new Map();
        const seenByDate = new Map();

        for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : []) {
            const entry = normalizeKediDiarySyncEntry(rawEntry);

            if (!entry) continue;

            if (!entriesByDate.has(entry.date)) {
                entriesByDate.set(entry.date, []);
                seenByDate.set(entry.date, new Set());
            }

            const seen = seenByDate.get(entry.date);

            if (seen.has(entry.sourceKey)) continue;

            seen.add(entry.sourceKey);
            entriesByDate.get(entry.date).push(entry);
        }

        for (const date of entriesByDate.keys()) {
            const createResult = getOrCreateDiaryNode(projectFolder, date);

            if (!createResult.ok) {
                return createResult;
            }
        }

        const allDiaryNodes = listKediDiaryNodePaths(projectFolder);
        let updatedCount = 0;

        for (const nodePath of allDiaryNodes) {
            const ensured = ensureKediFileMetadata(nodePath);

            if (!ensured.ok || ensured.metadata?.type !== 'node') continue;

            const fileDate =
                normalizeKediDiaryIsoDate(ensured.data?.kedi?.diaryDate) ||
                normalizeKediDiaryIsoDate(path.basename(nodePath, '.node'));

            if (!fileDate) continue;

            const manualContent = stripKediDiaryManagedSection(ensured.data.content || '');
            const entries = entriesByDate.get(fileDate) || [];
            const managedSection = buildKediDiaryManagedSection(fileDate, entries);
            const nextContent = [manualContent, managedSection]
                .filter(Boolean)
                .join('\n\n');

            if (nextContent !== String(ensured.data.content || '')) {
                ensured.data.content = nextContent;
                ensured.data.kedi.parentMap = 'diary';
                ensured.data.kedi.diaryDate = fileDate;
                ensured.data.kedi.updatedAt = new Date().toISOString();
                writeKediDocument(nodePath, ensured.data);
                updatedCount++;
            }
        }

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

        const ext = getKediFileExt(mapPath);

        if (ext !== '.map') {
            return {
                ok: false,
                error: 'Node sadece .map dosyası altında oluşturulabilir.'
            };
        }

        const mapInfo = ensureKediFileMetadata(mapPath);

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

        const nodeInfo = createUniqueKediFile(mapSidecarPath, '.node', {
            parentMap: mapId
        });

        const nodeList = listNodesForMap(mapPath);
        const createdNode = nodeList.ok
        ? nodeList.nodes.find((node) => node.id === nodeInfo.metadata.id)
        : null;

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

function renameKediFile(oldPath, newBaseName) {
    try {
        if (!oldPath || !fs.existsSync(oldPath)) {
            return {
                ok: false,
                error: 'Yeniden adlandırılacak dosya bulunamadı.'
            };
        }

        const ext = getKediFileExt(oldPath);

        if (ext !== '.node' && ext !== '.map') {
            return {
                ok: false,
                error: 'Sadece .node ve .map dosyaları yeniden adlandırılabilir.'
            };
        }

        const ensuredBefore = ensureKediFileMetadata(oldPath);
        if (!ensuredBefore.ok) return ensuredBefore;

        const dir = path.dirname(oldPath);
        const id = ensuredBefore.metadata.id;

        let cleanTitle = sanitizeKediBaseName(newBaseName);

        if (cleanTitle.toLowerCase().endsWith(ext)) {
            cleanTitle = cleanTitle.slice(0, -ext.length);
            cleanTitle = sanitizeKediBaseName(cleanTitle);
        }

        // Aynı görünen title'a izin veriyoruz.
        // Eğer plain dosya adı doluysa gerçek dosya adı title__id.ext olur.
        const newPath = getUniqueKediPhysicalPath(
            dir,
            cleanTitle,
            ext,
            id,
            oldPath
        );

        if (normalizePathForCompare(oldPath) !== normalizePathForCompare(newPath)) {
            fs.renameSync(oldPath, newPath);
        }

        // Dosya rename sonrası metadata title'ı görünür title olarak ayarla.
        const data = readJsonFileSafe(newPath) || ensuredBefore.data;

        if (!data.kedi) data.kedi = {};

        data.kedi.title = cleanTitle;
        data.kedi.sidecar = getKediSidecarName(cleanTitle, ext, id);
        data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(newPath, data);

        const ensuredAfter = ensureKediFileMetadata(newPath);

        return {
            ok: true,
            fullPath: newPath,
            fileName: path.basename(newPath),
            displayName: ensuredAfter.metadata.title,
            metadata: ensuredAfter.metadata,
            sidecarPath: ensuredAfter.sidecarPath
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function getKediDocument(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return {
                ok: false,
                error: 'Dosya bulunamadı.'
            };
        }

        const ensured = ensureKediFileMetadata(filePath);

        if (!ensured.ok) return ensured;

        return {
            ok: true,
            fullPath: filePath,
            fileName: path.basename(filePath),
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

function stripPreviewText(value = '') {
    return String(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getDefaultNodeLayout(index) {
    const col = index % 4;
    const row = Math.floor(index / 4);

    return {
        x: 80 + col * 240,
        y: 80 + row * 150,
        width: 220,
        height: 92
    };
}

function listNodesForMap(mapPath) {
    try {
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (mapInfo.metadata.type !== 'map') {
            return {
                ok: false,
                error: 'Bu dosya bir map değil.'
            };
        }

        const sidecarPath = mapInfo.sidecarPath;

        if (!sidecarPath || !fs.existsSync(sidecarPath)) {
            return {
                ok: true,
                map: mapInfo,
                nodes: []
            };
        }

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        if (!Array.isArray(mapInfo.data.map.nodes)) {
            mapInfo.data.map.nodes = [];
        }

        const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });
        const nodeFiles = entries
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.node'))
            .map((entry) => path.join(sidecarPath, entry.name));

        let changed = false;

        const nodes = nodeFiles.map((nodePath, index) => {
            const nodeInfo = ensureKediFileMetadata(nodePath);

            if (!nodeInfo.ok) {
                return null;
            }

            const nodeId = nodeInfo.metadata.id;

            let layout = mapInfo.data.map.nodes.find((item) => item.id === nodeId);

            if (!layout) {
                layout = {
                    id: nodeId,
                    ...getDefaultNodeLayout(index)
                };

                mapInfo.data.map.nodes.push(layout);
                changed = true;
            }

            return {
                id: nodeId,
                fullPath: nodePath,
                fileName: path.basename(nodePath),
                metadata: nodeInfo.metadata,
                content: nodeInfo.data.content || '',
                preview: stripPreviewText(nodeInfo.data.content || ''),
                layout: {
                    x: Number(layout.x ?? 80),
                    y: Number(layout.y ?? 80),
                    width: Number(layout.width ?? 220),
                    height: Number(layout.height ?? 92)
                }
            };
        }).filter(Boolean);

        if (changed) {
            writeKediDocument(mapPath, mapInfo.data);
        }

        const syncResult = syncMapConnectionMetadata(mapPath);

        return {
        ok: true,
        map: mapInfo,
        nodes,
        edges: syncResult.ok
        ? syncResult.edges
        : (Array.isArray(mapInfo.data.map.edges) ? mapInfo.data.map.edges : [])
        };

    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveMapNodeLayout(mapPath, nodeLayouts = []) {
    try {
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        if (!Array.isArray(mapInfo.data.map.nodes)) {
            mapInfo.data.map.nodes = [];
        }

        for (const incoming of nodeLayouts) {
            if (!incoming || !incoming.id) continue;

            let stored = mapInfo.data.map.nodes.find((item) => item.id === incoming.id);

            if (!stored) {
                stored = { id: incoming.id };
                mapInfo.data.map.nodes.push(stored);
            }

            stored.x = Number(incoming.x ?? stored.x ?? 80);
            stored.y = Number(incoming.y ?? stored.y ?? 80);
            stored.width = Number(incoming.width ?? stored.width ?? 220);
            stored.height = Number(incoming.height ?? stored.height ?? 92);
        }

        mapInfo.data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(mapPath, mapInfo.data);

        return {
            ok: true
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveMapCamera(mapPath, camera = {}) {
    try {
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        mapInfo.data.map.camera = {
            x: Number(camera.x ?? 0),
            y: Number(camera.y ?? 0),
            zoom: Number(camera.zoom ?? 1)
        };

        mapInfo.data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(mapPath, mapInfo.data);

        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function saveNodeContent(nodePath, content = '') {
    try {
        const nodeInfo = ensureKediFileMetadata(nodePath);

        if (!nodeInfo.ok) return nodeInfo;

        if (nodeInfo.metadata.type !== 'node') {
            return {
                ok: false,
                error: 'Bu dosya bir node değil.'
            };
        }

        nodeInfo.data.content = String(content || '');
        nodeInfo.data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(nodePath, nodeInfo.data);

        return {
            ok: true,
            fullPath: nodePath,
            fileName: path.basename(nodePath),
            metadata: nodeInfo.data.kedi,
            content: nodeInfo.data.content,
            preview: stripPreviewText(nodeInfo.data.content)
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function getNodeDocByIdInMap(mapPath, nodeId) {
    const mapInfo = ensureKediFileMetadata(mapPath);

    if (!mapInfo.ok || !mapInfo.sidecarPath || !fs.existsSync(mapInfo.sidecarPath)) {
        return null;
    }

    const entries = fs.readdirSync(mapInfo.sidecarPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) continue;

        const nodePath = path.join(mapInfo.sidecarPath, entry.name);
        const nodeInfo = ensureKediFileMetadata(nodePath);

        if (nodeInfo.ok && nodeInfo.metadata.id === nodeId) {
            return nodeInfo;
        }
    }

    return null;
}

function getAllNodeDocsInMap(mapPath) {
    const mapInfo = ensureKediFileMetadata(mapPath);

    if (!mapInfo.ok || !mapInfo.sidecarPath || !fs.existsSync(mapInfo.sidecarPath)) {
        return {
            ok: false,
            error: 'Map node klasörü bulunamadı.',
            mapInfo,
            nodesById: new Map()
        };
    }

    const nodesById = new Map();
    const entries = fs.readdirSync(mapInfo.sidecarPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
            continue;
        }

        const nodePath = path.join(mapInfo.sidecarPath, entry.name);
        const nodeInfo = ensureKediFileMetadata(nodePath);

        if (nodeInfo.ok && nodeInfo.metadata?.id) {
            nodesById.set(nodeInfo.metadata.id, nodeInfo);
        }
    }

    return {
        ok: true,
        mapInfo,
        nodesById
    };
}

function syncMapConnectionMetadata(mapPath) {
    const result = getAllNodeDocsInMap(mapPath);

    if (!result.ok) {
        return result;
    }

    const { mapInfo, nodesById } = result;

    if (!mapInfo.data.map) {
        mapInfo.data.map = {
            nodes: [],
            edges: [],
            camera: { x: 0, y: 0, zoom: 1 }
        };
    }

    if (!Array.isArray(mapInfo.data.map.edges)) {
        mapInfo.data.map.edges = [];
    }

    const oldEdgesJson = JSON.stringify(mapInfo.data.map.edges);
    const oldConnectionTypesByPath = new Map();

    // Önce mevcut connectionTypes durumunu kaydediyoruz.
    for (const nodeInfo of nodesById.values()) {
        oldConnectionTypesByPath.set(
            nodeInfo.filePath,
            JSON.stringify(normalizeNodeConnectionTypes(nodeInfo.data.kedi.connectionTypes))
        );

        resetNodeConnectionTypes(nodeInfo.data.kedi);
    }

    const cleanEdges = [];

    for (const rawEdge of mapInfo.data.map.edges) {
        const edge = normalizeMapEdge(rawEdge);

        if (!edge) continue;

        const sourceInfo = nodesById.get(edge.sourceId);
        const targetInfo = nodesById.get(edge.targetId);

        // Eğer node dosyası yoksa bu edge artık ölüdür.
        if (!sourceInfo || !targetInfo) {
            continue;
        }

        cleanEdges.push(edge);

        addUniqueConnectionType(
            sourceInfo.data.kedi,
            edge.sourceRole,
            edge.targetId
        );

        addUniqueConnectionType(
            targetInfo.data.kedi,
            edge.targetRole,
            edge.sourceId
        );
    }

    mapInfo.data.map.edges = cleanEdges;

    const newEdgesJson = JSON.stringify(cleanEdges);

    if (oldEdgesJson !== newEdgesJson) {
        mapInfo.data.kedi.updatedAt = new Date().toISOString();
        writeKediDocument(mapPath, mapInfo.data);
    }

    // Kritik düzeltme:
    // Node dosyalarını sadece connectionTypes gerçekten değiştiyse yaz.
    for (const nodeInfo of nodesById.values()) {
        const oldConnectionTypesJson = oldConnectionTypesByPath.get(nodeInfo.filePath);
        const newConnectionTypesJson = JSON.stringify(
            normalizeNodeConnectionTypes(nodeInfo.data.kedi.connectionTypes)
        );

        if (oldConnectionTypesJson !== newConnectionTypesJson) {
            nodeInfo.data.kedi.updatedAt = new Date().toISOString();
            writeKediDocument(nodeInfo.filePath, nodeInfo.data);
        }
    }

    return {
        ok: true,
        edges: cleanEdges,
        nodesById
    };
}

function removeNodeRelationship(metadata, otherNodeId) {
    if (!metadata.connectionTypes) {
        metadata.connectionTypes = getDefaultNodeConnectionTypes();
    }

    const keys = ["up-hub", "down-hub", "co-level", "upstream", "downstream"];

    for (const key of keys) {
        metadata.connectionTypes[key] = Array.isArray(metadata.connectionTypes[key])
            ? metadata.connectionTypes[key].filter((id) => id !== otherNodeId)
            : [];
    }
}

function addUniqueConnectionType(metadata, type, otherNodeId) {
    if (!metadata.connectionTypes) {
        metadata.connectionTypes = getDefaultNodeConnectionTypes();
    }

    if (!Array.isArray(metadata.connectionTypes[type])) {
        metadata.connectionTypes[type] = [];
    }

    if (!metadata.connectionTypes[type].includes(otherNodeId)) {
        metadata.connectionTypes[type].push(otherNodeId);
    }
}

function upsertMapConnection(mapPath, edge) {
    try {
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) return mapInfo;

        if (!mapInfo.data.map) {
            mapInfo.data.map = {
                nodes: [],
                edges: [],
                camera: { x: 0, y: 0, zoom: 1 }
            };
        }

        if (!Array.isArray(mapInfo.data.map.edges)) {
            mapInfo.data.map.edges = [];
        }

        if (!edge?.sourceId || !edge?.targetId) {
            return {
                ok: false,
                error: 'Bağlantı için sourceId ve targetId gerekli.'
            };
        }

        if (edge.sourceId === edge.targetId) {
            return {
                ok: false,
                error: 'Bir node kendisine bağlanamaz.'
            };
        }

        let normalizedEdge = normalizeMapEdge(edge);

        normalizedEdge = enforceSingleParentForTargetInMap(
         normalizedEdge,
         mapInfo.data.map.edges
        );

        if (!normalizedEdge) {
            return {
                ok: false,
                error: 'Bağlantı normalize edilemedi.'
            };
        }

        // İki node arasında tek aktif bağlantı olsun.
        // Aynı iki node arasında eski bağlantı varsa kaldırıyoruz.
        mapInfo.data.map.edges = mapInfo.data.map.edges.filter((existing) => {
            const sameDirection =
                existing.sourceId === normalizedEdge.sourceId &&
                existing.targetId === normalizedEdge.targetId;

            const reverseDirection =
                existing.sourceId === normalizedEdge.targetId &&
                existing.targetId === normalizedEdge.sourceId;

            return !(sameDirection || reverseDirection);
        });

        mapInfo.data.map.edges.push(normalizedEdge);
        mapInfo.data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(mapPath, mapInfo.data);

        const syncResult = syncMapConnectionMetadata(mapPath);

        if (!syncResult.ok) {
            return syncResult;
        }

        return {
            ok: true,
            edge: normalizedEdge,
            edges: syncResult.edges
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function deleteMapConnection(mapPath, edgeId) {
    try {
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) {
            return mapInfo;
        }

        if (!mapInfo.data.map || !Array.isArray(mapInfo.data.map.edges)) {
            return {
                ok: false,
                error: 'Bu map içinde bağlantı listesi bulunamadı.'
            };
        }

        const beforeCount = mapInfo.data.map.edges.length;

        mapInfo.data.map.edges = mapInfo.data.map.edges.filter((edge) => {
            return edge.id !== edgeId;
        });

        const afterCount = mapInfo.data.map.edges.length;

        if (beforeCount === afterCount) {
            return {
                ok: false,
                error: 'Silinecek bağlantı bulunamadı.'
            };
        }

        mapInfo.data.kedi.updatedAt = new Date().toISOString();
        writeKediDocument(mapPath, mapInfo.data);

        // Kritik kısım:
        // Edge silindikten sonra bütün node connectionTypes alanları
        // kalan edge listesine göre yeniden üretilir.
        const syncResult = syncMapConnectionMetadata(mapPath);

        if (!syncResult.ok) {
            return syncResult;
        }

        return {
            ok: true,
            deletedEdgeId: edgeId,
            edges: syncResult.edges
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function findParentMapPathForNode(nodePath, nodeInfo = null) {
    const nodeDir = path.dirname(nodePath);
    const possibleMapDir = path.dirname(nodeDir);
    const nodeSidecarFolderName = path.basename(nodeDir);

    if (!fs.existsSync(possibleMapDir)) {
        return null;
    }

    const entries = fs.readdirSync(possibleMapDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.map')) {
            continue;
        }

        const mapPath = path.join(possibleMapDir, entry.name);
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) continue;

        const sameSidecar =
            mapInfo.metadata.sidecar === nodeSidecarFolderName;

        const sameParentId =
            nodeInfo?.metadata?.parentMap &&
            nodeInfo.metadata.parentMap !== 'none' &&
            mapInfo.metadata.id === nodeInfo.metadata.parentMap;

        if (sameSidecar || sameParentId) {
            return mapPath;
        }
    }

    return null;
}

function findParentMapPathForNode(nodePath, nodeInfo = null) {
    const nodeDir = path.dirname(nodePath);
    const possibleMapDir = path.dirname(nodeDir);
    const sidecarFolderName = path.basename(nodeDir);

    if (!fs.existsSync(possibleMapDir)) {
        return null;
    }

    const entries = fs.readdirSync(possibleMapDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.map')) {
            continue;
        }

        const mapPath = path.join(possibleMapDir, entry.name);
        const mapInfo = ensureKediFileMetadata(mapPath);

        if (!mapInfo.ok) continue;

        const sameSidecar = mapInfo.metadata.sidecar === sidecarFolderName;

        const sameParentId =
            nodeInfo?.metadata?.parentMap &&
            nodeInfo.metadata.parentMap !== 'none' &&
            mapInfo.metadata.id === nodeInfo.metadata.parentMap;

        if (sameSidecar || sameParentId) {
            return mapPath;
        }
    }

    return null;
}

function cleanupDeletedNodeFromParentMap(parentMapPath, deletedNodeId) {
    if (!parentMapPath || !deletedNodeId || !fs.existsSync(parentMapPath)) {
        return {
            parentMapPath: null,
            edges: []
        };
    }

    const mapInfo = ensureKediFileMetadata(parentMapPath);

    if (!mapInfo.ok || !mapInfo.data.map) {
        return {
            parentMapPath,
            edges: []
        };
    }

    if (!Array.isArray(mapInfo.data.map.nodes)) {
        mapInfo.data.map.nodes = [];
    }

    if (!Array.isArray(mapInfo.data.map.edges)) {
        mapInfo.data.map.edges = [];
    }

    mapInfo.data.map.nodes = mapInfo.data.map.nodes.filter((node) => {
        return node.id !== deletedNodeId;
    });

    mapInfo.data.map.edges = mapInfo.data.map.edges.filter((edge) => {
        return edge.sourceId !== deletedNodeId && edge.targetId !== deletedNodeId;
    });

    mapInfo.data.kedi.updatedAt = new Date().toISOString();
    writeKediDocument(parentMapPath, mapInfo.data);

    // Kalan node dosyalarının connectionTypes alanından silinen node id'sini düş.
    const sidecarPath = mapInfo.sidecarPath;

    if (sidecarPath && fs.existsSync(sidecarPath)) {
        const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
                continue;
            }

            const nodePath = path.join(sidecarPath, entry.name);
            const nodeInfo = ensureKediFileMetadata(nodePath);

            if (!nodeInfo.ok) continue;

            const before = JSON.stringify(nodeInfo.data.kedi.connectionTypes);

            removeNodeRelationship(nodeInfo.data.kedi, deletedNodeId);

            const after = JSON.stringify(nodeInfo.data.kedi.connectionTypes);

            if (before !== after) {
                nodeInfo.data.kedi.updatedAt = new Date().toISOString();
                writeKediDocument(nodePath, nodeInfo.data);
            }
        }
    }

    return {
        parentMapPath,
        edges: mapInfo.data.map.edges
    };
}

function deleteKediFile(targetPath) {
    try {
        if (!targetPath || !fs.existsSync(targetPath)) {
            return {
                ok: false,
                error: 'Silinecek dosya bulunamadı.'
            };
        }

        const ext = getKediFileExt(targetPath);

        if (ext !== '.map' && ext !== '.node') {
            return {
                ok: false,
                error: 'Sadece .map ve .node dosyaları silinebilir.'
            };
        }

        const info = ensureKediFileMetadata(targetPath);

        if (!info.ok) {
            return info;
        }

        const dir = path.dirname(targetPath);
        const sidecarPath = info.metadata.sidecar
            ? path.join(dir, info.metadata.sidecar)
            : null;

        if (ext === '.map') {
            if (sidecarPath && fs.existsSync(sidecarPath)) {
                fs.rmSync(sidecarPath, { recursive: true, force: true });
            }

            fs.unlinkSync(targetPath);

            return {
                ok: true,
                type: 'map',
                deletedPath: targetPath,
                deletedMapId: info.metadata.id
            };
        }

        const deletedNodeId = info.metadata.id;
        const parentMapPath = findParentMapPathForNode(targetPath, info);

        const cleanupResult = cleanupDeletedNodeFromParentMap(
            parentMapPath,
            deletedNodeId
        );

        if (sidecarPath && fs.existsSync(sidecarPath)) {
            fs.rmSync(sidecarPath, { recursive: true, force: true });
        }

        fs.unlinkSync(targetPath);

        return {
            ok: true,
            type: 'node',
            deletedPath: targetPath,
            deletedNodeId,
            parentMapPath: cleanupResult.parentMapPath,
            edges: cleanupResult.edges
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

function deleteNodeFromMap(nodePath) {
    return deleteKediFile(nodePath);
}

function safeListFolder(folderPath) {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return {
                ok: false,
                error: 'Klasör bulunamadı.',
                items: []
            };
        }

        const entries = fs.readdirSync(folderPath, { withFileTypes: true });



        const items = entries
    .filter((entry) => {
        if (isKediManagedSidecarFolder(entry.name)) return false;

        if (entry.isDirectory() && entry.name.toLowerCase() === 'diary') return false;

        if (entry.isDirectory()) return true;

        return isKediVisibleFile(entry.name);
    })

    .map((entry) => {
    
        const fullPath = path.join(folderPath, entry.name);

        let metadata = null;
        let sidecarPath = null;

        if (entry.isFile() && isKediVisibleFile(entry.name)) {
        const ensured = ensureKediFileMetadata(fullPath);

        if (ensured && ensured.ok) {
            metadata = ensured.metadata;
            sidecarPath = ensured.sidecarPath;
        }
        }

        return {
        name: entry.name,
        fullPath,
        type: entry.isDirectory() ? 'folder' : 'file',
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        metadata,
        sidecarPath
        };
    
    });

        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }

            return a.name.localeCompare(b.name, 'tr');
        });

        return {
            ok: true,
            items
        };
        } catch (error) {
        return {
            ok: false,
            error: error.message,
            items: []
        };
        }
}

let activeProjectFolder = null;

let projectWatcher = null;
let projectWatchTimer = null;

function stopProjectWatcher() {
    if (projectWatcher) {
        try {
            projectWatcher.close();
        } catch (error) {
            console.warn('[KEDI] Watcher kapatılamadı:', error.message);
        }
    }

    projectWatcher = null;
    clearTimeout(projectWatchTimer);
    projectWatchTimer = null;
}

function notifyProjectChanged(reason = 'changed') {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    clearTimeout(projectWatchTimer);

    projectWatchTimer = setTimeout(() => {
        mainWindow.webContents.send('project:filesystem-changed', {
            reason,
            folderPath: activeProjectFolder
        });
    }, 250);
}

function startProjectWatcher(folderPath) {
    stopProjectWatcher();

    if (!folderPath || !fs.existsSync(folderPath)) {
        return;
    }

    try {
        projectWatcher = fs.watch(
            folderPath,
            { recursive: process.platform === 'win32' },
            () => {
                notifyProjectChanged('filesystem');
            }
        );

        console.log('[KEDI] Proje klasörü izleniyor:', folderPath);
    } catch (error) {
        console.warn('[KEDI] Proje klasörü izlenemedi:', error.message);
    }
}

function folderExistsAndIsDirectory(folderPath) {
    try {
        return Boolean(
            folderPath &&
            fs.existsSync(folderPath) &&
            fs.statSync(folderPath).isDirectory()
        );
    } catch {
        return false;
    }
}

function normalizePathForCompare(targetPath) {
    if (!targetPath) return '';

    return path
        .resolve(targetPath)
        .replace(/[\\/]+/g, '/')
        .toLowerCase();
}

function hideFileOnWindows(filePath) {
    if (process.platform !== 'win32') return;

    try {
        const { execFile } = require('child_process');
        execFile('attrib', ['+H', filePath], () => {});
    } catch (error) {
        console.warn('[KEDI] Lock dosyası gizlenemedi:', error.message);
    }
}

function ensureProjectLockMarker(folderPath) {
    try {
        const lockPath = path.join(folderPath, '.kedi.lock');

        if (!fs.existsSync(lockPath)) {
            fs.writeFileSync(
                lockPath,
                'KEDI bu klasörü aktif proje klasörü olarak kullanıyor.\nUygulama açıkken klasörü silmeyin.\n',
                'utf-8'
            );
        }

        hideFileOnWindows(lockPath);
    } catch (error) {
        console.warn('[KEDI] Lock marker oluşturulamadı:', error.message);
    }
}

function lockProjectFolder(folderPath) {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return false;
        }

        const stat = fs.statSync(folderPath);
        if (!stat.isDirectory()) {
            return false;
        }

        // KRİTİK KISIM:
        // Windows, çalışan process'in current working directory'sini silmeye izin vermez.
        process.chdir(folderPath);

        activeProjectFolder = folderPath;
        ensureProjectLockMarker(folderPath);
        startProjectWatcher(folderPath);

        console.log('[KEDI] Proje klasörü kilitlendi:', folderPath);
        return true;
    } catch (error) {
        console.error('[KEDI] Proje klasörü kilitlenemedi:', error);
        return false;
    }
}

function unlockProjectFolder() {
    stopProjectWatcher();

    try {
        process.chdir(app.getPath('home'));
    } catch (error) {
        console.warn('[KEDI] Proje klasörü kilidi bırakılırken hata:', error.message);
    }

    activeProjectFolder = null;
}

function createWindow() {

    const savedWindowState = getSavedWindowState();

    mainWindow = new BrowserWindow({
        
        width: savedWindowState.width,
        height: savedWindowState.height,
        x: savedWindowState.x,
        y: savedWindowState.y,

        minWidth: 900,
        minHeight: 600,

        title: 'KEDI',
        icon: appIconPath,
        frame: false,
        backgroundColor: '#1e1e1e',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    Menu.setApplicationMenu(null);

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.on('maximize', () => {
        saveWindowState();
        mainWindow.webContents.send('window:maximized');
    });

    mainWindow.on('unmaximize', () => {
        saveWindowState();
        mainWindow.webContents.send('window:unmaximized');
    });

    mainWindow.on('enter-full-screen', () => {
        saveWindowState();
    });

    mainWindow.on('leave-full-screen', () => {
        saveWindowState();
    });

    mainWindow.on('move', () => {
        scheduleWindowStateSave();
    });

    mainWindow.on('resize', () => {
        scheduleWindowStateSave();
    });

    mainWindow.on('close', () => {
        saveWindowState();
    });

    mainWindow.once('ready-to-show', () => {
        if (savedWindowState.isFullScreen) {
            mainWindow.setFullScreen(true);
        }

        else if (savedWindowState.isMaximized) {
            mainWindow.maximize();
        }

            mainWindow.show();
});
}

// Window controls
ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;

    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.on('window:focus-renderer', () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.focus();
    mainWindow.webContents?.focus?.();
});

ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

// Project handlers

ipcMain.handle('project:save-map-camera', (_event, mapPath, camera) => {
    return saveMapCamera(mapPath, camera);
});

ipcMain.handle('project:upsert-map-connection', (_event, mapPath, edge) => {
    return upsertMapConnection(mapPath, edge);
});

ipcMain.handle('project:delete-map-connection', (_event, mapPath, edgeId) => {
    return deleteMapConnection(mapPath, edgeId);
});

ipcMain.handle('project:get-kedi-document', (_event, filePath) => {
    return getKediDocument(filePath);
});

ipcMain.handle('project:list-map-nodes', (_event, mapPath) => {
    return listNodesForMap(mapPath);
});

ipcMain.handle('project:save-map-layout', (_event, mapPath, nodeLayouts) => {
    return saveMapNodeLayout(mapPath, nodeLayouts);
});

ipcMain.handle('project:save-node-content', (_event, nodePath, content) => {
    return saveNodeContent(nodePath, content);
});

ipcMain.handle('project:delete-node-from-map', (_event, nodePath) => {
    return deleteNodeFromMap(nodePath);
});

ipcMain.handle('project:delete-kedi-file', (_event, targetPath) => {
    return deleteKediFile(targetPath);
});

ipcMain.handle('project:create-node-under-map', (_event, mapPath) => {
    return createNodeUnderMap(mapPath);
});

ipcMain.handle('project:get-or-create-diary-node', (_event, projectFolder, isoDate) => {
    return getOrCreateDiaryNode(projectFolder, isoDate);
});

ipcMain.handle('project:list-diary-dates', (_event, projectFolder) => {
    return listKediDiaryDates(projectFolder);
});

ipcMain.handle('project:sync-diary-missions', (_event, projectFolder, entries) => {
    return syncDiaryMissions(projectFolder, entries);
});

ipcMain.handle('project:rename-kedi-file', (_event, oldPath, newBaseName) => {
    return renameKediFile(oldPath, newBaseName);
});

ipcMain.handle('project:create-kedi-file', (_event, folderPath, ext) => {
    return createUniqueKediFile(folderPath, ext);
});

ipcMain.handle('project:get-last-folder', () => {
    const settings = readSettings();
    const lastProjectFolder = settings.lastProjectFolder || null;

    if (!lastProjectFolder || !fs.existsSync(lastProjectFolder)) {
        return null;
    }

    lockProjectFolder(lastProjectFolder);

    return lastProjectFolder;
});

ipcMain.handle('project:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'KEDI proje klasörü seç',
        properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
    }

    const selectedFolder = result.filePaths[0];

    const settings = readSettings();
    settings.lastProjectFolder = selectedFolder;
    writeSettings(settings);

    lockProjectFolder(selectedFolder);

    return selectedFolder;
});

ipcMain.handle('project:set-last-folder', (_event, folderPath) => {
    const settings = readSettings();
    settings.lastProjectFolder = folderPath || null;
    writeSettings(settings);
    return true;
});

ipcMain.handle('project:list-folder', (_event, folderPath) => {
    return safeListFolder(folderPath);
});

ipcMain.handle('project:folder-exists', (_event, folderPath) => {
    return folderExistsAndIsDirectory(folderPath);
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', () => {
    unlockProjectFolder();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});