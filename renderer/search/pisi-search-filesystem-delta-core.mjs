import { pisiSearchPathKey } from './pisi-search-core.mjs';

const PISI_SEARCH_SCOPED_DELTA_MAX_PATHS = 24;

function getPisiSearchChangedPathExtension(value = '') {
    const match = String(value || '').match(/\.[A-Za-z0-9]+$/);
    return match?.[0]?.toLowerCase() || '';
}

function uniquePisiSearchPaths(paths = []) {
    const seen = new Set();
    const output = [];
    for (const value of Array.isArray(paths) ? paths : []) {
        const path = String(value || '').trim();
        const key = pisiSearchPathKey(path);
        if (!path || !key || seen.has(key)) continue;
        seen.add(key);
        output.push(path);
    }
    return output;
}

function classifyPisiSearchChangedPaths(paths = [], options = {}) {
    const maxPaths = Math.max(1, Number(options.maxPaths) || PISI_SEARCH_SCOPED_DELTA_MAX_PATHS);
    const uniquePaths = uniquePisiSearchPaths(paths);
    const nodePaths = [];
    const mapPaths = [];
    const ignoredPaths = [];
    const ambiguousPaths = [];

    for (const path of uniquePaths) {
        const extension = getPisiSearchChangedPathExtension(path);
        if (extension === '.node') {
            nodePaths.push(path);
        } else if (extension === '.map') {
            mapPaths.push(path);
        } else if (extension) {
            ignoredPaths.push(path);
        } else {
            ambiguousPaths.push(path);
        }
    }

    const scopedCount = nodePaths.length + mapPaths.length;
    if (ambiguousPaths.length || scopedCount > maxPaths) {
        return {
            mode: 'rebuild',
            nodePaths,
            mapPaths,
            ignoredPaths,
            ambiguousPaths,
            uniquePaths,
            reason: ambiguousPaths.length ? 'ambiguous-path' : 'delta-too-large'
        };
    }
    if (!scopedCount) {
        return {
            mode: 'ignore',
            nodePaths,
            mapPaths,
            ignoredPaths,
            ambiguousPaths,
            uniquePaths,
            reason: 'no-search-source-paths'
        };
    }
    return {
        mode: 'scoped',
        nodePaths,
        mapPaths,
        ignoredPaths,
        ambiguousPaths,
        uniquePaths,
        reason: 'document-scoped'
    };
}

function removePisiSearchMapMemberships(memberships = [], mapPath = '') {
    const mapKey = pisiSearchPathKey(mapPath);
    return (Array.isArray(memberships) ? memberships : []).filter((membership) => {
        return pisiSearchPathKey(membership?.mapPath) !== mapKey;
    });
}

function upsertPisiSearchMapMembership(memberships = [], membership = null) {
    if (!membership?.mapPath) return Array.from(memberships || []);
    return [...removePisiSearchMapMemberships(memberships, membership.mapPath), membership];
}

function replacePisiSearchNodeRecords(records = [], nodePath = '', nextRecords = []) {
    const nodeKey = pisiSearchPathKey(nodePath);
    return [
        ...(Array.isArray(records) ? records : []).filter((record) => {
            return pisiSearchPathKey(record?.nodePath) !== nodeKey;
        }),
        ...(Array.isArray(nextRecords) ? nextRecords : [])
    ];
}

function replacePisiSearchMapRecord(records = [], mapPath = '', nextRecord = null) {
    const mapKey = pisiSearchPathKey(mapPath);
    return [
        ...(Array.isArray(records) ? records : []).filter((record) => {
            return !(record?.kind === 'map' && pisiSearchPathKey(record?.mapPath) === mapKey);
        }),
        ...(nextRecord ? [nextRecord] : [])
    ];
}

export {
    PISI_SEARCH_SCOPED_DELTA_MAX_PATHS,
    classifyPisiSearchChangedPaths,
    getPisiSearchChangedPathExtension,
    removePisiSearchMapMemberships,
    replacePisiSearchMapRecord,
    replacePisiSearchNodeRecords,
    uniquePisiSearchPaths,
    upsertPisiSearchMapMembership
};
