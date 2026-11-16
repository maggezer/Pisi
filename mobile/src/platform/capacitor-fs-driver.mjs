// StorageDriver over Capacitor's Filesystem plugin. The project lives in the
// app's own data area: Directory.Data/projects/default/ (docs/mobile-plan.md
// §1.3). In a browser (vite dev, E2E) the plugin's web implementation keeps
// the same files in IndexedDB, so the app runs the same code there.

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { PisiStorageError, normalizeKey, notFound } from '../data/drivers/keys.mjs';

export const PISI_PROJECT_ROOT = 'projects/default';

export function createCapacitorFsDriver({ root = PISI_PROJECT_ROOT, filesystem = Filesystem } = {}) {
    const at = (key) => {
        const clean = normalizeKey(key);
        return { path: clean ? `${root}/${clean}` : root, directory: Directory.Data };
    };
    const ioError = (error, key) => new PisiStorageError('IO_ERROR', error?.message || String(error), String(key));

    async function stat(key) {
        const target = at(key);
        try {
            const result = await filesystem.stat(target);
            return { type: result.type === 'directory' ? 'directory' : 'file', size: Number(result.size) || 0, mtime: Number(result.mtime) || 0 };
        } catch {
            // The plugin reports a missing path as an error; its code differs per platform.
            return null;
        }
    }

    /** Runs `action`; when it fails, a missing `key` becomes NOT_FOUND and anything else an IO_ERROR. */
    async function guard(key, action) {
        try {
            return await action();
        } catch (error) {
            if (error instanceof PisiStorageError) throw error;
            if (!(await stat(key))) throw notFound(key);
            throw ioError(error, key);
        }
    }

    return {
        readText: (key) => guard(key, async () => String((await filesystem.readFile({ ...at(key), encoding: Encoding.UTF8 })).data)),

        /** A file's bytes as base64 (the plugin's own form for a file read without an encoding). */
        readBase64: (key) =>
            guard(key, async () => {
                const { data } = await filesystem.readFile(at(key));
                if (typeof data === 'string') return data;
                // In a browser the plugin may hand back a Blob.
                const bytes = new Uint8Array(await data.arrayBuffer());
                let binary = '';
                for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
                return btoa(binary);
            }),

        async writeText(key, text) {
            try {
                await filesystem.writeFile({ ...at(key), data: String(text), encoding: Encoding.UTF8 });
            } catch (error) {
                throw ioError(error, key);
            }
        },

        async rename(from, to) {
            const source = at(from);
            const target = at(to);
            const move = () => filesystem.rename({ from: source.path, to: target.path, directory: source.directory, toDirectory: target.directory });
            try {
                await move();
            } catch (error) {
                if (!(await stat(from))) throw notFound(from);
                // Some platforms refuse to rename over an existing file. The temporary
                // file stays complete until the second rename, and an interrupted
                // attempt is finished at the next start (ProjectWriter.recoverDirectory).
                if (!(await stat(to))) throw ioError(error, from);
                try {
                    await filesystem.deleteFile(target);
                    await move();
                } catch (retryError) {
                    throw ioError(retryError, from);
                }
            }
        },

        list: (key) =>
            guard(key, async () => {
                const { files } = await filesystem.readdir(at(key));
                return files
                    .map((entry) => ({ name: entry.name, type: entry.type === 'directory' ? 'directory' : 'file' }))
                    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            }),

        stat,

        async mkdir(key) {
            const existing = await stat(key);
            if (existing?.type === 'directory') return;
            if (existing) throw new PisiStorageError('NOT_A_DIRECTORY', `Not a directory: ${key}`, String(key));
            try {
                await filesystem.mkdir({ ...at(key), recursive: true });
            } catch (error) {
                // Two callers can ask for the same folder; it only matters that it exists now.
                if ((await stat(key))?.type !== 'directory') throw ioError(error, key);
            }
        },

        async exists(key) {
            return (await stat(key)) !== null;
        },

        /** Removes one file. Missing files are fine; directories are never removed. */
        async remove(key) {
            const existing = await stat(key);
            if (!existing) return;
            if (existing.type !== 'file') throw new PisiStorageError('NOT_A_FILE', `Not a file: ${key}`, String(key));
            try {
                await filesystem.deleteFile(at(key));
            } catch (error) {
                throw ioError(error, key);
            }
        }
    };
}
