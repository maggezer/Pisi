import { registerModule } from "../core/module-registry.mjs";
import { searchPisiIndex } from "./pisi-search-core.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex
} from "./pisi-search-index.mjs";
import { openPisiSearchResult } from "./pisi-global-search.mjs";

const PISI_RIGHT_SEARCH_LIMIT = 50;
let pisiRightSearchState = null;
let pisiRightSearchRequest = 0;

function pisiRightSearchTranslate(value) {
    return window.pisiI18n?.translate?.(value) || value;
}

function makePisiRightSearchElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function getPisiRightSearchKindLabel(kind) {
    return {
        map: 'Map',
        node: 'Node',
        content: 'İçerik',
        task: 'Görev',
        tag: 'Etiket',
        table: 'Tablo'
    }[kind] || 'Sonuç';
}

function getPisiRightSearchKindIcon(kind) {
    return {
        map: '⌘',
        node: '◆',
        content: '¶',
        task: '✓',
        tag: '#',
        table: '▦'
    }[kind] || '•';
}

function getPisiRightSearchDisplayPath(value = '') {
    return String(value || '')
        .split(/[\\/]+/)
        .filter(Boolean)
        .filter((segment) => {
            return !/^(?:nd|inv)_.+__(?:map|node)_[A-Za-z0-9_-]+$/i
                .test(segment);
        })
        .map((segment) => {
            return segment.replace(
                /__(?:node|map)_[A-Za-z0-9_-]+(?=\.(?:node|map)$)/i,
                ''
            );
        })
        .join(' / ');
}

function getPisiRightSearchPreview(result) {
    if (
        result.kind === 'node' &&
        result.preview === result.relativePath
    ) {
        return getPisiRightSearchDisplayPath(result.preview);
    }
    return result.preview || '';
}

function getPisiRightSearchContext(result) {
    const values = [
        result.mapTitle,
        getPisiRightSearchDisplayPath(result.relativePath)
    ].filter(Boolean);
    return values.filter((value, index) => {
        return values.findIndex((candidate) => {
            return candidate.toLocaleLowerCase('tr') ===
                value.toLocaleLowerCase('tr');
        }) === index;
    }).join(' · ');
}

function setPisiRightSearchStatus(state, message, mode = '') {
    state.status.textContent = pisiRightSearchTranslate(message);
    state.status.dataset.mode = mode;
}

function renderPisiRightSearchEmpty(state, message) {
    state.results.replaceChildren(makePisiRightSearchElement(
        'div',
        'pisi-right-search-empty',
        pisiRightSearchTranslate(message)
    ));
    state.input.removeAttribute('aria-activedescendant');
}

function selectPisiRightSearchResult(state, nextIndex, scroll = true) {
    if (!state.matches.length) return;
    state.selectedIndex = (
        nextIndex + state.matches.length
    ) % state.matches.length;
    state.results.querySelectorAll('.pisi-right-search-result')
        .forEach((row, index) => {
            const selected = index === state.selectedIndex;
            row.classList.toggle('selected', selected);
            row.setAttribute('aria-selected', selected ? 'true' : 'false');
            if (selected && scroll) row.scrollIntoView({ block: 'nearest' });
        });
    state.input.setAttribute(
        'aria-activedescendant',
        `pisi-right-search-result-${state.selectedIndex}`
    );
}

function makePisiRightSearchResult(state, result, index) {
    const row = makePisiRightSearchElement(
        'button',
        'pisi-right-search-result'
    );
    row.type = 'button';
    row.id = `pisi-right-search-result-${index}`;
    row.setAttribute('role', 'option');

    const icon = makePisiRightSearchElement(
        'span',
        'pisi-right-search-result-icon',
        getPisiRightSearchKindIcon(result.kind)
    );
    icon.setAttribute('aria-hidden', 'true');

    const body = makePisiRightSearchElement(
        'span',
        'pisi-right-search-result-body'
    );
    const title = makePisiRightSearchElement(
        'strong',
        'pisi-right-search-result-title',
        result.title || result.nodeTitle || 'Node'
    );
    const kind = makePisiRightSearchElement(
        'span',
        'pisi-right-search-result-kind',
        pisiRightSearchTranslate(getPisiRightSearchKindLabel(result.kind))
    );
    const titleRow = makePisiRightSearchElement(
        'span',
        'pisi-right-search-result-title-row'
    );
    titleRow.append(title, kind);
    body.appendChild(titleRow);

    const preview = getPisiRightSearchPreview(result);
    if (preview) {
        body.appendChild(makePisiRightSearchElement(
            'span',
            'pisi-right-search-result-preview',
            preview
        ));
    }
    const context = getPisiRightSearchContext(result);
    if (context) {
        body.appendChild(makePisiRightSearchElement(
            'span',
            'pisi-right-search-result-context',
            context
        ));
    }

    row.append(icon, body);
    row.addEventListener('mouseenter', () => {
        selectPisiRightSearchResult(state, index, false);
    });
    row.addEventListener('click', (event) => {
        void openPisiSearchResult(result, { mapOnly: event.altKey });
    });
    return row;
}

function renderPisiRightSearchResults(state) {
    if (!state.index) {
        renderPisiRightSearchEmpty(state, 'Arama indeksi hazırlanıyor…');
        return;
    }
    state.matches = searchPisiIndex(state.index, state.input.value, {
        limit: PISI_RIGHT_SEARCH_LIMIT
    });
    state.selectedIndex = Math.min(
        state.selectedIndex,
        Math.max(0, state.matches.length - 1)
    );
    if (!state.matches.length) {
        setPisiRightSearchStatus(state, 'Sonuç bulunamadı.', 'empty');
        renderPisiRightSearchEmpty(
            state,
            'Farklı bir başlık, görev, etiket veya dosya yolu dene.'
        );
        return;
    }

    const suffix = state.index.complete
        ? ''
        : ' · ' + pisiRightSearchTranslate('İndeks kısmi');
    state.status.textContent =
        `${state.matches.length} ${pisiRightSearchTranslate('sonuç')}${suffix}`;
    state.status.dataset.mode = state.index.complete ? 'ready' : 'warning';

    const fragment = document.createDocumentFragment();
    state.matches.forEach((result, index) => {
        fragment.appendChild(makePisiRightSearchResult(
            state,
            result,
            index
        ));
    });
    state.results.replaceChildren(fragment);
    selectPisiRightSearchResult(state, state.selectedIndex, false);
}

function handlePisiRightSearchKeydown(state, event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        selectPisiRightSearchResult(state, state.selectedIndex + direction);
        return;
    }
    if (event.key === 'Enter') {
        const result = state.matches[state.selectedIndex];
        if (!result) return;
        event.preventDefault();
        void openPisiSearchResult(result, { mapOnly: event.altKey });
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        state.input.blur();
    }
}

function makePisiRightSearchState(page) {
    const panel = makePisiRightSearchElement(
        'div',
        'pisi-right-search-panel'
    );
    const inputRow = makePisiRightSearchElement(
        'div',
        'pisi-right-search-input-row'
    );
    const icon = makePisiRightSearchElement(
        'span',
        'pisi-right-search-input-icon'
    );
    icon.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.id = 'pisi-right-search-input';
    input.className = 'pisi-right-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = pisiRightSearchTranslate(
        'Node, içerik, görev, etiket, map, tablo veya dosya yolu ara'
    );
    input.setAttribute('aria-controls', 'pisi-right-search-results');
    input.setAttribute('aria-autocomplete', 'list');
    inputRow.append(icon, input);

    const status = makePisiRightSearchElement(
        'div',
        'pisi-right-search-status',
        pisiRightSearchTranslate('Arama indeksi hazırlanıyor…')
    );
    status.setAttribute('role', 'status');
    const results = makePisiRightSearchElement(
        'div',
        'pisi-right-search-results'
    );
    results.id = 'pisi-right-search-results';
    results.setAttribute('role', 'listbox');
    panel.append(inputRow, status, results);
    page.appendChild(panel);

    const state = {
        page,
        input,
        status,
        results,
        index: null,
        matches: [],
        selectedIndex: 0
    };
    input.addEventListener('input', () => {
        state.selectedIndex = 0;
        renderPisiRightSearchResults(state);
    });
    input.addEventListener('keydown', (event) => {
        handlePisiRightSearchKeydown(state, event);
    });
    return state;
}

async function activatePisiRightSearchPanel(options = {}) {
    const state = pisiRightSearchState;
    if (!state) return false;
    const requestId = ++pisiRightSearchRequest;
    if (options.query !== undefined) state.input.value = options.query;
    state.index = null;
    state.matches = [];
    state.selectedIndex = 0;
    setPisiRightSearchStatus(state, 'Arama indeksi hazırlanıyor…', 'loading');
    renderPisiRightSearchEmpty(state, 'Arama indeksi hazırlanıyor…');

    const index = await ensurePisiSearchIndex();
    if (requestId !== pisiRightSearchRequest) return false;
    if (!index) {
        setPisiRightSearchStatus(
            state,
            'Arama için önce bir proje klasörü aç.',
            'empty'
        );
        renderPisiRightSearchEmpty(
            state,
            'Arama için önce bir proje klasörü aç.'
        );
        return false;
    }
    state.index = getPisiSearchLiveIndex(
        index,
        getPisiSearchCurrentNodePath()
    );
    renderPisiRightSearchResults(state);
    if (state.page.classList.contains('active')) {
        requestAnimationFrame(() => state.input.focus());
    }
    return true;
}

function installPisiRightSearchPanel() {
    const tabs = document.getElementById('right-panel-tabs');
    const content = document.getElementById('right-panel-content');
    if (!tabs || !content) return false;

    let button = document.getElementById('pisi-search-tab-button');
    if (!button) {
        button = makePisiRightSearchElement('button', 'right-panel-tab');
        button.id = 'pisi-search-tab-button';
        button.type = 'button';
        button.dataset.rightTab = 'search';
        button.title = pisiRightSearchTranslate(
            'Global arama ve hızlı geçiş (Ctrl+P)'
        );
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-controls', 'right-tab-search');
        const icon = makePisiRightSearchElement(
            'span',
            'pisi-right-tab-icon pisi-right-tab-icon-search'
        );
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
        button.addEventListener('click', () => {
            requestAnimationFrame(() => {
                void activatePisiRightSearchPanel();
            });
        });
        tabs.appendChild(button);
    }

    let page = document.getElementById('right-tab-search');
    if (!page) {
        page = makePisiRightSearchElement(
            'section',
            'right-tab-page pisi-search-page'
        );
        page.id = 'right-tab-search';
        content.appendChild(page);
    }
    if (!pisiRightSearchState) {
        pisiRightSearchState = makePisiRightSearchState(page);
    }
    window.bindRightPanelTabs?.();
    return true;
}

function rebuildPisiRightSearchPanelForLanguage() {
    const wasActive = pisiRightSearchState?.page?.classList.contains('active');
    document.getElementById('pisi-search-tab-button')?.remove();
    document.getElementById('right-tab-search')?.remove();
    pisiRightSearchState = null;
    pisiRightSearchRequest += 1;
    installPisiRightSearchPanel();
    if (wasActive) document.getElementById('pisi-search-tab-button')?.click();
}

document.addEventListener('DOMContentLoaded', installPisiRightSearchPanel);
document.addEventListener('pisi:search-index-invalidated', () => {
    const state = pisiRightSearchState;
    if (!state?.page.classList.contains('active')) return;
    void activatePisiRightSearchPanel({ query: state.input.value });
});
document.addEventListener(
    'pisi:language-changed',
    rebuildPisiRightSearchPanelForLanguage
);

const moduleApi = {
    installPisiRightSearchPanel,
    activatePisiRightSearchPanel
};
registerModule('search.rightPanel', moduleApi);

export {
    installPisiRightSearchPanel,
    activatePisiRightSearchPanel
};

