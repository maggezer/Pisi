// Pure string rules for note-to-note links. No filesystem or Electron access,
// so every rule is unit-tested directly. The renderer keeps the matching
// display/format rules in renderer/editor/pisi-wiki-link-core.mjs.
//
// Canonical link:  <a class="pisi-wiki-link" data-pisi-node-id="node_…"
//                     data-pisi-node-title="Başlık" [data-pisi-link-block="blk_…"]
//                     contenteditable="false">Başlık</a>
// Legacy link:     the literal text [[Başlık]] or [[Başlık#blk_…]].

const PISI_WIKI_NODE_ID = /^node_[A-Za-z0-9_-]{1,96}$/;
const PISI_WIKI_BLOCK_ID = /^blk_[A-Za-z0-9_-]{1,120}$/;
const PISI_WIKI_LEGACY_LINK = /\[\[([^\]\n]{1,200})\]\]/g;
const PISI_WIKI_SKIPPED_TAGS = new Set(['pre', 'code', 'a']);

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

export {
    PISI_WIKI_LEGACY_LINK,
    decodePisiWikiEntities,
    escapePisiWikiHtml,
    isPisiWikiBlockId,
    isPisiWikiNodeId,
    makePisiWikiLinkHtml,
    mapPisiWikiHtml,
    normalizePisiWikiTitle,
    parsePisiWikiTarget,
    repairPisiWikiLinks,
    rewritePisiWikiLinksForRename
};
