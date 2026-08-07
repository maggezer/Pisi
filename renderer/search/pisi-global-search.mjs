import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommand } from "../core/pisi-command-registry.mjs";
import { searchPisiIndex, pisiSearchPathKey } from "./pisi-search-core.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex
} from "./pisi-search-index.mjs";

const PISI_SEARCH_RESULT_LIMIT = 80;
const PISI_SEARCH_MAP_FOCUS_CLASS = 'pisi-search-map-focus';
const PISI_SEARCH_EDITOR_FOCUS_CLASS = 'pisi-search-editor-focus';

let pisiSearchOverlayState = null;
let pisiSearchOpenRequest = 0;
let pisiSearchHighlightTimer = null;

function pisiSearchTranslate(value) {
    return window.pisiI18n?.translate?.(value) || value;
}

function getPisiSearchResultKindLabel(kind) {
    return {
        map: 'Map',
        node: 'Node',
        content: 'İçerik',
        task: 'Görev',
        tag: 'Etiket',
        table: 'Tablo'
    }[kind] || 'Sonuç';
}

function getPisiSearchResultIcon(kind) {
    return {
        map: '⌘',
        node: '◆',
        content: '¶',
        task: '✓',
        tag: '#',
        table: '▦'
    }[kind] || '•';
}

function makePisiSearchElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function makePisiSearchDialog() {
    const overlay = makePisiSearchElement(
        'div',
        'pisi-global-search-overlay'
    );
    overlay.id = 'pisi-global-search-overlay';
    overlay.hidden = true;

    const dialog = makePisiSearchElement(
        'section',
        'pisi-global-search-dialog'
    );
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pisi-global-search-title');

    const heading = makePisiSearchElement(
        'h2',
        'pisi-global-search-title',
        pisiSearchTranslate('Global arama ve hızlı geçiş')
    );
    heading.id = 'pisi-global-search-title';

    const inputRow = makePisiSearchElement(
        'div',
        'pisi-global-search-input-row'
    );
    const searchIcon = makePisiSearchElement(
        'span',
        'pisi-global-search-input-icon',
        '⌕'
    );
    searchIcon.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.id = 'pisi-global-search-input';
    input.className = 'pisi-global-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = pisiSearchTranslate(
        'Node, içerik, görev, etiket, map, tablo veya dosya yolu ara'
    );
    input.setAttribute('aria-controls', 'pisi-global-search-results');
    input.setAttribute('aria-autocomplete', 'list');
    const shortcut = makePisiSearchElement(
        'kbd',
        'pisi-global-search-shortcut',
        'Ctrl+P'
    );
    inputRow.append(searchIcon, input, shortcut);

    const status = makePisiSearchElement(
        'div',
        'pisi-global-search-status',
        pisiSearchTranslate('Arama indeksi hazırlanıyor…')
    );
    status.id = 'pisi-global-search-status';
    status.setAttribute('role', 'status');

    const results = makePisiSearchElement(
        'div',
        'pisi-global-search-results'
    );
    results.id = 'pisi-global-search-results';
    results.setAttribute('role', 'listbox');

    const footer = makePisiSearchElement(
        'footer',
        'pisi-global-search-footer'
    );
    [
        ['↑↓', 'Gezin'],
        ['Enter', 'Aç'],
        ['Alt+Enter', 'Mapte göster'],
        ['Esc', 'Kapat']
    ].forEach(([key, label]) => {
        const hint = makePisiSearchElement(
            'span',
            'pisi-global-search-hint'
        );
        hint.append(
            makePisiSearchElement('kbd', '', key),
            document.createTextNode(' ' + pisiSearchTranslate(label))
        );
        footer.appendChild(hint);
    });

    dialog.append(heading, inputRow, status, results, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const state = {
        overlay,
        dialog,
        input,
        status,
        results,
        index: null,
        matches: [],
        selectedIndex: 0,
        returnFocus: null
    };

    input.addEventListener('input', () => {
        renderPisiSearchResults(state);
    });
    input.addEventListener('keydown', (event) => {
        handlePisiSearchInputKeydown(state, event);
    });
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiGlobalSearch();
    });

    return state;
}

function ensurePisiSearchDialog() {
    if (pisiSearchOverlayState?.overlay?.isConnected) {
        return pisiSearchOverlayState;
    }
    pisiSearchOverlayState = makePisiSearchDialog();
    return pisiSearchOverlayState;
}

function setPisiSearchStatus(state, message, mode = '') {
    state.status.textContent = pisiSearchTranslate(message);
    state.status.dataset.mode = mode;
}

function getPisiSearchContextText(result) {
    const pieces = [];
    if (result.mapTitle) pieces.push(result.mapTitle);
    if (result.relativePath) pieces.push(result.relativePath);
    return pieces.join(' · ');
}

function renderPisiSearchEmptyState(state, message) {
    const empty = makePisiSearchElement(
        'div',
        'pisi-global-search-empty',
        pisiSearchTranslate(message)
    );
    state.results.replaceChildren(empty);
    state.input.removeAttribute('aria-activedescendant');
}

function renderPisiSearchResults(state) {
    if (!state.index) {
        renderPisiSearchEmptyState(state, 'Arama indeksi hazırlanıyor…');
        return;
    }

    const query = state.input.value;
    state.matches = searchPisiIndex(
        state.index,
        query,
        { limit: PISI_SEARCH_RESULT_LIMIT }
    );
    state.selectedIndex = Math.min(
        Math.max(0, state.selectedIndex),
        Math.max(0, state.matches.length - 1)
    );

    if (!state.matches.length) {
        setPisiSearchStatus(state, 'Sonuç bulunamadı.', 'empty');
        renderPisiSearchEmptyState(
            state,
            'Farklı bir başlık, görev, etiket veya dosya yolu dene.'
        );
        return;
    }

    const suffix = state.index.complete
        ? ''
        : ' · ' + pisiSearchTranslate('İndeks kısmi');
    state.status.textContent =
        String(state.matches.length) + ' ' +
        pisiSearchTranslate('sonuç') + suffix;
    state.status.dataset.mode = state.index.complete ? 'ready' : 'warning';

    const fragment = document.createDocumentFragment();
    state.matches.forEach((result, index) => {
        const row = makePisiSearchElement(
            'button',
            'pisi-global-search-result'
        );
        row.type = 'button';
        row.id = 'pisi-global-search-result-' + index;
        row.dataset.index = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute(
            'aria-selected',
            index === state.selectedIndex ? 'true' : 'false'
        );
        row.classList.toggle('selected', index === state.selectedIndex);

        const icon = makePisiSearchElement(
            'span',
            'pisi-global-search-result-icon',
            getPisiSearchResultIcon(result.kind)
        );
        icon.setAttribute('aria-hidden', 'true');

        const body = makePisiSearchElement(
            'span',
            'pisi-global-search-result-body'
        );
        const titleRow = makePisiSearchElement(
            'span',
            'pisi-global-search-result-title-row'
        );
        titleRow.append(
            makePisiSearchElement(
                'strong',
                'pisi-global-search-result-title',
                result.title || result.nodeTitle || 'Node'
            ),
            makePisiSearchElement(
                'span',
                'pisi-global-search-result-kind',
                pisiSearchTranslate(
                    getPisiSearchResultKindLabel(result.kind)
                )
            )
        );
        body.appendChild(titleRow);

        if (result.preview) {
            body.appendChild(makePisiSearchElement(
                'span',
                'pisi-global-search-result-preview',
                result.preview
            ));
        }

        const contextText = getPisiSearchContextText(result);
        if (contextText) {
            body.appendChild(makePisiSearchElement(
                'span',
                'pisi-global-search-result-context',
                contextText
            ));
        }

        row.append(icon, body);
        row.addEventListener('mouseenter', () => {
            setPisiSearchSelectedIndex(state, index, false);
        });
        row.addEventListener('click', (event) => {
            void openPisiSearchResult(result, {
                mapOnly: event.altKey
            });
        });
        fragment.appendChild(row);
    });

    state.results.replaceChildren(fragment);
    setPisiSearchSelectedIndex(state, state.selectedIndex, false);
}

function setPisiSearchSelectedIndex(state, nextIndex, scroll = true) {
    if (!state.matches.length) return;
    const length = state.matches.length;
    state.selectedIndex = (nextIndex + length) % length;

    state.results.querySelectorAll(
        '.pisi-global-search-result'
    ).forEach((row, index) => {
        const selected = index === state.selectedIndex;
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (selected && scroll) {
            row.scrollIntoView({ block: 'nearest' });
        }
    });

    state.input.setAttribute(
        'aria-activedescendant',
        'pisi-global-search-result-' + state.selectedIndex
    );
}

function handlePisiSearchInputKeydown(state, event) {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setPisiSearchSelectedIndex(state, state.selectedIndex + 1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setPisiSearchSelectedIndex(state, state.selectedIndex - 1);
        return;
    }
    if (event.key === 'Enter') {
        const result = state.matches[state.selectedIndex];
        if (!result) return;
        event.preventDefault();
        event.stopPropagation();
        void openPisiSearchResult(result, {
            mapOnly: event.altKey
        });
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePisiGlobalSearch();
    }
}

async function openPisiGlobalSearch(options = {}) {
    const state = ensurePisiSearchDialog();
    const requestId = ++pisiSearchOpenRequest;
    state.returnFocus = document.activeElement;
    state.overlay.hidden = false;
    state.overlay.classList.add('visible');
    state.input.value = options.query || '';
    state.index = null;
    state.matches = [];
    state.selectedIndex = 0;
    setPisiSearchStatus(state, 'Arama indeksi hazırlanıyor…', 'loading');
    renderPisiSearchEmptyState(state, 'Arama indeksi hazırlanıyor…');

    requestAnimationFrame(() => {
        state.input.focus();
        state.input.select();
    });

    const index = await ensurePisiSearchIndex();
    if (
        requestId !== pisiSearchOpenRequest ||
        state.overlay.hidden
    ) {
        return false;
    }

    if (!index) {
        setPisiSearchStatus(
            state,
            'Arama için önce bir proje klasörü aç.',
            'empty'
        );
        renderPisiSearchEmptyState(
            state,
            'Arama için önce bir proje klasörü aç.'
        );
        return false;
    }

    state.index = getPisiSearchLiveIndex(
        index,
        getPisiSearchCurrentNodePath()
    );
    renderPisiSearchResults(state);
    return true;
}

function closePisiGlobalSearch() {
    const state = pisiSearchOverlayState;
    if (!state?.overlay) return;
    pisiSearchOpenRequest += 1;
    state.overlay.classList.remove('visible');
    state.overlay.hidden = true;
    state.input.removeAttribute('aria-activedescendant');
    state.returnFocus?.focus?.({ preventScroll: true });
}

function getPisiSearchMapItem(result) {
    if (result?.mapItem?.fullPath) return result.mapItem;
    if (!result?.mapPath) return null;
    const fileName = String(result.mapPath).split(/[\\/]/).pop() || 'Map.map';
    return {
        name: fileName,
        fileName,
        fullPath: result.mapPath,
        type: 'file',
        isFile: true,
        isDirectory: false,
        metadata: {
            type: 'map',
            title: result.mapTitle ||
                fileName.replace(/\.map$/i, '')
        }
    };
}

function getPisiSearchNodeItem(result) {
    if (result?.nodeItem?.fullPath) return result.nodeItem;
    if (!result?.nodePath) return null;
    const fileName = result.fileName ||
        String(result.nodePath).split(/[\\/]/).pop() ||
        'Node.node';
    return {
        name: fileName,
        fileName,
        fullPath: result.nodePath,
        type: 'file',
        isFile: true,
        isDirectory: false,
        metadata: {
            type: 'node',
            title: result.nodeTitle ||
                result.title ||
                fileName.replace(/\.node$/i, '')
        }
    };
}

async function waitForPisiSearchMapBox(nodePath) {
    const key = pisiSearchPathKey(nodePath);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const box = Array.from(document.querySelectorAll(
            '.map-node-box[data-node-path]'
        )).find((candidate) => {
            return pisiSearchPathKey(candidate.dataset.nodePath) === key;
        });
        if (box) return box;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return null;
}

function clearPisiSearchMapFocus() {
    document.querySelectorAll('.' + PISI_SEARCH_MAP_FOCUS_CLASS)
        .forEach((element) => {
            element.classList.remove(PISI_SEARCH_MAP_FOCUS_CLASS);
        });
}

function focusPisiSearchMapBox(box, nodePath) {
    if (!box) return false;
    clearPisiSearchMapFocus();

    const node = Array.isArray(window.activeMapNodes)
        ? window.activeMapNodes.find((candidate) => {
            return pisiSearchPathKey(candidate?.fullPath) ===
                pisiSearchPathKey(nodePath);
        })
        : null;
    const canvas = document.getElementById('map-canvas');
    const rect = canvas?.getBoundingClientRect();

    if (node?.layout && rect) {
        const currentZoom = Number(window.activeMapCamera?.zoom) || 1;
        const zoom = Math.min(1.25, Math.max(0.7, currentZoom));
        const centerX = Number(node.layout.x || 0) +
            Number(node.layout.width || 220) / 2;
        const centerY = Number(node.layout.y || 0) +
            Number(node.layout.height || 92) / 2;

        window.activeMapCamera = {
            ...(window.activeMapCamera || {}),
            zoom,
            x: rect.width / 2 - centerX * zoom,
            y: rect.height / 2 - centerY * zoom
        };
        window.applyMapCamera?.();
        window.saveActiveMapCameraSoon?.();
    }

    window.clearSelectedMapNodes?.();
    box.classList.add('selected', PISI_SEARCH_MAP_FOCUS_CLASS);
    box.focus({ preventScroll: true });
    box.addEventListener('animationend', () => {
        box.classList.remove(PISI_SEARCH_MAP_FOCUS_CLASS);
    }, { once: true });
    return true;
}

function findPisiSearchEditorTarget(editor, result) {
    if (!editor) return null;
    if (result.blockId) {
        const escaped = CSS.escape(String(result.blockId));
        const exact = editor.querySelector(
            '[data-pisi-block-id="' + escaped + '"]'
        );
        if (exact) return exact;
    }

    const preview = String(result.preview || result.sourceText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    if (!preview) return null;

    return Array.from(editor.querySelectorAll(
        '.pisi-editor-block, p, li, h1, h2, h3, h4, h5, h6, table'
    )).find((element) => {
        return String(element.textContent || '')
            .replace(/\s+/g, ' ')
            .includes(preview);
    }) || null;
}

function highlightPisiSearchEditorTarget(result) {
    clearTimeout(pisiSearchHighlightTimer);
    document.querySelectorAll('.' + PISI_SEARCH_EDITOR_FOCUS_CLASS)
        .forEach((element) => {
            element.classList.remove(PISI_SEARCH_EDITOR_FOCUS_CLASS);
        });

    const candidates = [
        document.getElementById('node-modal-content'),
        document.getElementById('center-node-editor-content')
    ];
    for (const editor of candidates) {
        const target = findPisiSearchEditorTarget(editor, result);
        if (!target) continue;
        target.classList.add(PISI_SEARCH_EDITOR_FOCUS_CLASS);
        target.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
        pisiSearchHighlightTimer = setTimeout(() => {
            target.classList.remove(PISI_SEARCH_EDITOR_FOCUS_CLASS);
        }, 2600);
        return true;
    }
    return false;
}

async function openPisiNodeSearchResult(result) {
    const nodeItem = getPisiSearchNodeItem(result);
    if (!nodeItem) return false;
    const opened = await window.openPisiFileTab?.(nodeItem);
    if (!opened) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    highlightPisiSearchEditorTarget(result);
    return true;
}

async function openPisiMapNodeSearchResult(result, options = {}) {
    const mapItem = getPisiSearchMapItem(result);
    if (!mapItem) return openPisiNodeSearchResult(result);

    const opened = await window.openPisiFileTab?.(mapItem);
    if (!opened) return false;
    const box = await waitForPisiSearchMapBox(result.nodePath);
    if (!box) return openPisiNodeSearchResult(result);

    focusPisiSearchMapBox(box, result.nodePath);
    if (options.mapOnly) return true;

    const modalOpened = await window.openNodeModalFromBox?.(box);
    if (modalOpened === false) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (
        result.kind === 'task' &&
        typeof window.highlightPisiEditorBlock === 'function'
    ) {
        const highlighted = await window.highlightPisiEditorBlock(result);
        if (highlighted) return true;
    }
    highlightPisiSearchEditorTarget(result);
    return true;
}

async function openPisiSearchResult(result, options = {}) {
    if (!result) return false;
    closePisiGlobalSearch();

    if (
        window.activeModalNode &&
        typeof window.closeNodeModalAndSave === 'function'
    ) {
        const modalSaved = await window.closeNodeModalAndSave();
        if (!modalSaved) return false;
    }

    if (result.kind === 'map') {
        const mapItem = getPisiSearchMapItem(result);
        return Boolean(await window.openPisiFileTab?.(mapItem));
    }

    if (result.nodePath && result.mapPath) {
        return openPisiMapNodeSearchResult(result, options);
    }

    return openPisiNodeSearchResult(result);
}

function installPisiSearchTrigger() {
    const actions = document.getElementById('project-actions');
    if (!actions || document.getElementById('pisi-global-search-button')) {
        return;
    }
    const button = makePisiSearchElement(
        'button',
        'project-action-btn pisi-global-search-button',
        '⌕'
    );
    button.id = 'pisi-global-search-button';
    button.type = 'button';
    button.title = pisiSearchTranslate(
        'Global arama ve hızlı geçiş (Ctrl+P)'
    );
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => {
        void openPisiGlobalSearch();
    });
    actions.prepend(button);
}

function bindPisiSearchKeyboardShortcut() {
    if (document.body.dataset.pisiSearchShortcutBound === '1') return;
    document.body.dataset.pisiSearchShortcutBound = '1';
    registerPisiCommand({
        id: 'pisi.global-search',
        label: 'Global arama ve hızlı geçiş',
        description: 'Node, blok, görev, etiket, tablo ve map sonuçlarını arar.',
        category: 'Gezinme',
        defaultShortcut: 'Mod+P',
        allowInInput: true,
        handler: () => openPisiGlobalSearch()
    });
}

function refreshOpenPisiSearchAfterInvalidation() {
    const state = pisiSearchOverlayState;
    if (!state || state.overlay.hidden) return;
    const query = state.input.value;
    void openPisiGlobalSearch({ query });
}

document.addEventListener('DOMContentLoaded', () => {
    installPisiSearchTrigger();
    bindPisiSearchKeyboardShortcut();
});
document.addEventListener(
    'pisi:search-index-invalidated',
    refreshOpenPisiSearchAfterInvalidation
);
document.addEventListener('pisi:language-changed', () => {
    const state = pisiSearchOverlayState;
    if (!state) return;
    state.overlay.remove();
    pisiSearchOverlayState = null;
    installPisiSearchTrigger();
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    openPisiGlobalSearch: {
        enumerable: true,
        get() { return openPisiGlobalSearch; }
    },
    closePisiGlobalSearch: {
        enumerable: true,
        get() { return closePisiGlobalSearch; }
    },
    openPisiSearchResult: {
        enumerable: true,
        get() { return openPisiSearchResult; }
    },
    focusPisiSearchMapBox: {
        enumerable: true,
        get() { return focusPisiSearchMapBox; }
    },
    highlightPisiSearchEditorTarget: {
        enumerable: true,
        get() { return highlightPisiSearchEditorTarget; }
    }
});
registerModule('search.global', moduleApi);

export {
    openPisiGlobalSearch,
    closePisiGlobalSearch,
    openPisiSearchResult,
    focusPisiSearchMapBox,
    highlightPisiSearchEditorTarget
};
