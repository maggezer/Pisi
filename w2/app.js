(function initKediNamespace() {
    const previousKedi = window.Kedi || {};
    const previousState = previousKedi.state || {};

    window.Kedi = {
        state: {


            activeCenterNode: previousState.activeCenterNode ?? null,
            centerNodeSaveTimer: previousState.centerNodeSaveTimer ?? null,
            
            activeMapPath: previousState.activeMapPath ?? null,
            activeMapNodes: previousState.activeMapNodes ?? [],
            activeMapEdges: previousState.activeMapEdges ?? [],
            activeMapCamera: previousState.activeMapCamera ?? { x: 0, y: 0, zoom: 1 },

            activeModalNode: previousState.activeModalNode ?? null,

            mapSaveTimer: previousState.mapSaveTimer ?? null,
            mapCameraSaveTimer: previousState.mapCameraSaveTimer ?? null,

            mapCanvasPanBound: previousState.mapCanvasPanBound ?? false,
            mapZoomEventsBound: previousState.mapZoomEventsBound ?? false,
            mapZoomControlsBound: previousState.mapZoomControlsBound ?? false,

            currentConnectionDrag: previousState.currentConnectionDrag ?? null,
            currentMapBoxSelection: previousState.currentMapBoxSelection ?? null,

            projectRefreshTimer: previousState.projectRefreshTimer ?? null,
            selectedTreeItem: previousState.selectedTreeItem ?? null,

            expandedTreePaths:
                previousState.expandedTreePaths instanceof Set
                    ? previousState.expandedTreePaths
                    : new Set(),

            suppressFileSystemRefreshUntil:
                previousState.suppressFileSystemRefreshUntil ?? 0,

            kediTagsPanelState:
                previousState.kediTagsPanelState ?? {
                    selectedTag: null,
                    index: []
                },

            kediTagsPanelRefreshTimer:
                previousState.kediTagsPanelRefreshTimer ?? null,

            KEDI_USER_TAG_CACHE:
                previousState.KEDI_USER_TAG_CACHE instanceof Set
                    ? previousState.KEDI_USER_TAG_CACHE
                    : new Set(),

            kediTagMenuState:
                previousState.kediTagMenuState ?? {
                    active: false,
                    command: '',
                    range: null,
                    items: [],
                    selectedIndex: 0
                },

            openTabs: Array.isArray(previousState.openTabs)
            ? previousState.openTabs
            : [],

            activeTabPath: previousState.activeTabPath ?? null,
        },

        

        api: window.kediProject,

        ui: previousKedi.ui || {},
        tree: previousKedi.tree || {},
        map: previousKedi.map || {},
        tags: previousKedi.tags || {},
        connections: previousKedi.connections || {}
    };

    function defineKediStateBridge(name) {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            return;
        }

        Object.defineProperty(window, name, {
            configurable: true,
            get() {
                return window.Kedi.state[name];
            },
            set(value) {
                window.Kedi.state[name] = value;
            }
        });
    }

    [
        'activeMapPath',
        'activeMapNodes',
        'activeMapEdges',
        'activeMapCamera',
        'activeModalNode',

        'mapSaveTimer',
        'mapCameraSaveTimer',

        'mapCanvasPanBound',
        'mapZoomEventsBound',
        'mapZoomControlsBound',

        'currentConnectionDrag',
        'currentMapBoxSelection',

        'projectRefreshTimer',
        'selectedTreeItem',
        'expandedTreePaths',
        'suppressFileSystemRefreshUntil',

        'kediTagsPanelState',
        'kediTagsPanelRefreshTimer',
        'KEDI_USER_TAG_CACHE',
        'kediTagMenuState',

        'openTabs',
        'activeTabPath',

        'activeCenterNode',
        'centerNodeSaveTimer',

    ].forEach(defineKediStateBridge);
})();

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[KEDI] Temiz arayüz yüklendi.');

    setupWindowControls();
    setupCenterFileTabs();
    bindRightPanelTabs();
    setupKediCustomizations();
    
    bindKediTagControls();
    bindKediBlockIndexControls();

    await setupProjectStartup();
});

function setupWindowControls() {
    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');
    const maxIcon = document.getElementById('win-max-icon');

    function setMaximizedIcon(isMaximized) {
        if (!maxIcon) return;

        maxIcon.src = isMaximized
            ? 'assets/win-restore.png'
            : 'assets/win-max.png';

        maxIcon.alt = isMaximized ? 'Geri Al' : 'Büyüt';

        if (maxBtn) {
            maxBtn.title = isMaximized ? 'Geri Al' : 'Büyüt';
        }
    }

    minBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.minimize();
    });

    maxBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.toggleMaximize();
    });

    closeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.close();
    });

    window.electronWindow?.onMaximized?.(() => {
        setMaximizedIcon(true);
    });

    window.electronWindow?.onUnmaximized?.(() => {
        setMaximizedIcon(false);
    });

    window.electronWindow?.isMaximized?.().then((isMaximized) => {
        setMaximizedIcon(Boolean(isMaximized));
    });
}

function bindRightPanelTabs() {
    const tabButtons = Array.from(document.querySelectorAll('.right-panel-tab'));
    const tabPages = Array.from(document.querySelectorAll('.right-tab-page'));

    if (!tabButtons.length || !tabPages.length) return;

    for (const button of tabButtons) {
        if (button.dataset.bound === '1') continue;
        button.dataset.bound = '1';

        button.addEventListener('click', () => {
    const target = button.dataset.rightTab;

    tabButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
    });

    tabPages.forEach((page) => {
        page.classList.toggle(
            'active',
            page.id === `right-tab-${target}`
        );
    });

    const rightPanelContent = document.getElementById('right-panel-content');

    if (rightPanelContent) {
        rightPanelContent.scrollTop = 0;
    }

    const activePage = document.getElementById(`right-tab-${target}`);

    if (activePage) {
        activePage.scrollTop = 0;
    }

    if (
    (target === 'missions' || target === 'tags') &&
    typeof refreshKediTagsPanelSoon === 'function'
    ) {
    refreshKediTagsPanelSoon();
    }

    if (target === 'tags') {
    const resetRightPanelScroll = () => {
        const rightPanelContent = document.getElementById('right-panel-content');
        const tagsPage = document.getElementById('right-tab-tags');

        if (rightPanelContent) {
            rightPanelContent.scrollTop = 0;
        }

        if (tagsPage) {
            tagsPage.scrollTop = 0;
        }
    };

    resetRightPanelScroll();
    requestAnimationFrame(resetRightPanelScroll);
    setTimeout(resetRightPanelScroll, 50);
}
});
    }
}

function setupCenterFileTabs() {
    const toolbar = document.getElementById('center-toolbar');
    if (!toolbar) return;

    let tabsEl = document.getElementById('center-tabs');

    if (!tabsEl) {
        toolbar.innerHTML = '<div id="center-tabs" class="center-tabs"></div>';
        tabsEl = document.getElementById('center-tabs');
    }

    if (tabsEl.dataset.bound === '1') {
        renderKediOpenTabs();
        return;
    }

    tabsEl.dataset.bound = '1';

    tabsEl.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            tabsEl.scrollLeft += event.deltaY;
        }
    });

    renderKediOpenTabs();
}

function getKediOpenTabsState() {
    if (!window.Kedi) {
        window.Kedi = {
            state: {},
            api: window.kediProject,
            ui: {},
            tree: {},
            map: {},
            tags: {},
            connections: {}
        };
    }

    if (!window.Kedi.state) {
        window.Kedi.state = {};
    }

    if (!Array.isArray(window.Kedi.state.openTabs)) {
        window.Kedi.state.openTabs = [];
    }

    if (typeof window.Kedi.state.activeTabPath === 'undefined') {
        window.Kedi.state.activeTabPath = null;
    }

    return window.Kedi.state;
}

function kediSameTabPath(a, b) {
    if (!a || !b) return false;

    if (typeof sameClientPath === 'function') {
        return sameClientPath(a, b);
    }

    return String(a) === String(b);
}

function getKediOpenTabType(item) {
    const fileName = item?.name || '';

    if (fileName.toLowerCase().endsWith('.map')) return 'map';
    if (fileName.toLowerCase().endsWith('.node')) return 'node';

    return 'file';
}

function getKediOpenTabTitle(item) {
    const rawName =
        item?.metadata?.title ||
        item?.displayName ||
        item?.name ||
        item?.fileName ||
        'Untitled';

    return String(rawName).replace(/\.(map|node)$/i, '');
}

function cloneKediTabItem(item) {
    return {
        name: item.name || item.fileName,
        fileName: item.fileName || item.name,
        fullPath: item.fullPath,
        type: item.type,
        isFile: item.isFile !== false,
        isDirectory: Boolean(item.isDirectory),
        displayName: item.displayName,
        sidecarPath: item.sidecarPath,
        metadata: {
            ...(item.metadata || {})
        }
    };
}

function ensureKediOpenTab(item) {
    if (!item || !item.fullPath || item.isDirectory) return null;

    const type = getKediOpenTabType(item);

    if (type !== 'map' && type !== 'node') return null;

    const state = getKediOpenTabsState();

    let tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, item.fullPath);
    });

    if (tab) {
        tab.title = getKediOpenTabTitle(item);
        tab.type = type;
        tab.item = cloneKediTabItem(item);
        return tab;
    }

    tab = {
        path: item.fullPath,
        type,
        title: getKediOpenTabTitle(item),
        item: cloneKediTabItem(item)
    };

    state.openTabs.push(tab);

    return tab;
}

async function openKediFileTab(item) {
    const tab = ensureKediOpenTab(item);

    if (!tab) return;

    await activateKediOpenTab(tab.path);
}

async function activateKediOpenTab(path) {
    const state = getKediOpenTabsState();

    const tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, path);
    });

    if (!tab) return;

    const alreadyActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, tab.path);

    const alreadyLoaded =
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        kediSameTabPath(activeMapPath, tab.path);

    state.activeTabPath = tab.path;
    renderKediOpenTabs();

    if (alreadyActive && alreadyLoaded) {
        selectKediTreeFileByPath(tab.path);
        return;
    }

    if (
    typeof saveCurrentCenterNodeEditor === 'function' &&
    activeCenterNode &&
    (!activeCenterNode.path || !kediSameTabPath(activeCenterNode.path, tab.path))
    ) {
    await saveCurrentCenterNodeEditor();
    }

    if (
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        !kediSameTabPath(activeMapPath, tab.path)
    ) {
        await saveCurrentMapLayout();
    }

    if (tab.type === 'map' && typeof openMapInWorkspace === 'function') {
        await openMapInWorkspace(tab.item);
    }

    if (tab.type === 'node' && typeof openCenterNodeEditor === 'function') {
    await openCenterNodeEditor(tab.item);
    }

    selectKediTreeFileByPath(tab.path);
}

async function closeKediOpenTab(path, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const state = getKediOpenTabsState();

    const isActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, path);

    if (
        isActive &&
        typeof saveCurrentCenterNodeEditor === 'function' &&
        activeCenterNode
    ) {
        await saveCurrentCenterNodeEditor();
    }

    if (
        isActive &&
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath
    ) {
        await saveCurrentMapLayout();
    }

    await removeKediOpenTabByPath(path);
}

async function removeKediOpenTabByPath(path) {
    const state = getKediOpenTabsState();

    const index = state.openTabs.findIndex((tab) => {
        return kediSameTabPath(tab.path, path);
    });

    const wasActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, path);

    if (index === -1) {
        if (
            typeof activeMapPath !== 'undefined' &&
            activeMapPath &&
            kediSameTabPath(activeMapPath, path) &&
            typeof clearMapWorkspace === 'function'
        ) {
            clearMapWorkspace();
        }

        renderKediOpenTabs();
        return;
    }

    state.openTabs.splice(index, 1);

    if (!wasActive) {
        renderKediOpenTabs();
        return;
    }

    const nextTab = state.openTabs[index] || state.openTabs[index - 1] || null;

    if (nextTab) {
        await activateKediOpenTab(nextTab.path);
        return;
    }

    state.activeTabPath = null;
    
    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor();
    }

    if (typeof clearMapWorkspace === 'function') {
        clearMapWorkspace();
    }

    renderKediOpenTabs();
}

function resetKediOpenTabs() {
    const state = getKediOpenTabsState();

    state.openTabs = [];
    state.activeTabPath = null;

    renderKediOpenTabs();
}

function updateKediOpenTabAfterRename(oldPath, result) {
    if (!oldPath || !result || !result.ok) return;

    const state = getKediOpenTabsState();

    const tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, oldPath);
    });

    if (!tab) return;

    tab.path = result.fullPath;
    tab.title =
        result.metadata?.title ||
        String(result.fileName || '').replace(/\.(map|node)$/i, '');

    tab.item = {
        ...tab.item,
        name: result.fileName,
        fileName: result.fileName,
        fullPath: result.fullPath,
        displayName: result.metadata?.title || result.fileName,
        metadata: {
            ...(result.metadata || {})
        },
        sidecarPath: result.sidecarPath || tab.item?.sidecarPath
    };

    if (state.activeTabPath && kediSameTabPath(state.activeTabPath, oldPath)) {
        state.activeTabPath = result.fullPath;
    }

    if (
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        kediSameTabPath(activeMapPath, oldPath)
    ) {
        activeMapPath = result.fullPath;
    }

    renderKediOpenTabs();
}

function selectKediTreeFileByPath(path) {
    if (
        typeof findTreeNodeByPath !== 'function' ||
        typeof selectTreeFile !== 'function'
    ) {
        return;
    }

    const treeNode = findTreeNodeByPath(path);

    if (!treeNode) return;

    const row = Array.from(treeNode.children).find((child) => {
        return child.classList?.contains('tree-row');
    });

    if (!row || !treeNode.__kediItem) return;

    selectTreeFile(treeNode.__kediItem, row);
}

function renderKediOpenTabs() {
    const tabsEl = document.getElementById('center-tabs');
    if (!tabsEl) return;

    const state = getKediOpenTabsState();

    tabsEl.innerHTML = '';

    if (!state.openTabs.length) {
        const empty = document.createElement('div');
        empty.className = 'center-tabs-empty';
        empty.textContent = 'Açık dosya yok';
        tabsEl.appendChild(empty);
        return;
    }

    for (const tab of state.openTabs) {
        const tabEl = document.createElement('div');
        tabEl.className = 'center-tab';
        tabEl.title = tab.path;

        if (state.activeTabPath && kediSameTabPath(state.activeTabPath, tab.path)) {
            tabEl.classList.add('active');
        }

        const icon = document.createElement('span');
        icon.className = 'center-tab-icon';
        icon.textContent = tab.type === 'map' ? '🗺️' : '📄';

        const title = document.createElement('span');
        title.className = 'center-tab-title';
        title.textContent = tab.title || 'Untitled';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'center-tab-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Sekmeyi kapat';
        closeBtn.textContent = '×';

        tabEl.appendChild(icon);
        tabEl.appendChild(title);
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', async (event) => {
            if (event.target.closest('.center-tab-close')) return;

            await activateKediOpenTab(tab.path);
        });

        closeBtn.addEventListener('click', async (event) => {
            await closeKediOpenTab(tab.path, event);
        });

        tabsEl.appendChild(tabEl);
    }
}

async function setupProjectStartup() {



    const projectModal = document.getElementById('project-modal');
    const modalChooseBtn = document.getElementById('modal-choose-project-btn');
    const changeProjectBtn = document.getElementById('change-project-btn');

    const addMapBtn = document.getElementById('add-map-btn');
    const addNodeBtn = document.getElementById('add-node-btn');

window.kediProject?.onFileSystemChanged?.(() => {
    if (shouldSuppressFileSystemRefresh()) {
        return;
    }

    // Aktif map açıkken connection/node metadata yazımları fs.watch tetikliyor.
    // Bu sırada full refresh yapmak sol paneli bozukmuş gibi zıplatıyor.
    if (activeMapPath) {
        return;
    }

    refreshCurrentProjectTree();
});
   

    modalChooseBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    changeProjectBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    addMapBtn?.addEventListener('click', async () => {
    await createKediFileInCurrentProject('.map');
    });

    addNodeBtn?.addEventListener('click', async () => {
    await createKediFileInCurrentProject('.node');
    });

    const lastFolder = await window.kediProject?.getLastFolder?.();

    if (lastFolder) {
        await loadProject(lastFolder);
    } else {
        showProjectModal();
    }
}

async function createKediFileInCurrentProject(ext) {
    if (!window.currentProjectFolder) {
        showProjectModal();
        return;
    }

    suppressNextFileSystemRefresh(1500);

    const result = await window.kediProject?.createKediFile?.(
        window.currentProjectFolder,
        ext
    );

    if (!result || !result.ok) {
        alert(result?.error || 'Dosya oluşturulamadı.');
        return;
    }

    const rootNode = findTreeNodeByPath(window.currentProjectFolder);
    const rootChildren = rootNode?.querySelector('.tree-children');

    if (!rootNode || !rootChildren) {
        await renderFolderTree(window.currentProjectFolder);
        return;
    }

    rootNode.classList.add('expanded');
    expandedTreePaths.add(window.currentProjectFolder);

    const newItem = makeTreeItemFromCreateResult(result);

    await appendTreeItemToContainer(rootChildren, newItem, 1);
}

function refocusKediRenderer() {
    window.electronWindow?.focusRenderer?.();
    window.focus();

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    document.body.focus({ preventScroll: true });

    const selection = window.getSelection?.();

    if (selection?.removeAllRanges) {
        selection.removeAllRanges();
    }
}

function focusKediTextInput(input, shouldSelect = true) {
    if (!input) return;

    window.electronWindow?.focusRenderer?.();
    window.focus();

    requestAnimationFrame(() => {
        input.focus({ preventScroll: true });

        if (shouldSelect) {
            input.select?.();
        }
    });

    setTimeout(() => {
        input.focus({ preventScroll: true });

        if (shouldSelect) {
            input.select?.();
        }
    }, 60);
}

function escapeKediConfirmText(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function resetKediKeyboardAndPointerState() {
    try {
        window.getSelection?.()?.removeAllRanges?.();
    } catch (error) {}

    document.querySelectorAll('.map-node-box.dragging').forEach((el) => {
        el.classList.remove('dragging');
    });

    document.querySelectorAll('.map-port.connecting-source').forEach((el) => {
        el.classList.remove('connecting-source');
    });

    document.querySelectorAll('.map-selection-box').forEach((el) => {
        el.remove();
    });

    document.getElementById('map-canvas')?.classList.remove('panning');
    document.getElementById('map-temp-edge')?.remove();

    try {
        if (typeof currentConnectionDrag !== 'undefined') {
            currentConnectionDrag = null;
        }
    } catch (error) {}

    try {
        if (typeof currentMapBoxSelection !== 'undefined') {
            currentMapBoxSelection = null;
        }
    } catch (error) {}

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    window.focus();
    document.body.focus({ preventScroll: true });
}

function kediConfirm(message, options = {}) {
    return new Promise((resolve) => {
        document.getElementById('kedi-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'kedi-confirm-overlay';

        const title = escapeKediConfirmText(options.title || 'Onay');
        const text = escapeKediConfirmText(message || '');
        const confirmText = escapeKediConfirmText(options.confirmText || 'Tamam');
        const cancelText = escapeKediConfirmText(options.cancelText || 'Vazgeç');

        overlay.innerHTML = `
            <div id="kedi-confirm-card">
                <div id="kedi-confirm-title">${title}</div>
                <div id="kedi-confirm-message">${text}</div>

                <div id="kedi-confirm-actions">
                    <button id="kedi-confirm-cancel" type="button">${cancelText}</button>
                    <button id="kedi-confirm-ok" type="button">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const card = overlay.querySelector('#kedi-confirm-card');
        const cancelBtn = overlay.querySelector('#kedi-confirm-cancel');
        const okBtn = overlay.querySelector('#kedi-confirm-ok');

        if (options.danger) {
            okBtn?.classList.add('danger');
        }

        let closed = false;

        function close(value) {
            if (closed) return;
            closed = true;

            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();

            resetKediKeyboardAndPointerState();

            resolve(value);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
            }
        }

        overlay.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.target === overlay) {
                close(false);
            }
        });

        card?.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        cancelBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(false);
        });

        okBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        });

        document.addEventListener('keydown', onKeyDown, true);

        setTimeout(() => {
            cancelBtn?.focus({ preventScroll: true });
        }, 0);
    });
}

const KEDI_CUSTOMIZATION_STORAGE_KEY = 'kedi.customization.v1';

const KEDI_DEFAULT_CUSTOMIZATION = {
    mapDownHubColor: '#f39c12',
    mapCoLevelColor: '#34ace0',
    mapStreamColor: '#2ecc71',
    mapNodeBoxColor: '#252526',
    mapNodeTitleColor: '#f39c12',
    nodeHeaderColor: '#f39c12'
};

const KEDI_CUSTOMIZATION_CSS_VARIABLES = {
    mapDownHubColor: '--kedi-map-downhub-color',
    mapCoLevelColor: '--kedi-map-colevel-color',
    mapStreamColor: '--kedi-map-stream-color',
    mapNodeBoxColor: '--kedi-map-node-box-color',
    mapNodeTitleColor: '--kedi-map-node-title-color',
    nodeHeaderColor: '--kedi-node-header-color'
};

function loadKediCustomizationSettings() {
    try {
        const raw = localStorage.getItem(KEDI_CUSTOMIZATION_STORAGE_KEY);

        if (!raw) {
            return { ...KEDI_DEFAULT_CUSTOMIZATION };
        }

const parsed = JSON.parse(raw) || {};

if (parsed.mapConnectionColor && !parsed.mapDownHubColor) {
    parsed.mapDownHubColor = parsed.mapConnectionColor;
}

delete parsed.mapConnectionColor;

return {
    ...KEDI_DEFAULT_CUSTOMIZATION,
    ...parsed
};
    } catch (error) {
        console.warn('[KEDI] Customize ayarları okunamadı:', error);
        return { ...KEDI_DEFAULT_CUSTOMIZATION };
    }
}

function saveKediCustomizationSettings(settings) {
    try {
        localStorage.setItem(
            KEDI_CUSTOMIZATION_STORAGE_KEY,
            JSON.stringify(settings)
        );
    } catch (error) {
        console.warn('[KEDI] Customize ayarları kaydedilemedi:', error);
    }
}

function isValidKediHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function applyKediCustomizationSettings(settings) {
    const root = document.documentElement;

    for (const [key, cssVariable] of Object.entries(KEDI_CUSTOMIZATION_CSS_VARIABLES)) {
        const fallback = KEDI_DEFAULT_CUSTOMIZATION[key];
        const value = isValidKediHexColor(settings?.[key])
            ? settings[key]
            : fallback;

        root.style.setProperty(cssVariable, value);
    }
}

function syncKediCustomizationInputs(settings) {
    document.querySelectorAll('[data-kedi-custom-color]').forEach((input) => {
        const key = input.dataset.kediCustomColor;
        const value = settings[key] || KEDI_DEFAULT_CUSTOMIZATION[key];

        if (isValidKediHexColor(value)) {
            input.value = value;
        }
    });
}

function setupKediCustomizations() {
    const panel = document.getElementById('kedi-customize-panel');

    if (!panel) return;

    let settings = loadKediCustomizationSettings();

    applyKediCustomizationSettings(settings);
    syncKediCustomizationInputs(settings);

    panel.querySelectorAll('[data-kedi-custom-color]').forEach((input) => {
        if (input.dataset.bound === '1') return;
        input.dataset.bound = '1';

        input.addEventListener('input', () => {
            const key = input.dataset.kediCustomColor;
            const value = input.value;

            if (!KEDI_DEFAULT_CUSTOMIZATION[key]) return;
            if (!isValidKediHexColor(value)) return;

            settings = {
                ...settings,
                [key]: value
            };

            applyKediCustomizationSettings(settings);
            saveKediCustomizationSettings(settings);
        });
    });

    const resetBtn = document.getElementById('kedi-customize-reset');

    if (resetBtn && resetBtn.dataset.bound !== '1') {
        resetBtn.dataset.bound = '1';

        resetBtn.addEventListener('click', () => {
            settings = { ...KEDI_DEFAULT_CUSTOMIZATION };

            saveKediCustomizationSettings(settings);
            applyKediCustomizationSettings(settings);
            syncKediCustomizationInputs(settings);
        });
    }
}