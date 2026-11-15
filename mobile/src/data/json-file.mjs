// Reading and serializing project JSON. A file that is missing, a file that is
// fine and a file that cannot be parsed are three different answers: the
// caller must never treat a corrupt file as an empty one (rule V7).

export class PisiReadOnlyError extends Error {
    constructor(key, reason = '') {
        super(`Read-only (corrupt) file is not written: ${key}${reason ? ` (${reason})` : ''}`);
        this.name = 'PisiReadOnlyError';
        this.code = 'READ_ONLY';
        this.key = key;
    }
}

/** @returns {{ status: 'missing' } | { status: 'ok', data: any, text: string } | { status: 'corrupt', error: string, text: string }} */
export function parseJsonText(text) {
    if (text === null || text === undefined) return { status: 'missing' };
    if (!String(text).trim()) return { status: 'corrupt', error: 'empty file', text };
    try {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 'corrupt', error: 'not a JSON object', text };
        return { status: 'ok', data, text };
    } catch (error) {
        return { status: 'corrupt', error: error?.message || 'invalid JSON', text };
    }
}

export async function readTextOrNull(driver, key) {
    try {
        return await driver.readText(key);
    } catch (error) {
        if (error?.code === 'NOT_FOUND') return null;
        throw error;
    }
}

export async function readJsonFile(driver, key) {
    return parseJsonText(await readTextOrNull(driver, key));
}

/** .node and .map files: two-space JSON without a final newline, as the desktop writes them. */
export const serializeDocument = (data) => JSON.stringify(data, null, 2);

/** .pisi/tasks.json: two-space JSON with a final newline, as the desktop writes it. */
export const serializeStore = (data) => `${JSON.stringify(data, null, 2)}\n`;
