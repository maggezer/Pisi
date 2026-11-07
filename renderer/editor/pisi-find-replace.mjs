import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { applyPisiReplacements, findPisiTextMatches, locatePisiFindOffset } from './pisi-find-core.mjs';

// Find and replace in the open note (center or modal editor). Matches are
// shown with the CSS Custom Highlight API, so the editor DOM and the saved HTML
// never change while searching. Only editable text nodes are searched and
// replaced: task markers and metadata, tags, [[links]], Paint, Sheet, rollup,
// image and file blocks and anything contenteditable="false" are skipped, and
// element attributes (block ids, task ids) are never touched. "Replace all" is
// one input event and therefore one undo step.
//
// Keyboard ownership (docs/editor-keyboard-rules.md): in a Sheet cell Mod+F
// goes to that Sheet's own search.

const PISI_FIND_SKIP =
    '[contenteditable="false"], .pisi-block-task-marker, .pisi-task-metadata, .pisi-user-tag, .pisi-wiki-link, .pisi-sheet-block, ' +
    '.pisi-canvas-block, table[data-pisi-sheet], canvas, .pisi-image-block, .pisi-file-block, [data-pisi-rollup-relation], script, style';
const PISI_FIND_REFRESH_MS = 120;
const pisiFindState = {
    bar: null,
    editor: null,
    query: '',
    caseSensitive: false,
    wholeWord: false,
    groups: [],
    collected: null,
    matches: [],
    current: -1,
    refreshTimer: 0,
    replacing: false,
    initialized: false
};

function pisiFindTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function isPisiMac() {
    return /Mac/i.test(navigator.platform || '');
}

function getPisiFindTargetEditor() {
    const active = document.activeElement;
    const focused = active?.closest?.('#center-node-editor-content, #node-modal-content');
    if (focused) return focused;
    if (pisiFindState.bar?.contains(active) && pisiFindState.editor?.isConnected) return pisiFindState.editor;
    if (window.activeModalNode) return document.getElementById('node-modal-content');
    const center = document.getElementById('center-node-editor-content');
    if (window.activeCenterNode && document.getElementById('center-node-editor')?.hidden === false) return center;
    return null;
}

function getPisiSheetSearchInput(target) {
    const block = target?.closest?.('.pisi-sheet-block, table[data-pisi-sheet]');
    if (!block) return null;
    const host = block.closest('.pisi-sheet-block') || block;
    return host.querySelector('[data-pisi-sheet-search-input]');
}

/** Editable text nodes grouped by block, in document order. */
function collectPisiFindGroups(editor) {
    const groups = [];
    const nodes = [];
    let currentBlock = null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest(PISI_FIND_SKIP)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    while (walker.nextNode()) {
        const node = /** @type {Text} */ (walker.currentNode);
        const block = node.parentElement.closest('.pisi-editor-block') || editor;
        if (block !== currentBlock) {
            currentBlock = block;
            groups.push([]);
            nodes.push([]);
        }
        groups[groups.length - 1].push(node.data);
        nodes[nodes.length - 1].push(node);
    }
    return { groups, nodes };
}

function makePisiFindRange(nodes, groups, match) {
    const texts = groups[match.group];
    const start = locatePisiFindOffset(texts, match.start, true);
    const end = locatePisiFindOffset(texts, match.end, false);
    const range = document.createRange();
    range.setStart(nodes[match.group][start.node], start.offset);
    range.setEnd(nodes[match.group][end.node], end.offset);
    return range;
}

function paintPisiFindHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    CSS.highlights.delete('pisi-find-match');
    CSS.highlights.delete('pisi-find-current');
    const { nodes, groups } = pisiFindState.collected || { nodes: [], groups: [] };
    if (!pisiFindState.matches.length) return;
    const ranges = pisiFindState.matches.map((match) => makePisiFindRange(nodes, groups, match));
    CSS.highlights.set('pisi-find-match', new Highlight(...ranges));
    const current = ranges[pisiFindState.current];
    if (current) CSS.highlights.set('pisi-find-current', new Highlight(current));
}

function updatePisiFindCounter() {
    const bar = pisiFindState.bar;
    if (!bar) return;
    const counter = bar.querySelector('[data-pisi-find-counter]');
    const total = pisiFindState.matches.length;
    counter.textContent = pisiFindState.query ? `${total ? pisiFindState.current + 1 : 0}/${total}` : '';
    bar.classList.toggle('pisi-find-empty', Boolean(pisiFindState.query) && !total);
    for (const button of bar.querySelectorAll('[data-pisi-find-action="replace"], [data-pisi-find-action="replace-all"]')) button.disabled = !total;
}

function revealPisiFindCurrent() {
    const match = pisiFindState.matches[pisiFindState.current];
    if (!match || !pisiFindState.collected) return;
    const range = makePisiFindRange(pisiFindState.collected.nodes, pisiFindState.collected.groups, match);
    const element = range.startContainer.parentElement;
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Recomputes matches; keeps the current match near where it was. */
function refreshPisiFind(options = {}) {
    clearTimeout(pisiFindState.refreshTimer);
    const editor = pisiFindState.editor;
    if (!editor?.isConnected) return;
    const collected = collectPisiFindGroups(editor);
    pisiFindState.collected = collected;
    pisiFindState.groups = collected.groups;
    const previous = pisiFindState.matches[pisiFindState.current];
    pisiFindState.matches = findPisiTextMatches(collected.groups, pisiFindState.query, {
        caseSensitive: pisiFindState.caseSensitive,
        wholeWord: pisiFindState.wholeWord
    });
    if (!pisiFindState.matches.length) pisiFindState.current = -1;
    else if (previous) {
        const next = pisiFindState.matches.findIndex(
            (match) => match.group > previous.group || (match.group === previous.group && match.start >= previous.start)
        );
        pisiFindState.current = next < 0 ? 0 : next;
    } else pisiFindState.current = 0;
    paintPisiFindHighlights();
    updatePisiFindCounter();
    if (options.reveal) revealPisiFindCurrent();
}

function schedulePisiFindRefresh() {
    clearTimeout(pisiFindState.refreshTimer);
    pisiFindState.refreshTimer = window.setTimeout(() => refreshPisiFind(), PISI_FIND_REFRESH_MS);
}

function stepPisiFind(delta) {
    const total = pisiFindState.matches.length;
    if (!total) return false;
    pisiFindState.current = (pisiFindState.current + delta + total) % total;
    paintPisiFindHighlights();
    updatePisiFindCounter();
    revealPisiFindCurrent();
    return true;
}

function commitPisiFindChange(editor, newGroups) {
    const { nodes, groups } = pisiFindState.collected;
    let changed = 0;
    newGroups.forEach((texts, group) => {
        texts.forEach((text, index) => {
            if (text !== groups[group][index]) {
                nodes[group][index].data = text;
                changed += 1;
            }
        });
    });
    if (!changed) return false;
    pisiFindState.replacing = true;
    try {
        // One input event: one undo step, saved through the normal autosave path.
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    } finally {
        pisiFindState.replacing = false;
    }
    return true;
}

function getPisiFindReplacement() {
    return pisiFindState.bar?.querySelector('[data-pisi-find-replace-input]')?.value ?? '';
}

function replacePisiFindCurrent() {
    const editor = pisiFindState.editor;
    const match = pisiFindState.matches[pisiFindState.current];
    if (!editor || !match || editor.getAttribute('contenteditable') === 'false') return false;
    const changed = commitPisiFindChange(editor, applyPisiReplacements(pisiFindState.groups, [match], getPisiFindReplacement()));
    refreshPisiFind({ reveal: true });
    return changed;
}

function replacePisiFindAll() {
    const editor = pisiFindState.editor;
    const count = pisiFindState.matches.length;
    if (!editor || !count || editor.getAttribute('contenteditable') === 'false') return 0;
    commitPisiFindChange(editor, applyPisiReplacements(pisiFindState.groups, pisiFindState.matches, getPisiFindReplacement()));
    refreshPisiFind();
    announcePisiFind(pisiFindTranslate('{count} eşleşme değiştirildi').replace('{count}', String(count)));
    return count;
}

function announcePisiFind(message) {
    const live = pisiFindState.bar?.querySelector('[data-pisi-find-live]');
    if (live) live.textContent = message;
}

function makePisiFindButton(label, action, text, extra = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-find-button';
    button.dataset.pisiFindAction = action;
    button.title = pisiFindTranslate(label);
    button.setAttribute('aria-label', pisiFindTranslate(label));
    button.textContent = text;
    if (extra.toggle) button.setAttribute('aria-pressed', 'false');
    return button;
}

function buildPisiFindBar() {
    const bar = document.createElement('div');
    bar.className = 'pisi-find-bar';
    bar.setAttribute('role', 'search');
    bar.hidden = true;
    const findRow = document.createElement('div');
    findRow.className = 'pisi-find-row';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pisi-find-input';
    input.dataset.pisiFindInput = '';
    input.placeholder = pisiFindTranslate('Notta bul');
    input.setAttribute('aria-label', pisiFindTranslate('Notta bul'));
    const counter = document.createElement('span');
    counter.className = 'pisi-find-counter';
    counter.dataset.pisiFindCounter = '';
    counter.setAttribute('aria-live', 'polite');
    findRow.append(
        makePisiFindButton('Değiştir alanını aç', 'toggle-replace', '▸'),
        input,
        counter,
        makePisiFindButton('Önceki eşleşme (Shift+Enter)', 'previous', '↑'),
        makePisiFindButton('Sonraki eşleşme (Enter)', 'next', '↓'),
        makePisiFindButton('Büyük/küçük harf duyarlı', 'case', 'Aa', { toggle: true }),
        makePisiFindButton('Tam kelime', 'word', 'ab|', { toggle: true }),
        makePisiFindButton('Kapat (Esc)', 'close', '×')
    );
    const replaceRow = document.createElement('div');
    replaceRow.className = 'pisi-find-row pisi-find-replace-row';
    replaceRow.hidden = true;
    const replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.className = 'pisi-find-input';
    replaceInput.dataset.pisiFindReplaceInput = '';
    replaceInput.placeholder = pisiFindTranslate('Şununla değiştir');
    replaceInput.setAttribute('aria-label', pisiFindTranslate('Şununla değiştir'));
    const replaceOne = makePisiFindButton('Değiştir', 'replace', pisiFindTranslate('Değiştir'));
    const replaceAll = makePisiFindButton('Tümünü değiştir', 'replace-all', pisiFindTranslate('Tümünü değiştir'));
    replaceRow.append(replaceInput, replaceOne, replaceAll);
    const live = document.createElement('span');
    live.className = 'pisi-visually-hidden';
    live.dataset.pisiFindLive = '';
    live.setAttribute('aria-live', 'polite');
    bar.append(findRow, replaceRow, live);

    bar.addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) event.preventDefault();
    });
    bar.addEventListener('click', (event) => {
        const action = event.target.closest('[data-pisi-find-action]')?.dataset.pisiFindAction;
        if (!action) return;
        if (action === 'next') stepPisiFind(1);
        else if (action === 'previous') stepPisiFind(-1);
        else if (action === 'close') closePisiFind();
        else if (action === 'toggle-replace') togglePisiFindReplace();
        else if (action === 'replace') replacePisiFindCurrent();
        else if (action === 'replace-all') replacePisiFindAll();
        else if (action === 'case' || action === 'word') {
            const key = action === 'case' ? 'caseSensitive' : 'wholeWord';
            pisiFindState[key] = !pisiFindState[key];
            event.target.closest('button').setAttribute('aria-pressed', String(pisiFindState[key]));
            refreshPisiFind({ reveal: true });
        }
    });
    input.addEventListener('input', () => {
        pisiFindState.query = input.value;
        pisiFindState.current = -1;
        refreshPisiFind({ reveal: true });
    });
    const handleKeys = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePisiFind();
        } else if (event.key === 'Enter' && event.target === input) {
            event.preventDefault();
            event.stopPropagation();
            stepPisiFind(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Enter' && event.target === replaceInput) {
            event.preventDefault();
            event.stopPropagation();
            if (event.ctrlKey || event.metaKey) replacePisiFindAll();
            else replacePisiFindCurrent();
        }
    };
    input.addEventListener('keydown', handleKeys);
    replaceInput.addEventListener('keydown', handleKeys);
    return bar;
}

function placePisiFindBar(editor) {
    if (!pisiFindState.bar) pisiFindState.bar = buildPisiFindBar();
    const host = editor.parentElement;
    // The bar sits beside the editor, never inside it, so it is never saved.
    if (pisiFindState.bar.parentElement !== host) host.insertBefore(pisiFindState.bar, editor);
    return pisiFindState.bar;
}

function togglePisiFindReplace(force) {
    const row = pisiFindState.bar?.querySelector('.pisi-find-replace-row');
    if (!row) return false;
    row.hidden = force === undefined ? !row.hidden : !force;
    const toggle = pisiFindState.bar.querySelector('[data-pisi-find-action="toggle-replace"]');
    toggle.textContent = row.hidden ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!row.hidden));
    if (!row.hidden) row.querySelector('input')?.focus();
    return !row.hidden;
}

function getPisiEditorSelectionText(editor) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return '';
    const text = selection.toString();
    return text.includes('\n') || text.length > 200 ? '' : text;
}

/** Mod+F (and Mod+H with `replace`). */
function openPisiFind(options = {}) {
    const sheetInput = getPisiSheetSearchInput(document.activeElement);
    if (sheetInput && !options.replace) {
        sheetInput.focus();
        sheetInput.select?.();
        return true;
    }
    const editor = getPisiFindTargetEditor();
    if (!editor) return false;
    const seed = getPisiEditorSelectionText(editor);
    if (pisiFindState.editor && pisiFindState.editor !== editor) closePisiFind({ keepSelection: true, silent: true });
    pisiFindState.editor = editor;
    const bar = placePisiFindBar(editor);
    bar.hidden = false;
    const input = bar.querySelector('[data-pisi-find-input]');
    if (seed) input.value = seed;
    pisiFindState.query = input.value;
    togglePisiFindReplace(Boolean(options.replace) || !bar.querySelector('.pisi-find-replace-row').hidden);
    refreshPisiFind({ reveal: true });
    if (!options.replace) {
        input.focus();
        input.select();
    }
    return true;
}

/** Esc: the bar closes and the last match stays selected in the note. */
function closePisiFind(options = {}) {
    const bar = pisiFindState.bar;
    const editor = pisiFindState.editor;
    if (!bar || bar.hidden) return false;
    const match = pisiFindState.matches[pisiFindState.current];
    const range = match && pisiFindState.collected ? makePisiFindRange(pisiFindState.collected.nodes, pisiFindState.collected.groups, match) : null;
    bar.hidden = true;
    CSS.highlights?.delete('pisi-find-match');
    CSS.highlights?.delete('pisi-find-current');
    pisiFindState.matches = [];
    pisiFindState.current = -1;
    if (!options.silent && editor?.isConnected) {
        editor.focus({ preventScroll: true });
        if (range && !options.keepSelection) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
    return true;
}

function isPisiFindOpen() {
    return Boolean(pisiFindState.bar && !pisiFindState.bar.hidden);
}

function handlePisiFindEditorInput(event) {
    if (!isPisiFindOpen() || pisiFindState.replacing || event.target !== pisiFindState.editor) return;
    schedulePisiFindRefresh();
}

function registerPisiFindCommands() {
    const canFind = () => Boolean(getPisiSheetSearchInput(document.activeElement) || getPisiFindTargetEditor());
    registerPisiCommand({
        id: 'pisi.editor.find',
        label: 'Notta bul',
        description: 'Açık notta metin arar; Sheet hücresindeyken Sheet aramasına gider.',
        category: 'Editör',
        defaultShortcut: 'Mod+F',
        allowInInput: true,
        when: canFind,
        handler: () => openPisiFind()
    });
    registerPisiCommand({
        id: 'pisi.editor.replace',
        label: 'Notta bul ve değiştir',
        category: 'Editör',
        // Cmd+H hides the app on macOS.
        defaultShortcut: isPisiMac() ? 'Mod+Alt+F' : 'Mod+H',
        allowInInput: true,
        when: () => Boolean(getPisiFindTargetEditor()),
        handler: () => openPisiFind({ replace: true })
    });
    registerPisiCommand({
        id: 'pisi.editor.find-next',
        label: 'Sonraki eşleşme',
        category: 'Editör',
        defaultShortcut: 'F3',
        allowInInput: true,
        when: isPisiFindOpen,
        handler: () => stepPisiFind(1)
    });
    registerPisiCommand({
        id: 'pisi.editor.find-previous',
        label: 'Önceki eşleşme',
        category: 'Editör',
        defaultShortcut: 'Shift+F3',
        allowInInput: true,
        when: isPisiFindOpen,
        handler: () => stepPisiFind(-1)
    });
}

function ensurePisiFindStyle() {
    if (document.querySelector('link[data-pisi-find-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/editor/pisi-find-replace.css';
    link.dataset.pisiFindStyle = '1';
    document.head.appendChild(link);
}

function initializePisiFindReplace() {
    if (pisiFindState.initialized) return false;
    pisiFindState.initialized = true;
    ensurePisiFindStyle();
    registerPisiFindCommands();
    document.addEventListener('input', handlePisiFindEditorInput, true);
    // Another note opened in the same editor: the old matches are gone.
    document.addEventListener('pisi:active-node-changed', () => {
        if (isPisiFindOpen()) refreshPisiFind();
    });
    return true;
}

const moduleApi = {
    pisiFindState,
    openPisiFind,
    closePisiFind,
    refreshPisiFind,
    stepPisiFind,
    replacePisiFindCurrent,
    replacePisiFindAll,
    initializePisiFindReplace
};

registerModule('editor.findReplace', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiFindReplace, { once: true });
} else {
    initializePisiFindReplace();
}

export { closePisiFind, initializePisiFindReplace, openPisiFind, pisiFindState, refreshPisiFind, replacePisiFindAll, replacePisiFindCurrent, stepPisiFind };
