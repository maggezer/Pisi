// StorageDriver over a real folder with node:fs. Only tests import this file
// (the desktop compatibility test runs the mobile repos through it); the app
// bundle never does.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PisiStorageError, normalizeKey, notFound } from './keys.mjs';

export function createNodeFsDriver(rootFolder) {
    const root = path.resolve(rootFolder);
    const resolve = (key) => path.join(root, ...normalizeKey(key).split('/').filter(Boolean));

    async function guard(key, action) {
        try {
            return await action();
        } catch (error) {
            if (error?.code === 'ENOENT') throw notFound(key);
            if (error instanceof PisiStorageError) throw error;
            throw new PisiStorageError('IO_ERROR', error?.message || String(error), String(key));
        }
    }

    return {
        readText: (key) => guard(key, () => fs.readFile(resolve(key), 'utf8')),
        writeText: (key, text) => guard(key, () => fs.writeFile(resolve(key), String(text), 'utf8')),
        rename: (from, to) => guard(from, () => fs.rename(resolve(from), resolve(to))),

        list: (key) =>
            guard(key, async () => {
                const entries = await fs.readdir(resolve(key), { withFileTypes: true });
                return entries
                    .filter((entry) => entry.isFile() || entry.isDirectory())
                    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
                    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            }),

        async stat(key) {
            try {
                const stat = await fs.stat(resolve(key));
                return { type: stat.isDirectory() ? 'directory' : 'file', size: stat.size, mtime: stat.mtimeMs };
            } catch (error) {
                if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
                throw new PisiStorageError('IO_ERROR', error?.message || String(error), String(key));
            }
        },

        mkdir: (key) => guard(key, () => fs.mkdir(resolve(key), { recursive: true }).then(() => undefined)),

        async exists(key) {
            return (await this.stat(key)) !== null;
        },

        /** Removes one file. Missing files are fine; directories are never removed. */
        remove: (key) => guard(key, () => fs.rm(resolve(key), { force: true }))
    };
}
