// Pure rules for note-to-note links in the renderer: trigger detection, menu
// items, link markup, Markdown source form and legacy title resolution. The
// main process applies the same link markup and title identity in
// main/functions/wiki-link-core.js; both are covered by unit tests.

export const PISI_WIKI_NODE_ID = /^node_[A-Za-z0-9_-]{1,96}$/;
export const PISI_WIKI_BLOCK_ID = /^blk_[A-Za-z0-9_-]{1,120}$/;
export const PISI_WIKI_MENU_LIMIT = 12;
const PISI_WIKI_MAX_QUERY = 200;

export function isPisiWikiNodeId(value) {
    return PISI_WIKI_NODE_ID.test(String(value || ''));
}

export function isPisiWikiBlockId(value) {
    return PISI_WIKI_BLOCK_ID.test(String(value || ''));
}

function decodePisiWikiEntities(value) {
    return String(value || '')
        .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&');
}

export function escapePisiWikiHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Same title identity as main: legacy [[Başlık]] matches case- and spacing-insensitively. */
export function normalizePisiWikiTitle(value) {
    return decodePisiWikiEntities(value).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
}

export function parsePisiWikiTarget(raw) {
    const text = String(raw || '');
    const hash = text.indexOf('#');
    return {
        title: (hash < 0 ? text : text.slice(0, hash)).trim(),
        block: hash < 0 ? '' : text.slice(hash + 1).trim(),
        hasBlock: hash >= 0
    };
}

/**
 * Finds an open "[[query" ending at the caret. Returns null once the link is
 * closed with "]]", spans a line break or grows past 200 characters.
 */
export function getPisiWikiTrigger(textBeforeCaret) {
    const text = String(textBeforeCaret || '');
    const start = text.lastIndexOf('[[');
    if (start < 0) return null;
    const query = text.slice(start + 2);
    if (query.length > PISI_WIKI_MAX_QUERY || /[\]\n\r[]/.test(query)) return null;
    return { start, end: text.length, query, ...parsePisiWikiTarget(query) };
}

/** Finds the [[…]] text that contains `offset`, for Ctrl+click on legacy links. */
export function findPisiLegacyWikiLinkAt(text, offset) {
    for (const match of String(text || '').matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) {
        if (offset >= match.index && offset <= match.index + match[0].length) {
            return { start: match.index, end: match.index + match[0].length, raw: match[0], ...parsePisiWikiTarget(match[1]) };
        }
    }
    return null;
}

/** documents: [{ id, title, path, relativePath }]; returns every note whose title matches. */
export function resolvePisiLegacyWikiTitle(documents, title) {
    const key = normalizePisiWikiTitle(title);
    if (!key) return [];
    return (documents || []).filter((document) => normalizePisiWikiTitle(document.title) === key);
}

/**
 * Builds the suggestion list. `matches` are ranked notes ({ id, title,
 * relativePath }); a "create" item is offered whenever no note carries exactly
 * the typed title, which includes the case of no match at all.
 */
export function buildPisiWikiMenuItems({ trigger, matches = [], blocks = null, createLabel = 'Yeni not oluştur' }) {
    if (!trigger) return [];
    if (trigger.hasBlock && blocks) {
        const blockQuery = normalizePisiWikiTitle(trigger.block);
        return blocks
            .filter((block) => isPisiWikiBlockId(block.blockId) && (!blockQuery || normalizePisiWikiTitle(block.text).includes(blockQuery)))
            .slice(0, PISI_WIKI_MENU_LIMIT)
            .map((block) => ({
                kind: 'wiki-block',
                id: block.blockId,
                label: block.text,
                typedToken: `#${String(block.text || '').slice(0, 60)}`,
                description: block.kind || 'Blok',
                nodeId: block.nodeId,
                title: block.title,
                blockId: block.blockId
            }));
    }
    const items = matches
        .filter((match) => isPisiWikiNodeId(match.id))
        .slice(0, PISI_WIKI_MENU_LIMIT)
        .map((match) => ({
            kind: 'wiki-note',
            id: match.id,
            label: match.title,
            typedToken: match.title,
            description: match.relativePath || '',
            nodeId: match.id,
            title: match.title
        }));
    const title = trigger.title.trim();
    const exact = matches.some((match) => normalizePisiWikiTitle(match.title) === normalizePisiWikiTitle(title));
    if (title && !trigger.hasBlock && !exact) {
        items.push({ kind: 'wiki-create', id: `create:${title}`, label: title, typedToken: `+ ${title}`, description: createLabel, nodeId: null, title });
    }
    return items;
}

export function makePisiWikiLinkHtml({ nodeId, title, blockId = '' }) {
    if (!isPisiWikiNodeId(nodeId)) return '';
    const safeTitle = escapePisiWikiHtml(String(title || '').trim());
    const block = isPisiWikiBlockId(blockId) ? ` data-pisi-link-block="${blockId}"` : '';
    return `<a class="pisi-wiki-link" data-pisi-node-id="${nodeId}" data-pisi-node-title="${safeTitle}"${block} contenteditable="false">${safeTitle}</a>`;
}

/** Sanitizer policy for the link-only attributes on A elements. */
export function isPisiWikiLinkAttributeAllowed(name, value) {
    if (name === 'data-pisi-node-id') return isPisiWikiNodeId(value);
    if (name === 'data-pisi-link-block') return isPisiWikiBlockId(value);
    return false;
}

/** Markdown source view: [[Başlık#blk_…|node_…]]. */
export function serializePisiWikiLinkMarkdown({ nodeId, title, blockId = '' }) {
    if (!isPisiWikiNodeId(nodeId)) return `[[${String(title || '')}]]`;
    const safeTitle = String(title || '')
        .replace(/[[\]|#\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `[[${safeTitle}${isPisiWikiBlockId(blockId) ? '#' + blockId : ''}|${nodeId}]]`;
}

/** Replaces [[Başlık#blk_…|node_…]] in already HTML-escaped inline text. */
export function replacePisiWikiLinkMarkdown(escapedHtml) {
    return String(escapedHtml || '').replace(/\[\[([^\]|\n]{1,200})\|(node_[A-Za-z0-9_-]{1,96})\]\]/g, (match, target, nodeId) => {
        const parsed = parsePisiWikiTarget(decodePisiWikiEntities(target));
        if (parsed.hasBlock && !isPisiWikiBlockId(parsed.block)) return match;
        return makePisiWikiLinkHtml({ nodeId, title: parsed.title, blockId: parsed.block });
    });
}
