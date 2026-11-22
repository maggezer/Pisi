// The diary: `diary/YYYY-MM-DD.node`, one note per day (shared/diary-rules.mjs).
// Mobile edits the day's plain text. That text is the note's plain paragraph
// blocks; everything else in the note (the task section, images, formatted
// blocks) is left exactly as it is (V8). The task section is written only by
// the TaskRepo (task-days.mjs); a day this repo creates gets the section of
// its day from its first byte, as on the desktop (GV15). The managed section
// of an old desktop diary (between two comments) is kept byte for byte and
// its blocks are not diary text.
// A day's file is created when the first character is written, never empty.

import { PISI_DIARY_FOLDER, getPisiDiaryDateFromFileName, getPisiDiaryNodeKey, normalizePisiDiaryIsoDate } from '../../../shared/diary-rules.mjs';
import { formatPisiBlockId } from '../../../shared/ids.mjs';
import { createDiaryFile } from './diary-file.mjs';
import { PisiReadOnlyError, parseJsonText, readJsonFile, serializeDocument } from './json-file.mjs';
import { makeDiaryContentWithSection, readTaskRecords } from './task-days.mjs';
import { decodeEntities } from '../../../shared/html-tokens.mjs';
import { splitNoteBlocks } from '../../../shared/note-blocks.mjs';
import { applyBlockPatch, makeParagraphBlockHtml, textToBlockHtml } from './note-patch.mjs';
import { PisiNoteChangedError, textToParagraphs } from './note-repo.mjs';

// tasks.json, read for the section of a day created here (task-repo.mjs owns the file).
const TASK_STORE_KEY = '.pisi/tasks.json';
const MANAGED_START = 'PISI_DIARY_MANAGED_START';

/** Text of a paragraph that holds only text and line breaks, or null when the block is anything else. */
function plainBlockText(segment) {
    if (!segment.editable || segment.blockType !== 'paragraph' || /<(?!br\s*\/?>)/i.test(segment.inner)) return null;
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

/** The day's text as the diary field shows it: its text blocks, a blank line between them. */
function joinTextBlocks(blocks) {
    return blocks
        .map((block) => block.text)
        .join('\n\n')
        .replace(/^\n+|\n+$/g, '');
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
            const text = joinTextBlocks(blocks);
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
         * without a file creates nothing. With `expectedText` the text is
         * written only while the day still holds that text (a missing day holds
         * ''); otherwise PisiNoteChangedError is thrown and nothing is written,
         * so a change from another device is never overwritten unseen (SV3).
         * The result's `text` is the day's text on disk afterwards.
         */
        async setText(isoDate, text, { expectedText } = {}) {
            const day = normalizePisiDiaryIsoDate(isoDate);
            if (!day) throw invalidDate(isoDate);
            const key = getPisiDiaryNodeKey(day);
            const paragraphs = textToParagraphs(text);
            const written = paragraphs.join('\n\n');

            return writer.run(async (tx) => {
                const parsed = parseJsonText(await tx.read(key));
                if (parsed.status === 'corrupt' || (parsed.status === 'ok' && !parsed.data.pisi)) {
                    writer.markReadOnly(key, parsed.error || 'not a note');
                    throw new PisiReadOnlyError(key, parsed.error || 'not a note');
                }

                const onDisk = parsed.status === 'missing' ? '' : joinTextBlocks(readTextBlocks(String(parsed.data.content ?? '')).blocks);
                if (expectedText !== undefined && onDisk !== expectedText) throw new PisiNoteChangedError(key);

                if (parsed.status === 'missing') {
                    if (!paragraphs.length) return { ok: true, changed: false, created: false, key, text: '' };
                    // The day's task section comes after the text; an unreadable tasks.json gives none (GV11).
                    const records = await readTaskRecords(tx, TASK_STORE_KEY);
                    await createDiaryFile(tx, day, () => makeDiaryContentWithSection(paragraphs.map(newParagraph).join(''), day, records), { now, makeUuid });
                    return { ok: true, changed: true, created: true, key, text: written };
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
                if (next === content) return { ok: true, changed: false, created: false, key, text: written };
                await tx.write(key, serializeDocument({ ...parsed.data, pisi: { ...parsed.data.pisi, updatedAt: now().toISOString() }, content: next }));
                return { ok: true, changed: true, created: false, key, text: written };
            });
        }
    };
}
