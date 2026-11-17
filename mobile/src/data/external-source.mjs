// A stand-in for "another device" in tests and debug builds (docs/sync-plan.md
// S4 step 6). It changes project files the way the sync engine (S5) will:
// first it asks the screen that has the file open to write what is waiting
// (`documents.flush`), then it reads the file and hands the new content to
// `ProjectWriter.applyExternal` with the text it started from, so a save that
// lands in between is never overwritten. `{ flush: false }` skips the first
// step, to see what happens to a file a screen still holds unsaved edits of.
// The app itself never uses this; vitest imports it and the Playwright build
// reaches it through the developer bridge (`window.pisiDeveloper.external`).

import { readTextOrNull, parseJsonText, serializeDocument } from './json-file.mjs';
import { applyBlockPatch, textToBlockHtml } from './note-patch.mjs';

export function createExternalSource(project, { now = () => new Date() } = {}) {
    const { writer, documents, driver } = project;

    async function prepare(key, flush) {
        if (flush) await documents.flush(key);
        // What the screen wrote is in the queue; it is on disk once the queue is empty.
        await writer.flush();
        return readTextOrNull(driver, key);
    }

    async function editDocument(key, change, { flush = true } = {}) {
        const expected = await prepare(key, flush);
        const parsed = parseJsonText(expected);
        if (parsed.status !== 'ok') throw new Error(`Not a readable document: ${key}`);
        const data = change(parsed.data);
        data.pisi = { ...data.pisi, updatedAt: now().toISOString() };
        return writer.applyExternal(key, serializeDocument(data), { expected });
    }

    return {
        /** Writes `text` to `key`, as a change that came from another device. */
        async put(key, text, { flush = true } = {}) {
            const expected = await prepare(key, flush);
            return writer.applyExternal(key, text, { expected });
        },

        /** Removes `key`, as a delete that came from the desktop. */
        async remove(key, { flush = true } = {}) {
            const expected = await prepare(key, flush);
            return writer.removeExternal(key, { expected });
        },

        /** Changes a document's data (`change(data)` returns the new data); `pisi.updatedAt` is set as the desktop would. */
        editDocument,

        /** Sets the text of one block of a note, as the desktop editor would. */
        setBlockText(key, blockId, text, options = {}) {
            return editDocument(
                key,
                (data) => ({ ...data, content: applyBlockPatch(data.content, [{ op: 'replace', blockId, html: textToBlockHtml(text) }]) }),
                options
            );
        },

        /** Adds a paragraph block (`html`, the whole block) at the end of a note. */
        appendBlock(key, html, options = {}) {
            return editDocument(key, (data) => ({ ...data, content: `${data.content ?? ''}${html}` }), options);
        }
    };
}
