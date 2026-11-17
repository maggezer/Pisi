// The inside of a text block as a small tree, so that the editor can show it
// and write it back without the browser's own serializer deciding what goes
// to disk (rule V2). A tree holds text, line breaks, formatting (bold, italic,
// underline, strike) and links. A link keeps the exact HTML it was read with:
// mobile shows it and moves it around but never rewrites it.

import { parseTagAttributes, walkTags } from '../../../shared/html-tokens.mjs';

export const PISI_INLINE_FORMAT_TAGS = Object.freeze(['b', 'em', 'i', 's', 'strong', 'u']);
const NAMED = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

/** Text as the browser would show it. Unlike `decodeEntities`, a no-break space stays a no-break space. */
export function decodeInlineText(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
        if (name[0] !== '#') return NAMED[name.toLowerCase()] ?? entity;
        const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/** Text as the desktop editor's HTML holds it (what `innerHTML` writes). */
export function escapeInlineText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

/**
 * Reads inline HTML into nodes:
 * `{ type: 'text', text }`, `{ type: 'br' }`, `{ type: 'format', tag, children }` and
 * `{ type: 'link', html, text, attributes }`.
 * Tags it does not know are dropped and what they hold is kept, so the text of
 * any block can be shown; only blocks shared/note-blocks.mjs calls editable are written back.
 */
export function parseInlineHtml(html) {
    const source = String(html ?? '');
    const root = [];
    const stack = [{ tag: null, children: root }];
    let cursor = 0;
    let link = null;

    const pushText = (end) => {
        if (end > cursor) stack.at(-1).children.push({ type: 'text', text: decodeInlineText(source.slice(cursor, end)) });
    };

    walkTags(source, (token) => {
        if (link) {
            if (token.name !== 'a' || !token.closing) return;
            const inner = source.slice(link.openEnd, token.start).replace(/<[^>]*>/g, '');
            stack.at(-1).children.push({
                type: 'link',
                html: source.slice(link.start, token.end),
                text: decodeInlineText(inner),
                attributes: parseTagAttributes(source.slice(link.start, link.openEnd))
            });
            link = null;
            cursor = token.end;
            return;
        }
        pushText(token.start);
        cursor = token.end;
        if (token.comment) return;
        if (token.name === 'a') {
            if (!token.closing) link = { start: token.start, openEnd: token.end };
        } else if (token.name === 'br') {
            if (!token.closing) stack.at(-1).children.push({ type: 'br' });
        } else if (PISI_INLINE_FORMAT_TAGS.includes(token.name)) {
            if (!token.closing) {
                const node = { type: 'format', tag: token.name, children: [] };
                stack.at(-1).children.push(node);
                stack.push(node);
            } else if (stack.at(-1).tag === token.name) stack.pop();
        }
    });
    // A link that never closes is shown as its text.
    if (link) cursor = link.openEnd;
    stack.length = Math.max(stack.length, 1);
    if (cursor < source.length) stack.at(-1).children.push({ type: 'text', text: decodeInlineText(source.slice(cursor).replace(/<[^>]*>/g, '')) });
    return root;
}

function write(nodes) {
    return nodes
        .map((node) => {
            if (node.type === 'text') return escapeInlineText(node.text);
            if (node.type === 'br') return '<br>';
            if (node.type === 'link') return node.html;
            const inner = PISI_INLINE_FORMAT_TAGS.includes(node.tag) ? write(node.children) : '';
            return inner ? `<${node.tag}>${inner}</${node.tag}>` : '';
        })
        .join('');
}

/** Inner HTML of a text block for the nodes. An empty block holds one `<br>`, as on the desktop. */
export function inlineToHtml(nodes) {
    const html = write(nodes);
    return html && html !== '<br>' ? html : '<br>';
}

/** The nodes as plain text; a line break is a new line. */
export function inlineToText(nodes) {
    return nodes.map((node) => (node.type === 'br' ? '\n' : node.type === 'format' ? inlineToText(node.children) : node.text)).join('');
}
