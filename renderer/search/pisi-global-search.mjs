import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import { pisiSearchPathKey } from './pisi-search-core.mjs';
import { searchPisiAdvancedIndex } from './pisi-search-query.mjs';
import { ensurePisiEnhancedLiveSearchIndex, getPisiStaleSearchIndex } from './pisi-search-enhanced-index.mjs';
import { makePisiSearchRecentMap } from './pisi-search-history.mjs';
import { focusPisiSearchMapBox, highlightPisiSearchEditorTarget, openPisiSearchResult } from './pisi-search-navigation.mjs';

const PISI_SEARCH_RESULT_LIMIT = 80;
const PISI_SEARCH_PAGE_JUMP = 8;
const PISI_GLOBAL_SEARCH_KINDS = [
    ['node', 'Node'],
    ['task', 'Görev'],
    ['map', 'Map'],
    ['content', 'İçerik'],
    ['tag', 'Etiket'],
    ['table', 'Tablo']
];

const PISI_GLOBAL_SEARCH_LOCAL_TEXT = {
    tr: {
        all: 'Tümü',
        recent: 'Son kullanılanlar ve hızlı geçiş',
        syntax: 'Filtreler: type:task · map:Proje · status:todo · priority:5 · #etiket · "tam ifade"',
        fuzzy: 'yakın eşleşme',
        page: 'Sayfa',
        firstLast: 'İlk/Son',
        direct: 'Kaynağı aç',
        map: 'Mapte göster'
    },
    eng: {
        all: 'All',
        recent: 'Recent items and quick switch',
        syntax: 'Filters: type:task · map:Project · status:todo · priority:5 · #tag · "exact phrase"',
        fuzzy: 'fuzzy match',
        page: 'Page',
        firstLast: 'First/Last',
        direct: 'Open source',
        map: 'Show on map'
    }
};

let pisiSearchOverlayState = null;
let pisiSearchOpenRequest = 0;

function pisiSearchTranslate(value) {
    return window.pisiI18n?.translate?.(value) || value;
}

function pisiSearchLocalText(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return PISI_GLOBAL_SEARCH_LOCAL_TEXT[language]?.[key] || PISI_GLOBAL_SEARCH_LOCAL_TEXT.tr[key] || key;
}

function getPisiSearchResultKindLabel(kind) {
    return (
        {
            map: 'Map',
            node: 'Node',
            content: 'İçerik',
            task: 'Görev',
            tag: 'Etiket',
            table: 'Tablo'
        }[kind] || 'Sonuç'
    );
}

function getPisiSearchResultIcon(kind) {
    return (
        {
            map: '⌘',
            node: '◆',
            content: '¶',
            task: '✓',
            tag: '#',
            table: '▦'
        }[kind] || '•'
    );
}

function makePisiSearchElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function makePisiSearchFilterBar(state) {
    const bar = makePisiSearchElement('div', 'pisi-global-search-filters');
    const all = makePisiSearchElement('button', 'pisi-global-search-filter active', pisiSearchLocalText('all'));
    all.type = 'button';
    all.dataset.kind = '';
    all.setAttribute('aria-pressed', 'true');
    bar.appendChild(all);

    for (const [kind, label] of PISI_GLOBAL_SEARCH_KINDS) {
        const button = makePisiSearchElement('button', 'pisi-global-search-filter', pisiSearchTranslate(label));
        button.type = 'button';
        button.dataset.kind = kind;
        button.setAttribute('aria-pressed', 'false');
        bar.appendChild(button);
    }

    bar.addEventListener('click', (event) => {
        const button = event.target.closest('.pisi-global-search-filter');
        if (!button) return;
        const kind = button.dataset.kind || '';
        if (!kind) {
            state.kinds.clear();
        } else if (state.kinds.has(kind)) {
            state.kinds.delete(kind);
        } else {
            state.kinds.add(kind);
        }
        syncPisiSearchFilterButtons(state);
        state.selectedIndex = 0;
        renderPisiSearchResults(state);
        state.input.focus();
    });
    return bar;
}

function syncPisiSearchFilterButtons(state) {
    state.filters?.querySelectorAll('.pisi-global-search-filter').forEach((button) => {
        const kind = button.dataset.kind || '';
        const selected = kind ? state.kinds.has(kind) : state.kinds.size === 0;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}

function makePisiSearchDialog() {
    const overlay = makePisiSearchElement('div', 'pisi-global-search-overlay');
    overlay.id = 'pisi-global-search-overlay';
    overlay.hidden = true;
    const dialog = makePisiSearchElement('section', 'pisi-global-search-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pisi-global-search-title');

    const heading = makePisiSearchElement('h2', 'pisi-global-search-title', pisiSearchTranslate('Global arama ve hızlı geçiş'));
    heading.id = 'pisi-global-search-title';

    const inputRow = makePisiSearchElement('div', 'pisi-global-search-input-row');
    const searchIcon = makePisiSearchElement('span', 'pisi-global-search-input-icon', '⌕');
    searchIcon.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.id = 'pisi-global-search-input';
    input.className = 'pisi-global-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = pisiSearchTranslate('Node, içerik, görev, etiket, map, tablo veya dosya yolu ara');
    input.setAttribute('aria-controls', 'pisi-global-search-results');
    input.setAttribute('aria-autocomplete', 'list');
    const shortcut = makePisiSearchElement('kbd', 'pisi-global-search-shortcut', 'Ctrl+P');
    inputRow.append(searchIcon, input, shortcut);

    const state = {
        overlay,
        dialog,
        input,
        filters: null,
        status: null,
        results: null,
        index: null,
        matches: [],
        selectedIndex: 0,
        returnFocus: null,
        kinds: new Set(),
        recentById: new Map()
    };
    const filters = makePisiSearchFilterBar(state);
    state.filters = filters;
    const syntax = makePisiSearchElement('div', 'pisi-global-search-syntax', pisiSearchLocalText('syntax'));
    const status = makePisiSearchElement('div', 'pisi-global-search-status', pisiSearchTranslate('Arama indeksi hazırlanıyor…'));
    status.id = 'pisi-global-search-status';
    status.setAttribute('role', 'status');
    state.status = status;
    const results = makePisiSearchElement('div', 'pisi-global-search-results');
    results.id = 'pisi-global-search-results';
    results.setAttribute('role', 'listbox');
    state.results = results;

    const footer = makePisiSearchElement('footer', 'pisi-global-search-footer');
    [
        ['↑↓', 'Gezin'],
        ['PgUp/PgDn', pisiSearchLocalText('page')],
        ['Home/End', pisiSearchLocalText('firstLast')],
        ['Enter', pisiSearchLocalText('direct')],
        ['Alt+Enter', pisiSearchLocalText('map')],
        ['Esc', 'Kapat']
    ].forEach(([key, label]) => {
        const hint = makePisiSearchElement('span', 'pisi-global-search-hint');
        hint.append(makePisiSearchElement('kbd', '', key), document.createTextNode(' ' + pisiSearchTranslate(label)));
        footer.appendChild(hint);
    });

    dialog.append(heading, inputRow, filters, syntax, status, results, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    input.addEventListener('input', () => {
        state.selectedIndex = 0;
        renderPisiSearchResults(state);
    });
    input.addEventListener('keydown', (event) => handlePisiSearchInputKeydown(state, event));
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiGlobalSearch();
    });
    return state;
}

function ensurePisiSearchDialog() {
    if (pisiSearchOverlayState?.overlay?.isConnected) return pisiSearchOverlayState;
    pisiSearchOverlayState = makePisiSearchDialog();
    return pisiSearchOverlayState;
}

function setPisiSearchStatus(state, message, mode = '') {
    state.status.textContent = pisiSearchTranslate(message);
    state.status.dataset.mode = mode;
}

function getPisiSearchContextText(result) {
    const pieces = [];
    if (result.kind === 'task' && result.nodeTitle) pieces.push(result.nodeTitle);
    const memberships = Array.isArray(result.memberships) ? result.memberships : [];
    const mapTitles = Array.from(new Set(memberships.map((item) => item?.mapTitle).filter(Boolean)));
    if (mapTitles.length === 1) pieces.push(mapTitles[0]);
    else if (mapTitles.length > 1) pieces.push(`${mapTitles[0]} +${mapTitles.length - 1}`);
    else if (result.mapTitle) pieces.push(result.mapTitle);
    if (result.relativePath) pieces.push(result.relativePath);
    return pieces.join(' · ');
}

function renderPisiSearchEmptyState(state, message) {
    const empty = makePisiSearchElement('div', 'pisi-global-search-empty', pisiSearchTranslate(message));
    state.results.replaceChildren(empty);
    state.input.removeAttribute('aria-activedescendant');
}

function getPisiSearchOptions(state) {
    return {
        limit: PISI_SEARCH_RESULT_LIMIT,
        kinds: state.kinds,
        recentById: state.recentById,
        currentNodePathKey: pisiSearchPathKey(window.activeModalNode?.path || window.activeCenterNode?.path || ''),
        currentMapPathKey: pisiSearchPathKey(window.activeMapPath || ''),
        now: Date.now()
    };
}

function renderPisiSearchResults(state) {
    if (!state.index) {
        renderPisiSearchEmptyState(state, 'Arama indeksi hazırlanıyor…');
        return;
    }
    const query = state.input.value;
    state.matches = searchPisiAdvancedIndex(state.index, query, getPisiSearchOptions(state));
    state.selectedIndex = Math.min(Math.max(0, state.selectedIndex), Math.max(0, state.matches.length - 1));
    if (!state.matches.length) {
        setPisiSearchStatus(state, 'Sonuç bulunamadı.', 'empty');
        renderPisiSearchEmptyState(state, 'Farklı bir başlık, görev, etiket veya dosya yolu dene.');
        return;
    }

    const suffix = state.index.complete ? '' : ' · ' + pisiSearchTranslate('İndeks kısmi');
    state.status.textContent = query.trim()
        ? `${state.matches.length} ${pisiSearchTranslate('sonuç')}${suffix}`
        : `${pisiSearchLocalText('recent')} · ${state.matches.length}${suffix}`;
    state.status.dataset.mode = state.index.complete ? 'ready' : 'warning';

    const fragment = document.createDocumentFragment();
    state.matches.forEach((result, index) => {
        const row = makePisiSearchElement('button', 'pisi-global-search-result');
        row.type = 'button';
        row.id = `pisi-global-search-result-${index}`;
        row.dataset.index = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', index === state.selectedIndex ? 'true' : 'false');
        row.classList.toggle('selected', index === state.selectedIndex);
        if (state.recentById.has(result.id)) row.classList.add('recent');

        const icon = makePisiSearchElement('span', 'pisi-global-search-result-icon', getPisiSearchResultIcon(result.kind));
        icon.setAttribute('aria-hidden', 'true');
        const body = makePisiSearchElement('span', 'pisi-global-search-result-body');
        const titleRow = makePisiSearchElement('span', 'pisi-global-search-result-title-row');
        titleRow.append(
            makePisiSearchElement('strong', 'pisi-global-search-result-title', result.title || result.nodeTitle || 'Node'),
            makePisiSearchElement('span', 'pisi-global-search-result-kind', pisiSearchTranslate(getPisiSearchResultKindLabel(result.kind)))
        );
        if (result.fuzzyMatch) {
            titleRow.appendChild(makePisiSearchElement('span', 'pisi-global-search-result-fuzzy', '≈ ' + pisiSearchLocalText('fuzzy')));
        }
        body.appendChild(titleRow);
        if (result.preview) {
            body.appendChild(makePisiSearchElement('span', 'pisi-global-search-result-preview', result.preview));
        }
        const contextText = getPisiSearchContextText(result);
        if (contextText) {
            body.appendChild(makePisiSearchElement('span', 'pisi-global-search-result-context', contextText));
        }
        row.append(icon, body);
        row.addEventListener('mouseenter', () => setPisiSearchSelectedIndex(state, index, false));
        row.addEventListener('click', (event) => {
            void executePisiSearchResult(state, result, { mapOnly: event.altKey });
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
    state.results.querySelectorAll('.pisi-global-search-result').forEach((row, index) => {
        const selected = index === state.selectedIndex;
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (selected && scroll) row.scrollIntoView({ block: 'nearest' });
    });
    state.input.setAttribute('aria-activedescendant', `pisi-global-search-result-${state.selectedIndex}`);
}

async function executePisiSearchResult(state, result, options = {}) {
    if (!result) return false;
    closePisiGlobalSearch();
    const opened = await openPisiSearchResult(result, options);
    if (!opened) state.returnFocus?.focus?.({ preventScroll: true });
    return opened;
}

function handlePisiSearchInputKeydown(state, event) {
    const result = state.matches[state.selectedIndex];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setPisiSearchSelectedIndex(state, state.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
        return;
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        event.stopPropagation();
        setPisiSearchSelectedIndex(state, state.selectedIndex + (event.key === 'PageDown' ? PISI_SEARCH_PAGE_JUMP : -PISI_SEARCH_PAGE_JUMP));
        return;
    }
    if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        setPisiSearchSelectedIndex(state, event.key === 'Home' ? 0 : state.matches.length - 1);
        return;
    }
    if (event.key === 'Enter' && result) {
        event.preventDefault();
        event.stopPropagation();
        void executePisiSearchResult(state, result, { mapOnly: event.altKey });
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
    state.kinds = new Set(Array.isArray(options.kinds) ? options.kinds : []);
    state.recentById = makePisiSearchRecentMap(window.currentProjectFolder || '');
    state.matches = [];
    state.selectedIndex = 0;
    syncPisiSearchFilterButtons(state);

    const stale = getPisiStaleSearchIndex(window.currentProjectFolder);
    state.index = stale;
    if (stale) renderPisiSearchResults(state);
    else {
        setPisiSearchStatus(state, 'Arama indeksi hazırlanıyor…', 'loading');
        renderPisiSearchEmptyState(state, 'Arama indeksi hazırlanıyor…');
    }
    requestAnimationFrame(() => {
        state.input.focus();
        state.input.select();
    });

    const index = await ensurePisiEnhancedLiveSearchIndex();
    if (requestId !== pisiSearchOpenRequest || state.overlay.hidden) return false;
    if (!index) {
        setPisiSearchStatus(state, 'Arama için önce bir proje klasörü aç.', 'empty');
        renderPisiSearchEmptyState(state, 'Arama için önce bir proje klasörü aç.');
        return false;
    }
    state.index = index;
    state.recentById = makePisiSearchRecentMap(window.currentProjectFolder || '');
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

function refreshOpenPisiSearch() {
    const state = pisiSearchOverlayState;
    if (!state || state.overlay.hidden) return;
    state.recentById = makePisiSearchRecentMap(window.currentProjectFolder || '');
    renderPisiSearchResults(state);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pisi-global-search-button')?.remove();
    bindPisiSearchKeyboardShortcut();
});
document.addEventListener('pisi:search-index-invalidated', () => {
    const state = pisiSearchOverlayState;
    if (!state || state.overlay.hidden) return;
    const query = state.input.value;
    void openPisiGlobalSearch({ query, kinds: Array.from(state.kinds) });
});
document.addEventListener('pisi:enhanced-search-index-updated', refreshOpenPisiSearch);
document.addEventListener('pisi:search-history-updated', refreshOpenPisiSearch);
document.addEventListener('pisi:language-changed', () => {
    const state = pisiSearchOverlayState;
    if (!state) return;
    state.overlay.remove();
    pisiSearchOverlayState = null;
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    openPisiGlobalSearch: {
        enumerable: true,
        get() {
            return openPisiGlobalSearch;
        }
    },
    closePisiGlobalSearch: {
        enumerable: true,
        get() {
            return closePisiGlobalSearch;
        }
    },
    openPisiSearchResult: {
        enumerable: true,
        get() {
            return openPisiSearchResult;
        }
    },
    focusPisiSearchMapBox: {
        enumerable: true,
        get() {
            return focusPisiSearchMapBox;
        }
    },
    highlightPisiSearchEditorTarget: {
        enumerable: true,
        get() {
            return highlightPisiSearchEditorTarget;
        }
    }
});
registerModule('search.global', moduleApi);

export { closePisiGlobalSearch, focusPisiSearchMapBox, highlightPisiSearchEditorTarget, openPisiGlobalSearch, openPisiSearchResult };
