// Pure string rules for note-to-note links: link markup, title identity, rename
// and repair rewrites (used by the main process) and trigger detection, menu
// items and the Markdown source form (used by the renderer). main/functions/
// wiki-link-core.js and renderer/editor/pisi-wiki-link-core.mjs re-export this
// file; the mobile app imports it directly.
//
// Canonical link:  <a class="pisi-wiki-link" data-pisi-node-id="node_…"
//                     data-pisi-node-title="Başlık" [data-pisi-link-block="blk_…"]
//                     contenteditable="false">Başlık</a>
// Legacy link:     the literal text [[Başlık]] or [[Başlık#blk_…]].

const PISI_WIKI_NODE_ID = /^node_[A-Za-z0-9_-]{1,96}$/;
const PISI_WIKI_BLOCK_ID = /^blk_[A-Za-z0-9_-]{1,120}$/;
const PISI_WIKI_LEGACY_LINK = /\[\[([^\]\n]{1,200})\]\]/g;
const PISI_WIKI_SKIPPED_TAGS = new Set(['pre', 'code', 'a']);
const PISI_WIKI_MENU_LIMIT = 12;
const PISI_WIKI_MAX_QUERY = 200;

function isPisiWikiNodeId(value) {
    return PISI_WIKI_NODE_ID.test(String(value || ''));
}

function isPisiWikiBlockId(value) {
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

function escapePisiWikiHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Title identity used for legacy [[Başlık]] resolution in main and renderer. */
function normalizePisiWikiTitle(value) {
    return decodePisiWikiEntities(value).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
}

/** Splits "Başlık#blk_…" into its title and optional block id. */
function parsePisiWikiTarget(raw) {
    const text = String(raw || '');
    const hash = text.indexOf('#');
    const title = (hash < 0 ? text : text.slice(0, hash)).trim();
    const block = hash < 0 ? '' : text.slice(hash + 1).trim();
    return { title, block, hasBlock: hash >= 0 };
}

function makePisiWikiLinkHtml({ nodeId, title, blockId = '' }) {
    if (!isPisiWikiNodeId(nodeId)) return '';
    const safeTitle = escapePisiWikiHtml(String(title || '').trim());
    const block = isPisiWikiBlockId(blockId) ? ` data-pisi-link-block="${blockId}"` : '';
    return `<a class="pisi-wiki-link" data-pisi-node-id="${nodeId}" data-pisi-node-title="${safeTitle}"${block} contenteditable="false">${safeTitle}</a>`;
}

function getPisiWikiAttribute(tag, name) {
    const match = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? decodePisiWikiEntities(match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function setPisiWikiAttribute(tag, name, value) {
    const escaped = escapePisiWikiHtml(value);
    const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    if (pattern.test(tag)) return tag.replace(pattern, `$1"${escaped}"`);
    return tag.replace(/\s*(\/?)>$/, ` ${name}="${escaped}"$1>`);
}

/**
 * Walks HTML as tag/text tokens and calls onText for text that is not inside
 * pre/code/a, which is where legacy [[…]] references may appear.
 */
function mapPisiWikiHtml(html, { onTag = null, onText = null } = {}) {
    const depth = { pre: 0, code: 0, a: 0 };
    const tokens = String(html || '').match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || [];
    const output = [];
    for (const token of tokens) {
        if (token.startsWith('<')) {
            const close = token.match(/^<\/([a-z0-9]+)/i);
            const open = !close && token.match(/^<([a-z0-9]+)/i);
            const name = (close?.[1] || open?.[1] || '').toLowerCase();
            const replaced = onTag ? onTag(token, { name, opening: Boolean(open), closing: Boolean(close) }) : token;
            output.push(replaced);
            if (PISI_WIKI_SKIPPED_TAGS.has(name)) {
                if (open && !/\/>$/.test(token)) depth[name] += 1;
                else if (close) depth[name] = Math.max(0, depth[name] - 1);
            }
            continue;
        }
        const skipped = depth.pre > 0 || depth.code > 0 || depth.a > 0;
        output.push(onText ? onText(token, { skipped }) : token);
    }
    return output.join('');
}

/**
 * Rewrites one note's HTML after the note `nodeId` was renamed. Id links get
 * the new title as attribute and visible text; legacy [[Old]] text becomes
 * [[New]] only when `rewriteLegacy` is true (the old title was unambiguous).
 */
function rewritePisiWikiLinksForRename(html, { nodeId, oldTitle, newTitle, rewriteLegacy = true }) {
    let count = 0;
    let insideTarget = false;
    let wroteText = false;
    const oldKey = normalizePisiWikiTitle(oldTitle);
    const escapedNew = escapePisiWikiHtml(newTitle);
    const content = mapPisiWikiHtml(html, {
        onTag(token, { name, opening, closing }) {
            if (name === 'a' && opening && getPisiWikiAttribute(token, 'data-pisi-node-id') === nodeId) {
                insideTarget = true;
                wroteText = false;
                count += 1;
                return setPisiWikiAttribute(token, 'data-pisi-node-title', newTitle);
            }
            if (name === 'a' && closing && insideTarget) {
                insideTarget = false;
                return (wroteText ? '' : escapedNew) + token;
            }
            return token;
        },
        onText(text, { skipped }) {
            if (insideTarget) {
                if (wroteText) return '';
                wroteText = true;
                return escapedNew;
            }
            if (skipped || !rewriteLegacy || !oldKey) return text;
            return text.replace(PISI_WIKI_LEGACY_LINK, (match, inner) => {
                const target = parsePisiWikiTarget(inner);
                if (normalizePisiWikiTitle(target.title) !== oldKey) return match;
                count += 1;
                return `[[${escapedNew}${target.hasBlock ? '#' + inner.slice(inner.indexOf('#') + 1) : ''}]]`;
            });
        }
    });
    return { content, count, changed: content !== String(html || '') };
}

/**
 * Converts legacy [[Başlık]] / [[Başlık#blk_…]] text into id links when the
 * title resolves to exactly one note. resolveTitle(normalizedTitle) returns
 * { status: 'unique', nodeId, title } | { status: 'ambiguous' } | { status: 'missing' }.
 */
function repairPisiWikiLinks(html, resolveTitle) {
    const report = { converted: 0, ambiguous: 0, missing: 0, unsupported: 0 };
    const content = mapPisiWikiHtml(html, {
        onText(text, { skipped }) {
            if (skipped) return text;
            return text.replace(PISI_WIKI_LEGACY_LINK, (match, inner) => {
                const target = parsePisiWikiTarget(inner);
                if (target.hasBlock && !isPisiWikiBlockId(target.block)) {
                    report.unsupported += 1;
                    return match;
                }
                const resolved = resolveTitle(normalizePisiWikiTitle(target.title)) || { status: 'missing' };
                if (resolved.status !== 'unique') {
                    report[resolved.status === 'ambiguous' ? 'ambiguous' : 'missing'] += 1;
                    return match;
                }
                report.converted += 1;
                return makePisiWikiLinkHtml({ nodeId: resolved.nodeId, title: resolved.title, blockId: target.block });
            });
        }
    });
    return { content, ...report, changed: content !== String(html || '') };
}

/**
 * Finds an open "[[query" ending at the caret. Returns null once the link is
 * closed with "]]", spans a line break or grows past 200 characters.
 */
function getPisiWikiTrigger(textBeforeCaret) {
    const text = String(textBeforeCaret || '');
    const start = text.lastIndexOf('[[');
    if (start < 0) return null;
    const query = text.slice(start + 2);
    if (query.length > PISI_WIKI_MAX_QUERY || /[\]\n\r[]/.test(query)) return null;
    return { start, end: text.length, query, ...parsePisiWikiTarget(query) };
}

/** Finds the [[…]] text that contains `offset`, for Ctrl+click on legacy links. */
function findPisiLegacyWikiLinkAt(text, offset) {
    for (const match of String(text || '').matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) {
        if (offset >= match.index && offset <= match.index + match[0].length) {
            return { start: match.index, end: match.index + match[0].length, raw: match[0], ...parsePisiWikiTarget(match[1]) };
        }
    }
    return null;
}

/** documents: [{ id, title, path, relativePath }]; returns every note whose title matches. */
function resolvePisiLegacyWikiTitle(documents, title) {
    const key = normalizePisiWikiTitle(title);
    if (!key) return [];
    return (documents || []).filter((document) => normalizePisiWikiTitle(document.title) === key);
}

/**
 * Builds the suggestion list. `matches` are ranked notes ({ id, title,
 * relativePath }); a "create" item is offered whenever no note carries exactly
 * the typed title, which includes the case of no match at all.
 */
function buildPisiWikiMenuItems({ trigger, matches = [], blocks = null, createLabel = 'Yeni not oluştur' }) {
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

/** Sanitizer policy for the link-only attributes on A elements. */
function isPisiWikiLinkAttributeAllowed(name, value) {
    if (name === 'data-pisi-node-id') return isPisiWikiNodeId(value);
    if (name === 'data-pisi-link-block') return isPisiWikiBlockId(value);
    return false;
}

/** Markdown source view: [[Başlık#blk_…|node_…]]. */
function serializePisiWikiLinkMarkdown({ nodeId, title, blockId = '' }) {
    if (!isPisiWikiNodeId(nodeId)) return `[[${String(title || '')}]]`;
    const safeTitle = String(title || '')
        .replace(/[[\]|#\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `[[${safeTitle}${isPisiWikiBlockId(blockId) ? '#' + blockId : ''}|${nodeId}]]`;
}

/** Replaces [[Başlık#blk_…|node_…]] in already HTML-escaped inline text. */
function replacePisiWikiLinkMarkdown(escapedHtml) {
    return String(escapedHtml || '').replace(/\[\[([^\]|\n]{1,200})\|(node_[A-Za-z0-9_-]{1,96})\]\]/g, (match, target, nodeId) => {
        const parsed = parsePisiWikiTarget(decodePisiWikiEntities(target));
        if (parsed.hasBlock && !isPisiWikiBlockId(parsed.block)) return match;
        return makePisiWikiLinkHtml({ nodeId, title: parsed.title, blockId: parsed.block });
    });
}

export {
    PISI_WIKI_BLOCK_ID,
    PISI_WIKI_LEGACY_LINK,
    PISI_WIKI_MENU_LIMIT,
    PISI_WIKI_NODE_ID,
    buildPisiWikiMenuItems,
    decodePisiWikiEntities,
    escapePisiWikiHtml,
    findPisiLegacyWikiLinkAt,
    getPisiWikiTrigger,
    isPisiWikiBlockId,
    isPisiWikiLinkAttributeAllowed,
    isPisiWikiNodeId,
    makePisiWikiLinkHtml,
    mapPisiWikiHtml,
    normalizePisiWikiTitle,
    parsePisiWikiTarget,
    repairPisiWikiLinks,
    replacePisiWikiLinkMarkdown,
    resolvePisiLegacyWikiTitle,
    rewritePisiWikiLinksForRename,
    serializePisiWikiLinkMarkdown
};
