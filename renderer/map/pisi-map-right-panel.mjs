import { registerModule } from '../core/module-registry.mjs';

const mindMapPanelText = {
    tr: {
        tab: 'Mind Map araçları',
        empty: 'Mind Map araçlarını kullanmak için orta alanda bir map aç.',
        filters: 'Filtreler',
        titles: 'Yalnız başlık'
    },
    eng: {
        tab: 'Mind Map tools',
        empty: 'Open a map in the workspace to use Mind Map tools.',
        filters: 'Filters',
        titles: 'Titles only'
    }
};

const mindMapToolIcons = Object.freeze({
    'pisi-map-operational-focus': 'focus',
    'pisi-map-operational-linked': 'linked',
    'pisi-map-operational-deps': 'dependencies',
    'pisi-map-operational-labels': 'labels',
    'pisi-map-operational-work': 'work',
    'pisi-map-operational-save-layout': 'save',
    'pisi-map-operational-restore': 'restore',
    'pisi-map-operational-delete-layout': 'delete',
    'pisi-map-operational-reset': 'reset',
    'pisi-map-freeze-scope': 'freeze',
    'pisi-map-add-property-filter': 'add',
    'pisi-map-save-scope': 'save',
    'pisi-map-apply-scope': 'apply',
    'pisi-map-delete-scope': 'delete',
    'pisi-map-dim-filtered': 'dim'
});

const mindMapPrimaryActionIds = [
    'pisi-map-operational-focus',
    'pisi-map-operational-linked',
    'pisi-map-operational-deps',
    'pisi-map-operational-labels',
    'pisi-map-operational-work',
    'pisi-map-dim-filtered'
];

const mindMapFilterControlIds = ['pisi-map-operational-scope', 'pisi-map-operational-relation', 'pisi-map-operational-depth', 'pisi-map-scope-controls'];

const titleViewStorageKey = 'pisi.map.titleOnly.v1';
let titleOnly = false;
try {
    titleOnly = localStorage.getItem(titleViewStorageKey) === 'true';
} catch {
    // Keep the default full view when storage is unavailable.
}

function syncMindMapTitleView() {
    const canvas = document.getElementById('map-canvas');
    if (canvas) canvas.dataset.nodeView = titleOnly ? 'title' : 'full';
    const button = document.getElementById('pisi-map-title-view');
    if (button) {
        button.setAttribute('aria-pressed', String(titleOnly));
        button.title = t('titles');
        button.setAttribute('aria-label', t('titles'));
    }
}

function ensureMindMapTitleButton() {
    let button = document.getElementById('pisi-map-title-view');
    if (!button) {
        button = document.createElement('button');
        button.id = 'pisi-map-title-view';
        button.type = 'button';
        button.className = 'pisi-mindmap-icon-button';
        button.dataset.pisiToolIcon = 'labels';
        button.addEventListener('click', () => {
            titleOnly = !titleOnly;
            try {
                localStorage.setItem(titleViewStorageKey, String(titleOnly));
            } catch {
                // The toggle still works for this session.
            }
            syncMindMapTitleView();
            window.scheduleDrawMapConnections?.();
        });
    }
    button.setAttribute('aria-pressed', String(titleOnly));
    button.title = t('titles');
    button.setAttribute('aria-label', t('titles'));
    return button;
}

let mindMapPanelObserver = null;
let mindMapDocumentHandlersBound = false;

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return mindMapPanelText[language]?.[key] || mindMapPanelText.tr[key] || key;
}

function ensureMindMapPanelStyle() {
    if (document.querySelector('link[data-pisi-map-right-panel-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-right-panel.css';
    link.dataset.pisiMapRightPanelStyle = '1';
    document.head.appendChild(link);
}

function makeElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function getMindMapFilterButton() {
    return document.getElementById('pisi-mindmap-filter-button');
}

function getMindMapFilterMenu() {
    return document.getElementById('pisi-mindmap-filter-menu');
}

function setMindMapFilterMenuOpen(open) {
    const button = getMindMapFilterButton();
    const menu = getMindMapFilterMenu();
    if (!button || !menu) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function bindMindMapDocumentHandlers() {
    if (mindMapDocumentHandlersBound) return;
    mindMapDocumentHandlersBound = true;

    document.addEventListener(
        'mousedown',
        (event) => {
            const button = getMindMapFilterButton();
            const menu = getMindMapFilterMenu();
            if (!button || !menu || menu.hidden) return;
            const target = event.target instanceof Node ? event.target : null;
            if (target && (button.contains(target) || menu.contains(target))) return;
            setMindMapFilterMenuOpen(false);
        },
        true
    );

    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Escape') return;
            const menu = getMindMapFilterMenu();
            if (!menu || menu.hidden) return;
            setMindMapFilterMenuOpen(false);
            getMindMapFilterButton()?.focus();
        },
        true
    );
}

function syncMindMapPanelLabels() {
    syncMindMapTitleView();
    const button = document.getElementById('pisi-mindmap-tab-button');
    if (button) {
        button.title = t('tab');
        button.setAttribute('aria-label', t('tab'));
    }

    const empty = document.getElementById('pisi-mindmap-panel-empty');
    if (empty) empty.textContent = t('empty');

    const filterButton = getMindMapFilterButton();
    if (filterButton) {
        filterButton.title = t('filters');
        filterButton.setAttribute('aria-label', t('filters'));
    }
}

function ensureMindMapPanelEmpty(host) {
    let empty = document.getElementById('pisi-mindmap-panel-empty');
    if (!empty) {
        empty = makeElement('div', 'right-panel-empty pisi-mindmap-panel-empty', t('empty'));
        empty.id = 'pisi-mindmap-panel-empty';
        host.appendChild(empty);
    }
    empty.hidden = Boolean(window.activeMapPath);
    return empty;
}

function decorateMindMapIconButton(button, icon) {
    if (!(button instanceof HTMLButtonElement) || !icon) return;
    const label = String(button.textContent || '').trim();
    if (label) {
        button.title = label;
        button.setAttribute('aria-label', label);
    }
    button.classList.add('pisi-mindmap-icon-button');
    button.dataset.pisiToolIcon = icon;
}

function decorateMindMapIconButtons(toolbar) {
    for (const [id, icon] of Object.entries(mindMapToolIcons)) {
        const button = toolbar.querySelector(`#${id}`) || document.getElementById(id);
        decorateMindMapIconButton(button, icon);
    }
}

function ensureMindMapFilterDisclosure(toolbar) {
    let actions = toolbar.querySelector(':scope > .pisi-mindmap-icon-actions');
    if (!actions) {
        actions = makeElement('div', 'pisi-mindmap-icon-actions');
    }

    let filterButton = getMindMapFilterButton();
    if (!filterButton) {
        filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.id = 'pisi-mindmap-filter-button';
        filterButton.className = 'pisi-mindmap-icon-button';
        filterButton.dataset.pisiToolIcon = 'filter';
        filterButton.setAttribute('aria-controls', 'pisi-mindmap-filter-menu');
        filterButton.setAttribute('aria-expanded', 'false');
        filterButton.addEventListener('click', () => {
            const menu = getMindMapFilterMenu();
            setMindMapFilterMenuOpen(Boolean(menu?.hidden));
        });
    }
    filterButton.title = t('filters');
    filterButton.setAttribute('aria-label', t('filters'));

    const actionElements = [filterButton, ensureMindMapTitleButton()];
    for (const id of mindMapPrimaryActionIds) {
        const button = document.getElementById(id);
        if (button) actionElements.push(button);
    }
    actions.replaceChildren(...actionElements);

    let menu = getMindMapFilterMenu();
    if (!menu) {
        menu = makeElement('div', 'pisi-mindmap-filter-menu');
        menu.id = 'pisi-mindmap-filter-menu';
        menu.hidden = true;
    }
    for (const id of mindMapFilterControlIds) {
        const control = document.getElementById(id);
        if (control && control.parentElement !== menu) menu.appendChild(control);
    }

    return { actions, menu };
}

function ensureMindMapLayoutRow(toolbar) {
    let row = toolbar.querySelector(':scope > .pisi-mindmap-layout-row');
    if (!row) row = makeElement('div', 'pisi-mindmap-layout-row');

    const elements = [
        document.getElementById('pisi-map-operational-layout'),
        document.getElementById('pisi-map-operational-save-layout'),
        document.getElementById('pisi-map-operational-restore'),
        document.getElementById('pisi-map-operational-delete-layout'),
        document.getElementById('pisi-map-operational-reset')
    ].filter(Boolean);
    row.replaceChildren(...elements);
    return row;
}

function enhanceMindMapToolbar(toolbar) {
    if (!toolbar) return false;
    const query = document.getElementById('pisi-map-operational-query');
    const summary = document.getElementById('pisi-map-operational-summary');
    const { actions, menu } = ensureMindMapFilterDisclosure(toolbar);
    const layoutRow = ensureMindMapLayoutRow(toolbar);

    decorateMindMapIconButtons(toolbar);
    const ordered = [query, actions, menu, layoutRow, summary].filter(Boolean);
    toolbar.replaceChildren(...ordered);
    toolbar.classList.add('pisi-mindmap-toolbar-compact');
    syncMindMapPanelLabels();
    bindMindMapDocumentHandlers();
    return true;
}

function moveMindMapToolbarToRightPanel() {
    const host = document.getElementById('pisi-mindmap-controls-host');
    if (!host) return false;

    const toolbar = document.getElementById('pisi-map-operational-bar');
    const empty = ensureMindMapPanelEmpty(host);

    if (!toolbar) {
        empty.hidden = false;
        return false;
    }

    if (toolbar.parentElement !== host) host.appendChild(toolbar);
    toolbar.classList.add('pisi-map-operational-right-panel');
    enhanceMindMapToolbar(toolbar);
    toolbar.hidden = !window.activeMapPath;
    empty.hidden = Boolean(window.activeMapPath);
    return true;
}

function installMindMapRightPanel() {
    ensureMindMapPanelStyle();

    const tabs = document.getElementById('right-panel-tabs');
    const content = document.getElementById('right-panel-content');
    if (!tabs || !content) return false;

    tabs.classList.add('pisi-mindmap-tabs-installed');

    let button = document.getElementById('pisi-mindmap-tab-button');
    if (!button) {
        button = makeElement('button', 'right-panel-tab');
        button.id = 'pisi-mindmap-tab-button';
        button.type = 'button';
        button.dataset.rightTab = 'mindmap';
        button.setAttribute('aria-controls', 'right-tab-mindmap');

        const icon = makeElement('span', 'pisi-right-tab-icon pisi-right-tab-icon-mindmap');
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
        tabs.appendChild(button);
    }

    let page = document.getElementById('right-tab-mindmap');
    if (!page) {
        page = makeElement('section', 'right-tab-page pisi-mindmap-page');
        page.id = 'right-tab-mindmap';

        const host = makeElement('div', 'pisi-mindmap-controls-host');
        host.id = 'pisi-mindmap-controls-host';
        page.appendChild(host);
        content.appendChild(page);
    }

    window.bindRightPanelTabs?.();
    syncMindMapPanelLabels();
    moveMindMapToolbarToRightPanel();
    bindMindMapToolbarObserver();
    return true;
}

function bindMindMapToolbarObserver() {
    if (mindMapPanelObserver) return;
    const workspace = document.getElementById('workspace');
    if (!workspace) return;

    mindMapPanelObserver = new MutationObserver((mutations) => {
        const toolbarTouched = mutations.some((mutation) => {
            return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
                return node?.nodeType === Node.ELEMENT_NODE && (node.id === 'pisi-map-operational-bar' || node.querySelector?.('#pisi-map-operational-bar'));
            });
        });
        if (toolbarTouched) requestAnimationFrame(moveMindMapToolbarToRightPanel);
    });
    mindMapPanelObserver.observe(workspace, { childList: true, subtree: true });
}

function refreshMindMapRightPanel() {
    installMindMapRightPanel();
    requestAnimationFrame(moveMindMapToolbarToRightPanel);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMindMapRightPanel, { once: true });
} else {
    installMindMapRightPanel();
}

document.addEventListener('pisi:map-customization-context-changed', refreshMindMapRightPanel);
document.addEventListener('pisi:language-changed', () => {
    syncMindMapPanelLabels();
    requestAnimationFrame(moveMindMapToolbarToRightPanel);
});

registerModule('map.rightPanel', {
    enhanceMindMapToolbar,
    installMindMapRightPanel,
    moveMindMapToolbarToRightPanel,
    refreshMindMapRightPanel,
    setMindMapFilterMenuOpen
});

export { enhanceMindMapToolbar, installMindMapRightPanel, moveMindMapToolbarToRightPanel, refreshMindMapRightPanel, setMindMapFilterMenuOpen };
