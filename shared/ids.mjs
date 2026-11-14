// Identifier formats of a Pisi project: node_/map_ documents, task_ tasks and
// blk_ editor blocks. Nothing here creates randomness: the caller passes the
// UUID (node:crypto in the desktop main process, Web Crypto in the renderer and
// on mobile), so every platform writes the same formats.

const PISI_TASK_ID = /^task_[A-Za-z0-9._:-]{4,180}$/;

/** map_<token> for a .map document, node_<token> for every other document. */
function formatPisiDocumentId(ext, token) {
    const prefix = ext === '.map' ? 'map' : 'node';
    return `${prefix}_${token}`;
}

function normalizePisiId(value, ext = '') {
    const id = String(value || '').trim();
    const expectedPrefix = ext === '.map' ? 'map_' : ext === '.node' ? 'node_' : '';

    if (!id || id.length > 101 || !/^(?:map|node)_[A-Za-z0-9_-]+$/.test(id) || (expectedPrefix && !id.startsWith(expectedPrefix))) {
        return null;
    }

    return id;
}

function isPisiTaskId(value) {
    return PISI_TASK_ID.test(String(value || ''));
}

/** The trimmed id when it is a valid task id, otherwise null. */
function normalizePisiTaskId(value) {
    const raw = String(value || '').trim();
    return PISI_TASK_ID.test(raw) ? raw : null;
}

function formatPisiTaskId(token) {
    return `task_${token}`;
}

function formatPisiBlockId(token) {
    return `blk_${token}`;
}

/**
 * Path form used inside a source task id: one forward slash between segments,
 * lower case where the file system ignores case (Windows).
 */
function normalizePisiTaskIdentityPath(value, caseInsensitive = false) {
    const normalized = String(value || '').replace(/[\\/]+/g, '/');
    return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function hashPisiTaskIdentity(value) {
    const input = String(value || '');
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        hashA ^= code;
        hashA = Math.imul(hashA, 0x01000193) >>> 0;
        hashB ^= (code + index) >>> 0;
        hashB = Math.imul(hashB, 0x85ebca6b) >>> 0;
    }
    return `${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

/**
 * Id of a task captured into a note block. It is derived from the block, so
 * re-indexing the same block yields the same task. `identityPath` is the
 * result of normalizePisiTaskIdentityPath.
 */
function formatPisiSourceTaskId(identityPath, blockId, todoTag) {
    const key = [String(identityPath || ''), String(blockId || ''), String(todoTag || '')].map(encodeURIComponent).join('::');
    return `task_source_${hashPisiTaskIdentity(key)}`;
}

export {
    formatPisiBlockId,
    formatPisiDocumentId,
    formatPisiSourceTaskId,
    formatPisiTaskId,
    hashPisiTaskIdentity,
    isPisiTaskId,
    normalizePisiId,
    normalizePisiTaskId,
    normalizePisiTaskIdentityPath
};
