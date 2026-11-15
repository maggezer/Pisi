// Notes (.node files). Reading goes through the project index for lists and
// straight to the file for one note. Writing changes only what was asked:
// `updateContent` patches blocks inside `content` and leaves every other field
// of the document as it was read (V3, V8); `create` writes a new document with
// the naming, sidecar and id rules of shared/.

import { makePisiDocumentData } from '../../../shared/document-model.mjs';
import { getPisiPhysicalFileName, sanitizePisiBaseName } from '../../../shared/document-naming.mjs';
import { formatPisiBlockId, formatPisiDocumentId } from '../../../shared/ids.mjs';
import { joinKey, normalizeKey, parentKey } from './drivers/keys.mjs';
import { PisiReadOnlyError, parseJsonText, readJsonFile, serializeDocument } from './json-file.mjs';
import { applyBlockPatch, makeParagraphBlockHtml, splitNoteBlocks, textToBlockHtml } from './note-blocks.mjs';

const isNoteData = (data) => Boolean(data?.pisi && typeof data.pisi === 'object' && data.pisi.type === 'node');

/** One paragraph block per blank-line-separated paragraph; a single line break stays inside its block (the desktop rule). */
export function textToParagraphs(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
        .filter((paragraph) => paragraph.trim());
}

export function createNoteRepo({ driver, writer, index, now, makeUuid }) {
    const newParagraph = (text) => makeParagraphBlockHtml(formatPisiBlockId(makeUuid()), textToBlockHtml(text));

    return {
        list: () => index.getNotes(),

        /** One note: its document data and its content cut into blocks. */
        async read(key) {
            const clean = normalizeKey(key);
            const result = await readJsonFile(driver, clean);
            if (result.status === 'missing') return { ok: false, missing: true, key: clean };
            if (result.status === 'corrupt' || !isNoteData(result.data)) {
                writer.markReadOnly(clean, result.error || 'not a note');
                return { ok: false, corrupt: true, readOnly: true, key: clean, error: result.error || 'not a note' };
            }
            return { ok: true, key: clean, data: result.data, blocks: splitNoteBlocks(result.data.content), readOnly: writer.isReadOnly(clean) };
        },

        newParagraph,

        /**
         * Applies block operations (see applyBlockPatch) to a note. Only
         * `content` and `pisi.updatedAt` change; when the patch changes nothing,
         * the file is not written (V4).
         */
        async updateContent(key, operations) {
            const clean = normalizeKey(key);
            let changed = false;
            await writer.update(clean, (text) => {
                const parsed = parseJsonText(text);
                if (parsed.status === 'missing') throw new Error(`Note not found: ${clean}`);
                if (parsed.status === 'corrupt' || !isNoteData(parsed.data)) {
                    writer.markReadOnly(clean, parsed.error || 'not a note');
                    throw new PisiReadOnlyError(clean, parsed.error || 'not a note');
                }
                const content = applyBlockPatch(parsed.data.content, operations);
                if (content === String(parsed.data.content ?? '')) return null;
                changed = true;
                return serializeDocument({ ...parsed.data, pisi: { ...parsed.data.pisi, updatedAt: now().toISOString() }, content });
            });
            return { ok: true, changed, key: clean };
        },

        /**
         * Creates a note in `folder` (the project root by default). The file is
         * `Title.node`; when that name is taken the id is appended, as on the
         * desktop. A note without a title is not created.
         */
        async create({ title, text = '', folder = '' }) {
            const wanted = String(title ?? '').trim();
            if (!wanted) return { ok: false, error: 'empty-title' };
            const parent = normalizeKey(folder);
            const id = formatPisiDocumentId('.node', makeUuid());
            const cleanTitle = sanitizePisiBaseName(wanted);
            return writer.run(async (tx) => {
                let key = '';
                for (let attempt = 0; ; attempt += 1) {
                    key = joinKey(parent, getPisiPhysicalFileName(cleanTitle, '.node', id, attempt));
                    if (!(await tx.exists(key))) break;
                }
                const data = makePisiDocumentData({ ext: '.node', title: cleanTitle, id, parentMap: 'none', now: now().toISOString() });
                data.content = textToParagraphs(text).map(newParagraph).join('');
                await tx.write(key, serializeDocument(data));
                await tx.mkdir(joinKey(parentKey(key), data.pisi.sidecar));
                return { ok: true, key, id, data };
            });
        }
    };
}
