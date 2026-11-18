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
import { splitNoteBlocks } from '../../../shared/note-blocks.mjs';
import { applyBlockPatch, makeBlockHtml, textToBlockHtml } from './note-patch.mjs';

// Sidecar assets mobile shows: images and Paint drawings, by the content-addressed name the desktop gave them.
const ASSET_REFERENCE = /^(?:image|paint)\/[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|bmp)$/i;
// Every attachment a block can name in its sidecar: images, drawings and files (pisi-definition.md).
const ATTACHMENT_REFERENCE = /^(?:image|paint|file)\/[A-Za-z0-9._-]+$/;
const ASSET_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' });

/** The note on disk is not the one the editor read: its patch is not applied. */
export class PisiNoteChangedError extends Error {
    constructor(key) {
        super(`Note changed on disk: ${key}`);
        this.name = 'PisiNoteChangedError';
        this.code = 'NOTE_CHANGED';
        this.key = key;
    }
}

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
    const newBlockId = () => formatPisiBlockId(makeUuid());
    const newParagraph = (text) => makeBlockHtml('paragraph', newBlockId(), textToBlockHtml(text));

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
        newBlockId,

        /**
         * The project key of an attachment a note's block names (`image/<hash>.png`,
         * `file/<hash>.pdf`): inside the note's own sidecar folder, or null when
         * the reference or the sidecar is not one a note may name.
         */
        attachmentKey(key, data, reference) {
            const sidecar = String(data?.pisi?.sidecar ?? '');
            if (!ATTACHMENT_REFERENCE.test(String(reference ?? '')) || !sidecar || /[\\/]/.test(sidecar) || sidecar.startsWith('.')) return null;
            return joinKey(joinKey(parentKey(normalizeKey(key)), sidecar), reference);
        },

        /**
         * An image or Paint drawing from the note's sidecar folder as a `data:`
         * URL, or null when it cannot be shown. `data` is the note's document
         * and `reference` the asset path its block names (`image/<hash>.png`).
         * The URL is for the screen only; it is never written anywhere.
         */
        async readAsset(key, data, reference) {
            const match = ASSET_REFERENCE.exec(String(reference ?? ''));
            const sidecar = String(data?.pisi?.sidecar ?? '');
            if (!match || !sidecar || /[\\/]/.test(sidecar) || typeof driver.readBase64 !== 'function') return null;
            try {
                const base64 = await driver.readBase64(joinKey(joinKey(parentKey(normalizeKey(key)), sidecar), reference));
                return base64 ? `data:${ASSET_TYPES[match[1].toLowerCase()]};base64,${base64}` : null;
            } catch {
                return null;
            }
        },

        /**
         * Applies block operations (see applyBlockPatch) to a note. Only
         * `content` and `pisi.updatedAt` change; when the patch changes nothing,
         * the file is not written (V4). With `expectedContent` the patch is
         * applied only if the note still holds that content; positions in a
         * patch are only safe that way. Resolves with the content now on disk.
         */
        async updateContent(key, operations, { expectedContent } = {}) {
            const clean = normalizeKey(key);
            let changed = false;
            let current = '';
            await writer.update(clean, (text) => {
                const parsed = parseJsonText(text);
                if (parsed.status === 'missing') throw new Error(`Note not found: ${clean}`);
                if (parsed.status === 'corrupt' || !isNoteData(parsed.data)) {
                    writer.markReadOnly(clean, parsed.error || 'not a note');
                    throw new PisiReadOnlyError(clean, parsed.error || 'not a note');
                }
                current = String(parsed.data.content ?? '');
                if (expectedContent !== undefined && expectedContent !== current) throw new PisiNoteChangedError(clean);
                const content = applyBlockPatch(current, operations);
                if (content === current) return null;
                changed = true;
                current = content;
                return serializeDocument({ ...parsed.data, pisi: { ...parsed.data.pisi, updatedAt: now().toISOString() }, content });
            });
            return { ok: true, changed, key: clean, content: current };
        },

        /**
         * Creates a note in `folder` (the project root by default). The file is
         * `Title.node`; when that name is taken the id is appended, as on the
         * desktop. A note without a title is not created. The content is
         * `blocks` (`[{ type, text }]`, editable types) or, without them, one
         * paragraph per paragraph of `text`.
         */
        async create({ title, text = '', blocks = null, folder = '' }) {
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
                data.content = blocks
                    ? blocks.map((block) => makeBlockHtml(block.type, newBlockId(), textToBlockHtml(block.text))).join('')
                    : textToParagraphs(text).map(newParagraph).join('');
                await tx.write(key, serializeDocument(data));
                await tx.mkdir(joinKey(parentKey(key), data.pisi.sidecar));
                return { ok: true, key, id, data };
            });
        }
    };
}
