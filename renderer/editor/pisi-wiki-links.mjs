import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { isPisiEditorComposing } from './pisi-editor-input-policy.mjs';
import { pisiSearchPathKey, searchPisiIndex } from '../search/pisi-search-core.mjs';
import {
    PISI_WIKI_MENU_LIMIT,
    buildPisiWikiMenuItems,
    findPisiLegacyWikiLinkAt,
    getPisiWikiTrigger,
    isPisiWikiBlockId,
    isPisiWikiNodeId,
    makePisiWikiLinkHtml,
    normalizePisiWikiTitle,
    parsePisiWikiTarget,
    resolvePisiLegacyWikiTitle
} from './pisi-wiki-link-core.mjs';

// Note-to-note links. "[[" opens a suggestion list in the shared tag menu (its
// keyboard ownership already handles arrows, Enter/Tab and Escape and skips IME
// composition). A chosen note is stored as an id link that survives renames.
// Ctrl/Cmd+click follows a link in an editable note; read-only surfaces follow
// it on a plain click. Legacy [[Başlık]] text stays as written, is highlighted
// without touching the DOM and is resolved by title when followed.

const PISI_WIKI_LINK_SELECTOR = 'a.pisi-wiki-link[data-pisi-node-id]';
const PISI_WIKI_SKIPPED_TEXT = 'a, pre, code, .pisi-task-metadata, [contenteditable="false"]';
const pisiWikiState = { editor: null, request: 0, highlightTimer: 0, chooser: null, initialized: false };

function pisiWikiTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function isPisiWikiMacPlatform() {
    return /mac|iphone|ipad|ipod/i.test(String(navigator.userAgentData?.platform || navigator.platform || ''));
}

function getPisiWikiEditor(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.('.pisi-rich-editor') || null;
}

function getPisiWikiEditorNodePath(editor) {
    if (editor?.id === 'node-modal-content') return window.activeModalNode?.path || null;
    if (editor?.id === 'center-node-editor-content') return window.activeCenterNode?.path || null;
    return null;
}

function getPisiWikiCaretContext(editor) {
    const selection = window.getSelection?.();
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    let block = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (!block || block === editor) return null;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    return { block, textBefore: before.toString() };
}

function makePisiWikiRangeFromOffsets(block, start, end) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const length = node.nodeValue.length;
        if (!started && start <= offset + length) {
            range.setStart(node, start - offset);
            started = true;
        }
        if (started && end <= offset + length) {
            range.setEnd(node, end - offset);
            return range;
        }
        offset += length;
    }
    return null;
}

async function getPisiWikiIndex() {
    return (await window.ensurePisiSearchIndex?.()) || null;
}

function getPisiWikiDocuments(index) {
    const documents = index?.documents instanceof Map ? Array.from(index.documents.values()) : [];
    return documents
        .map((document) => ({
            id: document.metadata?.id || null,
            title: document.title,
            path: document.path,
            relativePath: document.relativePath,
            nodeItem: document.nodeItem,
            contentBlocks: document.contentBlocks || []
        }))
        .filter((document) => isPisiWikiNodeId(document.id));
}

function rankPisiWikiMatches(index, documents, title, currentPath) {
    const currentKey = currentPath ? pisiSearchPathKey(currentPath) : '';
    const byPath = new Map(documents.map((document) => [pisiSearchPathKey(document.path), document]));
    const others = (document) => pisiSearchPathKey(document.path) !== currentKey;
    if (!title.trim()) {
        return documents
            .filter(others)
            .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
            .slice(0, PISI_WIKI_MENU_LIMIT);
    }
    const ranked = [];
    for (const record of searchPisiIndex(index, title, { limit: 60 })) {
        if (record.kind !== 'node') continue;
        const document = byPath.get(pisiSearchPathKey(record.nodePath));
        if (document && others(document) && !ranked.includes(document)) ranked.push(document);
    }
    // Exact title owners always lead, even if fuzzy scoring placed them lower.
    const exact = resolvePisiLegacyWikiTitle(documents, title).filter(others);
    return [...exact, ...ranked.filter((document) => !exact.includes(document))].slice(0, PISI_WIKI_MENU_LIMIT);
}

function closePisiWikiMenu(editor = null) {
    if (window.pisiTagMenuState?.mode === 'wiki-link' && (!editor || window.pisiTagMenuState.editor === editor)) window.closePisiTagMenu?.();
}

async function routePisiWikiInput(editor) {
    if (!editor || isPisiEditorComposing(editor) || editor.getAttribute('contenteditable') === 'false') return;
    const context = getPisiWikiCaretContext(editor);
    const trigger = context && getPisiWikiTrigger(context.textBefore);
    const request = ++pisiWikiState.request;
    if (!trigger) {
        closePisiWikiMenu(editor);
        if (context && /\[\[[^\]\n]{1,200}\]\]$/.test(context.textBefore)) await convertPisiTypedWikiLink(editor, context, request);
        return;
    }
    const index = await getPisiWikiIndex();
    if (request !== pisiWikiState.request) return;
    const documents = getPisiWikiDocuments(index);
    const matches = rankPisiWikiMatches(index, documents, trigger.title, getPisiWikiEditorNodePath(editor));
    let blocks = null;
    if (trigger.hasBlock) {
        const target = resolvePisiLegacyWikiTitle(documents, trigger.title)[0] || matches[0];
        blocks = (target?.contentBlocks || []).map((block) => ({
            blockId: block.blockId,
            text: String(block.text || '').slice(0, 80),
            kind: String(block.blockType || '').startsWith('heading') ? pisiWikiTranslate('Başlık') : pisiWikiTranslate('Blok'),
            nodeId: target.id,
            title: target.title
        }));
    }
    const items = buildPisiWikiMenuItems({ trigger, matches, blocks, createLabel: pisiWikiTranslate('Yeni not oluştur') });
    if (!items.length) return closePisiWikiMenu(editor);
    pisiWikiState.editor = editor;
    window.openPisiTagMenuForEditor?.(editor, { mode: 'wiki-link', items, token: `[[${trigger.query}`, wiki: { block: context.block } });
}

// "[[Başlık]]" typed in full becomes an id link right away when exactly one note
// carries that title; otherwise the text stays as a legacy link.
async function convertPisiTypedWikiLink(editor, context, request) {
    const match = context.textBefore.match(/\[\[([^\]\n]{1,200})\]\]$/);
    const target = parsePisiWikiTarget(match[1]);
    if (target.hasBlock && !isPisiWikiBlockId(target.block)) return;
    const documents = getPisiWikiDocuments(await getPisiWikiIndex());
    if (request !== pisiWikiState.request) return;
    const owners = resolvePisiLegacyWikiTitle(documents, target.title);
    if (owners.length !== 1) return;
    const end = context.textBefore.length;
    insertPisiWikiLink(editor, context.block, end - match[0].length, end, { nodeId: owners[0].id, title: owners[0].title, blockId: target.block });
}

function insertPisiWikiLink(editor, block, start, end, link) {
    const range = block?.isConnected ? makePisiWikiRangeFromOffsets(block, start, end) : null;
    if (!range) return false;
    const template = document.createElement('template');
    template.innerHTML = makePisiWikiLinkHtml(link);
    const anchor = template.content.firstElementChild;
    if (!anchor) return false;
    range.deleteContents();
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(anchor);
    editor.focus({ preventScroll: true });
    const caret = document.createRange();
    caret.setStart(space, 1);
    caret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLink' }));
    schedulePisiWikiDecorations();
    return true;
}

function getPisiWikiTokenOffsets(editor) {
    const context = getPisiWikiCaretContext(editor);
    const trigger = context && getPisiWikiTrigger(context.textBefore);
    return trigger ? { block: context.block, start: trigger.start, end: trigger.end } : null;
}

async function createPisiWikiTargetNote(editor, title) {
    const sourcePath = getPisiWikiEditorNodePath(editor);
    const folder = sourcePath ? sourcePath.replace(/[\\/][^\\/]+$/, '') : window.currentProjectFolder;
    const created = await window.pisiProject?.createPisiFile?.(folder, '.node');
    if (!created?.ok) throw new Error(created?.error || pisiWikiTranslate('Not oluşturulamadı.'));
    const renamed = await window.pisiProject.renamePisiFile(created.fullPath, title);
    if (!renamed?.ok) throw new Error(renamed?.error || pisiWikiTranslate('Not oluşturulamadı.'));
    window.invalidatePisiSearchIndex?.('wiki-link-create');
    await window.refreshCurrentProjectTree?.();
    return { nodeId: renamed.metadata?.id || created.metadata?.id, title: renamed.metadata?.title || title };
}

function applyPisiWikiMenuItem(editor, item) {
    const offsets = getPisiWikiTokenOffsets(editor);
    window.closePisiTagMenu?.();
    if (!offsets) return false;
    if (item.kind === 'wiki-create') {
        void createPisiWikiTargetNote(editor, item.title)
            .then((link) => insertPisiWikiLink(editor, offsets.block, offsets.start, offsets.end, link))
            .catch((error) => pisiNotifyError(error.message));
        return true;
    }
    return insertPisiWikiLink(editor, offsets.block, offsets.start, offsets.end, { nodeId: item.nodeId, title: item.title, blockId: item.blockId });
}

async function openPisiWikiTarget(nodeId, blockId = '') {
    const documents = getPisiWikiDocuments(await getPisiWikiIndex());
    const target = documents.find((document) => document.id === nodeId);
    if (!target) {
        pisiNotifyWarning(pisiWikiTranslate('Bağlantının hedef notu bulunamadı.'));
        return false;
    }
    return openPisiWikiDocument(target, blockId);
}

async function openPisiWikiDocument(target, blockId = '') {
    const opened = await window.openPisiFileTab?.(target.nodeItem);
    if (!opened || !isPisiWikiBlockId(blockId)) return Boolean(opened);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const block = document.querySelector(`#center-node-editor-content [data-pisi-block-id="${CSS.escape(blockId)}"]`);
        if (block) {
            block.scrollIntoView({ block: 'center' });
            block.classList.add('pisi-wiki-link-target');
            setTimeout(() => block.classList.remove('pisi-wiki-link-target'), 1600);
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
}

function closePisiWikiChooser() {
    pisiWikiState.chooser?.remove();
    pisiWikiState.chooser = null;
}

function showPisiWikiChooser(candidates, x, y) {
    closePisiWikiChooser();
    const chooser = document.createElement('div');
    chooser.className = 'pisi-wiki-chooser';
    chooser.setAttribute('role', 'menu');
    const heading = document.createElement('div');
    heading.className = 'pisi-wiki-chooser-heading';
    heading.textContent = pisiWikiTranslate('Bu başlığı taşıyan birden fazla not var');
    chooser.append(heading);
    for (const candidate of candidates) {
        const option = document.createElement('button');
        option.type = 'button';
        option.setAttribute('role', 'menuitem');
        const title = document.createElement('strong');
        title.textContent = candidate.title;
        const where = document.createElement('span');
        where.textContent = candidate.relativePath || '';
        option.append(title, where);
        option.addEventListener('click', () => {
            closePisiWikiChooser();
            void openPisiWikiDocument(candidate);
        });
        chooser.append(option);
    }
    document.body.appendChild(chooser);
    chooser.style.left = `${Math.max(8, Math.min(x, window.innerWidth - chooser.offsetWidth - 8))}px`;
    chooser.style.top = `${Math.max(8, Math.min(y + 8, window.innerHeight - chooser.offsetHeight - 8))}px`;
    chooser.querySelector('button')?.focus();
    pisiWikiState.chooser = chooser;
}

async function followPisiLegacyWikiLink(event) {
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.startContainer;
    if (node?.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(PISI_WIKI_SKIPPED_TEXT)) return false;
    const legacy = findPisiLegacyWikiLinkAt(node.nodeValue, caret.startOffset);
    if (!legacy) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const documents = getPisiWikiDocuments(await getPisiWikiIndex());
    const owners = resolvePisiLegacyWikiTitle(documents, legacy.title);
    if (!owners.length) pisiNotifyWarning(pisiWikiTranslate('Bu başlıkta bir not bulunamadı.'));
    else if (owners.length === 1) await openPisiWikiDocument(owners[0], isPisiWikiBlockId(legacy.block) ? legacy.block : '');
    else showPisiWikiChooser(owners, event.clientX, event.clientY);
    return true;
}

function handlePisiWikiClick(event) {
    if (event.button !== 0) return;
    if (pisiWikiState.chooser && !event.target?.closest?.('.pisi-wiki-chooser')) closePisiWikiChooser();
    const modifier = isPisiWikiMacPlatform() ? event.metaKey : event.ctrlKey;
    const anchor = event.target?.closest?.(PISI_WIKI_LINK_SELECTOR);
    const editor = getPisiWikiEditor(event.target);
    const editable = Boolean(editor?.isContentEditable);
    if (anchor) {
        event.preventDefault();
        if (editable && !modifier) return;
        event.stopImmediatePropagation();
        void openPisiWikiTarget(anchor.dataset.pisiNodeId, anchor.dataset.pisiLinkBlock || '');
        return;
    }
    if (editor && (modifier || !editable)) void followPisiLegacyWikiLink(event);
}

// Marks id links whose target note no longer exists and highlights legacy
// [[…]] text. Both are runtime-only: the state attribute is not in the
// sanitizer allowlist and CSS highlights never touch the DOM.
async function refreshPisiWikiDecorations() {
    pisiWikiState.highlightTimer = 0;
    const editors = Array.from(document.querySelectorAll('.pisi-rich-editor'));
    const anchors = editors.flatMap((editor) => Array.from(editor.querySelectorAll(PISI_WIKI_LINK_SELECTOR)));
    if (anchors.length) {
        const ids = new Set(getPisiWikiDocuments(await getPisiWikiIndex()).map((document) => document.id));
        for (const anchor of anchors) {
            if (ids.has(anchor.dataset.pisiNodeId)) delete anchor.dataset.pisiLinkState;
            else anchor.dataset.pisiLinkState = 'broken';
        }
    }
    if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
    const ranges = [];
    for (const editor of editors) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.nodeValue.includes('[[') || node.parentElement?.closest(PISI_WIKI_SKIPPED_TEXT)) continue;
            for (const match of node.nodeValue.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) {
                const range = new Range();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                ranges.push(range);
            }
        }
    }
    CSS.highlights.set('pisi-legacy-wiki-link', new Highlight(...ranges));
}

function schedulePisiWikiDecorations() {
    clearTimeout(pisiWikiState.highlightTimer);
    pisiWikiState.highlightTimer = window.setTimeout(() => void refreshPisiWikiDecorations(), 200);
}

// Keeps open editors in step with a rename the main process already wrote to
// disk, so a pending save of an open note cannot bring the old title back.
function applyPisiWikiRenameToOpenEditors({ nodeId = '', oldTitle = '', newTitle = '', rewriteLegacy = false } = {}) {
    if (!isPisiWikiNodeId(nodeId) || !newTitle) return;
    const oldKey = normalizePisiWikiTitle(oldTitle);
    for (const editor of document.querySelectorAll('.pisi-rich-editor')) {
        for (const anchor of editor.querySelectorAll(`a.pisi-wiki-link[data-pisi-node-id="${nodeId}"]`)) {
            anchor.dataset.pisiNodeTitle = newTitle;
            anchor.textContent = newTitle;
        }
        if (!rewriteLegacy || !oldKey) continue;
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('[[')) nodes.push(walker.currentNode);
        for (const node of nodes) {
            if (node.parentElement?.closest(PISI_WIKI_SKIPPED_TEXT)) continue;
            node.nodeValue = node.nodeValue.replace(/\[\[([^\]\n]{1,200})\]\]/g, (match, inner) => {
                const target = parsePisiWikiTarget(inner);
                if (normalizePisiWikiTitle(target.title) !== oldKey) return match;
                return `[[${newTitle}${target.hasBlock ? '#' + target.block : ''}]]`;
            });
        }
    }
    schedulePisiWikiDecorations();
}

/**
 * The single renderer path for renaming a note or map. When other notes link to
 * the item, the number of affected notes is confirmed first. Declining keeps the
 * old name: the title field is reset and an unchanged result is returned so the
 * caller still saves the note's content.
 */
async function renamePisiItemWithLinkReview(oldPath, newTitle, titleInput = null) {
    if (/\.node$/i.test(String(oldPath || ''))) {
        const impact = await window.pisiDomain?.query?.('links.rename-impact.v1', { nodePath: oldPath, newTitle });
        if (impact?.ok && impact.notes > 0) {
            const message = [
                pisiWikiTranslate('Bu notu yeniden adlandırmak ona verilen bağlantıları da günceller.'),
                `${pisiWikiTranslate('Etkilenecek not')}: ${impact.notes}`,
                `${pisiWikiTranslate('Güncellenecek bağlantı')}: ${impact.links}`,
                pisiWikiTranslate('Devam edilsin mi?')
            ].join('\n');
            if (!(await pisiConfirm(message, { title: pisiWikiTranslate('Bağlantıları güncelle'), confirmText: pisiWikiTranslate('Yeniden adlandır') }))) {
                const current = await window.pisiProject?.getPisiDocument?.(oldPath);
                const title = current?.metadata?.title || '';
                if (titleInput && title) titleInput.value = title;
                return { ok: true, skipped: true, fullPath: oldPath, fileName: String(oldPath).split(/[\\/]/).pop(), metadata: current?.metadata || {} };
            }
        }
    }
    const result = await window.pisiProject?.renamePisiFile?.(oldPath, newTitle);
    if (result?.ok && result.wikiLinks?.notes) {
        applyPisiWikiRenameToOpenEditors(result.wikiLinks);
        window.invalidatePisiSearchIndex?.('wiki-link-rename');
    }
    return result;
}

async function repairPisiWikiLinksInProject() {
    const projectFolder = window.currentProjectFolder;
    if (!projectFolder) return false;
    if (typeof window.flushPisiPendingSaves === 'function' && !(await window.flushPisiPendingSaves())) return false;
    const preview = await window.pisiDomain?.query?.('links.repair-preview.v1', { projectFolder });
    if (!preview?.ok) {
        pisiNotifyError(preview?.error || pisiWikiTranslate('Bağlantılar incelenemedi.'));
        return false;
    }
    const skipped = [
        `${pisiWikiTranslate('Birden fazla notla eşleşen')}: ${preview.ambiguous}`,
        `${pisiWikiTranslate('Hedefi bulunamayan')}: ${preview.missing}`,
        `${pisiWikiTranslate('Desteklenmeyen blok biçimi')}: ${preview.unsupported}`
    ];
    if (!preview.converted) {
        pisiNotifyInfo(pisiWikiTranslate('Onarılacak bağlantı yok.'), { detail: skipped.join('\n'), duration: 8000 });
        return false;
    }
    const summary = [
        `${pisiWikiTranslate('Kimlik eklenecek bağlantı')}: ${preview.converted}`,
        `${pisiWikiTranslate('Etkilenecek not')}: ${preview.notes}`,
        ...skipped,
        pisiWikiTranslate('Devam edilsin mi?')
    ];
    if (!(await pisiConfirm(summary.join('\n'), { title: pisiWikiTranslate('Bağlantıları onar'), confirmText: pisiWikiTranslate('Onar') }))) return false;
    const repaired = await window.pisiDomain?.command?.('links.repair.v1', { projectFolder });
    if (!repaired?.ok) {
        pisiNotifyError(repaired?.error || pisiWikiTranslate('Bağlantılar onarılamadı.'));
        return false;
    }
    window.invalidatePisiSearchIndex?.('wiki-link-repair');
    // Reload so open notes show the repaired links; pending saves were flushed above.
    await window.loadProject?.(projectFolder);
    return true;
}

function initializePisiWikiLinks() {
    if (pisiWikiState.initialized) return false;
    pisiWikiState.initialized = true;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'renderer/editor/pisi-wiki-links.css';
    document.head.appendChild(style);
    document.addEventListener('input', (event) => {
        const editor = event.target?.closest?.('.pisi-rich-editor');
        if (!editor) return;
        schedulePisiWikiDecorations();
        const inputType = /** @type {InputEvent} */ (event).inputType || '';
        if (inputType === 'insertLink' || inputType.startsWith('history')) return;
        queueMicrotask(() => void routePisiWikiInput(editor));
    });
    document.addEventListener('click', handlePisiWikiClick, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pisiWikiState.chooser) {
            event.preventDefault();
            closePisiWikiChooser();
        }
    });
    document.addEventListener('pisi:active-node-changed', () => schedulePisiWikiDecorations());
    registerPisiCommand({
        id: 'links.repair',
        label: 'Bağlantıları onar',
        category: 'Düzenleme',
        when: () => Boolean(window.currentProjectFolder),
        handler: () => repairPisiWikiLinksInProject()
    });
    return true;
}

const moduleApi = {
    pisiWikiState,
    applyPisiWikiMenuItem,
    renamePisiItemWithLinkReview,
    openPisiWikiTarget,
    applyPisiWikiRenameToOpenEditors,
    repairPisiWikiLinksInProject,
    refreshPisiWikiDecorations,
    initializePisiWikiLinks
};

registerModule('editor.wikiLinks', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiWikiLinks, { once: true });
} else {
    initializePisiWikiLinks();
}

export { applyPisiWikiRenameToOpenEditors, initializePisiWikiLinks, openPisiWikiTarget, refreshPisiWikiDecorations, renamePisiItemWithLinkReview };
