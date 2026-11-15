// The diary: `diary/YYYY-MM-DD.node`, one note per day (shared/diary-rules.mjs).
// Mobile edits the day's plain text. That text is the note's plain paragraph
// blocks; everything else in the note (the task section the desktop manages,
// images, formatted blocks) is left exactly as it is (V8).
// A day's file is created when the first character is written, never empty.

import {
    PISI_DIARY_FOLDER,
    PISI_DIARY_MARKER_FILE,
    PISI_DIARY_MARKER_TEXT,
    getPisiDiaryDateFromFileName,
    getPisiDiaryNodeKey,
    makePisiDiaryDocumentData,
    normalizePisiDiaryIsoDate
} from '../../../shared/diary-rules.mjs';
import { formatPisiBlockId, formatPisiDocumentId } from '../../../shared/ids.mjs';
import { joinKey } from './drivers/keys.mjs';
import { PisiReadOnlyError, parseJsonText, readJsonFile, serializeDocument } from './json-file.mjs';
import { applyBlockPatch, decodeEntities, makeParagraphBlockHtml, splitNoteBlocks, textToBlockHtml } from './note-blocks.mjs';
import { textToParagraphs } from './note-repo.mjs';

const MARKER_KEY = joinKey(PISI_DIARY_FOLDER, PISI_DIARY_MARKER_FILE);
const MANAGED_START = 'PISI_DIARY_MANAGED_START';

/** Text of a block that holds only text and line breaks, or null when it holds anything else. */
function plainBlockText(segment) {
    if (!segment.editable || /<(?!br\s*\/?>)/i.test(segment.inner)) return null;
    return decodeEntities(segment.inner.replace(/<br\s*\/?>/gi, '\n')).replace(/\n+$/, '');
}

/** The blocks mobile edits as diary text: plain paragraphs above the desktop's managed task section. */
function readTextBlocks(content) {
    const segments = splitNoteBlocks(content);
    const managedAt = segments.findIndex((segment) => segment.kind === 'comment' && segment.html.includes(MANAGED_START));
    const own = managedAt < 0 ? segments : segments.slice(0, managedAt);
    const blocks = own
        .map((segment) => ({ segment, text: segment.kind === 'element' ? plainBlockText(segment) : null }))
        .filter((block) => block.text !== null);
    const other = segments.filter((segment) => segment.kind === 'element' && !blocks.some((block) => block.segment === segment)).length;
    return { blocks, otherBlocks: other };
}

export function createDiaryRepo({ driver, writer, now, makeUuid }) {
    const newParagraph = (text) => makeParagraphBlockHtml(formatPisiBlockId(makeUuid()), textToBlockHtml(text));

    function invalidDate(isoDate) {
        return new Error(`Invalid diary date: ${isoDate}`);
    }

    return {
        /** The day's text. `exists` is false when the day has no file yet; `otherBlocks` counts what only the desktop edits. */
        async read(isoDate) {
            const day = normalizePisiDiaryIsoDate(isoDate);
            if (!day) throw invalidDate(isoDate);
            const key = getPisiDiaryNodeKey(day);
            const result = await readJsonFile(driver, key);
            if (result.status === 'missing') return { ok: true, exists: false, key, isoDate: day, text: '', otherBlocks: 0, readOnly: false };
            if (result.status === 'corrupt' || !result.data.pisi) {
                writer.markReadOnly(key, result.error || 'not a note');
                return { ok: false, corrupt: true, readOnly: true, exists: true, key, isoDate: day, text: '', otherBlocks: 0, error: result.error };
            }
            const { blocks, otherBlocks } = readTextBlocks(result.data.content);
            const text = blocks
                .map((block) => block.text)
                .join('\n\n')
                .replace(/^\n+|\n+$/g, '');
            return { ok: true, exists: true, key, isoDate: day, data: result.data, text, otherBlocks, readOnly: false };
        },

        /** Days that have a diary file, as `YYYY-MM-DD`, oldest first. */
        async listDates() {
            const entries = await driver.list(PISI_DIARY_FOLDER).catch((error) => {
                if (error?.code === 'NOT_FOUND') return [];
                throw error;
            });
            return entries
                .map((entry) => (entry.type === 'file' ? getPisiDiaryDateFromFileName(entry.name) : null))
                .filter(Boolean)
                .sort();
        },

        /**
         * Sets the day's text. Paragraphs are separated by a blank line. Writing
         * the text the day already has changes nothing; empty text for a day
         * without a file creates nothing.
         */
        async setText(isoDate, text) {
            const day = normalizePisiDiaryIsoDate(isoDate);
            if (!day) throw invalidDate(isoDate);
            const key = getPisiDiaryNodeKey(day);
            const paragraphs = textToParagraphs(text);

            return writer.run(async (tx) => {
                const parsed = parseJsonText(await tx.read(key));
                if (parsed.status === 'corrupt' || (parsed.status === 'ok' && !parsed.data.pisi)) {
                    writer.markReadOnly(key, parsed.error || 'not a note');
                    throw new PisiReadOnlyError(key, parsed.error || 'not a note');
                }

                if (parsed.status === 'missing') {
                    if (!paragraphs.length) return { ok: true, changed: false, created: false, key };
                    await tx.mkdir(PISI_DIARY_FOLDER);
                    if (!(await tx.exists(MARKER_KEY))) await tx.write(MARKER_KEY, PISI_DIARY_MARKER_TEXT);
                    const stamp = now().toISOString();
                    const data = makePisiDiaryDocumentData({ isoDate: day, id: formatPisiDocumentId('.node', makeUuid()), now: stamp });
                    data.content = paragraphs.map(newParagraph).join('');
                    await tx.write(key, serializeDocument(data));
                    await tx.mkdir(joinKey(PISI_DIARY_FOLDER, data.pisi.sidecar));
                    return { ok: true, changed: true, created: true, key };
                }

                const content = String(parsed.data.content ?? '');
                const { blocks } = readTextBlocks(content);
                const operations = [];
                blocks.forEach((block, position) => {
                    if (position >= paragraphs.length) operations.push({ op: 'remove', blockId: block.segment.blockId });
                    else if (block.text !== paragraphs[position]) {
                        operations.push({ op: 'replace', blockId: block.segment.blockId, html: textToBlockHtml(paragraphs[position]) });
                    }
                });
                const added = paragraphs.slice(blocks.length).map(newParagraph).join('');
                let next = applyBlockPatch(content, operations);
                if (added) {
                    // New paragraphs follow the last text block; a day without one gets them at the top.
                    const anchor = blocks.length ? splitNoteBlocks(next).find((segment) => segment.blockId === blocks.at(-1).segment.blockId) : null;
                    const at = anchor ? anchor.end : 0;
                    next = next.slice(0, at) + added + next.slice(at);
                }
                if (next === content) return { ok: true, changed: false, created: false, key };
                await tx.write(key, serializeDocument({ ...parsed.data, pisi: { ...parsed.data.pisi, updatedAt: now().toISOString() }, content: next }));
                return { ok: true, changed: true, created: false, key };
            });
        }
    };
}
