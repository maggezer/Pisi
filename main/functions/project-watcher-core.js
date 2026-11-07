import * as path from 'node:path';

// Project file watcher, without Electron. On macOS and Windows one native
// recursive fs.watch covers the whole project. On Linux, Node's recursive
// watcher walks the whole tree synchronously when it starts (measured: 1.27 s
// for 10,000 note folders inside Electron, blocking the main process), so
// there a watcher per directory is set up asynchronously in small batches, and
// a rename only rescans the affected directory, never the whole tree. Internal folders (.git, history,
// trash, mutation journals, sync metadata, node_modules) and temporary files
// never produce events. Directory listing is async, so a large project does
// not block the main process while watchers are set up.

const PISI_WATCH_IGNORED_ROOTS = new Set(['.git', '.pisi-history', '.pisi-sync', 'node_modules', 'dist', 'coverage']);
const PISI_WATCH_IGNORED_PISI = new Set(['trash', 'mutations']);
const PISI_WATCH_TEMP_FILE = /(?:\.tmp|\.swp|\.swx|~)$|^~\$|^\.DS_Store$|^Thumbs\.db$|^\.pisi-(?:delete|transaction)-/i;

/**
 * Whether one recursive fs.watch is used. True on macOS and Windows (native
 * recursive events). False on Linux: Node 20+ supports it there, but builds it
 * with a synchronous walk of the whole tree, which blocks the main process on
 * large projects; per-directory watchers are set up asynchronously instead.
 */
export function shouldUsePisiRecursiveWatch(platform = process.platform) {
    return platform === 'darwin' || platform === 'win32';
}

const PISI_WATCH_BATCH = 200;
const yieldToEventLoop = () => new Promise((resolve) => globalThis.setImmediate(resolve));

/** True for paths (relative to the project root) that never produce watcher events. */
export function isPisiWatchIgnoredPath(relativePath) {
    const parts = String(relativePath || '')
        .split(/[\\/]+/)
        .filter(Boolean);
    if (!parts.length) return false;
    const first = parts[0].toLowerCase();
    if (PISI_WATCH_IGNORED_ROOTS.has(first)) return true;
    if (first === '.pisi' && parts[1] && PISI_WATCH_IGNORED_PISI.has(parts[1].toLowerCase())) return true;
    return parts.some((part) => PISI_WATCH_TEMP_FILE.test(part));
}

/**
 * @param {{
 *   root: string,
 *   watch: (target: string, options: { recursive: boolean }, listener: (eventType: string, fileName: string | Buffer | null) => void) => { close(): void, on?(event: string, handler: Function): void },
 *   readdir: (directory: string) => Promise<Array<{ name: string, isDirectory(): boolean, isSymbolicLink(): boolean }>>,
 *   recursive?: boolean,
 *   watchers?: Map<string, { close(): void }>,
 *   onChange: (eventType: string, changedPath: string, directoryPath: string) => void,
 *   onError?: (error: Error, directoryPath: string) => void
 * }} options
 */
export function createPisiProjectWatcher(options) {
    const root = path.resolve(options.root);
    const watchers = options.watchers || new Map();
    const recursive = options.recursive !== false;
    const state = { closed: false, rescans: new Map(), rescanCount: 0 };

    const relative = (target) => path.relative(root, target);
    const isIgnored = (target) => {
        const rel = relative(target);
        return rel.startsWith('..') || path.isAbsolute(rel) ? true : isPisiWatchIgnoredPath(rel);
    };

    function addWatcher(directory, recursiveWatch) {
        if (state.closed || watchers.has(directory)) return;
        try {
            const watcher = options.watch(directory, { recursive: recursiveWatch }, (eventType, fileName) => {
                const name = fileName ? String(fileName) : '';
                const changedPath = name ? path.join(directory, name) : directory;
                if (name && isIgnored(changedPath)) return;
                options.onChange(eventType || 'filesystem', changedPath, name ? path.dirname(changedPath) : directory);
                if (!recursiveWatch && (eventType === 'rename' || !name)) scheduleRescan(name ? changedPath : directory);
            });
            watcher.on?.('error', (error) => options.onError?.(error, directory));
            watchers.set(directory, watcher);
        } catch (error) {
            options.onError?.(error, directory);
        }
    }

    /** Lists `start` and the folders below it, calling `visit` for each; yields every few folders. */
    async function walkDirectories(start, visit) {
        const queue = [start];
        let count = 0;
        while (queue.length && !state.closed) {
            const directory = queue.shift();
            if (directory !== root && isIgnored(directory)) continue;
            let entries;
            try {
                entries = await options.readdir(directory);
            } catch {
                continue;
            }
            visit(directory);
            count += 1;
            if (count % PISI_WATCH_BATCH === 0) await yieldToEventLoop();
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(path.join(directory, entry.name));
            }
        }
        return count;
    }

    /** Fallback mode: re-syncs watchers below `target` only (a renamed, added or removed folder). */
    async function rescan(target) {
        state.rescanCount += 1;
        let directory = target;
        // A renamed file: its folder is still watched; a renamed folder may be gone.
        while (directory !== root && !(await isDirectory(directory))) directory = path.dirname(directory);
        for (const key of [...watchers.keys()]) {
            if (key !== directory && key.startsWith(directory + path.sep) && !(await isDirectory(key))) {
                watchers.get(key)?.close();
                watchers.delete(key);
            }
        }
        await walkDirectories(directory, (found) => addWatcher(found, false));
    }

    async function isDirectory(directory) {
        try {
            await options.readdir(directory);
            return true;
        } catch {
            return false;
        }
    }

    function scheduleRescan(target) {
        if (state.closed) return;
        const key = path.dirname(target);
        clearTimeout(state.rescans.get(key));
        const timer = setTimeout(() => {
            state.rescans.delete(key);
            void rescan(target);
        }, 300);
        timer.unref?.();
        state.rescans.set(key, timer);
    }

    return {
        async start() {
            if (recursive) {
                addWatcher(root, true);
                return { mode: 'recursive', watchers: watchers.size };
            }
            await walkDirectories(root, (directory) => addWatcher(directory, false));
            return { mode: 'per-directory', watchers: watchers.size };
        },
        close() {
            state.closed = true;
            for (const timer of state.rescans.values()) clearTimeout(timer);
            state.rescans.clear();
            for (const watcher of watchers.values()) {
                try {
                    watcher.close();
                } catch {
                    // Already closed.
                }
            }
            watchers.clear();
        },
        rescan,
        get rescanCount() {
            return state.rescanCount;
        },
        watchers
    };
}
