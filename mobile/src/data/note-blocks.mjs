// A note's `content` is desktop block HTML. This module cuts it into top-level
// segments by position, without building a DOM, so that whatever mobile does
// not edit goes back to disk as the very same characters (rule V8): a patch
// replaces the slices of the blocks it names and copies every other slice.
//
// A segment is one top-level element, one comment or one run of text between
// them. Editable segments are plain text blocks (paragraphs for now; M7 adds
// headings and lists). Everything else is protected: Sheet, Paint/canvas,
// image, file, rollup, diary-managed, task and unknown blocks.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const INLINE_TAGS = new Set(['a', 'b', 'br', 'em', 'i', 's', 'strong', 'u']);
const EDITABLE_TYPES = new Set(['paragraph']);
const TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/** End index (exclusive) of the tag that starts at `start`, honouring quoted attribute values; -1 when unterminated. */
function findTagEnd(html, start) {
    let quote = '';
    for (let index = start + 1; index < html.length; index += 1) {
        const char = html[index];
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return index + 1;
        }
    }
    return -1;
}

export function decodeEntities(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/** Attributes of an opening tag as a plain object (values entity-decoded; valueless attributes are ''). */
export function parseTagAttributes(openTag) {
    const attributes = {};
    const body = openTag.replace(/^<[A-Za-z][A-Za-z0-9-]*/, '').replace(/\/?>$/, '');
    const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
        const name = match[1].toLowerCase();
        if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attributes;
}

/**
 * Walks the tags of `html` from `from`. Calls `onTag({ start, end, name, closing, selfClosing })`
 * for every tag and returns false when the markup cannot be followed (an
 * unterminated tag or comment).
 */
function walkTags(html, onTag) {
    let index = 0;
    while (index < html.length) {
        const open = html.indexOf('<', index);
        if (open < 0) return true;
        if (html.startsWith('<!--', open)) {
            const close = html.indexOf('-->', open + 4);
            if (close < 0) return false;
            onTag({ start: open, end: close + 3, comment: true });
            index = close + 3;
            continue;
        }
        const name = TAG_NAME.exec(html.slice(open, open + 64));
        if (!name) {
            // A lone `<` in text.
            index = open + 1;
            continue;
        }
        const end = findTagEnd(html, open);
        if (end < 0) return false;
        onTag({ start: open, end, name: name[1].toLowerCase(), closing: html[open + 1] === '/', selfClosing: html[end - 2] === '/' });
        index = end;
    }
    return true;
}

function htmlToText(html) {
    return decodeEntities(
        html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, '')
    );
}

function classify(segment) {
    const { attributes, tag, inner } = segment;
    const classes = new Set(
        String(attributes.class || '')
            .split(/\s+/)
            .filter(Boolean)
    );
    const type = attributes['data-pisi-block-type'] || (/^h[1-5]$/.test(tag) ? `heading${tag.slice(1)}` : 'paragraph');
    segment.blockId = attributes['data-pisi-block-id'] || null;
    segment.blockType = classes.has('pisi-editor-block') ? type : 'unknown';

    if (classes.has('pisi-sheet-block')) segment.blockType = 'sheet';
    else if (classes.has('pisi-canvas-block')) segment.blockType = 'canvas';
    else if (classes.has('pisi-diary-managed-block')) segment.blockType = 'diary-managed';

    let plain = tag === 'div' && classes.has('pisi-editor-block') && classes.size === 1 && Boolean(segment.blockId);
    plain &&= EDITABLE_TYPES.has(segment.blockType) && !('contenteditable' in attributes);
    if (plain) {
        // Inside an editable block only simple inline formatting may appear. A
        // task tag, a wiki link or anything else the desktop manages keeps the block protected.
        const followed = walkTags(inner, (token) => {
            if (token.comment || !INLINE_TAGS.has(token.name)) plain = false;
            else if (!token.closing && /\s(?:data-|contenteditable|class|style|id)/i.test(inner.slice(token.start, token.end))) plain = false;
        });
        plain &&= followed;
    }
    if (!plain && segment.blockType === 'paragraph' && /pisi-user-tag|pisi-todo-source/.test(inner)) segment.blockType = 'task';
    segment.editable = plain;
}

/**
 * Cuts note HTML into top-level segments. Joining `segment.html` of every
 * segment gives back `html` exactly. When the markup cannot be followed the
 * whole content is one protected segment, so nothing in it can be patched.
 *
 * @returns {Array<{ kind: 'element'|'comment'|'text', html: string, start: number, end: number, tag?: string,
 *   attributes?: Record<string, string>, openTag?: string, closeTag?: string, inner?: string, blockId?: string|null,
 *   blockType?: string, editable: boolean }>}
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
    return segments;
}

export function escapeNoteText(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Inner HTML of a text block for plain text: escaped, with line breaks as `<br>`; an empty block holds one `<br>`. */
export function textToBlockHtml(text) {
    const html = escapeNoteText(String(text ?? '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
    return html || '<br>';
}

/** A new paragraph block as the desktop writes it. `blockId` comes from shared/ids.mjs (`blk_<uuid>`). */
export function makeParagraphBlockHtml(blockId, innerHtml) {
    return `<div class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="paragraph">${innerHtml}</div>`;
}

export class PisiBlockPatchError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'PisiBlockPatchError';
        this.code = code;
    }
}

/**
 * Applies block operations to note HTML and returns the new HTML.
 * - `{ op: 'replace', blockId, html }`: new inner HTML for an editable block; its tag and attributes stay.
 * - `{ op: 'insert', afterBlockId, html }`: a complete new block after the named block (null: at the end).
 * - `{ op: 'remove', blockId }`: removes an editable block.
 * Naming a protected or missing block throws; nothing is applied partially.
 */
export function applyBlockPatch(html, operations) {
    const content = String(html ?? '');
    const segments = splitNoteBlocks(content);
    const byId = new Map();
    for (const segment of segments) {
        if (segment.kind === 'element' && segment.blockId && !byId.has(segment.blockId)) byId.set(segment.blockId, segment);
    }
    const replaced = new Map();
    const after = new Map();
    const appended = [];

    const find = (blockId, mustBeEditable) => {
        const segment = byId.get(blockId);
        if (!segment) throw new PisiBlockPatchError('BLOCK_NOT_FOUND', `Block not found: ${blockId}`);
        if (mustBeEditable && !segment.editable) throw new PisiBlockPatchError('BLOCK_PROTECTED', `Block is not editable on mobile: ${blockId}`);
        return segment;
    };

    for (const operation of operations || []) {
        if (operation.op === 'replace') {
            const segment = find(operation.blockId, true);
            replaced.set(segment, segment.openTag + String(operation.html) + segment.closeTag);
        } else if (operation.op === 'remove') {
            replaced.set(find(operation.blockId, true), '');
        } else if (operation.op === 'insert') {
            if (operation.afterBlockId === null || operation.afterBlockId === undefined) appended.push(String(operation.html));
            else {
                const anchor = find(operation.afterBlockId, false);
                after.set(anchor, [...(after.get(anchor) || []), String(operation.html)]);
            }
        } else {
            throw new PisiBlockPatchError('UNKNOWN_OPERATION', `Unknown block operation: ${operation.op}`);
        }
    }

    return (
        segments.map((segment) => (replaced.has(segment) ? replaced.get(segment) : segment.html) + (after.get(segment) || []).join('')).join('') +
        appended.join('')
    );
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
            if (segment.html.includes('PISI_DIARY_MANAGED_START')) managed = true;
            else if (segment.html.includes('PISI_DIARY_MANAGED_END')) managed = false;
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
