// The inside of a text block on screen. The tree of data/note-inline.mjs is
// turned into DOM nodes for the editor, and what the user leaves in the block
// is read back into a tree. Reading keeps only what a note may hold: text,
// line breaks, bold/italic/underline/strike and the links that were there.
// Whatever else the browser or the keyboard put in is dropped, so nothing of
// the screen's own markup can reach the file (rule V2).

import { PISI_INLINE_FORMAT_TAGS } from '../../data/note-inline.mjs';

// A link element on screen and the link node it was built from.
const links = new WeakMap();
const FORMAT_OF_TAG = Object.freeze({ B: 'b', STRONG: 'strong', I: 'i', EM: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's' });
const LINE_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

export const getLinkNode = (element) => links.get(element) ?? null;

/** DOM nodes for inline nodes. A link is one unit: it can be deleted or tapped, not typed in. */
export function buildInlineDom(nodes, document) {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
        if (node.type === 'text') fragment.append(document.createTextNode(node.text));
        else if (node.type === 'br') fragment.append(document.createElement('br'));
        else if (node.type === 'link') {
            const link = document.createElement('a');
            link.className = 'pisi-note-link';
            link.setAttribute('contenteditable', 'false');
            link.setAttribute('role', 'link');
            link.setAttribute('tabindex', '0');
            if (node.attributes['data-pisi-node-id']) link.dataset.wiki = node.attributes['data-pisi-node-id'];
            link.textContent = node.text;
            links.set(link, node);
            fragment.append(link);
        } else if (PISI_INLINE_FORMAT_TAGS.includes(node.tag)) {
            const element = document.createElement(node.tag);
            element.append(buildInlineDom(node.children, document));
            fragment.append(element);
        }
    }
    return fragment;
}

function readChildren(parent, out) {
    for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
            // A browser may leave a zero-width space where the caret was.
            const text = child.nodeValue.replace(/​/g, '');
            if (!text) continue;
            if (out.at(-1)?.type === 'text') out.at(-1).text += text;
            else out.push({ type: 'text', text });
            continue;
        }
        if (child.nodeType !== 1) continue;
        const link = links.get(child);
        if (link) out.push(link);
        else if (child.tagName === 'BR') out.push({ type: 'br' });
        else if (FORMAT_OF_TAG[child.tagName]) {
            const node = { type: 'format', tag: FORMAT_OF_TAG[child.tagName], children: [] };
            readChildren(child, node.children);
            if (node.children.length) out.push(node);
        } else {
            // Anything else gives its content; a block the browser made starts a new line.
            if (LINE_TAGS.has(child.tagName) && out.length && out.at(-1).type !== 'br') out.push({ type: 'br' });
            readChildren(child, out);
        }
    }
}

/** The inline nodes an element holds now. */
export function readInlineDom(element) {
    const nodes = [];
    readChildren(element, nodes);
    return nodes;
}
