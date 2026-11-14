// Main-process entry for the note-to-note link rules. The rules live in
// shared/wiki-link-core.mjs, which the renderer and the mobile app use as well.
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
} from '../../shared/wiki-link-core.mjs';
