// Project file adapter of the sync engine (docs/sync-plan.md §3.3, §3.6, rules
// SV7, SV9, SV11). Paths are project-relative with '/'. The scan skips the
// excluded paths of shared/sync-paths.mjs, symbolic links and anything that
// resolves outside the project. `apply` writes a whole turn synchronously
// inside `run` — the desktop passes runPisiAtomicMutation, so an interrupted
// turn rolls back to the state before it — and checks `isDirty` right before
// each write (SV4): a dirty file is skipped and reported back.

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isPisiManagedSidecarFolder } from '../../shared/document-naming.mjs';
import { isPisiSyncExcludedPath } from '../../shared/sync-paths.mjs';

function toRelative(root, absolute) {
    return path.relative(root, absolute).split(path.sep).join('/');
}

function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The managed sidecar folder (`inv_…`, `nd_…`) a written note or map names, or
 * null. Folders are not synced, so an empty one is created next to the
 * document: Project Integrity expects it (SV6).
 */
function getSidecarFolder(absolute, bytes) {
    if (!/\.(node|map)$/i.test(absolute)) return null;
    try {
        const sidecar = JSON.parse(Buffer.from(bytes).toString('utf8'))?.pisi?.sidecar;
        return typeof sidecar === 'string' && isPisiManagedSidecarFolder(sidecar) && !/[\\/]/.test(sidecar) ? path.join(path.dirname(absolute), sidecar) : null;
    } catch {
        return null;
    }
}

function defaultWrite(filePath, bytes) {
    const temp = `${filePath}.${process.pid}.${Date.now()}.sync.tmp`;
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, filePath);
}

/**
 * `root` is the project folder. Options: `run(fn)` runs the writes of a turn
 * (default: directly), `writeFile(absolutePath, bytes)` writes one file
 * atomically, `beforeWrite(op, index)` is a test hook (fault injection).
 */
export function createPisiSyncProjectFiles(
    root,
    { run = (fn) => fn(), writeFile = defaultWrite, beforeWrite = /** @type {((op: any, index: number) => void) | null} */ (null) } = {}
) {
    const projectRoot = path.resolve(root);
    const resolve = (relative) => {
        const absolute = path.resolve(projectRoot, ...String(relative).split('/'));
        if (!isInside(projectRoot, absolute)) throw Object.assign(new Error('Proje dışı yol.'), { code: 'PATH_UNSAFE' });
        return absolute;
    };

    async function list() {
        const out = [];
        async function walk(directory) {
            let entries;
            try {
                entries = await fsPromises.readdir(directory, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const absolute = path.join(directory, entry.name);
                const relative = toRelative(projectRoot, absolute);
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) {
                    if (!isPisiSyncExcludedPath(`${relative}/`)) await walk(absolute);
                    continue;
                }
                if (!entry.isFile() || isPisiSyncExcludedPath(relative)) continue;
                try {
                    const stat = await fsPromises.stat(absolute);
                    out.push({ path: relative.normalize('NFC'), size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
                } catch {
                    // The file went away during the scan.
                }
            }
        }
        await walk(projectRoot);
        return out.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    }

    async function read(relative) {
        try {
            const absolute = resolve(relative);
            const stat = await fsPromises.lstat(absolute);
            if (!stat.isFile()) return null;
            return new Uint8Array(await fsPromises.readFile(absolute));
        } catch {
            return null;
        }
    }

    function isEmptyTree(directory) {
        try {
            return fs.readdirSync(directory, { withFileTypes: true }).every((entry) => entry.isDirectory() && isEmptyTree(path.join(directory, entry.name)));
        } catch {
            return false;
        }
    }

    function pruneEmptyParents(absolute) {
        let directory = path.dirname(absolute);
        while (isInside(projectRoot, directory)) {
            let entries;
            try {
                entries = fs.readdirSync(directory);
            } catch {
                return;
            }
            if (entries.length) return;
            fs.rmSync(directory, { recursive: true, force: true });
            directory = path.dirname(directory);
        }
    }

    /** Writes and removes `ops` in one `run`; returns `{ skipped }` (paths left alone because they are dirty). */
    async function apply(ops, { isDirty = (_path) => false } = {}) {
        const skipped = [];
        await run(() => {
            ops.forEach((op, index) => {
                beforeWrite?.(op, index);
                if (isDirty(op.path)) {
                    skipped.push(op.path);
                    return;
                }
                const absolute = resolve(op.path);
                if (op.op === 'remove') {
                    if (fs.existsSync(absolute)) {
                        let sidecar = null;
                        try {
                            sidecar = getSidecarFolder(absolute, fs.readFileSync(absolute));
                        } catch {
                            sidecar = null;
                        }
                        fs.rmSync(absolute, { force: true });
                        // The removed document's sidecar goes too once the remote deletes left it without files.
                        if (sidecar && isEmptyTree(sidecar)) fs.rmSync(sidecar, { recursive: true, force: true });
                        pruneEmptyParents(absolute);
                    }
                    return;
                }
                fs.mkdirSync(path.dirname(absolute), { recursive: true });
                writeFile(absolute, Buffer.from(op.bytes));
                const sidecar = getSidecarFolder(absolute, op.bytes);
                if (sidecar && !fs.existsSync(sidecar)) fs.mkdirSync(sidecar, { recursive: true });
            });
            return { ok: true };
        });
        return { skipped };
    }

    return { root: projectRoot, resolve, list, read, apply, toAbsolute: resolve };
}
