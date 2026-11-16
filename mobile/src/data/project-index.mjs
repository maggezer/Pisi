// What is in the project: a light list of notes and maps, rebuilt from the
// files and kept current from the writer's `fileChanged` events. It is a cache
// (rule V1): it can be thrown away and rebuilt, and nothing in it is ever
// written back to a file.

import { getPisiDiaryDateFromFileName, PISI_DIARY_FOLDER } from '../../../shared/diary-rules.mjs';
import { getPisiFileExt, isPisiManagedSidecarFolder } from '../../../shared/document-naming.mjs';
import { baseName, joinKey, parentKey } from './drivers/keys.mjs';
import { readJsonFile } from './json-file.mjs';
import { readMapReferences } from './map-model.mjs';
import { getNotePlainText } from '../../../shared/note-blocks.mjs';

// Folders that hold no notes: authorities and recovery data, and note sidecars (assets only).
const SKIPPED_FOLDERS = new Set(['.pisi', '.pisi-history', '.git', 'node_modules']);
const PREVIEW_LENGTH = 200;

const skipFolder = (name) => SKIPPED_FOLDERS.has(name) || (name.startsWith('inv_') && isPisiManagedSidecarFolder(name));

function makeNoteEntry(key, data) {
    const text = getNotePlainText(data.content);
    const isDiary = parentKey(key) === PISI_DIARY_FOLDER && Boolean(getPisiDiaryDateFromFileName(baseName(key)));
    return {
        id: String(data.pisi.id || ''),
        title: String(data.pisi.title || ''),
        key,
        updatedAt: String(data.pisi.updatedAt || ''),
        preview: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : text,
        text,
        kind: isDiary ? 'diary' : 'note',
        parentMap: String(data.pisi.parentMap || 'none')
    };
}

function makeMapEntry(key, data) {
    return {
        id: String(data.pisi.id || ''),
        title: String(data.pisi.title || ''),
        key,
        updatedAt: String(data.pisi.updatedAt || ''),
        // The standalone notes the map points to; its own notes are the ones in its sidecar folder (map-repo.mjs).
        references: readMapReferences(data.map)
    };
}

export function createProjectIndex({ driver, writer, onError = () => {} }) {
    const notes = new Map();
    const maps = new Map();
    const listeners = new Set();
    let built = null;

    function notify() {
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                onError(error);
            }
        }
    }

    async function load(key) {
        const ext = getPisiFileExt(key);
        if (!ext) return;
        const target = ext === '.node' ? notes : maps;
        const result = await readJsonFile(driver, key);
        if (result.status !== 'ok' || !result.data.pisi || typeof result.data.pisi !== 'object') {
            target.delete(key);
            // A document that cannot be read stays as it is on disk and is never written (V7).
            if (result.status !== 'missing') writer.markReadOnly(key, result.error || 'not a Pisi document');
            return;
        }
        target.set(key, ext === '.node' ? makeNoteEntry(key, result.data) : makeMapEntry(key, result.data));
    }

    async function walk(folder) {
        const entries = await driver.list(folder);
        // Leftovers of an interrupted write are tidied before the folder's files are read (V6).
        if (entries.some((entry) => entry.name.endsWith('.tmp'))) await writer.recoverDirectory(folder, entries);
        for (const entry of entries) {
            const key = joinKey(folder, entry.name);
            if (entry.type === 'directory') {
                if (!skipFolder(entry.name)) await walk(key);
            } else if (getPisiFileExt(entry.name) && !entry.name.startsWith('.')) {
                await load(key);
            }
        }
    }

    writer.onFileChanged((key) => {
        if (!built || !getPisiFileExt(key)) return;
        void built
            .then(() => load(key))
            .then(notify)
            .catch(onError);
    });

    return {
        /** Reads the whole project once; later calls return the same pass. `rebuild()` starts over. */
        build() {
            built ??= walk('').then(notify);
            return built;
        },

        rebuild() {
            notes.clear();
            maps.clear();
            built = null;
            return this.build();
        },

        /** Notes and diary days, most recently changed first. */
        getNotes: () => [...notes.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.key < b.key ? -1 : 1)),
        getMaps: () => [...maps.values()].sort((a, b) => a.title.localeCompare(b.title, 'tr')),
        findNoteById: (id) => [...notes.values()].find((note) => note.id === id) ?? null,
        getNote: (key) => notes.get(key) ?? null,

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}
