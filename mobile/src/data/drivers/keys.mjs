// Project-relative keys: forward slashes, no leading slash, no `.` or `..`
// segment. Every driver resolves keys through these helpers, so nothing the
// app asks for can leave the project folder.

export class PisiStorageError extends Error {
    constructor(code, message, key = '') {
        super(message);
        this.name = 'PisiStorageError';
        this.code = code;
        this.key = key;
    }
}

export const notFound = (key) => new PisiStorageError('NOT_FOUND', `Not found: ${key}`, key);

/** The clean key, or '' for the project root. Throws on a key that could leave the project. */
export function normalizeKey(key) {
    const raw = String(key ?? '');
    if (raw === '' || raw === '.') return '';
    if (raw.includes('\\') || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
        throw new PisiStorageError('INVALID_KEY', `Invalid project key: ${raw}`, raw);
    }
    const segments = raw.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new PisiStorageError('INVALID_KEY', `Invalid project key: ${raw}`, raw);
    }
    return segments.join('/');
}

export function parentKey(key) {
    const index = key.lastIndexOf('/');
    return index < 0 ? '' : key.slice(0, index);
}

export function baseName(key) {
    return key.slice(key.lastIndexOf('/') + 1);
}

export function joinKey(parent, name) {
    return parent ? `${parent}/${name}` : name;
}
