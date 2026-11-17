// The project as a whole: opening it, creating the skeleton of a new one and
// reporting which files could not be read. This is the one place the app gets
// its data layer from: `createProject({ driver, ... })` wires the writer, the
// index and the repos over any StorageDriver.

import { PISI_DIARY_FOLDER, PISI_DIARY_MARKER_FILE, PISI_DIARY_MARKER_TEXT } from '../../../shared/diary-rules.mjs';
import { createDiaryRepo } from './diary-repo.mjs';
import { joinKey } from './drivers/keys.mjs';
import { readJsonFile, serializeDocument } from './json-file.mjs';
import { createMapRepo, PISI_RELATIONSHIP_STORE_KEY } from './map-repo.mjs';
import { createNoteRepo } from './note-repo.mjs';
import { createOpenDocuments } from './open-documents.mjs';
import { createProjectIndex } from './project-index.mjs';
import { createProjectWriter } from './project-writer.mjs';
import { createSearchIndex } from './search-index.mjs';
import { createTaskRepo, PISI_TASK_STORE_KEY } from './task-repo.mjs';

export const PISI_PROPERTY_SCHEMA_KEY = '.pisi/properties.json';
const AUTHORITY_KEYS = [PISI_TASK_STORE_KEY, PISI_RELATIONSHIP_STORE_KEY, PISI_PROPERTY_SCHEMA_KEY];
// Folders mobile itself writes into; the rest of the tree is tidied while the index walks it.
const RECOVERY_FOLDERS = ['', '.pisi', PISI_DIARY_FOLDER];

export function createProject({ driver, now = () => new Date(), makeUuid, onError = () => {} }) {
    // The files screens have open with unsaved edits; outside changes wait for them (SV4).
    const documents = createOpenDocuments({ onError });
    const writer = createProjectWriter({ driver, makeToken: makeUuid, documents, onError });
    const index = createProjectIndex({ driver, writer, onError });
    const tasks = createTaskRepo({ driver, writer, now, makeUuid });
    const notes = createNoteRepo({ driver, writer, index, now, makeUuid });
    const diary = createDiaryRepo({ driver, writer, now, makeUuid });
    const maps = createMapRepo({ driver, writer, index });
    const search = createSearchIndex({ index });

    /**
     * A new project's files. The desktop has no "new project" step: a project
     * is a folder, and `.pisi/tasks.json` and `.pisi/relationships.json` appear
     * with their first record, so they are not created here either. The empty
     * property schema is what the desktop writes the first time it needs one.
     */
    async function createSkeleton() {
        const schema = { version: 1, definitions: [], conflicts: [], updatedAt: now().toISOString() };
        await writer.writeText(PISI_PROPERTY_SCHEMA_KEY, serializeDocument(schema));
        await writer.writeText(joinKey(PISI_DIARY_FOLDER, PISI_DIARY_MARKER_FILE), PISI_DIARY_MARKER_TEXT);
    }

    return {
        driver,
        writer,
        documents,
        index,
        // The id source the repos use; the developer menu's sample data takes its ids from it too.
        makeUuid,
        tasks,
        notes,
        diary,
        maps,
        search,

        /**
         * Opens the project folder. An empty folder becomes a new project;
         * anything already there is left as it is. Finishes interrupted writes
         * and checks that the authority files can be read.
         */
        async open() {
            await driver.mkdir('');
            const entries = await driver.list('');
            const created = entries.length === 0;
            if (created) await createSkeleton();
            else {
                for (const folder of RECOVERY_FOLDERS) {
                    if (folder === '' || (await driver.exists(folder))) await writer.recoverDirectory(folder);
                }
            }
            for (const key of AUTHORITY_KEYS) {
                const result = await readJsonFile(driver, key);
                if (result.status === 'corrupt') writer.markReadOnly(key, result.error);
            }
            return { ok: true, created, integrity: this.getIntegrity() };
        },

        /** Files that could not be read. They are shown to the user and never written (V7). */
        getIntegrity() {
            const readOnlyFiles = writer.getReadOnlyFiles();
            return { healthy: readOnlyFiles.length === 0, readOnlyFiles };
        },

        flush: () => writer.flush()
    };
}
