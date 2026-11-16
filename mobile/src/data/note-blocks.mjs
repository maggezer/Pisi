// A note's `content` is desktop block HTML. This module cuts it into top-level
// segments by position, without building a DOM, so that whatever mobile does
// not edit goes back to disk as the very same characters (rule V8): a patch
// replaces the slices of the blocks it names and copies every other slice.
//
// A segment is one top-level element, one comment or one run of text between
// them. Editable segments are plain text blocks: paragraphs, headings 1–3 and
// the items of bulleted and numbered lists. Everything else is protected:
// Sheet, Paint/canvas, image, file, rollup, diary-managed, task, quote, code
// and unknown blocks. Patching is in note-patch.mjs.

import { decodeEntities, hasOnlyKnownEntities, parseTagAttributes, walkTags } from './html-tokens.mjs';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const FORMAT_TAGS = new Set(['b', 'em', 'i', 's', 'strong', 'u']);
// The block types of the desktop editor (PISI_BLOCK_TYPES) and the tag each one is written with.
const BLOCK_TAGS = Object.freeze({
    paragraph: 'div',
    heading1: 'h1',
    heading2: 'h2',
    heading3: 'h3',
    heading4: 'h4',
    heading5: 'h5',
    quote: 'blockquote',
    code: 'pre',
    bullet: 'div',
    number: 'div',
    task: 'div',
    rollup: 'div',
    image: 'div',
    file: 'div'
});
export const PISI_EDITABLE_BLOCK_TYPES = Object.freeze(['paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'number']);
// State classes the desktop keeps on a list item; they do not stop mobile from editing its text.
const LIST_STATE_CLASSES = new Set(['pisi-bullet-has-children']);
const MANAGED_START = 'PISI_DIARY_MANAGED_START';
const MANAGED_END = 'PISI_DIARY_MANAGED_END';
export function htmlToText(html) {
    return decodeEntities(
        html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, '')
    );
}

/** The tag a block of `type` is written with by the desktop editor, or null for a type it does not have. */
export const getBlockTag = (type) => BLOCK_TAGS[type] ?? null;

/** The type the desktop editor gives a block: the named one, else what its tag says (getPisiBlockType). */
function readBlockType(tag, attributes) {
    const explicit = attributes['data-pisi-block-type'];
    if (explicit) return explicit in BLOCK_TAGS ? explicit : 'unknown';
    if (/^h[1-5]$/.test(tag)) return `heading${tag.slice(1)}`;
    if (tag === 'blockquote') return 'quote';
    if (tag === 'pre') return 'code';
    return 'paragraph';
}

/**
 * Whether the inside of a text block is something mobile can edit and write
 * back: text, line breaks, bold/italic/underline/strike tags without
 * attributes, and links. A link (`<a>`, a wiki link or a web link) is kept as
 * it is, so it may carry any attribute but only text inside. A task tag, a
 * styled span or anything else the desktop manages keeps the block protected.
 */
function isPlainInline(inner) {
    if (!hasOnlyKnownEntities(inner)) return false;
    let plain = true;
    let inLink = false;
    const followed = walkTags(inner, (token) => {
        if (!plain) return;
        if (token.comment) plain = false;
        else if (token.name === 'a') {
            if (token.closing !== inLink || token.selfClosing) plain = false;
            inLink = !token.closing;
        } else if (inLink) plain = false;
        else if (token.name === 'br') plain = !token.closing;
        else if (!FORMAT_TAGS.has(token.name)) plain = false;
        else if (!token.closing && token.end - token.start !== token.name.length + 2) plain = false;
    });
    return plain && followed && !inLink;
}

function classify(segment) {
    const { attributes, tag, inner } = segment;
    const classes = new Set(
        String(attributes.class || '')
            .split(/\s+/)
            .filter(Boolean)
    );
    const isBlock = classes.has('pisi-editor-block');
    segment.blockId = attributes['data-pisi-block-id'] || null;
    segment.blockType = isBlock ? readBlockType(tag, attributes) : 'unknown';

    if (classes.has('pisi-sheet-block')) segment.blockType = 'sheet';
    else if (classes.has('pisi-canvas-block')) segment.blockType = 'canvas';
    else if (classes.has('pisi-diary-managed-block')) segment.blockType = 'diary-managed';
    else if (classes.has('pisi-image-block')) segment.blockType = 'image';
    else if (classes.has('pisi-file-block')) segment.blockType = 'file';
    else if (isBlock && (classes.has('pisi-section-break') || /^\s*<hr\s*\/?>\s*$/i.test(inner))) segment.blockType = 'divider';
    else if (isBlock && /pisi-todo-source|data-pisi-todo-status|pisi-block-task-marker/.test(inner)) segment.blockType = 'task';

    if (segment.blockType === 'image') segment.asset = /\sdata-pisi-image-asset="([^"]+)"/.exec(inner)?.[1] ?? null;
    if (segment.blockType === 'canvas') segment.asset = /\sdata-pisi-asset="([^"]+)"/.exec(inner)?.[1] ?? null;
    if (segment.blockType === 'diary-managed') segment.taskId = attributes['data-pisi-task-id'] || null;

    const ownClasses = [...classes].filter((name) => name !== 'pisi-editor-block' && !(segment.blockType === 'bullet' && LIST_STATE_CLASSES.has(name)));
    segment.editable =
        isBlock &&
        Boolean(segment.blockId) &&
        ownClasses.length === 0 &&
        PISI_EDITABLE_BLOCK_TYPES.includes(segment.blockType) &&
        tag === BLOCK_TAGS[segment.blockType] &&
        !('contenteditable' in attributes) &&
        isPlainInline(inner);
}

/**
 * In a diary note the desktop keeps a task section between two comments, and
 * the heading right above it belongs to that section. Nothing from that
 * heading to the closing comment is edited on mobile.
 */
function protectDiarySection(segments) {
    const start = segments.findIndex((segment) => segment.kind === 'comment' && segment.html.includes(MANAGED_START));
    if (start < 0) return;
    const closing = segments.findIndex((segment, index) => index > start && segment.kind === 'comment' && segment.html.includes(MANAGED_END));
    const end = closing < 0 ? segments.length : closing;
    for (let index = start; index < end; index += 1) segments[index].editable = false;
    let before = start - 1;
    while (before >= 0 && segments[before].kind === 'text' && !segments[before].html.trim()) before -= 1;
    const heading = segments[before];
    if (heading?.kind === 'element' && /^h[1-5]$/.test(heading.tag)) {
        heading.editable = false;
        heading.blockType = 'diary-heading';
    }
}

/**
 * Cuts note HTML into top-level segments. Joining `segment.html` of every
 * segment gives back `html` exactly. When the markup cannot be followed the
 * whole content is one protected segment, so nothing in it can be patched.
 *
 * @returns {Array<{ kind: 'element'|'comment'|'text', html: string, start: number, end: number, tag?: string,
 *   attributes?: Record<string, string>, openTag?: string, closeTag?: string, inner?: string, blockId?: string|null,
 *   blockType?: string, asset?: string|null, taskId?: string|null, editable: boolean }>}
 */
export function splitNoteBlocks(html) {
    const content = String(html ?? '');
    const segments = [];
    const stack = [];
    let cursor = 0;
    let current = null;
    let broken = false;

    const pushText = (end) => {
        if (end > cursor) segments.push({ kind: 'text', html: content.slice(cursor, end), start: cursor, end, editable: false });
    };

    const followed = walkTags(content, (token) => {
        if (broken) return;
        if (token.comment) {
            if (stack.length) return;
            pushText(token.start);
            segments.push({ kind: 'comment', html: content.slice(token.start, token.end), start: token.start, end: token.end, editable: false });
            cursor = token.end;
            return;
        }
        const isVoid = VOID_TAGS.has(token.name) || token.selfClosing;
        if (!token.closing) {
            if (!stack.length) {
                pushText(token.start);
                current = { start: token.start, openEnd: token.end, tag: token.name };
                cursor = token.start;
            }
            if (!isVoid) stack.push(token.name);
            else if (!stack.length) close(token.end, token.end);
            return;
        }
        if (stack.at(-1) !== token.name) {
            broken = true;
            return;
        }
        stack.pop();
        if (!stack.length) close(token.start, token.end);
    });

    function close(innerEnd, end) {
        const openTag = content.slice(current.start, current.openEnd);
        const segment = {
            kind: 'element',
            html: content.slice(current.start, end),
            start: current.start,
            end,
            tag: current.tag,
            attributes: parseTagAttributes(openTag),
            openTag,
            closeTag: content.slice(innerEnd, end),
            inner: content.slice(current.openEnd, innerEnd),
            editable: false
        };
        classify(segment);
        segments.push(segment);
        cursor = end;
        current = null;
    }

    if (!followed || broken || stack.length) {
        return content
            ? [{ kind: 'element', html: content, start: 0, end: content.length, tag: '', blockId: null, blockType: 'unknown', editable: false }]
            : [];
    }
    pushText(content.length);
    protectDiarySection(segments);
    return segments;
}

/**
 * Plain text of a note for previews and search: one line per block (G7). The
 * task section the desktop keeps in a diary note is a projection of
 * tasks.json, not note text, so it is left out.
 */
export function getNotePlainText(html) {
    const lines = [];
    let managed = false;
    for (const segment of splitNoteBlocks(html)) {
        if (segment.kind === 'comment') {
            if (segment.html.includes(MANAGED_START)) managed = true;
            else if (segment.html.includes(MANAGED_END)) managed = false;
            continue;
        }
        if (managed) continue;
        const text = htmlToText(segment.html)
            .replace(/[ \t]+/g, ' ')
            .trim();
        if (text) lines.push(text);
    }
    return lines.join('\n');
}
