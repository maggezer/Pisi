import { registerModule } from '../core/module-registry.mjs';

const mindMapPanelText = {
    tr: {
        title: 'Mind Map',
        tab: 'Mind Map araçları',
        description: 'Aktif map için görünüm, scope, ilişkiler ve kayıtlı layout kontrolleri.',
        empty: 'Mind Map araçlarını kullanmak için orta alanda bir map aç.'
    },
    eng: {
        title: 'Mind Map',
        tab: 'Mind Map tools',
        description: 'View, scope, relationship and saved layout controls for the active map.',
        empty: 'Open a map in the workspace to use Mind Map tools.'
    }
};

let mindMapPanelObserver = null;

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

function syncMindMapPanelLabels() {
    const button = document.getElementById('pisi-mindmap-tab-button');
    if (button) {
        button.title = t('tab');
        button.setAttribute('aria-label', t('tab'));
    }

    const title = document.getElementById('pisi-mindmap-panel-title');
    if (title) title.textContent = t('title');

    const description = document.getElementById('pisi-mindmap-panel-description');
    if (description) description.textContent = t('description');

    const empty = document.getElementById('pisi-mindmap-panel-empty');
    if (empty) empty.textContent = t('empty');
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
    toolbar.hidden = !window.activeMapPath;
    empty.hidden = Boolean(window.activeMapPath);
    return true;
}

function installMindMapRightPanel() {
    ensureMindMapPanelStyle();

    const tabs = document.getElementById('right-panel-tabs');
    const content = document.getElementById('right-panel-content');
    if (!tabs || !content) return false;

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

        const header = makeElement('header', 'pisi-mindmap-panel-header');
        const heading = makeElement('h2', 'pisi-mindmap-panel-title', t('title'));
        heading.id = 'pisi-mindmap-panel-title';
        const description = makeElement('p', 'pisi-mindmap-panel-description', t('description'));
        description.id = 'pisi-mindmap-panel-description';
        header.append(heading, description);

        const host = makeElement('div', 'pisi-mindmap-controls-host');
        host.id = 'pisi-mindmap-controls-host';
        page.append(header, host);
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
                return node?.nodeType === Node.ELEMENT_NODE && (
                    node.id === 'pisi-map-operational-bar' ||
                    node.querySelector?.('#pisi-map-operational-bar')
                );
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
document.addEventListener('pisi:language-changed', syncMindMapPanelLabels);

registerModule('map.rightPanel', {
    installMindMapRightPanel,
    moveMindMapToolbarToRightPanel,
    refreshMindMapRightPanel
});

export {
    installMindMapRightPanel,
    moveMindMapToolbarToRightPanel,
    refreshMindMapRightPanel
};
