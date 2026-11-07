import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Asynchronous, Electron-free project reads used for long scans. They run in
// the project read worker (project-read-worker.js) and, when no worker is
// available, in the main process itself, still asynchronously. Nothing here
// writes; writes stay in the atomic mutation path.

/**
 * Lists project files like the synchronous walkers it replaces: breadth-first
 * ('bfs', Project Integrity) or depth-first in directory order ('dfs', export).
 * @param {string} root
 * @param {{ order?: 'bfs'|'dfs', skipDirs?: string[], skipDirPrefixes?: string[], caseInsensitive?: boolean, skipHidden?: boolean, pattern?: string, limit?: number }} [options]
 */
export async function walkPisiProjectFiles(root, options = {}) {
    const skipDirs = new Set(options.skipDirs || []);
    const skipPrefixes = options.skipDirPrefixes || [];
    const pattern = new RegExp(options.pattern || '\\.(?:node|map)$', 'i');
    const limit = Number(options.limit) || Infinity;
    const files = [];
    const skipDirectory = (name) => {
        if (options.skipHidden && name.startsWith('.')) return true;
        // Export compares lower-case names, Project Integrity exact names: keep each walker's rule.
        const key = options.caseInsensitive ? name.toLowerCase() : name;
        return skipDirs.has(key) || skipPrefixes.some((prefix) => key.startsWith(prefix));
    };
    const list = async (directory) => {
        try {
            return await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return null;
        }
    };
    if (options.order === 'dfs') {
        const visit = async (directory) => {
            const entries = await list(directory);
            if (!entries) return;
            for (const entry of entries) {
                if (files.length >= limit) return;
                if (entry.isSymbolicLink?.()) continue;
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirectory(entry.name)) await visit(fullPath);
                } else if (entry.isFile() && pattern.test(entry.name)) files.push(fullPath);
            }
        };
        await visit(path.resolve(root));
        return files;
    }
    const queue = [path.resolve(root)];
    while (queue.length) {
        const current = queue.shift();
        const entries = await list(current);
        if (!entries) continue;
        for (const entry of entries) {
            if (entry.isSymbolicLink?.()) continue;
            if (entry.isDirectory() && skipDirectory(entry.name)) continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) queue.push(fullPath);
            else if (entry.isFile() && pattern.test(entry.name)) {
                files.push(fullPath);
                if (files.length >= limit) return files;
            }
        }
    }
    return files;
}

/**
 * Reads and parses JSON files: { path, ok, data, raw?, missing?, error? } per path, in order.
 * @param {string[]} paths
 * @param {{ raw?: boolean, sidecars?: boolean, concurrency?: number }} [options]
 */
export async function readPisiJsonFiles(paths, options = {}) {
    const results = new Array(paths.length);
    const concurrency = Math.max(1, Number(options.concurrency) || 16);
    let next = 0;
    const worker = async () => {
        while (next < paths.length) {
            const index = next++;
            const filePath = paths[index];
            try {
                const raw = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(raw);
                /** @type {{ path: string, ok: boolean, data: any, raw?: string, sidecarName?: string, sidecarIsDirectory?: boolean }} */
                const result = { path: filePath, ok: true, data, ...(options.raw ? { raw } : {}) };
                if (options.sidecars) {
                    // Whether the document's managed sidecar folder exists (Project Integrity checks it).
                    const sidecarName = String(data?.pisi?.sidecar || '');
                    if (sidecarName) {
                        result.sidecarName = sidecarName;
                        result.sidecarIsDirectory = await fs.stat(path.join(path.dirname(filePath), sidecarName)).then(
                            (stat) => stat.isDirectory(),
                            () => false
                        );
                    }
                }
                results[index] = result;
            } catch (error) {
                results[index] =
                    error?.code === 'ENOENT'
                        ? { path: filePath, ok: false, missing: true, error: 'Dosya bulunamadı.' }
                        : { path: filePath, ok: false, error: error?.message || String(error) };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
    return results;
}

/**
 * Link rename preparation: the title of every live note, and the notes whose
 * text may need a rewrite (they mention `nodeId`, or contain legacy [[…]] text).
 * A superset is fine: the rewrite inside the mutation re-reads each candidate.
 * @param {string} root
 * @param {{ nodeId: string }} options
 */
export async function scanPisiWikiRenameCandidates(root, options) {
    const files = await walkPisiProjectFiles(root, { order: 'dfs', skipHidden: true, pattern: '\\.node$' });
    const titles = [];
    const candidates = [];
    for (let offset = 0; offset < files.length; offset += 200) {
        const batch = files.slice(offset, offset + 200);
        for (const result of await readPisiJsonFiles(batch, { raw: true })) {
            if (!result.ok || typeof result.data?.content !== 'string') continue;
            titles.push({ filePath: result.path, id: result.data.pisi?.id || null, title: String(result.data.pisi?.title || '') });
            if ((options.nodeId && result.raw.includes(options.nodeId)) || result.data.content.includes('[[')) candidates.push(result.path);
        }
    }
    return { files: files.length, titles, candidates };
}
