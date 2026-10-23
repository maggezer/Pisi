const pasteTags = new Set(
    'A B BLOCKQUOTE BR CODE DIV EM FONT H1 H2 H3 H4 H5 H6 I IMG LI OL P PRE S SPAN STRONG SUB SUP TABLE TBODY TD TH THEAD TFOOT TR U UL SECTION ARTICLE MAIN HEADER FOOTER ASIDE DD DT DL FIGCAPTION'.split(
        ' '
    )
);
const pasteStyles = new Set(['background-color', 'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-align', 'text-decoration']);
const internalData =
    /^data-pisi-(?:block-id|block-type|task-id|tag|done-for|heading-parent|section-break|section-exit|bullet-indent|bullet-collapsed|todo-(?:checkbox|for|parent|status|repeat|order|scheduled-at|deadline|reminder-at|duration-minutes|actual-minutes|completion-offset-days))$/;

export function safePisiPasteHref(value = '') {
    const href = String(value).trim();
    return !/[\u0000-\u0020\u007f]/.test(href) && /^(?:https?:|mailto:|#)/i.test(href) ? href : '';
}

export function sanitizePisiPasteHtml(html = '', internal = false) {
    const template = document.createElement('template');
    template.innerHTML = String(html);
    template.content
        .querySelectorAll('script, style, meta, link, base, title, head, svg, math, iframe, object, embed, form, input, button, select, textarea, template')
        .forEach((el) => el.remove());
    for (let element of /** @type {HTMLElement[]} */ (Array.from(template.content.querySelectorAll('*')))) {
        if (!template.content.contains(element)) continue;
        if (['DEL', 'STRIKE', 'TT'].includes(element.tagName)) {
            const replacement = document.createElement(element.tagName === 'TT' ? 'code' : 's');
            replacement.append(...element.childNodes);
            element.replaceWith(replacement);
            element = replacement;
        }
        if (!pasteTags.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            continue;
        }
        if (element.tagName === 'IMG' && !/^(?:data:image\/(?:png|jpeg|gif|webp);base64,|\.{0,2}\/?assets\/)/i.test(element.getAttribute('src') || '')) {
            element.replaceWith(document.createTextNode(element.getAttribute('alt') || ''));
            continue;
        }
        if (/^pre/.test(element.style.whiteSpace) && element.tagName !== 'PRE') {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const texts = [];
            while (walker.nextNode()) texts.push(/** @type {Text} */ (walker.currentNode));
            for (const node of texts) {
                const lines = node.textContent.replace(/\r\n?/g, '\n').split('\n');
                if (lines.length > 1)
                    node.replaceWith(
                        ...lines.flatMap((line, index) =>
                            index ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]
                        )
                    );
            }
        }
        const style = document.createElement('span').style;
        for (const property of pasteStyles) {
            const value = element.style.getPropertyValue(property);
            if (value && !/url\s*\(|expression\s*\(|@import|[<>]/i.test(value)) style.setProperty(property, value);
        }
        const decoration = element.style.getPropertyValue('text-decoration-line');
        if (decoration && /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/.test(decoration))
            style.textDecoration = decoration;
        if (element.tagName === 'FONT') {
            if (element.getAttribute('face')) style.fontFamily = element.getAttribute('face');
            if (element.getAttribute('color')) style.color = element.getAttribute('color');
            const size = Number(element.getAttribute('size'));
            if (Number.isInteger(size) && size >= 1 && size <= 7) style.fontSize = [10, 13, 16, 18, 24, 32, 48][size - 1] + 'px';
        }
        const attrs = Array.from(element.attributes).map((attr) => [attr.name, attr.value]);
        for (const attr of Array.from(element.attributes)) element.removeAttribute(attr.name);
        for (const [name, value] of attrs) {
            if (name === 'title') element.setAttribute(name, value);
            if (element.tagName === 'A' && name === 'href' && safePisiPasteHref(value)) element.setAttribute('href', safePisiPasteHref(value));
            if (element.tagName === 'IMG' && ['src', 'alt', 'width', 'height'].includes(name)) element.setAttribute(name, value);
            if (['TD', 'TH'].includes(element.tagName) && ['rowspan', 'colspan'].includes(name) && /^\d{1,3}$/.test(value) && Number(value) > 0)
                element.setAttribute(name, value);
            if (internal && internalData.test(name)) element.setAttribute(name, value);
            if (internal && name === 'class')
                element.className = value
                    .split(/\s+/)
                    .filter((value) => /^pisi-[\w-]+$/.test(value))
                    .join(' ');
        }
        if (style.cssText) element.setAttribute('style', style.cssText);
        if (internal && element.matches('.pisi-block-task-marker, .pisi-task-metadata')) element.setAttribute('contenteditable', 'false');
    }
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement?.closest('pre')) node.nodeValue = node.nodeValue.replace(/\r?\n/g, ' ');
    }
    return template.innerHTML;
}
