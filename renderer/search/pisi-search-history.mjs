import { pisiSearchPathKey } from './pisi-search-core.mjs';

const PISI_SEARCH_HISTORY_VERSION = 1;
const PISI_SEARCH_HISTORY_LIMIT = 32;
const PISI_SEARCH_HISTORY_PREFIX = 'pisi.search.history.v1:';

function getPisiSearchHistoryStorage(storage = globalThis.localStorage) {
    return storage && typeof storage.getItem === 'function' ? storage : null;
}

function getPisiSearchHistoryKey(projectFolder = '') {
    const projectKey = pisiSearchPathKey(projectFolder);
    return projectKey ? PISI_SEARCH_HISTORY_PREFIX + projectKey : '';
}

function normalizePisiSearchHistoryEntry(entry = {}) {
    const id = String(entry?.id || '').trim();
    if (!id) return null;
    return {
        id,
        kind: String(entry?.kind || ''),
        title: String(entry?.title || entry?.nodeTitle || ''),
        nodePath: String(entry?.nodePath || ''),
        mapPath: String(entry?.mapPath || ''),
        lastOpened: Math.max(0, Number(entry?.lastOpened) || 0),
        openCount: Math.max(1, Math.min(9999, Number(entry?.openCount) || 1))
    };
}

function readPisiSearchHistory(projectFolder = '', storage = globalThis.localStorage) {
    const target = getPisiSearchHistoryStorage(storage);
    const key = getPisiSearchHistoryKey(projectFolder);
    if (!target || !key) return [];
    try {
        const parsed = JSON.parse(target.getItem(key) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(normalizePisiSearchHistoryEntry)
            .filter(Boolean)
            .sort((a, b) => b.lastOpened - a.lastOpened)
            .slice(0, PISI_SEARCH_HISTORY_LIMIT);
    } catch {
        return [];
    }
}

function writePisiSearchHistory(projectFolder, entries, storage = globalThis.localStorage) {
    const target = getPisiSearchHistoryStorage(storage);
    const key = getPisiSearchHistoryKey(projectFolder);
    if (!target || !key) return false;
    const normalized = (Array.isArray(entries) ? entries : [])
        .map(normalizePisiSearchHistoryEntry)
        .filter(Boolean)
        .sort((a, b) => b.lastOpened - a.lastOpened)
        .slice(0, PISI_SEARCH_HISTORY_LIMIT);
    try {
        target.setItem(key, JSON.stringify(normalized));
        return true;
    } catch {
        return false;
    }
}

function rememberPisiSearchResult(
    projectFolder,
    result,
    options = {}
) {
    const id = String(result?.id || '').trim();
    if (!projectFolder || !id) return [];
    const storage = options.storage ?? globalThis.localStorage;
    const now = Number(options.now) || Date.now();
    const entries = readPisiSearchHistory(projectFolder, storage);
    const previous = entries.find((entry) => entry.id === id);
    const next = normalizePisiSearchHistoryEntry({
        ...previous,
        id,
        kind: result?.kind,
        title: result?.title || result?.nodeTitle,
        nodePath: result?.nodePath,
        mapPath: result?.mapPath,
        lastOpened: now,
        openCount: Math.min(9999, Number(previous?.openCount || 0) + 1)
    });
    const merged = [
        next,
        ...entries.filter((entry) => entry.id !== id)
    ].filter(Boolean).slice(0, PISI_SEARCH_HISTORY_LIMIT);
    writePisiSearchHistory(projectFolder, merged, storage);
    return merged;
}

function makePisiSearchRecentMap(projectFolder, storage = globalThis.localStorage) {
    return new Map(
        readPisiSearchHistory(projectFolder, storage)
            .map((entry) => [entry.id, entry])
    );
}

function clearPisiSearchHistory(projectFolder, storage = globalThis.localStorage) {
    const target = getPisiSearchHistoryStorage(storage);
    const key = getPisiSearchHistoryKey(projectFolder);
    if (!target || !key) return false;
    try {
        target.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

export {
    PISI_SEARCH_HISTORY_LIMIT,
    PISI_SEARCH_HISTORY_VERSION,
    clearPisiSearchHistory,
    getPisiSearchHistoryKey,
    makePisiSearchRecentMap,
    normalizePisiSearchHistoryEntry,
    readPisiSearchHistory,
    rememberPisiSearchResult,
    writePisiSearchHistory
};