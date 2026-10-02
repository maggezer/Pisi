const PISI_TODO_WORKSPACE_VIEWS = Object.freeze([
    Object.freeze({ value: 'kanban', label: 'Kanban' }),
    Object.freeze({ value: 'calendar', label: 'Takvim' }),
    Object.freeze({ value: 'timeline', label: 'Zaman çizelgesi' }),
    Object.freeze({ value: 'stats', label: 'İlerleme' })
]);

const pisiTodoWorkspaceState = {
    open: false,
    view: 'kanban',
    hiddenSnapshot: null,
    renderQueued: false,
    tabsObserver: null,
    missionsObserver: null
};

function pisiTodoWorkspaceTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiTodoWorkspaceProjectKey() {
    return String(window.currentProjectFolder || 'no-project')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
}

function getPisiTodoWorkspaceStorageKey() {
    return `pisiTodoWorkspace:${encodeURIComponent(getPisiTodoWorkspaceProjectKey())}:view`;
}

function loadPisiTodoWorkspaceView() {
    try {
        const saved = localStorage.getItem(getPisiTodoWorkspaceStorageKey());
        if (PISI_TODO_WORKSPACE_VIEWS.some((item) => item.value === saved)) {
            pisiTodoWorkspaceState.view = saved;
        }
    } catch {
        // Görünüm tercihi kaydedilemese de çalışma alanı kullanılabilir.
    }
}

function savePisiTodoWorkspaceView() {
    try {
        localStorage.setItem(getPisiTodoWorkspaceStorageKey(), pisiTodoWorkspaceState.view);
    } catch {
        // Görünüm tercihi zorunlu değildir.
    }
}

function forcePisiRightTodoListView() {
    const state = window.pisiTodoThirdReleaseState;
    if (!state || state.view === 'list') return false;

    state.view = 'list';
    queueMicrotask(() => {
        window.renderPisiMissionsPanelFirstRelease?.();
    });
    return true;
}

function ensurePisiTodoWorkspaceOpenButton() {
    const host = document.getElementById('pisi-todo-panel-actions-host');
    if (!host) return null;

    let actions = host.querySelector('.pisi-todo-panel-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'pisi-todo-panel-actions';
        host.replaceChildren(actions);
    }

    let workspaceButton = actions.querySelector('#pisi-todo-workspace-open');
    if (!workspaceButton) {
        workspaceButton = document.createElement('button');
        workspaceButton.id = 'pisi-todo-workspace-open';
        workspaceButton.type = 'button';
        workspaceButton.className = 'pisi-todo-panel-action pisi-todo-workspace-open';
        const icon = document.createElement('span');
        icon.className = 'pisi-todo-panel-action-icon pisi-todo-panel-workspace-icon';
        icon.setAttribute('aria-hidden', 'true');
        workspaceButton.appendChild(icon);
        workspaceButton.title = pisiTodoWorkspaceTranslate('To-do çalışma alanını aç');
        workspaceButton.setAttribute('aria-label', workspaceButton.title);
        workspaceButton.addEventListener('click', openPisiTodoWorkspace);
        actions.appendChild(workspaceButton);
    }

    let quickAddButton = actions.querySelector('#pisi-todo-quick-add');
    if (!quickAddButton) {
        quickAddButton = document.createElement('button');
        quickAddButton.id = 'pisi-todo-quick-add';
        quickAddButton.type = 'button';
        quickAddButton.className = 'pisi-todo-panel-action pisi-todo-quick-add';
        quickAddButton.setAttribute('aria-keyshortcuts', 'Control+M');
        const icon = document.createElement('span');
        icon.className = 'pisi-todo-panel-action-icon pisi-todo-quick-add-icon';
        icon.setAttribute('aria-hidden', 'true');
        quickAddButton.appendChild(icon);
        quickAddButton.title = pisiTodoWorkspaceTranslate('Görev ekleme penceresini aç (Ctrl+M)');
        quickAddButton.setAttribute('aria-label', quickAddButton.title);
        quickAddButton.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('pisi:quick-add-requested', { detail: { source: 'todo-panel' } }));
        });
        actions.appendChild(quickAddButton);
    }

    return workspaceButton;
}

function ensurePisiTodoWorkspaceDom() {
    let workspace = document.getElementById('pisi-todo-workspace');
    if (workspace) return workspace;

    const host = document.getElementById('workspace');
    if (!host) return null;

    workspace = document.createElement('section');
    workspace.id = 'pisi-todo-workspace';
    workspace.className = 'pisi-todo-workspace';
    workspace.hidden = true;

    const header = document.createElement('header');
    header.className = 'pisi-todo-workspace-header';

    const heading = document.createElement('div');
    heading.className = 'pisi-todo-workspace-heading';
    const title = document.createElement('h2');
    title.textContent = pisiTodoWorkspaceTranslate('To-do');
    const subtitle = document.createElement('span');
    subtitle.className = 'pisi-todo-workspace-subtitle';
    heading.append(title, subtitle);

    const navigation = document.createElement('nav');
    navigation.className = 'pisi-todo-workspace-navigation';
    navigation.setAttribute('aria-label', pisiTodoWorkspaceTranslate('To-do genel görünümleri'));

    for (const view of PISI_TODO_WORKSPACE_VIEWS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-todo-workspace-view';
        button.dataset.view = view.value;
        button.textContent = pisiTodoWorkspaceTranslate(view.label);
        button.addEventListener('click', () => {
            pisiTodoWorkspaceState.view = view.value;
            savePisiTodoWorkspaceView();
            renderPisiTodoWorkspace();
        });
        navigation.appendChild(button);
    }

    header.append(heading, navigation);

    const content = document.createElement('div');
    content.id = 'pisi-todo-workspace-content';
    content.className = 'pisi-todo-workspace-content';
    content.addEventListener('click', (event) => {
        if (!event.target.closest('.pisi-third-calendar-nav-button, .pisi-third-calendar-today')) {
            return;
        }
        queueMicrotask(renderPisiTodoWorkspace);
    });

    workspace.append(header, content);
    host.appendChild(workspace);
    return workspace;
}

function getPisiTodoWorkspaceMissions() {
    if (!window.currentProjectFolder) return [];
    if (typeof window.getPisiMissionsFromIndexFirstRelease !== 'function') {
        return [];
    }

    const missions = window.getPisiMissionsFromIndexFirstRelease({
        includeCompleted: true
    });

    return typeof window.enhancePisiMissionsThirdRelease === 'function' ? window.enhancePisiMissionsThirdRelease(missions) : missions;
}

function updatePisiTodoWorkspaceNavigation(workspace) {
    workspace.querySelectorAll('.pisi-todo-workspace-view').forEach((button) => {
        const active = button.dataset.view === pisiTodoWorkspaceState.view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function renderPisiTodoWorkspace() {
    if (!pisiTodoWorkspaceState.open) return;
    const workspace = ensurePisiTodoWorkspaceDom();
    const content = document.getElementById('pisi-todo-workspace-content');
    if (!workspace || !content) return;

    forcePisiRightTodoListView();
    updatePisiTodoWorkspaceNavigation(workspace);

    const subtitle = workspace.querySelector('.pisi-todo-workspace-subtitle');
    if (subtitle) {
        const projectName = getPisiTodoWorkspaceProjectKey().split('/').filter(Boolean).pop();
        subtitle.textContent = window.currentProjectFolder
            ? `${projectName || pisiTodoWorkspaceTranslate('Proje')} · ${pisiTodoWorkspaceTranslate('genel görev görünümü')}`
            : pisiTodoWorkspaceTranslate('Önce bir proje klasörü seçin.');
    }

    if (!window.currentProjectFolder) {
        content.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'pisi-todo-workspace-empty';
        empty.textContent = pisiTodoWorkspaceTranslate('To-do çalışma alanı için önce bir proje klasörü seçin.');
        content.appendChild(empty);
        return;
    }

    const missions = getPisiTodoWorkspaceMissions();
    const renderer = {
        kanban: window.renderPisiTodoThirdKanban,
        calendar: window.renderPisiTodoThirdCalendar,
        timeline: window.renderPisiTodoThirdTimeline,
        stats: window.renderPisiTodoThirdStats
    }[pisiTodoWorkspaceState.view];

    if (typeof renderer !== 'function') {
        content.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'pisi-todo-workspace-empty';
        empty.textContent = pisiTodoWorkspaceTranslate('To-do görünümü henüz hazır değil.');
        content.appendChild(empty);
        return;
    }

    renderer(content, missions);
}

function schedulePisiTodoWorkspaceRender() {
    if (!pisiTodoWorkspaceState.open || pisiTodoWorkspaceState.renderQueued) {
        return;
    }
    pisiTodoWorkspaceState.renderQueued = true;
    queueMicrotask(() => {
        pisiTodoWorkspaceState.renderQueued = false;
        renderPisiTodoWorkspace();
    });
}

function captureAndHidePisiCenterSurfaces() {
    if (pisiTodoWorkspaceState.hiddenSnapshot) return;

    const ids = ['workspace-placeholder', 'map-canvas', 'center-node-editor'];
    pisiTodoWorkspaceState.hiddenSnapshot = {};

    for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        pisiTodoWorkspaceState.hiddenSnapshot[id] = element.hidden;
        element.hidden = true;
    }
}

function restorePisiCenterSurfaces() {
    const snapshot = pisiTodoWorkspaceState.hiddenSnapshot;
    pisiTodoWorkspaceState.hiddenSnapshot = null;
    if (!snapshot) return;

    for (const [id, hidden] of Object.entries(snapshot)) {
        const element = document.getElementById(id);
        if (element) element.hidden = hidden;
    }
}

function ensurePisiTodoVirtualTab() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs || !pisiTodoWorkspaceState.open) return null;

    tabs.querySelector('.center-tabs-empty')?.remove();
    let tab = tabs.querySelector('.pisi-todo-center-tab');
    if (!tab) {
        tab = document.createElement('div');
        tab.className = 'center-tab pisi-todo-center-tab';
        tab.title = pisiTodoWorkspaceTranslate('To-do çalışma alanı');

        const icon = document.createElement('span');
        icon.className = 'center-tab-icon';
        icon.textContent = '✓';

        const title = document.createElement('span');
        title.className = 'center-tab-title';
        title.textContent = pisiTodoWorkspaceTranslate('To-do');

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'center-tab-close';
        close.title = pisiTodoWorkspaceTranslate('Sekmeyi kapat');
        close.textContent = '×';
        close.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closePisiTodoWorkspace();
        });

        tab.append(icon, title, close);
        tab.addEventListener('click', (event) => {
            if (event.target.closest('.center-tab-close')) return;
            openPisiTodoWorkspace();
        });
        tabs.prepend(tab);
    }

    tabs.querySelectorAll('.center-tab').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === tab);
    });
    return tab;
}

async function openPisiTodoWorkspace() {
    forcePisiRightTodoListView();
    loadPisiTodoWorkspaceView();
    const workspace = ensurePisiTodoWorkspaceDom();
    if (!workspace) return false;

    if (!pisiTodoWorkspaceState.open) {
        captureAndHidePisiCenterSurfaces();
    }
    pisiTodoWorkspaceState.open = true;
    workspace.hidden = false;
    ensurePisiTodoVirtualTab();
    renderPisiTodoWorkspace();

    if (typeof window.refreshPisiMissionIndex === 'function') {
        await window.refreshPisiMissionIndex({
            reason: 'todo-workspace-open'
        });
        if (pisiTodoWorkspaceState.open) renderPisiTodoWorkspace();
    }
    return true;
}

function closePisiTodoWorkspace(options = {}) {
    if (!pisiTodoWorkspaceState.open) return;
    pisiTodoWorkspaceState.open = false;

    const workspace = document.getElementById('pisi-todo-workspace');
    if (workspace) workspace.hidden = true;
    document.querySelector('.pisi-todo-center-tab')?.remove();

    if (options.restore !== false) restorePisiCenterSurfaces();
    else pisiTodoWorkspaceState.hiddenSnapshot = null;

    window.renderPisiOpenTabs?.();
}

function bindPisiTodoWorkspaceTabs() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs) return;

    tabs.addEventListener('click', (event) => {
        const regularTab = event.target.closest('.center-tab:not(.pisi-todo-center-tab)');
        if (!regularTab || event.target.closest('.center-tab-close')) return;
        if (pisiTodoWorkspaceState.open) closePisiTodoWorkspace();
    });

    pisiTodoWorkspaceState.tabsObserver?.disconnect();
    pisiTodoWorkspaceState.tabsObserver = new MutationObserver(() => {
        if (pisiTodoWorkspaceState.open) ensurePisiTodoVirtualTab();
    });
    pisiTodoWorkspaceState.tabsObserver.observe(tabs, {
        childList: true
    });
}

function bindPisiTodoWorkspaceMissionRefresh() {
    const panel = document.getElementById('pisi-missions-panel');
    if (!panel) return;

    pisiTodoWorkspaceState.missionsObserver?.disconnect();
    pisiTodoWorkspaceState.missionsObserver = new MutationObserver(() => {
        forcePisiRightTodoListView();
        schedulePisiTodoWorkspaceRender();
    });
    pisiTodoWorkspaceState.missionsObserver.observe(panel, {
        childList: true,
        subtree: true
    });
}

function initializePisiTodoWorkspace() {
    forcePisiRightTodoListView();
    ensurePisiTodoWorkspaceOpenButton();
    ensurePisiTodoWorkspaceDom();
    bindPisiTodoWorkspaceTabs();
    bindPisiTodoWorkspaceMissionRefresh();
    document.addEventListener('pisi:mission-index-updated', schedulePisiTodoWorkspaceRender);

    document.addEventListener('pisi:active-node-changed', (event) => {
        if (!pisiTodoWorkspaceState.open) return;
        if (event.detail?.reason !== 'center-open') return;
        closePisiTodoWorkspace({ restore: false });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiTodoWorkspace);
} else {
    initializePisiTodoWorkspace();
}

export { PISI_TODO_WORKSPACE_VIEWS, pisiTodoWorkspaceState, openPisiTodoWorkspace, closePisiTodoWorkspace, renderPisiTodoWorkspace };
