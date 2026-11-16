// StorageDriver kept in memory, for unit tests. Same contract as the other
// drivers (docs/mobile-plan.md §3.3): keys are project-relative, a missing
// file throws NOT_FOUND, `rename` replaces the destination.

import { PisiStorageError, normalizeKey, notFound, parentKey } from './keys.mjs';

export function createMemoryDriver(initialFiles = {}) {
    const files = new Map();
    const directories = new Set(['']);
    let clock = 0;

    function addDirectory(key) {
        for (let current = key; current && !directories.has(current); current = parentKey(current)) directories.add(current);
    }

    function put(key, text) {
        addDirectory(parentKey(key));
        files.set(key, { text, mtime: (clock += 1) });
    }

    for (const [key, text] of Object.entries(initialFiles)) put(normalizeKey(key), String(text));

    const driver = {
        async readText(key) {
            const file = files.get(normalizeKey(key));
            if (!file) throw notFound(key);
            return file.text;
        },

        /** A file's bytes as base64. Files here are text unless a test stored bytes with `putBase64`. */
        async readBase64(key) {
            const file = files.get(normalizeKey(key));
            if (!file) throw notFound(key);
            return file.base64 ?? btoa(String.fromCharCode(...new TextEncoder().encode(file.text)));
        },

        async writeText(key, text) {
            const clean = normalizeKey(key);
            if (!clean || directories.has(clean)) throw new PisiStorageError('NOT_A_FILE', `Not a file: ${key}`, key);
            if (!directories.has(parentKey(clean))) throw notFound(parentKey(clean));
            put(clean, String(text));
        },

        async rename(from, to) {
            const source = normalizeKey(from);
            const target = normalizeKey(to);
            const file = files.get(source);
            if (!file) throw notFound(from);
            if (!directories.has(parentKey(target))) throw notFound(parentKey(target));
            files.delete(source);
            put(target, file.text);
        },

        async list(key) {
            const clean = normalizeKey(key);
            if (!directories.has(clean)) throw notFound(key);
            const entries = [];
            for (const directory of directories) {
                if (directory && parentKey(directory) === clean) entries.push({ name: directory.slice(clean ? clean.length + 1 : 0), type: 'directory' });
            }
            for (const file of files.keys()) {
                if (parentKey(file) === clean) entries.push({ name: file.slice(clean ? clean.length + 1 : 0), type: 'file' });
            }
            return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        },

        async stat(key) {
            const clean = normalizeKey(key);
            if (directories.has(clean)) return { type: 'directory', size: 0, mtime: 0 };
            const file = files.get(clean);
            return file ? { type: 'file', size: file.text.length, mtime: file.mtime } : null;
        },

        async mkdir(key) {
            const clean = normalizeKey(key);
            if (files.has(clean)) throw new PisiStorageError('NOT_A_DIRECTORY', `Not a directory: ${key}`, key);
            addDirectory(clean);
        },

        async exists(key) {
            const clean = normalizeKey(key);
            return files.has(clean) || directories.has(clean);
        },

        /** Removes one file. Missing files are fine; directories are never removed. */
        async remove(key) {
            files.delete(normalizeKey(key));
        },

        /** Test helper: stores a binary file (an image in a sidecar folder) from its base64. */
        putBase64(key, base64) {
            const clean = normalizeKey(key);
            put(clean, '');
            files.get(clean).base64 = String(base64);
        },

        /** Test helper: every file as `{ key: text }`. */
        snapshot() {
            return Object.fromEntries([...files].map(([key, file]) => [key, file.text]).sort(([a], [b]) => (a < b ? -1 : 1)));
        }
    };

    return driver;
}
