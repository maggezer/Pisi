import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as editorAssets from './editor-asset-store.js';

const PISI_VERSION_HISTORY_FORMAT_VERSION = 2;
const PISI_VERSION_HISTORY_INDEX_VERSION = 1;
const PISI_VERSION_HISTORY_MAX_VERSIONS = 50;
const PISI_VERSION_HISTORY_MAX_BYTES = 24 * 1024 * 1024;
const PISI_VERSION_HISTORY_INDEX_FILE = 'index.json';
const PISI_VERSION_HISTORY_ID_PATTERN = /^\d+-[^/\\]+\.(?:json|json\.gz)$/;

function pisiVersionHistoryProjectFolder(nodePath, options = {}) {
    return path.resolve(options.projectFolder || globalThis.activeProjectFolder || path.dirname(nodePath));
}

function pisiVersionHistoryDirectory(nodePath, options = {}) {
    const ensureMetadata = options.ensurePisiFileMetadata || globalThis.ensurePisiFileMetadata;
    if (typeof ensureMetadata !== 'function') {
        return { ok: false, error: 'Node metadata servisi kullanılamıyor.' };
    }
    const info = ensureMetadata(nodePath, { ensureSidecar: false });
    if (!info?.ok || info.metadata?.type !== 'node') return info;
    const projectFolder = pisiVersionHistoryProjectFolder(nodePath, options);
    return {
        ok: true,
        info,
        projectFolder,
        directory: path.join(projectFolder, '.pisi-history', info.metadata.id)
    };
}

function isPisiVersionHistoryId(value) {
    return PISI_VERSION_HISTORY_ID_PATTERN.test(String(value || ''));
}

function pisiVersionHistorySnapshotNames(directory) {
    if (!directory || !fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(isPisiVersionHistoryId).sort().reverse();
}

function readPisiVersionHistorySnapshotFile(snapshotPath) {
    try {
        const bytes = fs.readFileSync(snapshotPath);
        const raw = snapshotPath.endsWith('.json.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
        return { ok: true, data: JSON.parse(raw), raw };
    } catch (error) {
        return { ok: false, error: error.message, data: null };
    }
}

function pisiVersionHistoryPreview(snapshot) {
    const content = String(snapshot?.data?.content || '');
    const stripPreview = globalThis.stripPreviewText;
    if (typeof stripPreview === 'function') return stripPreview(content);
    return content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
}

function normalizePisiVersionHistoryEntry(entry, directory) {
    const historyId = String(entry?.historyId || '');
    if (!isPisiVersionHistoryId(historyId)) return null;
    const snapshotPath = path.join(directory, historyId);
    if (!fs.existsSync(snapshotPath)) return null;
    let size = Number(entry?.size);
    if (!Number.isFinite(size) || size < 0) size = fs.statSync(snapshotPath).size;
    return {
        historyId,
        capturedAt: String(entry?.capturedAt || ''),
        reason: String(entry?.reason || 'save').slice(0, 80),
        hash: String(entry?.hash || '').slice(0, 64),
        preview: String(entry?.preview || '').slice(0, 500),
        size,
        compressed: historyId.endsWith('.json.gz')
    };
}

function makePisiVersionHistoryEntry(directory, historyId, snapshot) {
    const snapshotPath = path.join(directory, historyId);
    const stat = fs.statSync(snapshotPath);
    return {
        historyId,
        capturedAt: String(snapshot?.capturedAt || ''),
        reason: String(snapshot?.reason || 'save').slice(0, 80),
        hash: String(snapshot?.hash || '').slice(0, 64),
        preview: pisiVersionHistoryPreview(snapshot),
        size: stat.size,
        compressed: historyId.endsWith('.json.gz')
    };
}

function readPisiVersionHistoryIndex(directory) {
    const indexPath = path.join(directory, PISI_VERSION_HISTORY_INDEX_FILE);
    if (!fs.existsSync(indexPath)) return null;
    try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (index?.version !== PISI_VERSION_HISTORY_INDEX_VERSION || !Array.isArray(index.entries)) {
            return null;
        }
        const entries = index.entries
            .slice(0, PISI_VERSION_HISTORY_MAX_VERSIONS * 4)
            .map((entry) => normalizePisiVersionHistoryEntry(entry, directory))
            .filter(Boolean);
        const names = pisiVersionHistorySnapshotNames(directory);
        if (entries.length !== names.length) return null;
        const indexedNames = new Set(entries.map((entry) => entry.historyId));
        if (names.some((name) => !indexedNames.has(name))) return null;
        return entries.sort(comparePisiVersionHistoryEntries);
    } catch {
        return null;
    }
}

function rebuildPisiVersionHistoryEntries(directory) {
    const entries = [];
    for (const historyId of pisiVersionHistorySnapshotNames(directory)) {
        const result = readPisiVersionHistorySnapshotFile(path.join(directory, historyId));
        if (!result.ok || !result.data?.data?.pisi) continue;
        entries.push(makePisiVersionHistoryEntry(directory, historyId, result.data));
    }
    return entries.sort(comparePisiVersionHistoryEntries);
}

function comparePisiVersionHistoryEntries(a, b) {
    const byTime = String(b?.capturedAt || '').localeCompare(String(a?.capturedAt || ''));
    if (byTime) return byTime;
    return String(b?.historyId || '').localeCompare(String(a?.historyId || ''));
}

function getPisiVersionHistoryEntries(directory) {
    return readPisiVersionHistoryIndex(directory) || rebuildPisiVersionHistoryEntries(directory);
}

function selectPisiVersionHistoryRetention(entries = [], options = {}) {
    const maxVersions = Math.max(1, Number(options.maxVersions) || PISI_VERSION_HISTORY_MAX_VERSIONS);
    const maxBytes = Math.max(1, Number(options.maxBytes) || PISI_VERSION_HISTORY_MAX_BYTES);
    const sorted = Array.from(entries || []).sort(comparePisiVersionHistoryEntries);
    const keep = [];
    const remove = [];
    let bytes = 0;

    for (const entry of sorted) {
        const size = Math.max(0, Number(entry?.size) || 0);
        const countAllowed = keep.length < maxVersions;
        const byteAllowed = bytes + size <= maxBytes;
        if (countAllowed && (keep.length === 0 || byteAllowed)) {
            keep.push(entry);
            bytes += size;
        } else {
            remove.push(entry);
        }
    }
    return { keep, remove, bytes, maxVersions, maxBytes };
}

function writePisiVersionHistoryIndex(directory, entries, options = {}) {
    const writeAtomic = options.writeFileAtomic || globalThis.writeFileAtomic;
    const index = {
        version: PISI_VERSION_HISTORY_INDEX_VERSION,
        updatedAt: new Date().toISOString(),
        entries: entries.map((entry) => ({
            historyId: entry.historyId,
            capturedAt: entry.capturedAt,
            reason: entry.reason,
            hash: entry.hash,
            preview: entry.preview,
            size: entry.size,
            compressed: entry.compressed === true
        }))
    };
    const indexPath = path.join(directory, PISI_VERSION_HISTORY_INDEX_FILE);
    const content = JSON.stringify(index, null, 2);
    if (typeof writeAtomic === 'function') {
        writeAtomic(indexPath, content, { backup: false });
    } else {
        fs.writeFileSync(indexPath, content, 'utf8');
    }
}

function prunePisiVersionHistory(directory, entries, options = {}) {
    const selected = selectPisiVersionHistoryRetention(entries, options);
    for (const entry of selected.remove) {
        const snapshotPath = path.join(directory, entry.historyId);
        try {
            if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
        } catch {}
    }
    writePisiVersionHistoryIndex(directory, selected.keep, options);
    return selected;
}

function snapshotPisiNodeVersionBounded(nodePath, reason = 'save', options = {}) {
    try {
        if (!fs.existsSync(nodePath)) return { ok: true, skipped: true };
        const context = pisiVersionHistoryDirectory(nodePath, options);
        if (!context?.ok) return context;
        const { directory, info, projectFolder } = context;
        fs.mkdirSync(directory, { recursive: true });

        const raw = fs.readFileSync(nodePath, 'utf8');
        const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
        const existingEntries = getPisiVersionHistoryEntries(directory);
        if (existingEntries.some((entry) => entry.hash === hash)) {
            return {
                ok: true,
                skipped: true,
                duplicate: true,
                storageBytes: existingEntries.reduce((sum, entry) => sum + entry.size, 0)
            };
        }

        const capturedAt = new Date().toISOString();
        const historyId = `${Date.now()}-${capturedAt.replace(/[:.]/g, '-')}-${hash}.json.gz`;
        const snapshot = {
            version: PISI_VERSION_HISTORY_FORMAT_VERSION,
            reason: String(reason || 'save').slice(0, 80),
            capturedAt,
            nodePath: path.relative(projectFolder, nodePath),
            hash,
            data: info.data
        };
        const encoded = Buffer.from(JSON.stringify(snapshot), 'utf8');
        const compressed = zlib.gzipSync(encoded, { level: 6 });
        const snapshotPath = path.join(directory, historyId);
        const writeAtomic = options.writeFileAtomic || globalThis.writeFileAtomic;
        if (typeof writeAtomic === 'function') {
            writeAtomic(snapshotPath, compressed, { backup: false });
        } else {
            fs.writeFileSync(snapshotPath, compressed);
        }

        const entry = makePisiVersionHistoryEntry(directory, historyId, snapshot);
        const retention = prunePisiVersionHistory(directory, [entry, ...existingEntries], options);
        return {
            ok: true,
            historyId,
            snapshotPath,
            compressed: true,
            rawBytes: encoded.length,
            storedBytes: entry.size,
            storageBytes: retention.bytes,
            storageBudgetBytes: retention.maxBytes,
            retainedVersions: retention.keep.length
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function listPisiNodeHistoryBounded(nodePath, options = {}) {
    try {
        const context = pisiVersionHistoryDirectory(nodePath, options);
        if (!context?.ok) return context;
        if (!fs.existsSync(context.directory)) {
            return {
                ok: true,
                versions: [],
                storageBytes: 0,
                storageBudgetBytes: PISI_VERSION_HISTORY_MAX_BYTES,
                maxVersions: PISI_VERSION_HISTORY_MAX_VERSIONS
            };
        }
        const entries = getPisiVersionHistoryEntries(context.directory).slice(0, PISI_VERSION_HISTORY_MAX_VERSIONS);
        return {
            ok: true,
            versions: entries.map((entry) => ({ ...entry })),
            storageBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
            storageBudgetBytes: PISI_VERSION_HISTORY_MAX_BYTES,
            maxVersions: PISI_VERSION_HISTORY_MAX_VERSIONS
        };
    } catch (error) {
        return { ok: false, error: error.message, versions: [] };
    }
}

function getPisiNodeHistoryVersionBounded(nodePath, historyId, options = {}) {
    try {
        if (!isPisiVersionHistoryId(historyId)) {
            return { ok: false, error: 'Geçersiz sürüm kimliği.' };
        }
        const context = pisiVersionHistoryDirectory(nodePath, options);
        if (!context?.ok) return context;
        const snapshotPath = path.join(context.directory, historyId);
        const result = readPisiVersionHistorySnapshotFile(snapshotPath);
        if (!result.ok || !result.data?.data) {
            return { ok: false, error: result.error || 'Sürüm bulunamadı.' };
        }
        const toPlainText = options.pisiHtmlToPlainText || globalThis.pisiHtmlToPlainText;
        return {
            ok: true,
            historyId,
            capturedAt: result.data.capturedAt,
            reason: result.data.reason,
            data: result.data.data,
            text:
                typeof toPlainText === 'function'
                    ? toPlainText(result.data.data.content || '')
                    : String(result.data.data.content || '').replace(/<[^>]+>/g, ' ')
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function saveNodeContentWithBoundedHistory(nodePath, content = '', options = {}) {
    try {
        const getDocument = options.getPisiDocument || globalThis.getPisiDocument;
        const saveContent = options.saveNodeContent || globalThis.saveNodeContent;
        const current = getDocument(nodePath);
        if (!current?.ok) return current;

        const normalizedIncoming = editorAssets.normalizePisiEditorAssets(String(content || ''), { writeAssets: false }).content;

        if (String(current.data?.content || '') === String(normalizedIncoming || '')) {
            return {
                ok: true,
                unchanged: true,
                fullPath: nodePath,
                metadata: current.metadata,
                content: current.data.content || '',
                preview: globalThis.stripPreviewText?.(current.data.content || '') || ''
            };
        }
        const snapshot = snapshotPisiNodeVersionBounded(nodePath, options.reason || 'save', options);
        if (!snapshot.ok) return snapshot;
        return saveContent(nodePath, content);
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function restorePisiNodeHistoryVersionBounded(nodePath, historyId, options = {}) {
    try {
        const version = getPisiNodeHistoryVersionBounded(nodePath, historyId, options);
        if (!version.ok) return version;
        const ensureMetadata = options.ensurePisiFileMetadata || globalThis.ensurePisiFileMetadata;
        const current = ensureMetadata(nodePath, { ensureSidecar: false });
        if (!current?.ok) return current;
        if (version.data?.pisi?.id !== current.metadata?.id) {
            return { ok: false, error: 'Sürüm başka bir node kimliğine ait.' };
        }
        const snapshot = snapshotPisiNodeVersionBounded(nodePath, 'before-restore', options);
        if (!snapshot.ok) return snapshot;
        const restoredData = JSON.parse(JSON.stringify(version.data));
        restoredData.pisi.updatedAt = new Date().toISOString();
        const writeDocument = options.writePisiDocument || globalThis.writePisiDocument;
        writeDocument(nodePath, restoredData);
        return { ok: true, fullPath: nodePath, restoredHistoryId: historyId };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export {
PISI_VERSION_HISTORY_FORMAT_VERSION,
    PISI_VERSION_HISTORY_INDEX_VERSION,
    PISI_VERSION_HISTORY_MAX_BYTES,
    PISI_VERSION_HISTORY_MAX_VERSIONS,
    getPisiVersionHistoryEntries,
    getPisiNodeHistoryVersionBounded,
    isPisiVersionHistoryId,
    listPisiNodeHistoryBounded,
    readPisiVersionHistorySnapshotFile,
    restorePisiNodeHistoryVersionBounded,
    saveNodeContentWithBoundedHistory,
    selectPisiVersionHistoryRetention,
    snapshotPisiNodeVersionBounded
};
