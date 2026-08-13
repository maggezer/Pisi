import { registerModule } from "../core/module-registry.mjs";
import { buildPisiRelationshipModel, pisiSearchPathKey } from "./pisi-search-core.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    getPisiSearchLiveIndex
} from "./pisi-search-index.mjs";
import { openPisiSearchResult } from "./pisi-global-search.mjs";
import { renderPisiBlockRelationshipPanel } from "./pisi-block-graph.mjs";

let pisiLinksRefreshTimer = null;
let pisiLinksRefreshRequest = 0;
let pisiConnectionsView = 'node';

function pisiLinksTranslate(value) {
    return window.pisiI18n?.translate?.(value) || value;
}

function makePisiLinksElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function installPisiLinksPanel() {
    const tabs = document.getElementById('right-panel-tabs');
    const content = document.getElementById('right-panel-content');
    if (!tabs || !content) return false;

    if (!document.getElementById('pisi-connections-tab-button')) {
        const button = makePisiLinksElement(
            'button',
            'right-panel-tab'
        );
        button.id = 'pisi-connections-tab-button';
        button.type = 'button';
        button.dataset.rightTab = 'connections';
        button.title = pisiLinksTranslate('Bağlantılar');
        button.setAttribute('aria-label', button.title);
        const icon = makePisiLinksElement(
            'span',
            'pisi-right-tab-icon pisi-right-tab-icon-connections'
        );
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
        tabs.appendChild(button);
    }

    if (!document.getElementById('right-tab-connections')) {
        const page = makePisiLinksElement(
            'section',
            'right-tab-page pisi-connections-page'
        );
        page.id = 'right-tab-connections';

        const title = makePisiLinksElement(
            'div',
            'right-panel-section-title',
            pisiLinksTranslate('Bağlantılar')
        );
        const switcher = makePisiLinksElement(
            'div',
            'pisi-connections-switcher'
        );
        switcher.setAttribute('role', 'group');
        switcher.setAttribute(
            'aria-label',
            pisiLinksTranslate('Bağlantı türü')
        );
        for (const [view, label] of [
            ['node', 'Node bağlantıları'],
            ['blocks', 'Blok referansları']
        ]) {
            const option = makePisiLinksElement(
                'button',
                'pisi-connections-switcher-button',
                pisiLinksTranslate(label)
            );
            option.type = 'button';
            option.dataset.connectionsView = view;
            option.addEventListener('click', () => {
                void setPisiConnectionsView(view);
            });
            switcher.appendChild(option);
        }
        const nodePanel = makePisiLinksElement('div', 'pisi-links-panel');
        nodePanel.id = 'pisi-connections-node-panel';
        const blockPanel = makePisiLinksElement(
            'div',
            'pisi-connections-block-panel'
        );
        blockPanel.id = 'pisi-connections-block-panel';
        page.append(title, switcher, nodePanel, blockPanel);
        content.appendChild(page);
        syncPisiConnectionsView();
    }

    window.bindRightPanelTabs?.();
    const tab = document.getElementById('pisi-connections-tab-button');
    if (tab && tab.dataset.pisiLinksRefreshBound !== '1') {
        tab.dataset.pisiLinksRefreshBound = '1';
        tab.addEventListener('click', () => {
            schedulePisiLinksPanelRefresh(0);
        });
    }
    return true;
}

function renderPisiLinksMessage(message, mode = '') {
    const panel = document.getElementById('pisi-connections-node-panel');
    if (!panel) return;
    const element = makePisiLinksElement(
        'div',
        'pisi-links-message',
        pisiLinksTranslate(message)
    );
    element.dataset.mode = mode;
    panel.replaceChildren(element);
}

function getPisiLinksDocument(index, path) {
    return index?.documents?.get?.(pisiSearchPathKey(path)) || null;
}

function getPisiLinksMap(index, path) {
    const key = pisiSearchPathKey(path);
    return index?.maps?.find((map) => {
        return pisiSearchPathKey(map.path) === key;
    }) || null;
}

function makePisiLinksNodeResult(index, relationship, kind = 'node') {
    const documentRecord = getPisiLinksDocument(index, relationship.path);
    const membership = relationship.mapPath
        ? documentRecord?.memberships?.find((candidate) => {
            return pisiSearchPathKey(candidate.mapPath) ===
                pisiSearchPathKey(relationship.mapPath);
        })
        : documentRecord?.memberships?.[0];

    return {
        kind,
        title: relationship.title || documentRecord?.title || 'Node',
        nodeTitle: relationship.title || documentRecord?.title || 'Node',
        nodePath: relationship.path,
        fileName: relationship.fileName || documentRecord?.fileName,
        nodeItem: documentRecord?.nodeItem || null,
        mapPath: relationship.mapPath || membership?.mapPath || null,
        mapTitle: relationship.mapTitle || membership?.mapTitle || '',
        mapItem: membership?.mapItem || null,
        preview: relationship.preview || ''
    };
}

function makePisiLinksTypeChip(type) {
    const label = {
        text: 'Metin',
        map: 'Map',
        mention: 'Bahsetme',
        task: 'Görev'
    }[type] || type;
    return makePisiLinksElement(
        'span',
        'pisi-links-type pisi-links-type-' + type,
        pisiLinksTranslate(label)
    );
}

function makePisiLinksRelationButton(index, relationship) {
    const button = makePisiLinksElement(
        'button',
        'pisi-links-item'
    );
    button.type = 'button';

    const title = makePisiLinksElement(
        'span',
        'pisi-links-item-title',
        relationship.title || 'Node'
    );
    const metadata = makePisiLinksElement(
        'span',
        'pisi-links-item-meta'
    );
    (relationship.types || []).forEach((type) => {
        metadata.appendChild(makePisiLinksTypeChip(type));
    });
    if (relationship.mapTitle) {
        metadata.appendChild(makePisiLinksElement(
            'span',
            'pisi-links-map-title',
            relationship.mapTitle
        ));
    }

    button.append(title, metadata);
    button.addEventListener('click', () => {
        void openPisiSearchResult(
            makePisiLinksNodeResult(index, relationship)
        );
    });
    return button;
}

function makePisiLinksTaskButton(index, target, task) {
    const button = makePisiLinksElement(
        'button',
        'pisi-links-item pisi-links-task'
    );
    button.type = 'button';
    button.append(
        makePisiLinksElement(
            'span',
            'pisi-links-item-title',
            task.text || task.todoTag || pisiLinksTranslate('Görev')
        ),
        makePisiLinksElement(
            'span',
            'pisi-links-item-meta',
            task.status || ''
        )
    );
    const membership = target.memberships?.[0] || null;
    button.addEventListener('click', () => {
        void openPisiSearchResult({
            kind: 'task',
            title: target.title,
            nodeTitle: target.title,
            nodePath: target.path,
            nodeItem: target.nodeItem,
            fileName: target.fileName,
            mapPath: membership?.mapPath || null,
            mapTitle: membership?.mapTitle || '',
            mapItem: membership?.mapItem || null,
            blockId: task.blockId,
            todoTag: task.todoTag,
            sourceText: task.text,
            preview: task.text
        });
    });
    return button;
}

function makePisiLinksMapButton(index, membership) {
    const button = makePisiLinksElement(
        'button',
        'pisi-links-item'
    );
    button.type = 'button';
    const map = getPisiLinksMap(index, membership.mapPath);
    button.append(
        makePisiLinksElement(
            'span',
            'pisi-links-item-title',
            membership.mapTitle || map?.title || 'Map'
        ),
        makePisiLinksElement(
            'span',
            'pisi-links-item-meta',
            pisiLinksTranslate('Map içinde göster')
        )
    );
    button.addEventListener('click', () => {
        void openPisiSearchResult({
            kind: 'map',
            title: membership.mapTitle || map?.title || 'Map',
            mapTitle: membership.mapTitle || map?.title || 'Map',
            mapPath: membership.mapPath,
            mapItem: membership.mapItem || map?.item || null
        });
    });
    return button;
}

function makePisiLinksSection(title, items, itemFactory) {
    const section = makePisiLinksElement(
        'section',
        'pisi-links-section'
    );
    const heading = makePisiLinksElement(
        'h3',
        'pisi-links-section-title'
    );
    heading.append(
        document.createTextNode(pisiLinksTranslate(title) + ' '),
        makePisiLinksElement(
            'span',
            'pisi-links-count',
            String(items.length)
        )
    );
    section.appendChild(heading);

    if (!items.length) {
        section.appendChild(makePisiLinksElement(
            'div',
            'pisi-links-empty',
            pisiLinksTranslate('Kayıt yok')
        ));
        return section;
    }

    const list = makePisiLinksElement('div', 'pisi-links-list');
    items.forEach((item) => list.appendChild(itemFactory(item)));
    section.appendChild(list);
    return section;
}

function renderPisiLinksModel(index, model) {
    const panel = document.getElementById('pisi-connections-node-panel');
    if (!panel) return;
    if (!model.target) {
        renderPisiLinksMessage(
            'Bu node arama indeksinde bulunamadı.',
            'warning'
        );
        return;
    }

    const summary = makePisiLinksElement(
        'div',
        'pisi-links-summary'
    );
    summary.append(
        makePisiLinksElement(
            'strong',
            'pisi-links-summary-title',
            model.target.title
        ),
        makePisiLinksElement(
            'span',
            'pisi-links-summary-path',
            model.target.relativePath
        )
    );

    const sections = [
        makePisiLinksSection(
            'Bu node’a bağlantı verenler',
            model.inbound,
            (item) => makePisiLinksRelationButton(index, item)
        ),
        makePisiLinksSection(
            'Bu node’un bağlantı verdikleri',
            model.outbound,
            (item) => makePisiLinksRelationButton(index, item)
        ),
        makePisiLinksSection(
            'Bağlantısız bahsetmeler',
            model.unlinked,
            (item) => makePisiLinksRelationButton(index, item)
        ),
        makePisiLinksSection(
            'Bu node’dan üretilen görevler',
            model.tasks,
            (item) => makePisiLinksTaskButton(
                index,
                model.target,
                item
            )
        ),
        makePisiLinksSection(
            'Aynı map’ler',
            model.sameMaps,
            (item) => makePisiLinksMapButton(index, item)
        )
    ];
    panel.replaceChildren(summary, ...sections);
}

async function refreshPisiLinksPanel() {
    if (!installPisiLinksPanel()) return false;
    const requestId = ++pisiLinksRefreshRequest;
    const targetPath = getPisiSearchCurrentNodePath();

    if (!targetPath) {
        renderPisiLinksMessage(
            'İlişkileri görmek için bir node aç.',
            'empty'
        );
        return false;
    }

    renderPisiLinksMessage('Bağlantılar taranıyor…', 'loading');
    const index = await ensurePisiSearchIndex();
    if (requestId !== pisiLinksRefreshRequest) return false;
    if (!index) {
        renderPisiLinksMessage(
            'Bağlantılar için önce bir proje klasörü aç.',
            'empty'
        );
        return false;
    }

    const liveIndex = getPisiSearchLiveIndex(index, targetPath);
    const model = buildPisiRelationshipModel(liveIndex, targetPath);
    renderPisiLinksModel(liveIndex, model);
    if (pisiConnectionsView === 'blocks') {
        await refreshPisiBlockConnectionsPanel();
    }
    return true;
}

function syncPisiConnectionsView() {
    const nodePanel = document.getElementById('pisi-connections-node-panel');
    const blockPanel = document.getElementById('pisi-connections-block-panel');
    document.querySelectorAll('[data-connections-view]').forEach((button) => {
        const active = button.dataset.connectionsView === pisiConnectionsView;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (nodePanel) nodePanel.hidden = pisiConnectionsView !== 'node';
    if (blockPanel) blockPanel.hidden = pisiConnectionsView !== 'blocks';
}

async function refreshPisiBlockConnectionsPanel() {
    const panel = document.getElementById('pisi-connections-block-panel');
    if (!panel) return false;
    await renderPisiBlockRelationshipPanel(panel, { showTitle: false });
    return true;
}

async function setPisiConnectionsView(view = 'node') {
    pisiConnectionsView = view === 'blocks' ? 'blocks' : 'node';
    syncPisiConnectionsView();
    if (pisiConnectionsView === 'blocks') {
        await refreshPisiBlockConnectionsPanel();
    } else {
        schedulePisiLinksPanelRefresh(0);
    }
    return pisiConnectionsView;
}

async function openPisiBlockConnections() {
    installPisiLinksPanel();
    const tab = document.getElementById('pisi-connections-tab-button');
    if (!tab || tab.disabled) return false;
    tab.click();
    await setPisiConnectionsView('blocks');
    return true;
}

function schedulePisiLinksPanelRefresh(delay = 160) {
    clearTimeout(pisiLinksRefreshTimer);
    pisiLinksRefreshTimer = setTimeout(() => {
        pisiLinksRefreshTimer = null;
        void refreshPisiLinksPanel();
    }, Math.max(0, Number(delay) || 0));
}

function bindPisiLinksLiveRefresh() {
    [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].forEach((editor) => {
        if (!editor || editor.dataset.pisiLinksBound === '1') return;
        editor.dataset.pisiLinksBound = '1';
        editor.addEventListener('input', () => {
            schedulePisiLinksPanelRefresh(500);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    installPisiLinksPanel();
    bindPisiLinksLiveRefresh();
    schedulePisiLinksPanelRefresh(0);
});
document.addEventListener('pisi:active-node-changed', () => {
    schedulePisiLinksPanelRefresh(0);
});
document.addEventListener('pisi:search-index-ready', () => {
    schedulePisiLinksPanelRefresh(0);
});
document.addEventListener('pisi:search-index-invalidated', () => {
    const page = document.getElementById('right-tab-connections');
    if (page?.classList.contains('active')) {
        schedulePisiLinksPanelRefresh(220);
    }
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    installPisiLinksPanel: {
        enumerable: true,
        get() { return installPisiLinksPanel; }
    },
    refreshPisiLinksPanel: {
        enumerable: true,
        get() { return refreshPisiLinksPanel; }
    },
    schedulePisiLinksPanelRefresh: {
        enumerable: true,
        get() { return schedulePisiLinksPanelRefresh; }
    },
    setPisiConnectionsView: {
        enumerable: true,
        get() { return setPisiConnectionsView; }
    },
    openPisiBlockConnections: {
        enumerable: true,
        get() { return openPisiBlockConnections; }
    }
});
registerModule('search.linksPanel', moduleApi);

export {
    installPisiLinksPanel,
    openPisiBlockConnections,
    refreshPisiLinksPanel,
    schedulePisiLinksPanelRefresh,
    setPisiConnectionsView
};
