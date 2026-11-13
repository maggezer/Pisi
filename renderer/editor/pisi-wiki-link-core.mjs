// Renderer entry for the note-to-note link rules: trigger detection, menu
// items, link markup, Markdown source form and legacy title resolution. The
// rules live in shared/wiki-link-core.mjs, which the main process and the
// mobile app use as well.
export {
    PISI_WIKI_BLOCK_ID,
    PISI_WIKI_MENU_LIMIT,
    PISI_WIKI_NODE_ID,
    buildPisiWikiMenuItems,
    escapePisiWikiHtml,
    findPisiLegacyWikiLinkAt,
    getPisiWikiTrigger,
    isPisiWikiBlockId,
    isPisiWikiLinkAttributeAllowed,
    isPisiWikiNodeId,
    makePisiWikiLinkHtml,
    normalizePisiWikiTitle,
    parsePisiWikiTarget,
    replacePisiWikiLinkMarkdown,
    resolvePisiLegacyWikiTitle,
    serializePisiWikiLinkMarkdown
} from '../../shared/wiki-link-core.mjs';
