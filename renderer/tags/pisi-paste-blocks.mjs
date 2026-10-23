import { sanitizePisiPasteHtml } from './pisi-paste-sanitize.mjs';
import { parsePisiPlainPaste } from './pisi-paste-plain.mjs';

const blockTags = new Set('DIV P SECTION ARTICLE MAIN HEADER FOOTER ASIDE BLOCKQUOTE PRE UL OL LI H1 H2 H3 H4 H5 H6 DD DT DL FIGCAPTION TABLE'.split(' '));
const internalTypes = /^(?:paragraph|heading[1-5]|quote|code|bullet|number|task)$/;

export function isPisiInternalPaste(html = '') {
    const template = document.createElement('template');
    template.innerHTML = html;
    return Boolean(template.content.querySelector('.pisi-editor-block[data-pisi-block-id][data-pisi-block-type]'));
}

function resolvePisiPastedBlockMeta(element, internal) {
    const base = { tag: 'div', type: 'paragraph', indent: 0, attributes: {} };
    if (internal && internalTypes.test(element.dataset.pisiBlockType || '')) {
        base.type = element.dataset.pisiBlockType;
        base.indent = Math.min(6, Math.max(0, Number(element.dataset.pisiBulletIndent) || 0));
        base.attributes = Object.fromEntries(
            Array.from(element.attributes)
                .filter((attr) => attr.name.startsWith('data-pisi-'))
                .map((attr) => [attr.name, attr.value])
        );
    } else if (/^H[1-6]$/.test(element.tagName)) base.type = 'heading' + Math.min(5, Number(element.tagName.slice(1)));
    else if (element.tagName === 'BLOCKQUOTE') base.type = 'quote';
    else if (element.tagName === 'PRE') base.type = 'code';
    else if (element.tagName === 'LI') {
        base.type = element.parentElement?.tagName === 'OL' ? 'number' : 'bullet';
        let depth = 0;
        for (let curr = element.parentElement; curr; curr = curr.parentElement) if (['UL', 'OL'].includes(curr.tagName)) depth += 1;
        base.indent = base.type === 'bullet' ? Math.min(6, Math.max(0, depth - 1)) : 0;
    }
    base.tag = base.type.startsWith('heading') ? 'h' + base.type.slice(-1) : base.type === 'code' ? 'pre' : base.type === 'quote' ? 'blockquote' : 'div';
    return { ...base, style: element.getAttribute('style') || '' };
}

function preText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeName === 'BR') return '\n';
    return Array.from(node.childNodes).map(preText).join('');
}

export function extractPisiPasteBlocks(html = '', plain = '') {
    const plainBlocks = () => parsePisiPlainPaste(plain).map((item) => (item.html ? { ...item, html: sanitizePisiPasteHtml(item.html) } : item));
    if (!String(html).trim()) return plainBlocks();
    const internal = isPisiInternalPaste(html);
    const template = document.createElement('template');
    template.innerHTML =
        internal && typeof window.sanitizePisiEditorHtml === 'function' ? window.sanitizePisiEditorHtml(html) : sanitizePisiPasteHtml(html, internal);
    const blocks = [];
    const base = { tag: 'div', type: 'paragraph', indent: 0, attributes: {} };
    const emit = (nodes, meta, explicit = false) => {
        const wrapper = document.createElement('div');
        nodes.forEach((node) => wrapper.appendChild(node.cloneNode(true)));
        if (!explicit && !wrapper.textContent.trim() && !wrapper.querySelector('br, img, table')) return;
        blocks.push(meta.type === 'code' ? { ...meta, text: preText(wrapper).replace(/\r\n?/g, '\n') } : { ...meta, html: wrapper.innerHTML });
    };
    const walk = (container, inherited = base) => {
        let buffer = [];
        const flush = () => {
            if (buffer.length) emit(buffer, inherited);
            buffer = [];
        };
        for (const child of Array.from(container.childNodes)) {
            if (child.nodeType !== Node.ELEMENT_NODE || !blockTags.has(child.tagName)) {
                buffer.push(child);
                continue;
            }
            flush();
            if (internal && child.matches('.pisi-sheet-block, .pisi-canvas-block, [data-pisi-rollup-relation]')) {
                blocks.push({ ...base, composite: true, html: child.outerHTML });
                continue;
            }
            if (child.tagName === 'TABLE') {
                emit([child], base, true);
                continue;
            }
            const meta = resolvePisiPastedBlockMeta(child, internal);
            if (meta.type === 'code') {
                emit(Array.from(child.childNodes), meta, true);
                continue;
            }
            const nested = Array.from(child.children).some((el) => blockTags.has(el.tagName));
            if (nested || ['UL', 'OL', 'DL'].includes(child.tagName)) walk(child, ['UL', 'OL', 'DL'].includes(child.tagName) ? inherited : meta);
            else emit(Array.from(child.childNodes), meta, true);
        }
        flush();
    };
    walk(template.content);
    return blocks.length ? blocks : plainBlocks();
}
