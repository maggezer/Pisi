const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow = null;
let allowWindowClose = false;
let closeRequestInFlight = false;
let closeRequestTimer = null;
const recentInternalFileChanges = new Map();

function markInternalFileChange(...filePaths) {
    const expiresAt = Date.now() + 1500;

    for (const filePath of filePaths) {
        if (!filePath) continue;
        recentInternalFileChanges.set(
            normalizePathForCompare(filePath),
            expiresAt
        );
    }
}

function isRecentInternalFileChange(filePath) {
    const now = Date.now();
    const normalizedPath = normalizePathForCompare(filePath);

    for (const [key, expiresAt] of recentInternalFileChanges) {
        if (expiresAt <= now) {
            recentInternalFileChanges.delete(key);
        }
    }

    return Boolean(
        normalizedPath &&
        (recentInternalFileChanges.get(normalizedPath) || 0) > now
    );
}

function renamePathInternal(oldPath, newPath) {
    markInternalFileChange(oldPath, newPath);
    fs.renameSync(oldPath, newPath);
}

const appIconPath = path.join(__dirname, 'assets', 'kedi.ico');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.mumin.kedi');
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
        writeFileAtomic(
            settingsPath,
            JSON.stringify(settings, null, 2),
            { backup: false }
        );
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
        /^(?:inv|nd)_.+__(?:node|map)_[A-Za-z0-9_-]{1,96}$/.test(folderName)
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
    return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeKediId(value, ext = '') {
    const id = String(value || '').trim();
    const expectedPrefix = ext === '.map'
        ? 'map_'
        : (ext === '.node' ? 'node_' : '');

    if (
        !id ||
        id.length > 101 ||
        !/^(?:map|node)_[A-Za-z0-9_-]+$/.test(id) ||
        (expectedPrefix && !id.startsWith(expectedPrefix))
    ) {
        return null;
    }

    return id;
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
    const sourceId = normalizeKediId(edge?.sourceId, '.node');
    const targetId = normalizeKediId(edge?.targetId, '.node');

    if (!sourceId || !targetId || sourceId === targetId) {
        return null;
    }

    let type = String(edge.type || 'down-hub');

    if (type === 'colevel') {
        type = 'co-level';
    }

    if (!['down-hub', 'stream', 'co-level'].includes(type)) {
        type = 'down-hub';
    }

    let sourceRole = normalizeConnectionRole(edge.sourceRole);
    let targetRole = normalizeConnectionRole(edge.targetRole);

    // Portlar yalnızca geometriyi belirler. İlişki türü ile rollerin
    // çelişmesine izin vermeyerek elle düzenlenmiş eski dosyaları onar.
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

    const ports = new Set(['top', 'right', 'bottom', 'left']);
    const sourcePort = ports.has(edge.sourcePort) ? edge.sourcePort : 'bottom';
    const targetPort = ports.has(edge.targetPort) ? edge.targetPort : 'top';

    return {
        id: /^edge_[A-Za-z0-9_-]{1,101}$/.test(String(edge.id || ''))
            ? String(edge.id)
            : `edge_${crypto.randomUUID()}`,
        sourceId,
        targetId,

        // Bunlar sadece çizgi geometrisi.
        sourcePort,
        targetPort,

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

function getKediEdgeSemanticKey(edge) {
    const normalized = normalizeMapEdge(edge);
    if (!normalized) return '';

    if (normalized.type === 'co-level') {
        const pair = [normalized.sourceId, normalized.targetId].sort();
        return `co-level:${pair[0]}:${pair[1]}`;
    }

    return [
        normalized.type,
        normalized.sourceId,
        normalized.targetId,
        normalized.sourceRole,
        normalized.targetRole
    ].join(':');
}

function wouldCreateKediHierarchyCycle(parentByChild, parentId, childId) {
    let current = parentId;
    const visited = new Set();

    while (current && !visited.has(current)) {
        if (current === childId) return true;
        visited.add(current);
        current = parentByChild.get(current) || null;
    }

    return false;
}

function normalizeKediMapEdges(rawEdges = [], validNodeIds = null) {
    const cleanEdges = [];
    const seenSemanticEdges = new Set();
    const parentByChild = new Map();
    const warnings = [];

    for (const rawEdge of Array.isArray(rawEdges) ? rawEdges : []) {
        let edge = normalizeMapEdge(rawEdge);
        if (!edge) {
            warnings.push('Geçersiz veya self-loop bağlantı atlandı.');
            continue;
        }

        if (
            validNodeIds &&
            (
                !validNodeIds.has(edge.sourceId) ||
                !validNodeIds.has(edge.targetId)
            )
        ) {
            warnings.push(`Eksik node referanslı bağlantı atlandı: ${edge.id}`);
            continue;
        }

        if (isHierarchyEdge(edge)) {
            const existingParentId = parentByChild.get(edge.targetId);

            if (
                existingParentId &&
                existingParentId !== edge.sourceId
            ) {
                edge = convertEdgeToStream(edge);
                warnings.push(
                    `İkinci parent bağlantısı stream olarak kurtarıldı: ${edge.id}`
                );
            } else if (
                !existingParentId &&
                wouldCreateKediHierarchyCycle(
                    parentByChild,
                    edge.sourceId,
                    edge.targetId
                )
            ) {
                edge = convertEdgeToStream(edge);
                warnings.push(
                    `Döngü oluşturan bağlantı stream olarak kurtarıldı: ${edge.id}`
                );
            } else if (!existingParentId) {
                parentByChild.set(edge.targetId, edge.sourceId);
            }
        }

        const semanticKey = getKediEdgeSemanticKey(edge);
        if (!semanticKey || seenSemanticEdges.has(semanticKey)) {
            warnings.push(`Tekrarlanan bağlantı atlandı: ${edge.id}`);
            continue;
        }

        seenSemanticEdges.add(semanticKey);
        cleanEdges.push(edge);
    }

    return {
        edges: cleanEdges,
        warnings
    };
}

function resetNodeConnectionTypes(metadata) {
    metadata.connectionTypes = getDefaultNodeConnectionTypes();
}

function getKediSidecarName(title, ext, id) {
    const prefix = getKediSidecarPrefix(ext);
    const safeId = normalizeKediId(id, ext);
    if (!prefix || !safeId) return null;

    const safeTitle = sanitizeForSidecarName(title);
    return `${prefix}${safeTitle}__${safeId}`;
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

function readJsonFileResult(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');

        if (!raw || !raw.trim()) {
            return {
                ok: false,
                raw,
                error: 'Dosya boş.'
            };
        }

        return {
            ok: true,
            raw,
            data: JSON.parse(raw)
        };
    } catch (error) {
        return {
            ok: false,
            raw: null,
            error: error.message
        };
    }
}

function readJsonFileSafe(filePath) {
    const result = readJsonFileResult(filePath);
    return result.ok ? result.data : null;
}

function fsyncDirectoryBestEffort(directoryPath) {
    if (process.platform === 'win32') return;

    let descriptor = null;

    try {
        descriptor = fs.openSync(directoryPath, 'r');
        fs.fsyncSync(descriptor);
    } catch {
        // Bazı dosya sistemleri klasör fsync işlemini desteklemez.
    } finally {
        if (descriptor !== null) {
            fs.closeSync(descriptor);
        }
    }
}

function writeFileAtomic(filePath, content, options = {}) {
    const targetPath = path.resolve(filePath);
    const directoryPath = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const tempPath = path.join(
        directoryPath,
        `.${baseName}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    const backupPath = `${targetPath}.kedi-backup`;
    let descriptor = null;
    markInternalFileChange(targetPath, tempPath, backupPath);

    try {
        descriptor = fs.openSync(tempPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, content, 'utf-8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;

        if (options.backup !== false && fs.existsSync(targetPath)) {
            const backupTempPath = `${backupPath}.${crypto.randomUUID()}.tmp`;
            markInternalFileChange(backupTempPath);
            fs.copyFileSync(targetPath, backupTempPath);
            renamePathInternal(backupTempPath, backupPath);
        }

        renamePathInternal(tempPath, targetPath);
        fsyncDirectoryBestEffort(directoryPath);
    } catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }

        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch {}

        throw error;
    }
}

function writeKediDocument(filePath, data) {
    writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

function writeKediDocumentsTransaction(changes = []) {
    const uniqueChanges = [];
    const seenPaths = new Set();

    for (const change of changes) {
        if (!change?.filePath || !change.data) continue;
        const normalizedPath = normalizePathForCompare(change.filePath);
        if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);
        uniqueChanges.push(change);
    }

    const originals = uniqueChanges.map((change) => ({
        filePath: change.filePath,
        existed: fs.existsSync(change.filePath),
        content: fs.existsSync(change.filePath)
            ? fs.readFileSync(change.filePath, 'utf-8')
            : null
    }));
    const written = [];

    try {
        for (const change of uniqueChanges) {
            writeKediDocument(change.filePath, change.data);
            written.push(change.filePath);
        }
    } catch (error) {
        const rollbackErrors = [];

        for (const original of originals.reverse()) {
            if (!written.some((writtenPath) => {
                return normalizePathForCompare(writtenPath) ===
                    normalizePathForCompare(original.filePath);
            })) {
                continue;
            }

            try {
                if (original.existed) {
                    writeFileAtomic(
                        original.filePath,
                        original.content,
                        { backup: false }
                    );
                } else if (fs.existsSync(original.filePath)) {
                    fs.unlinkSync(original.filePath);
                }
            } catch (rollbackError) {
                rollbackErrors.push(
                    `${original.filePath}: ${rollbackError.message}`
                );
            }
        }

        if (rollbackErrors.length) {
            throw new Error(
                `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
            );
        }

        throw error;
    }
}

function backupCorruptKediFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath);
        const digest = crypto
            .createHash('sha256')
            .update(raw)
            .digest('hex')
            .slice(0, 12);
        const backupPath = `${filePath}.corrupt-${digest}.bak`;

        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
        }

        return backupPath;
    } catch {
        return null;
    }
}

function findExistingSidecarById(dir, ext, id) {
    const safeId = normalizeKediId(id, ext);
    if (!safeId || !fs.existsSync(dir)) return null;

    const prefix = getKediSidecarPrefix(ext);
    if (!prefix) return null;

    const suffix = `__${safeId}`;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const matches = entries.filter((entry) => {
            return (
                entry.isDirectory() &&
                entry.name.startsWith(prefix) &&
                entry.name.endsWith(suffix)
            );
        });

        if (matches.length > 1) {
            throw new Error(
                `Aynı kimliğe bağlı birden fazla yan klasör bulundu: ${safeId}`
            );
        }

        return matches.length === 1
            ? path.join(dir, matches[0].name)
            : null;
    } catch (error) {
        if (String(error.message || '').includes('birden fazla yan klasör')) {
            throw error;
        }
        return null;
    }
}

function ensureKediSidecar(filePath, metadata) {
    const ext = getKediFileExt(filePath);
    const safeId = normalizeKediId(metadata?.id, ext);
    if (!ext || !safeId) return null;

    const dir = path.dirname(filePath);
    const desiredName = getKediSidecarName(metadata.title, ext, safeId);
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
    }

    return desiredPath;
}

function ensureKediFileMetadata(filePath, options = {}) {
    const persist = options.persist !== false;
    const ensureSidecar = options.ensureSidecar !== false;
    const ext = getKediFileExt(filePath);

    if (!ext) {
        return {
            ok: false,
            error: 'KEDI dosyası değil.'
        };
    }

    const type = getKediTypeFromExt(ext);
    const readResult = readJsonFileResult(filePath);
    let changed = false;

    if (
        !readResult.ok ||
        !readResult.data ||
        typeof readResult.data !== 'object' ||
        Array.isArray(readResult.data)
    ) {
        const backupPath = persist
            ? backupCorruptKediFile(filePath)
            : null;

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
    } else if (!normalizeKediId(data.kedi.id, ext)) {
        return {
            ok: false,
            unsafeId: true,
            filePath,
            error: 'Dosyadaki KEDI kimliği güvenli biçimde değil. Dosya değiştirilmedi.'
        };
    }

    const diaryDate = ext === '.node'
        ? normalizeKediDiaryIsoDate(data.kedi.diaryDate)
        : null;
    const cleanVisibleTitle = diaryDate
        ? makeKediDiaryNodeTitle(diaryDate)
        : getVisibleTitleFromFilePath(filePath, ext, data.kedi.id);

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

    if (!data.kedi.updatedAt) {
        data.kedi.updatedAt = data.kedi.createdAt;
        changed = true;
    }

    if (ext === '.node') {
        if (typeof data.content !== 'string') {
            data.content = '';
            changed = true;
        }

        if (!data.kedi.parentMap) {
            data.kedi.parentMap = diaryDate ? 'diary' : 'none';
            changed = true;
        }

        const normalizedConnections = normalizeNodeConnectionTypes(
            data.kedi.connectionTypes
        );

        if (
            JSON.stringify(data.kedi.connectionTypes) !==
            JSON.stringify(normalizedConnections)
        ) {
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

    const desiredSidecarName = getKediSidecarName(
        data.kedi.title,
        ext,
        data.kedi.id
    );
    const desiredSidecarPath = desiredSidecarName
        ? path.join(path.dirname(filePath), desiredSidecarName)
        : null;
    const sidecarPath = ensureSidecar
        ? ensureKediSidecar(filePath, data.kedi)
        : (
            desiredSidecarPath && fs.existsSync(desiredSidecarPath)
                ? desiredSidecarPath
                : findExistingSidecarById(
                    path.dirname(filePath),
                    ext,
                    data.kedi.id
                )
        );

    if (changed && persist) {
        writeKediDocument(filePath, data);
    }

    return {
        ok: true,
        filePath,
        metadata: data.kedi,
        sidecarPath,
        data,
        changed,
        persisted: changed && persist
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
    const markerPath = path.join(diaryFolder, '.kedi-diary');

    if (
        fs.existsSync(diaryFolder) &&
        !isKediManagedDiaryFolder(diaryFolder)
    ) {
        return {
            ok: false,
            error: 'Projedeki mevcut "diary" klasörü KEDI tarafından yönetilmiyor. Kullanıcı klasörünü korumak için işlem durduruldu.'
        };
    }

    markInternalFileChange(diaryFolder);
    fs.mkdirSync(diaryFolder, { recursive: true });

    if (!fs.existsSync(markerPath)) {
        writeFileAtomic(
            markerPath,
            'Bu klasör KEDI diary özelliği tarafından yönetilir.\n',
            { backup: false }
        );
    }

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

        if (
            ensured.data?.kedi &&
            (
                ensured.data.kedi.diaryDate !== normalizedDate ||
                ensured.data.kedi.parentMap !== 'diary' ||
                ensured.data.kedi.title !== makeKediDiaryNodeTitle(normalizedDate)
            )
        ) {
            ensured.data.kedi.diaryDate = normalizedDate;
            ensured.data.kedi.parentMap = 'diary';
            ensured.data.kedi.title = makeKediDiaryNodeTitle(normalizedDate);
            ensured.data.kedi.updatedAt = new Date().toISOString();
            const repairedSidecarPath = ensureKediSidecar(
                nodePath,
                ensured.data.kedi
            );
            ensured.data.kedi.sidecar = repairedSidecarPath
                ? path.basename(repairedSidecarPath)
                : ensured.data.kedi.sidecar;
            writeKediDocument(nodePath, ensured.data);
            ensured.metadata = ensured.data.kedi;
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

    return String(content || '').replace(regex, '');
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
        .replace(/<(iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(iframe|object|embed|link|meta|base|form)\b[^>]*\/?>/gi, '')
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
        .replace(
            /\s(href|src|xlink:href|formaction)\s*=\s*(["'])\s*(?:javascript|vbscript|data\s*:\s*text\/html)[\s\S]*?\2/gi,
            ''
        )
        .replace(
            /\s(href|src|xlink:href|formaction)\s*=\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^\s>]*/gi,
            ''
        )
        .replace(/\sstyle\s*=\s*(["'])[\s\S]*?(?:expression\s*\(|url\s*\(\s*["']?\s*(?:javascript|vbscript|data\s*:\s*text\/html))[\s\S]*?\1/gi, '')
        .replace(/\sstyle\s*=\s*[^\s>]*(?:expression\s*\(|url\s*\()[^\s>]*/gi, '');
}

function normalizeKediDiarySyncEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const date = normalizeKediDiaryIsoDate(entry?.date);

    if (!date) return null;

    const nodePath = String(entry.nodePath || '').trim().slice(0, 32768);
    const blockId = String(entry.blockId || '').trim().slice(0, 500);
    const tag = String(entry.tag || '').trim().slice(0, 200);
    const text = String(entry.text || '').trim().slice(0, 250000);

    if (!nodePath || !tag) return null;

    const sourceIdentity = blockId || crypto
        .createHash('sha256')
        .update(text)
        .digest('hex');
    const sourceKey = [nodePath, sourceIdentity, tag].join('::');
    const rawPriority = Number(entry.priority);
    const priority = Number.isFinite(rawPriority)
        ? Math.max(-1000000, Math.min(1000000, rawPriority))
        : 0;

    return {
        date,
        sourceKey,
        nodePath,
        nodeTitle: String(entry.nodeTitle || 'Node').slice(0, 500),
        blockId,
        tag,
        priority,
        text,
        html: sanitizeKediDiaryBlockHtml(
            String(entry.html || '').slice(0, 2000000)
        )
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

        if (
            !fs.existsSync(diaryFolder) ||
            !isKediManagedDiaryFolder(diaryFolder)
        ) {
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

        if (
            !entriesInput.length &&
            (
                !fs.existsSync(diaryFolderPath) ||
                !isKediManagedDiaryFolder(diaryFolderPath)
            )
        ) {
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
            const entry = normalizeKediDiarySyncEntry(rawEntry);

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

        const folderResult = ensureKediDiaryFolder(projectFolder);

        if (!folderResult.ok) return folderResult;

        for (const date of entriesByDate.keys()) {
            const createResult = getOrCreateDiaryNode(projectFolder, date);

            if (!createResult.ok) {
                return createResult;
            }
        }

        const allDiaryNodes = listKediDiaryNodePaths(projectFolder);
        let updatedCount = 0;
        const diaryChanges = [];

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
            const nextContent = managedSection
                ? `${manualContent}${managedSection}`
                : manualContent;

            if (nextContent !== String(ensured.data.content || '')) {
                ensured.data.content = nextContent;
                ensured.data.kedi.parentMap = 'diary';
                ensured.data.kedi.diaryDate = fileDate;
                ensured.data.kedi.updatedAt = new Date().toISOString();
                diaryChanges.push({
                    filePath: nodePath,
                    data: ensured.data
                });
                updatedCount++;
            }
        }

        writeKediDocumentsTransaction(diaryChanges);

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
        originalContent = fs.readFileSync(oldPath, 'utf-8');
        oldSidecarPath = ensuredBefore.sidecarPath &&
            fs.existsSync(ensuredBefore.sidecarPath)
            ? ensuredBefore.sidecarPath
            : null;

        let cleanTitle = sanitizeKediBaseName(newBaseName);

        if (cleanTitle.toLowerCase().endsWith(ext)) {
            cleanTitle = cleanTitle.slice(0, -ext.length);
            cleanTitle = sanitizeKediBaseName(cleanTitle);
        }

        // Aynı görünen title'a izin veriyoruz.
        // Eğer plain dosya adı doluysa gerçek dosya adı title__id.ext olur.
        newPath = getUniqueKediPhysicalPath(
            dir,
            cleanTitle,
            ext,
            id,
            oldPath
        );
        const newSidecarName = getKediSidecarName(cleanTitle, ext, id);
        newSidecarPath = newSidecarName
            ? path.join(dir, newSidecarName)
            : null;

        if (
            oldSidecarPath &&
            newSidecarPath &&
            fs.existsSync(newSidecarPath) &&
            normalizePathForCompare(oldSidecarPath) !==
                normalizePathForCompare(newSidecarPath)
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

        if (
            oldSidecarPath &&
            newSidecarPath &&
            normalizePathForCompare(oldSidecarPath) !==
                normalizePathForCompare(newSidecarPath)
        ) {
            renamePathInternal(oldSidecarPath, newSidecarPath);
            sidecarMoved = true;
        }

        const data = structuredClone(ensuredBefore.data);

        if (!data.kedi) data.kedi = {};

        data.kedi.title = cleanTitle;
        data.kedi.sidecar = newSidecarName;
        data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(newPath, data);

        const ensuredAfter = ensureKediFileMetadata(newPath);

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
                    ? [{
                        oldPath: oldSidecarPath,
                        newPath: ensuredAfter.sidecarPath
                    }]
                    : [])
            ]
        };
    } catch (error) {
        const rollbackErrors = [];

        try {
            if (
                sidecarMoved &&
                newSidecarPath &&
                oldSidecarPath &&
                fs.existsSync(newSidecarPath) &&
                !fs.existsSync(oldSidecarPath)
            ) {
                renamePathInternal(newSidecarPath, oldSidecarPath);
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        try {
            if (
                fileMoved &&
                newPath &&
                fs.existsSync(newPath) &&
                !fs.existsSync(oldPath)
            ) {
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
            error: rollbackErrors.length
                ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
                : error.message,
            rolledBack: rollbackErrors.length === 0
        };
    }
}

function getUniqueDirectoryPath(destinationFolder, wantedName) {
    const cleanName = sanitizeKediBaseName(wantedName || 'Yeni Klasör');
    let candidate = path.join(destinationFolder, cleanName);

    if (!fs.existsSync(candidate)) {
        return candidate;
    }

    let counter = 1;

    while (true) {
        candidate = path.join(destinationFolder, `${cleanName} ${counter}`);

        if (!fs.existsSync(candidate)) {
            return candidate;
        }

        counter++;
    }
}

function isPathInsideDirectory(childPath, parentPath) {
    const relative = path.relative(parentPath, childPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function moveKediItem(sourcePath, destinationFolderPath, options = {}) {
    let movedPath = null;
    let movedSidecarPath = null;
    let originalSidecarPath = null;
    let originalContent = null;
    let sourceWasDirectory = false;
    let fileMoved = false;
    let sidecarMoved = false;

    try {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return {
                ok: false,
                error: 'Taşınacak öğe bulunamadı.'
            };
        }

        if (!destinationFolderPath || !fs.existsSync(destinationFolderPath)) {
            return {
                ok: false,
                error: 'Hedef klasör bulunamadı.'
            };
        }

        const destinationStat = fs.statSync(destinationFolderPath);

        if (!destinationStat.isDirectory()) {
            return {
                ok: false,
                error: 'Hedef bir klasör olmalı.'
            };
        }

        const sourceStat = fs.statSync(sourcePath);
        const sourceDir = path.dirname(sourcePath);

        if (normalizePathForCompare(sourceDir) === normalizePathForCompare(destinationFolderPath)) {
            return {
                ok: true,
                unchanged: true,
                fullPath: sourcePath,
                fileName: path.basename(sourcePath)
            };
        }

        if (sourceStat.isDirectory()) {
            sourceWasDirectory = true;
            if (
                normalizePathForCompare(sourcePath) === normalizePathForCompare(destinationFolderPath) ||
                isPathInsideDirectory(destinationFolderPath, sourcePath)
            ) {
                return {
                    ok: false,
                    error: 'Bir klasör kendi içine taşınamaz.'
                };
            }

            const newDirPath = getUniqueDirectoryPath(destinationFolderPath, path.basename(sourcePath));
            renamePathInternal(sourcePath, newDirPath);
            movedPath = newDirPath;
            fileMoved = true;

            return {
                ok: true,
                type: 'folder',
                oldPath: sourcePath,
                fullPath: newDirPath,
                fileName: path.basename(newDirPath),
                pathChanges: [{
                    oldPath: sourcePath,
                    newPath: newDirPath
                }],
                isDirectory: true,
                isFile: false
            };
        }

        const ext = getKediFileExt(sourcePath);

        if (ext !== '.node' && ext !== '.map') {
            return {
                ok: false,
                error: 'Sadece .node, .map ve klasörler taşınabilir.'
            };
        }

        const info = ensureKediFileMetadata(sourcePath);
        if (!info.ok) return info;
        originalContent = fs.readFileSync(sourcePath, 'utf-8');

        const id = info.metadata.id;
        const title = sanitizeKediBaseName(info.metadata.title || getVisibleTitleFromFilePath(sourcePath, ext, id));
        const newPath = getUniqueKediPhysicalPath(destinationFolderPath, title, ext, id);
        const oldSidecarPath = info.sidecarPath && fs.existsSync(info.sidecarPath)
            ? info.sidecarPath
            : null;
        originalSidecarPath = oldSidecarPath;
        const desiredSidecarName = getKediSidecarName(title, ext, id);
        const desiredSidecarPath = desiredSidecarName
            ? path.join(destinationFolderPath, desiredSidecarName)
            : null;
        const oldParentMapPath = ext === '.node'
            ? findParentMapPathForNode(sourcePath, info)
            : null;

        if (
            oldSidecarPath &&
            desiredSidecarPath &&
            fs.existsSync(desiredSidecarPath) &&
            normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(desiredSidecarPath)
        ) {
            return {
                ok: false,
                error: 'Hedefte aynı KEDI yan klasörü zaten var.'
            };
        }

        if (normalizePathForCompare(sourcePath) !== normalizePathForCompare(newPath)) {
            renamePathInternal(sourcePath, newPath);
            movedPath = newPath;
            fileMoved = true;
        }

        if (
            oldSidecarPath &&
            desiredSidecarPath &&
            normalizePathForCompare(oldSidecarPath) !== normalizePathForCompare(desiredSidecarPath)
        ) {
            renamePathInternal(oldSidecarPath, desiredSidecarPath);
            movedSidecarPath = desiredSidecarPath;
            sidecarMoved = true;
        }

        const data = readJsonFileSafe(newPath) || info.data;

        if (!data.kedi) data.kedi = {};

        data.kedi.title = title;
        data.kedi.sidecar = desiredSidecarName;
        data.kedi.updatedAt = new Date().toISOString();

        if (ext === '.node') {
            data.kedi.parentMap = options.parentMapId || 'none';
        }

        if (ext === '.map') {
            delete data.kedi.parentMap;
            delete data.kedi.connectionTypes;
        }

        writeKediDocument(newPath, data);

        const ensuredAfter = ensureKediFileMetadata(newPath);

        let cleanupResult = null;

        if (
            ext === '.node' &&
            oldParentMapPath &&
            (!options.parentMapPath || normalizePathForCompare(oldParentMapPath) !== normalizePathForCompare(options.parentMapPath))
        ) {
            cleanupResult = cleanupDeletedNodeFromParentMap(oldParentMapPath, id);
        }

        return {
            ok: true,
            type: getKediTypeFromExt(ext),
            oldPath: sourcePath,
            fullPath: newPath,
            fileName: path.basename(newPath),
            displayName: ensuredAfter.metadata.title,
            metadata: ensuredAfter.metadata,
            sidecarPath: ensuredAfter.sidecarPath,
            oldSidecarPath,
            oldParentMapPath,
            parentMapPath: options.parentMapPath || null,
            oldParentMapEdges: cleanupResult?.edges || null,
            pathChanges: [
                {
                    oldPath: sourcePath,
                    newPath
                },
                ...(oldSidecarPath && ensuredAfter.sidecarPath
                    ? [{
                        oldPath: oldSidecarPath,
                        newPath: ensuredAfter.sidecarPath
                    }]
                    : [])
            ],
            isDirectory: false,
            isFile: true
        };
    } catch (error) {
        const rollbackErrors = [];

        try {
            if (
                sidecarMoved &&
                movedSidecarPath &&
                originalSidecarPath &&
                fs.existsSync(movedSidecarPath) &&
                !fs.existsSync(originalSidecarPath)
            ) {
                renamePathInternal(movedSidecarPath, originalSidecarPath);
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        try {
            if (
                fileMoved &&
                movedPath &&
                fs.existsSync(movedPath) &&
                !fs.existsSync(sourcePath)
            ) {
                renamePathInternal(movedPath, sourcePath);
            }

            if (
                !sourceWasDirectory &&
                originalContent !== null &&
                fs.existsSync(sourcePath)
            ) {
                writeFileAtomic(
                    sourcePath,
                    originalContent,
                    { backup: false }
                );
            }
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError.message);
        }

        return {
            ok: false,
            error: rollbackErrors.length
                ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
                : error.message,
            rolledBack: rollbackErrors.length === 0
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
        .trim()
        .slice(0, 600);
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

function finiteNumberInRange(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizeKediNodeLayout(layout = {}, fallback = {}) {
    return {
        x: finiteNumberInRange(layout.x, fallback.x ?? 80, -1000000, 1000000),
        y: finiteNumberInRange(layout.y, fallback.y ?? 80, -1000000, 1000000),
        width: finiteNumberInRange(layout.width, fallback.width ?? 220, 150, 4000),
        height: finiteNumberInRange(layout.height, fallback.height ?? 92, 74, 4000)
    };
}

function normalizeKediMapCamera(camera = {}) {
    return {
        x: finiteNumberInRange(camera.x, 0, -1000000, 1000000),
        y: finiteNumberInRange(camera.y, 0, -1000000, 1000000),
        zoom: finiteNumberInRange(camera.zoom, 1, 0.1, 3)
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
            .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
            .map((entry) => path.join(sidecarPath, entry.name));

        let changed = false;
        const seenNodeIds = new Set();

        const nodes = nodeFiles.map((nodePath, index) => {
            const nodeInfo = ensureKediFileMetadata(nodePath);

            if (!nodeInfo.ok) {
                return null;
            }

            const nodeId = nodeInfo.metadata.id;

            if (seenNodeIds.has(nodeId)) {
                throw new Error(
                    `Map içinde aynı KEDI kimliğine sahip iki node bulundu: ${nodeId}`
                );
            }

            seenNodeIds.add(nodeId);

            let layout = mapInfo.data.map.nodes.find((item) => item.id === nodeId);

            if (!layout) {
                layout = {
                    id: nodeId,
                    ...getDefaultNodeLayout(index)
                };

                mapInfo.data.map.nodes.push(layout);
                changed = true;
            }

            const fallbackLayout = getDefaultNodeLayout(index);
            const normalizedLayout = normalizeKediNodeLayout(
                layout,
                fallbackLayout
            );

            if (
                layout.x !== normalizedLayout.x ||
                layout.y !== normalizedLayout.y ||
                layout.width !== normalizedLayout.width ||
                layout.height !== normalizedLayout.height
            ) {
                Object.assign(layout, normalizedLayout);
                changed = true;
            }

            return {
                id: nodeId,
                fullPath: nodePath,
                fileName: path.basename(nodePath),
                metadata: nodeInfo.metadata,
                content: nodeInfo.data.content || '',
                preview: stripPreviewText(nodeInfo.data.content || ''),
                layout: normalizedLayout
            };
        }).filter(Boolean);

        const previousLayouts = mapInfo.data.map.nodes;
        mapInfo.data.map.nodes = previousLayouts.filter((layout) => {
            return layout?.id && seenNodeIds.has(layout.id);
        });

        if (mapInfo.data.map.nodes.length !== previousLayouts.length) {
            changed = true;
        }

        const normalizedCamera = normalizeKediMapCamera(mapInfo.data.map.camera);
        if (
            JSON.stringify(normalizedCamera) !==
            JSON.stringify(mapInfo.data.map.camera)
        ) {
            mapInfo.data.map.camera = normalizedCamera;
            changed = true;
        }

        if (changed) {
            mapInfo.data.kedi.updatedAt = new Date().toISOString();
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

        const knownNodeIds = new Set(
            mapInfo.data.map.nodes
                .map((item) => item?.id)
                .filter(Boolean)
        );

        for (const incoming of Array.isArray(nodeLayouts)
            ? nodeLayouts.slice(0, 5000)
            : []) {
            const incomingId = normalizeKediId(incoming?.id, '.node');
            if (!incomingId || !knownNodeIds.has(incomingId)) continue;

            let stored = mapInfo.data.map.nodes.find(
                (item) => item.id === incomingId
            );

            if (!stored) {
                stored = { id: incomingId };
                mapInfo.data.map.nodes.push(stored);
            }

            Object.assign(
                stored,
                normalizeKediNodeLayout(incoming, stored)
            );
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

        mapInfo.data.map.camera = normalizeKediMapCamera(camera);

        if (Array.isArray(camera.collapsedHubs)) {
            mapInfo.data.map.collapsedHubs = Array.from(
                new Set(
                    camera.collapsedHubs
                        .map((value) => String(value || ''))
                        .filter((value) => {
                            return /^(?:node_[A-Za-z0-9_-]+)::(?:top|right|bottom|left)$/.test(value);
                        })
                )
            ).slice(0, 10000);
        }

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
            if (nodesById.has(nodeInfo.metadata.id)) {
                return {
                    ok: false,
                    error: `Map içinde aynı KEDI kimliğine sahip iki node bulundu: ${nodeInfo.metadata.id}`,
                    mapInfo,
                    nodesById
                };
            }

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

    const normalizedEdges = normalizeKediMapEdges(
        mapInfo.data.map.edges,
        new Set(nodesById.keys())
    );
    const cleanEdges = normalizedEdges.edges;

    for (const edge of cleanEdges) {
        const sourceInfo = nodesById.get(edge.sourceId);
        const targetInfo = nodesById.get(edge.targetId);

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

    const documentChanges = [];

    if (oldEdgesJson !== newEdgesJson) {
        mapInfo.data.kedi.updatedAt = new Date().toISOString();
        documentChanges.push({
            filePath: mapPath,
            data: mapInfo.data
        });
    }

    for (const nodeInfo of nodesById.values()) {
        const oldConnectionTypesJson = oldConnectionTypesByPath.get(nodeInfo.filePath);
        const newConnectionTypesJson = JSON.stringify(
            normalizeNodeConnectionTypes(nodeInfo.data.kedi.connectionTypes)
        );

        if (oldConnectionTypesJson !== newConnectionTypesJson) {
            nodeInfo.data.kedi.updatedAt = new Date().toISOString();
            documentChanges.push({
                filePath: nodeInfo.filePath,
                data: nodeInfo.data
            });
        }
    }

    writeKediDocumentsTransaction(documentChanges);

    return {
        ok: true,
        edges: cleanEdges,
        nodesById,
        warnings: normalizedEdges.warnings
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

        const originalMapContent = fs.readFileSync(mapPath, 'utf-8');
        const nodeDocsResult = getAllNodeDocsInMap(mapPath);
        if (!nodeDocsResult.ok) return nodeDocsResult;

        let normalizedEdge = normalizeMapEdge(edge);

        if (!normalizedEdge) {
            return {
                ok: false,
                error: 'Bağlantı normalize edilemedi.'
            };
        }

        if (
            !nodeDocsResult.nodesById.has(normalizedEdge.sourceId) ||
            !nodeDocsResult.nodesById.has(normalizedEdge.targetId)
        ) {
            return {
                ok: false,
                error: 'Bağlantının source veya target node dosyası bulunamadı.'
            };
        }

        const normalizedExisting = normalizeKediMapEdges(
            mapInfo.data.map.edges,
            new Set(nodeDocsResult.nodesById.keys())
        ).edges;

        if (isHierarchyEdge(normalizedEdge)) {
            const existingParent = normalizedExisting.find((existing) => {
                return (
                    isHierarchyEdge(existing) &&
                    existing.targetId === normalizedEdge.targetId &&
                    existing.sourceId !== normalizedEdge.sourceId
                );
            });

            if (existingParent && edge.confirmSecondParentAsStream !== true) {
                return {
                    ok: false,
                    code: 'SECOND_PARENT_CONFIRM_REQUIRED',
                    requiresConfirmation: true,
                    error: 'Hedef node zaten bir parent bağlantısına sahip.',
                    suggestedEdge: convertEdgeToStream(normalizedEdge)
                };
            }

            if (existingParent) {
                normalizedEdge = convertEdgeToStream(normalizedEdge);
            } else {
                const parentByChild = new Map();
                normalizedExisting
                    .filter(isHierarchyEdge)
                    .forEach((existing) => {
                        parentByChild.set(
                            existing.targetId,
                            existing.sourceId
                        );
                    });

                if (
                    wouldCreateKediHierarchyCycle(
                        parentByChild,
                        normalizedEdge.sourceId,
                        normalizedEdge.targetId
                    )
                ) {
                    return {
                        ok: false,
                        code: 'HIERARCHY_CYCLE',
                        error: 'Bu bağlantı hiyerarşide döngü oluşturur.'
                    };
                }
            }
        }

        const semanticKey = getKediEdgeSemanticKey(normalizedEdge);
        mapInfo.data.map.edges = mapInfo.data.map.edges.filter((existing) => {
            return (
                existing.id !== normalizedEdge.id &&
                getKediEdgeSemanticKey(existing) !== semanticKey
            );
        });

        mapInfo.data.map.edges.push(normalizedEdge);
        mapInfo.data.kedi.updatedAt = new Date().toISOString();

        writeKediDocument(mapPath, mapInfo.data);

        const syncResult = syncMapConnectionMetadata(mapPath);

        if (!syncResult.ok) {
            writeFileAtomic(
                mapPath,
                originalMapContent,
                { backup: false }
            );
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

        const originalMapContent = fs.readFileSync(mapPath, 'utf-8');
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
            writeFileAtomic(
                mapPath,
                originalMapContent,
                { backup: false }
            );
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

function reparentMapNode(mapPath, childId, parentId) {
    try {
        const safeChildId = normalizeKediId(childId, '.node');
        const safeParentId = normalizeKediId(parentId, '.node');

        if (!safeChildId || !safeParentId || safeChildId === safeParentId) {
            return {
                ok: false,
                error: 'Geçersiz parent veya child kimliği.'
            };
        }

        const nodeDocsResult = getAllNodeDocsInMap(mapPath);
        if (!nodeDocsResult.ok) return nodeDocsResult;

        if (
            !nodeDocsResult.nodesById.has(safeChildId) ||
            !nodeDocsResult.nodesById.has(safeParentId)
        ) {
            return {
                ok: false,
                error: 'Parent veya child node map içinde bulunamadı.'
            };
        }

        const mapInfo = nodeDocsResult.mapInfo;
        const originalMapContent = fs.readFileSync(mapPath, 'utf-8');
        const existingEdges = normalizeKediMapEdges(
            mapInfo.data.map?.edges || [],
            new Set(nodeDocsResult.nodesById.keys())
        ).edges;
        const withoutOldParents = existingEdges.filter((edge) => {
            return !(isHierarchyEdge(edge) && edge.targetId === safeChildId);
        });
        const parentByChild = new Map();

        withoutOldParents
            .filter(isHierarchyEdge)
            .forEach((edge) => {
                parentByChild.set(edge.targetId, edge.sourceId);
            });

        if (
            wouldCreateKediHierarchyCycle(
                parentByChild,
                safeParentId,
                safeChildId
            )
        ) {
            return {
                ok: false,
                code: 'HIERARCHY_CYCLE',
                error: 'Bu taşıma hiyerarşide döngü oluşturur.'
            };
        }

        const replacement = normalizeMapEdge({
            sourceId: safeParentId,
            targetId: safeChildId,
            sourcePort: 'bottom',
            targetPort: 'top',
            type: 'down-hub',
            sourceRole: 'down-hub',
            targetRole: 'up-hub'
        });

        mapInfo.data.map.edges = [...withoutOldParents, replacement];
        mapInfo.data.kedi.updatedAt = new Date().toISOString();
        writeKediDocument(mapPath, mapInfo.data);

        const syncResult = syncMapConnectionMetadata(mapPath);
        if (!syncResult.ok) {
            writeFileAtomic(
                mapPath,
                originalMapContent,
                { backup: false }
            );
            return syncResult;
        }

        return {
            ok: true,
            edge: replacement,
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

function cleanupDeletedNodeFromParentMap(parentMapPath, deletedNodeId, deletionTransaction = null) {
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

    const pendingDocumentChanges = [];
    mapInfo.data.kedi.updatedAt = new Date().toISOString();

    if (deletionTransaction) {
        writeKediDeletionMetadata(
            deletionTransaction,
            parentMapPath,
            mapInfo.data
        );
    } else {
        pendingDocumentChanges.push({
            filePath: parentMapPath,
            data: mapInfo.data
        });
    }

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

                if (deletionTransaction) {
                    writeKediDeletionMetadata(
                        deletionTransaction,
                        nodePath,
                        nodeInfo.data
                    );
                } else {
                    pendingDocumentChanges.push({
                        filePath: nodePath,
                        data: nodeInfo.data
                    });
                }
            }
        }
    }

    if (!deletionTransaction) {
        writeKediDocumentsTransaction(pendingDocumentChanges);
    }

    return {
        parentMapPath,
        edges: mapInfo.data.map.edges
    };
}

function writeKediDeletionMetadata(transaction, filePath, data) {
    if (!transaction) {
        writeKediDocument(filePath, data);
        return;
    }

    let backup = transaction.metadataBackups.find((entry) => {
        return normalizePathForCompare(entry.originalPath) ===
            normalizePathForCompare(filePath);
    });

    if (!backup) {
        const backupPath = path.join(
            transaction.directoryPath,
            `metadata-${transaction.metadataBackups.length}.bak`
        );

        fs.copyFileSync(filePath, backupPath);
        backup = {
            originalPath: filePath,
            backupPath
        };
        transaction.metadataBackups.push(backup);
    }

    writeKediDocument(filePath, data);
}

function createKediDeletionTransaction(targetPath) {
    const directoryPath = fs.mkdtempSync(
        path.join(path.dirname(targetPath), '.kedi-delete-')
    );
    markInternalFileChange(directoryPath);

    return {
        directoryPath,
        stagedPaths: [],
        metadataBackups: []
    };
}

function stageKediDeletionPath(transaction, originalPath) {
    if (!originalPath || !fs.existsSync(originalPath)) {
        return;
    }

    const stagedPath = path.join(
        transaction.directoryPath,
        path.basename(originalPath)
    );

    if (fs.existsSync(stagedPath)) {
        throw new Error(`Geçici silme hedefi zaten var: ${stagedPath}`);
    }

    renamePathInternal(originalPath, stagedPath);
    transaction.stagedPaths.push({
        originalPath,
        stagedPath
    });
}

function rollbackKediDeletionTransaction(transaction) {
    const rollbackErrors = [];

    if (!fs.existsSync(transaction.directoryPath)) {
        return [
            'Geçici silme klasörü bulunamadığı için otomatik geri alma yapılamadı.'
        ];
    }

    for (const backup of [...transaction.metadataBackups].reverse()) {
        if (!fs.existsSync(backup.backupPath)) {
            rollbackErrors.push(
                `${backup.originalPath} için metadata yedeği bulunamadı.`
            );
            continue;
        }

        try {
            fs.copyFileSync(backup.backupPath, backup.originalPath);
            fs.unlinkSync(backup.backupPath);
        } catch (error) {
            rollbackErrors.push(
                `${backup.originalPath} metadata geri yüklenemedi: ${error.message}`
            );
        }
    }

    for (const staged of [...transaction.stagedPaths].reverse()) {
        if (!fs.existsSync(staged.stagedPath)) {
            if (!fs.existsSync(staged.originalPath)) {
                rollbackErrors.push(
                    `${staged.originalPath} için geçici yedek bulunamadı.`
                );
            }
            continue;
        }

        try {
            if (fs.existsSync(staged.originalPath)) {
                throw new Error('Orijinal yol yeniden oluşturulmuş.');
            }

            renamePathInternal(staged.stagedPath, staged.originalPath);
        } catch (error) {
            rollbackErrors.push(
                `${staged.originalPath} geri taşınamadı: ${error.message}`
            );
        }
    }

    try {
        if (
            fs.existsSync(transaction.directoryPath) &&
            fs.readdirSync(transaction.directoryPath).length === 0
        ) {
            fs.rmdirSync(transaction.directoryPath);
        }
    } catch (error) {
        rollbackErrors.push(
            `Geçici silme klasörü temizlenemedi: ${error.message}`
        );
    }

    return rollbackErrors;
}

async function deleteKediFile(targetPath) {
    let transaction = null;

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

        const deletedNodeId = ext === '.node'
            ? info.metadata.id
            : null;
        const parentMapPath = ext === '.node'
            ? findParentMapPathForNode(targetPath, info)
            : null;
        const childNodePaths = [];

        if (ext === '.map' && sidecarPath && fs.existsSync(sidecarPath)) {
            const entries = fs.readdirSync(sidecarPath, { withFileTypes: true });
            for (const entry of entries) {
                if (
                    entry.isFile() &&
                    entry.name.toLowerCase().endsWith('.node')
                ) {
                    childNodePaths.push(path.join(sidecarPath, entry.name));
                }
            }
        }

        transaction = createKediDeletionTransaction(targetPath);
        stageKediDeletionPath(transaction, targetPath);
        stageKediDeletionPath(transaction, sidecarPath);

        if (ext === '.map') {
            await shell.trashItem(path.resolve(transaction.directoryPath));

            return {
                ok: true,
                type: 'map',
                deletedPath: targetPath,
                deletedMapId: info.metadata.id,
                deletedSidecarPath: sidecarPath,
                childNodePaths,
                childNodeCount: childNodePaths.length,
                movedToTrash: true
            };
        }

        const cleanupResult = cleanupDeletedNodeFromParentMap(
            parentMapPath,
            deletedNodeId,
            transaction
        );

        await shell.trashItem(path.resolve(transaction.directoryPath));

        return {
            ok: true,
            type: 'node',
            deletedPath: targetPath,
            deletedNodeId,
            parentMapPath: cleanupResult.parentMapPath,
            edges: cleanupResult.edges,
            movedToTrash: true
        };
    } catch (error) {
        const rollbackErrors = transaction
            ? rollbackKediDeletionTransaction(transaction)
            : [];

        return {
            ok: false,
            error: rollbackErrors.length > 0
                ? `${error.message} Geri alma tamamlanamadı: ${rollbackErrors.join(' | ')}`
                : error.message,
            rolledBack: Boolean(transaction) && rollbackErrors.length === 0
        };
    }
}

function deleteNodeFromMap(nodePath) {
    return deleteKediFile(nodePath);
}

async function deleteProjectPath(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
        return {
            ok: false,
            error: 'Silinecek yol bulunamadı.'
        };
    }

    await shell.trashItem(path.resolve(targetPath));

    return {
        ok: true,
        deletedPath: targetPath,
        movedToTrash: true
    };
}

function isKediManagedDiaryFolder(folderPath) {
    if (!folderPath || path.basename(folderPath).toLowerCase() !== 'diary') {
        return false;
    }

    if (fs.existsSync(path.join(folderPath, '.kedi-diary'))) {
        return true;
    }

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        return entries.some((entry) => {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) {
                return false;
            }

            const result = readJsonFileResult(path.join(folderPath, entry.name));
            return Boolean(
                result.ok &&
                normalizeKediDiaryIsoDate(result.data?.kedi?.diaryDate)
            );
        });
    } catch {
        return false;
    }
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

                if (
                    entry.isDirectory() &&
                    (
                        entry.name.startsWith('.kedi-delete-') ||
                        entry.name.startsWith('.kedi-transaction-')
                    )
                ) {
                    return false;
                }

                const fullPath = path.join(folderPath, entry.name);
                if (entry.isDirectory() && isKediManagedDiaryFolder(fullPath)) {
                    return false;
                }

                if (entry.isDirectory()) return true;
                return isKediVisibleFile(entry.name);
            })
            .map((entry) => {
                const fullPath = path.join(folderPath, entry.name);
                let metadata = null;
                let sidecarPath = null;
                let itemError = null;
                let recoveryPath = null;

                if (entry.isFile() && isKediVisibleFile(entry.name)) {
                    try {
                        const inspected = ensureKediFileMetadata(fullPath, {
                            persist: false,
                            ensureSidecar: false
                        });

                        if (inspected?.ok) {
                            metadata = inspected.metadata;
                            sidecarPath = inspected.sidecarPath;
                        } else {
                            itemError = inspected?.error || 'Dosya okunamadı.';
                            recoveryPath = inspected?.backupPath || null;
                        }
                    } catch (error) {
                        itemError = error.message;
                    }
                }

                return {
                    name: entry.name,
                    fullPath,
                    type: entry.isDirectory() ? 'folder' : 'file',
                    isDirectory: entry.isDirectory(),
                    isFile: entry.isFile(),
                    metadata,
                    sidecarPath,
                    error: itemError,
                    recoveryPath
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
let activeProjectLockPath = null;
const kediInstanceId = crypto.randomUUID();

const projectWatchers = new Map();
let projectWatchTimer = null;
let projectWatcherRescanTimer = null;
const pendingProjectChangedPaths = new Set();

function stopProjectWatcher() {
    for (const watcher of projectWatchers.values()) {
        try {
            watcher.close();
        } catch (error) {
            console.warn('[KEDI] Watcher kapatılamadı:', error.message);
        }
    }

    projectWatchers.clear();
    clearTimeout(projectWatchTimer);
    projectWatchTimer = null;
    clearTimeout(projectWatcherRescanTimer);
    projectWatcherRescanTimer = null;
    pendingProjectChangedPaths.clear();
}

function notifyProjectChanged(reason = 'changed', changedPath = null) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (changedPath) {
        pendingProjectChangedPaths.add(path.resolve(changedPath));
    }

    clearTimeout(projectWatchTimer);

    projectWatchTimer = setTimeout(() => {
        mainWindow.webContents.send('project:filesystem-changed', {
            reason,
            folderPath: activeProjectFolder,
            changedPaths: Array.from(pendingProjectChangedPaths)
        });
        pendingProjectChangedPaths.clear();
    }, 250);
}

function shouldWatchProjectDirectory(directoryPath) {
    const name = path.basename(directoryPath).toLowerCase();
    return !['.git', 'node_modules', 'dist', 'coverage'].includes(name);
}

function collectProjectDirectories(rootPath) {
    const directories = [];
    const queue = [rootPath];

    while (queue.length) {
        const directoryPath = queue.shift();
        if (!shouldWatchProjectDirectory(directoryPath)) continue;
        directories.push(directoryPath);

        let entries = [];
        try {
            entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            queue.push(path.join(directoryPath, entry.name));
        }
    }

    return directories;
}

function syncProjectWatchers(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) return;

    const wantedDirectories = new Set(
        collectProjectDirectories(folderPath).map(normalizePathForCompare)
    );

    for (const [directoryKey, watcher] of projectWatchers) {
        if (!wantedDirectories.has(directoryKey)) {
            try {
                watcher.close();
            } catch {}
            projectWatchers.delete(directoryKey);
        }
    }

    for (const directoryPath of collectProjectDirectories(folderPath)) {
        const directoryKey = normalizePathForCompare(directoryPath);
        if (projectWatchers.has(directoryKey)) continue;

        try {
            const watcher = fs.watch(
                directoryPath,
                { recursive: false },
                (eventType, fileName) => {
                    const changedPath = fileName
                        ? path.join(directoryPath, String(fileName))
                        : directoryPath;
                    if (!isRecentInternalFileChange(changedPath)) {
                        notifyProjectChanged(
                            eventType || 'filesystem',
                            changedPath
                        );
                    }

                    clearTimeout(projectWatcherRescanTimer);
                    projectWatcherRescanTimer = setTimeout(() => {
                        if (activeProjectFolder) {
                            syncProjectWatchers(activeProjectFolder);
                        }
                    }, 350);
                }
            );

            watcher.on('error', (error) => {
                console.warn(
                    `[KEDI] Watcher hatası (${directoryPath}):`,
                    error.message
                );
            });

            projectWatchers.set(directoryKey, watcher);
        } catch (error) {
            console.warn(
                `[KEDI] Klasör izlenemedi (${directoryPath}):`,
                error.message
            );
        }
    }
}

function startProjectWatcher(folderPath) {
    stopProjectWatcher();

    if (!folderPath || !fs.existsSync(folderPath)) {
        return;
    }

    syncProjectWatchers(folderPath);
    console.log('[KEDI] Proje klasörü izleniyor:', folderPath);
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

    const normalized = path
        .resolve(targetPath)
        .replace(/[\\/]+/g, '/');

    return process.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
}

function isSameOrInsidePath(candidatePath, parentPath) {
    const candidate = normalizePathForCompare(candidatePath);
    const parent = normalizePathForCompare(parentPath);

    if (!candidate || !parent) return false;
    if (candidate === parent) return true;
    return candidate.startsWith(`${parent}/`);
}

function assertNoSymbolicLinksBetween(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    if (!relative || relative === '.') return;

    let current = rootPath;

    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;

        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw new Error('Proje işlemlerinde symlink/junction kullanılamaz.');
        }
    }
}

function assertProjectPath(inputPath, options = {}) {
    if (!activeProjectFolder) {
        throw new Error('Aktif proje klasörü yok.');
    }

    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        throw new Error('Geçerli bir proje yolu gerekli.');
    }

    const projectRoot = fs.realpathSync.native(activeProjectFolder);
    const resolvedPath = path.resolve(inputPath);

    if (!isSameOrInsidePath(resolvedPath, projectRoot)) {
        throw new Error('İstenen yol aktif proje klasörünün dışında.');
    }

    assertNoSymbolicLinksBetween(projectRoot, resolvedPath);

    const mustExist = options.mustExist !== false;
    if (mustExist && !fs.existsSync(resolvedPath)) {
        throw new Error('İstenen proje yolu bulunamadı.');
    }

    if (fs.existsSync(resolvedPath)) {
        const realPath = fs.realpathSync.native(resolvedPath);
        if (!isSameOrInsidePath(realPath, projectRoot)) {
            throw new Error('Yol bir bağlantı üzerinden proje dışına çıkıyor.');
        }

        const stat = fs.statSync(realPath);
        if (options.type === 'file' && !stat.isFile()) {
            throw new Error('İstenen yol bir dosya değil.');
        }
        if (options.type === 'directory' && !stat.isDirectory()) {
            throw new Error('İstenen yol bir klasör değil.');
        }
    } else {
        let ancestorPath = path.dirname(resolvedPath);

        while (
            !fs.existsSync(ancestorPath) &&
            isSameOrInsidePath(ancestorPath, projectRoot) &&
            ancestorPath !== path.dirname(ancestorPath)
        ) {
            ancestorPath = path.dirname(ancestorPath);
        }

        if (!fs.existsSync(ancestorPath)) {
            throw new Error('Hedef yolun üst klasörü bulunamadı.');
        }

        const realAncestor = fs.realpathSync.native(ancestorPath);
        if (!isSameOrInsidePath(realAncestor, projectRoot)) {
            throw new Error('Hedef yol bir bağlantı üzerinden proje dışına çıkıyor.');
        }
    }

    if (Array.isArray(options.extensions)) {
        const ext = getKediFileExt(resolvedPath);
        if (!options.extensions.includes(ext)) {
            throw new Error('Bu işlem için geçersiz dosya türü.');
        }
    }

    return resolvedPath;
}

function projectOperation(operation) {
    try {
        return operation();
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

async function asyncProjectOperation(operation) {
    try {
        return await operation();
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
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

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function acquireProjectLock(folderPath) {
    const lockPath = path.join(folderPath, '.kedi.lock');

    try {
        if (fs.existsSync(lockPath)) {
            let existingLock = null;

            try {
                existingLock = JSON.parse(
                    fs.readFileSync(lockPath, 'utf-8')
                );
            } catch {}

            if (
                existingLock?.instanceId === kediInstanceId &&
                existingLock?.pid === process.pid
            ) {
                return {
                    ok: true,
                    lockPath
                };
            }

            if (existingLock?.pid && isProcessAlive(Number(existingLock.pid))) {
                return {
                    ok: false,
                    error: `Bu proje başka bir KEDI süreci tarafından kullanılıyor (PID ${existingLock.pid}).`
                };
            }

            fs.unlinkSync(lockPath);
        }

        const descriptor = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeFileSync(
            descriptor,
            JSON.stringify({
                pid: process.pid,
                instanceId: kediInstanceId,
                openedAt: new Date().toISOString()
            }, null, 2),
            'utf-8'
        );
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        hideFileOnWindows(lockPath);

        return {
            ok: true,
            lockPath
        };
    } catch (error) {
        return {
            ok: false,
            error: `Proje kilidi alınamadı: ${error.message}`
        };
    }
}

function lockProjectFolder(folderPath) {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return false;
        }

        const realFolderPath = fs.realpathSync.native(folderPath);
        const stat = fs.statSync(realFolderPath);
        if (!stat.isDirectory()) {
            return false;
        }

        if (
            activeProjectFolder &&
            normalizePathForCompare(activeProjectFolder) ===
                normalizePathForCompare(realFolderPath)
        ) {
            return true;
        }

        const lockResult = acquireProjectLock(realFolderPath);
        if (!lockResult.ok) {
            console.error('[KEDI]', lockResult.error);
            return false;
        }

        const oldLockPath = activeProjectLockPath;

        activeProjectFolder = realFolderPath;
        activeProjectLockPath = lockResult.lockPath;
        startProjectWatcher(realFolderPath);

        if (oldLockPath && oldLockPath !== activeProjectLockPath) {
            try {
                const oldLock = JSON.parse(fs.readFileSync(oldLockPath, 'utf-8'));
                if (oldLock.instanceId === kediInstanceId) {
                    fs.unlinkSync(oldLockPath);
                }
            } catch {}
        }

        console.log('[KEDI] Proje klasörü kilitlendi:', realFolderPath);
        return true;
    } catch (error) {
        console.error('[KEDI] Proje klasörü kilitlenemedi:', error);
        return false;
    }
}

function unlockProjectFolder() {
    stopProjectWatcher();

    if (activeProjectLockPath && fs.existsSync(activeProjectLockPath)) {
        try {
            const lockData = JSON.parse(
                fs.readFileSync(activeProjectLockPath, 'utf-8')
            );

            if (lockData.instanceId === kediInstanceId) {
                fs.unlinkSync(activeProjectLockPath);
            }
        } catch (error) {
            console.warn('[KEDI] Proje kilidi kaldırılamadı:', error.message);
        }
    }

    activeProjectFolder = null;
    activeProjectLockPath = null;
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
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    Menu.setApplicationMenu(null);

    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
    });

    mainWindow.webContents.session.setPermissionCheckHandler(() => false);
    mainWindow.webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false)
    );

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    if (!app.isPackaged && process.env.KEDI_OPEN_DEVTOOLS === '1') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

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

    mainWindow.on('close', (event) => {
        saveWindowState();

        if (allowWindowClose) return;

        event.preventDefault();
        if (closeRequestInFlight) return;

        closeRequestInFlight = true;
        mainWindow.webContents.send('window:request-close');

        clearTimeout(closeRequestTimer);
        closeRequestTimer = setTimeout(() => {
            closeRequestInFlight = false;
            closeRequestTimer = null;
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'KEDI kapatılamadı',
                message: 'Bekleyen kayıtların tamamlandığı doğrulanamadı.',
                detail: 'Veri kaybını önlemek için pencere açık bırakıldı.'
            }).catch(() => {});
        }, 30000);
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

ipcMain.on('window:close-ready', (_event, result) => {
    clearTimeout(closeRequestTimer);
    closeRequestTimer = null;
    closeRequestInFlight = false;

    if (!result?.ok || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    allowWindowClose = true;
    mainWindow.close();
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
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return saveMapCamera(safeMapPath, camera);
    });
});

ipcMain.handle('project:upsert-map-connection', (_event, mapPath, edge) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return upsertMapConnection(safeMapPath, edge);
    });
});

ipcMain.handle('project:delete-map-connection', (_event, mapPath, edgeId) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return deleteMapConnection(safeMapPath, String(edgeId || ''));
    });
});

ipcMain.handle('project:reparent-map-node', (_event, mapPath, childId, parentId) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return reparentMapNode(safeMapPath, childId, parentId);
    });
});

ipcMain.handle('project:get-kedi-document', (_event, filePath) => {
    return projectOperation(() => {
        const safeFilePath = assertProjectPath(filePath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return getKediDocument(safeFilePath);
    });
});

ipcMain.handle('project:list-map-nodes', (_event, mapPath) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return listNodesForMap(safeMapPath);
    });
});

ipcMain.handle('project:save-map-layout', (_event, mapPath, nodeLayouts) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return saveMapNodeLayout(safeMapPath, nodeLayouts);
    });
});

ipcMain.handle('project:save-node-content', (_event, nodePath, content) => {
    return projectOperation(() => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return saveNodeContent(safeNodePath, content);
    });
});

ipcMain.handle('project:delete-node-from-map', (_event, nodePath) => {
    return asyncProjectOperation(async () => {
        const safeNodePath = assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        });
        return deleteNodeFromMap(safeNodePath);
    });
});

ipcMain.handle('project:delete-kedi-file', (_event, targetPath) => {
    return asyncProjectOperation(async () => {
        const safeTargetPath = assertProjectPath(targetPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return deleteKediFile(safeTargetPath);
    });
});

ipcMain.handle('project:delete-path', (_event, targetPath) => {
    return asyncProjectOperation(async () => {
        const safeTargetPath = assertProjectPath(targetPath);

        if (
            normalizePathForCompare(safeTargetPath) ===
            normalizePathForCompare(activeProjectFolder)
        ) {
            throw new Error('Aktif proje kökü bu işlemle silinemez.');
        }

        return deleteProjectPath(safeTargetPath);
    });
});

ipcMain.handle('project:create-node-under-map', (_event, mapPath) => {
    return projectOperation(() => {
        const safeMapPath = assertProjectPath(mapPath, {
            type: 'file',
            extensions: ['.map']
        });
        return createNodeUnderMap(safeMapPath);
    });
});

ipcMain.handle('project:get-or-create-diary-node', (_event, projectFolder, isoDate) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });

        if (
            normalizePathForCompare(safeProjectFolder) !==
            normalizePathForCompare(activeProjectFolder)
        ) {
            throw new Error('Diary yalnızca aktif proje kökünde kullanılabilir.');
        }

        return getOrCreateDiaryNode(safeProjectFolder, isoDate);
    });
});

ipcMain.handle('project:list-diary-dates', (_event, projectFolder) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return listKediDiaryDates(safeProjectFolder);
    });
});

ipcMain.handle('project:sync-diary-missions', (_event, projectFolder, payload) => {
    return projectOperation(() => {
        const safeProjectFolder = assertProjectPath(projectFolder, {
            type: 'directory'
        });
        return syncDiaryMissions(safeProjectFolder, payload);
    });
});

ipcMain.handle('project:rename-kedi-file', (_event, oldPath, newBaseName) => {
    return projectOperation(() => {
        const safeOldPath = assertProjectPath(oldPath, {
            type: 'file',
            extensions: ['.map', '.node']
        });
        return renameKediFile(safeOldPath, newBaseName);
    });
});

ipcMain.handle('project:move-kedi-item', (_event, sourcePath, destinationFolderPath, options) => {
    return projectOperation(() => {
        const safeSourcePath = assertProjectPath(sourcePath);
        const safeDestinationPath = assertProjectPath(destinationFolderPath, {
            type: 'directory'
        });

        if (
            normalizePathForCompare(safeSourcePath) ===
            normalizePathForCompare(activeProjectFolder)
        ) {
            throw new Error('Aktif proje kökü taşınamaz.');
        }

        const safeOptions = { ...(options || {}) };
        if (safeOptions.parentMapPath) {
            safeOptions.parentMapPath = assertProjectPath(
                safeOptions.parentMapPath,
                {
                    type: 'file',
                    extensions: ['.map']
                }
            );
        }

        return moveKediItem(
            safeSourcePath,
            safeDestinationPath,
            safeOptions
        );
    });
});

ipcMain.handle('project:create-kedi-file', (_event, folderPath, ext) => {
    return projectOperation(() => {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return createUniqueKediFile(safeFolderPath, ext);
    });
});

ipcMain.handle('project:get-last-folder', () => {
    const settings = readSettings();
    const lastProjectFolder = settings.lastProjectFolder || null;

    if (!lastProjectFolder || !fs.existsSync(lastProjectFolder)) {
        return null;
    }

    if (!lockProjectFolder(lastProjectFolder)) {
        return null;
    }

    return activeProjectFolder;
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

    if (!lockProjectFolder(selectedFolder)) {
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Proje açılamadı',
            message: 'Seçilen proje klasörü kilitlenemedi.',
            detail: 'Klasör başka bir KEDI sürecinde açık olabilir veya erişim izni olmayabilir.'
        });
        return null;
    }

    const settings = readSettings();
    settings.lastProjectFolder = activeProjectFolder;
    writeSettings(settings);

    return activeProjectFolder;
});

ipcMain.handle('project:set-last-folder', (_event, folderPath) => {
    return projectOperation(() => {
        if (folderPath) {
            const safeFolderPath = assertProjectPath(folderPath, {
                type: 'directory'
            });

            if (
                normalizePathForCompare(safeFolderPath) !==
                normalizePathForCompare(activeProjectFolder)
            ) {
                throw new Error('Yalnızca aktif proje son proje olarak kaydedilebilir.');
            }
        }

        const settings = readSettings();
        settings.lastProjectFolder = folderPath || null;
        writeSettings(settings);
        return {
            ok: true
        };
    });
});

ipcMain.handle('project:list-folder', (_event, folderPath) => {
    return projectOperation(() => {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return safeListFolder(safeFolderPath);
    });
});

ipcMain.handle('project:folder-exists', (_event, folderPath) => {
    try {
        const safeFolderPath = assertProjectPath(folderPath, {
            type: 'directory'
        });
        return folderExistsAndIsDirectory(safeFolderPath);
    } catch {
        return false;
    }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });

    app.whenReady().then(() => {
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                allowWindowClose = false;
                createWindow();
            }
        });
    });
}

app.on('will-quit', () => {
    unlockProjectFolder();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
