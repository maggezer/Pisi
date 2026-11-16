// Reading HTML as text, tag by tag, without building a DOM. The note modules
// use it to cut a note's content by position, so that whatever is not edited
// can be copied back as the very same characters.

const TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/** End index (exclusive) of the tag that starts at `start`, honouring quoted attribute values; -1 when unterminated. */
export function findTagEnd(html, start) {
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
export function walkTags(html, onTag) {
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

// What the desktop editor's HTML holds: the entities a browser writes, and numeric ones.
const UNKNOWN_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);)[a-z][a-z0-9]*;/i;

/** False when the text has a named entity this code would not write back the same way. */
export const hasOnlyKnownEntities = (html) => !UNKNOWN_ENTITY.test(html);
