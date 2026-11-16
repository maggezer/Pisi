// Changing a note's content block by block. A patch names the blocks it
// changes; every other slice of the content is copied as the very same
// characters (rules V4, V8). New blocks are written the way the desktop
// editor writes them (makePisiBlockHtml), so nothing mobile-specific reaches
// the file (V2).

import { PISI_EDITABLE_BLOCK_TYPES, getBlockTag, splitNoteBlocks } from './note-blocks.mjs';

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

/**
 * A new text block as the desktop writes it. `type` is one of the editable
 * types; `blockId` comes from shared/ids.mjs (`blk_<uuid>`); `indent` is the
 * nesting level of a list item.
 */
export function makeBlockHtml(type, blockId, innerHtml, { indent = 0 } = {}) {
    if (!PISI_EDITABLE_BLOCK_TYPES.includes(type)) throw new PisiBlockPatchError('UNKNOWN_BLOCK_TYPE', `Not a block type mobile writes: ${type}`);
    const tag = getBlockTag(type);
    const level = type === 'bullet' ? Math.max(0, Math.trunc(Number(indent) || 0)) : 0;
    const indentAttr = level > 0 ? ` data-pisi-bullet-indent="${level}" style="--pisi-bullet-indent:${level};"` : '';
    return `<${tag} class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="${type}"${indentAttr}>${innerHtml || '<br>'}</${tag}>`;
}

export const makeParagraphBlockHtml = (blockId, innerHtml) => makeBlockHtml('paragraph', blockId, innerHtml);

export class PisiBlockPatchError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'PisiBlockPatchError';
        this.code = code;
    }
}

const ATTRIBUTE = /\s+([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * The opening tag of a block after its type changed, as the desktop's
 * applyPisiBlockType leaves it: the new tag and type, the same id and other
 * attributes, and no list state on a block that is no longer a list item.
 */
export function retypeOpenTag(openTag, type) {
    const tag = getBlockTag(type);
    const body = openTag.replace(/^<[A-Za-z][A-Za-z0-9-]*/, '').replace(/\/?>$/, '');
    const parts = [];
    let typed = false;
    for (const [raw, name, value] of body.matchAll(ATTRIBUTE)) {
        const key = name.toLowerCase();
        if (key === 'class') parts.push(' class="pisi-editor-block"');
        else if (key === 'data-pisi-block-type') {
            parts.push(` data-pisi-block-type="${type}"`);
            typed = true;
        } else if (type !== 'bullet' && key.startsWith('data-pisi-bullet-')) continue;
        else if (type !== 'bullet' && key === 'style') {
            const style = String(value ?? '')
                .replace(/^["']|["']$/g, '')
                .replace(/--pisi-bullet-indent\s*:[^;]*;?\s*/g, '')
                .trim();
            if (style) parts.push(` style="${style}"`);
        } else parts.push(raw);
    }
    if (!typed) {
        const at = parts.findIndex((part) => /^\s+data-pisi-block-id\b/i.test(part));
        parts.splice(at + 1, 0, ` data-pisi-block-type="${type}"`);
    }
    return `<${tag}${parts.join('')}>`;
}

/**
 * Applies block operations to note HTML and returns the new HTML.
 * A block is named by its id (`blockId`), by its position among the segments
 * of `splitNoteBlocks` (`index`), or by both, which must then agree.
 * - `{ op: 'replace', blockId|index, html?, type? }`: new inner HTML and/or a new type for an editable block.
 *   Without `type` its tag and attributes stay as they are.
 * - `{ op: 'insert', afterBlockId|afterIndex, html }`: a complete new block after the named segment
 *   (`afterIndex: -1`: at the start; neither given: at the end). `afterIndex` may name any segment.
 * - `{ op: 'remove', blockId|index }`: removes an editable block.
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
    const prepended = [];
    const appended = [];

    const find = (blockId, index, mustBeEditable) => {
        const named = index === undefined || index === null ? `block ${blockId}` : `segment ${index}`;
        const segment = index === undefined || index === null ? byId.get(blockId) : segments[index];
        const matches = segment && (mustBeEditable ? segment.kind === 'element' : true) && (!blockId || index === undefined || segment.blockId === blockId);
        if (!matches) throw new PisiBlockPatchError('BLOCK_NOT_FOUND', `Block not found: ${named}`);
        if (mustBeEditable && !segment.editable) throw new PisiBlockPatchError('BLOCK_PROTECTED', `Block is not editable on mobile: ${named}`);
        return segment;
    };

    for (const operation of operations || []) {
        if (operation.op === 'replace') {
            const segment = find(operation.blockId, operation.index, true);
            const retyped = operation.type && operation.type !== segment.blockType;
            if (retyped && !PISI_EDITABLE_BLOCK_TYPES.includes(operation.type)) {
                throw new PisiBlockPatchError('UNKNOWN_BLOCK_TYPE', `Not a block type mobile writes: ${operation.type}`);
            }
            const inner = operation.html === undefined || operation.html === null ? segment.inner : String(operation.html);
            const openTag = retyped ? retypeOpenTag(segment.openTag, operation.type) : segment.openTag;
            const closeTag = retyped ? `</${getBlockTag(operation.type)}>` : segment.closeTag;
            replaced.set(segment, openTag + inner + closeTag);
        } else if (operation.op === 'remove') {
            replaced.set(find(operation.blockId, operation.index, true), '');
        } else if (operation.op === 'insert') {
            const hasIndex = operation.afterIndex !== undefined && operation.afterIndex !== null;
            const hasId = operation.afterBlockId !== undefined && operation.afterBlockId !== null;
            if (hasIndex && operation.afterIndex < 0) prepended.push(String(operation.html));
            else if (!hasIndex && !hasId) appended.push(String(operation.html));
            else {
                const anchor = find(hasId ? operation.afterBlockId : null, hasIndex ? operation.afterIndex : undefined, false);
                after.set(anchor, [...(after.get(anchor) || []), String(operation.html)]);
            }
        } else {
            throw new PisiBlockPatchError('UNKNOWN_OPERATION', `Unknown block operation: ${operation.op}`);
        }
    }

    return (
        prepended.join('') +
        segments.map((segment) => (replaced.has(segment) ? replaced.get(segment) : segment.html) + (after.get(segment) || []).join('')).join('') +
        appended.join('')
    );
}
