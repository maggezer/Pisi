import { registerModule } from '../core/module-registry.mjs';
import { createPisiTaskPanelButton, makePisiTaskPanelElement, pisiTaskPanelText as t } from './pisi-task-panel-dom.mjs';
import { mountPisiTaskPanel, renderPisiTaskSurface } from './pisi-task-panel.mjs';

// The task workspace (docs/task-plan.md G4.1): the task panel in the center,
// with every view (list, kanban, calendar, timeline, progress). It covers the
// center surfaces while it is open and has its own tab, which the tab bar draws
// through renderPisiTaskWorkspaceTab. Opening a note, a map or another tab
// starts a workspace navigation, which closes it.

const pisiTaskWorkspaceState = { open: false, element: null };

function ensurePisiTaskWorkspaceElement() {
    if (pisiTaskWorkspaceState.element?.isConnected) return pisiTaskWorkspaceState.element;
    const host = document.getElementById('workspace');
    if (!host) return null;
    const element = makePisiTaskPanelElement('section', 'pisi-task-workspace');
    element.id = 'pisi-task-workspace';
    element.hidden = true;
    element.setAttribute('aria-labelledby', 'pisi-task-workspace-title');
    const header = makePisiTaskPanelElement('header', 'pisi-task-workspace-header');
    const title = makePisiTaskPanelElement('h2', '', t('Görevler'));
    title.id = 'pisi-task-workspace-title';
    header.appendChild(title);
    const toolbar = makePisiTaskPanelElement('div', 'pisi-task-workspace-toolbar');
    const content = makePisiTaskPanelElement('div', 'pisi-task-workspace-content');
    element.append(header, toolbar, content);
    host.appendChild(element);
    pisiTaskWorkspaceState.element = element;
    return element;
}

function openPisiTaskWorkspace() {
    const element = ensurePisiTaskWorkspaceElement();
    if (!element) return false;
    pisiTaskWorkspaceState.open = true;
    element.hidden = false;
    document.getElementById('workspace')?.classList.add('pisi-task-workspace-open');
    const state = mountPisiTaskPanel(element.querySelector('.pisi-task-workspace-content'), {
        surface: 'workspace',
        toolbarHost: element.querySelector('.pisi-task-workspace-toolbar')
    });
    renderPisiTaskSurface(state);
    window.renderPisiOpenTabs?.();
    return true;
}

function closePisiTaskWorkspace() {
    if (!pisiTaskWorkspaceState.open) return false;
    pisiTaskWorkspaceState.open = false;
    if (pisiTaskWorkspaceState.element) pisiTaskWorkspaceState.element.hidden = true;
    document.getElementById('workspace')?.classList.remove('pisi-task-workspace-open');
    window.renderPisiOpenTabs?.();
    return true;
}

function isPisiTaskWorkspaceOpen() {
    return pisiTaskWorkspaceState.open;
}

/** Adds the workspace's tab to the tab bar while it is open (the only active tab then). Returns whether it did. */
function renderPisiTaskWorkspaceTab(tabsElement) {
    if (!pisiTaskWorkspaceState.open || !tabsElement) return false;
    tabsElement.querySelector('.center-tabs-empty')?.remove();
    for (const tab of tabsElement.querySelectorAll('.center-tab.active')) tab.classList.remove('active');
    const tab = makePisiTaskPanelElement('div', 'center-tab pisi-task-workspace-tab active');
    tab.title = t('Görev çalışma alanı');
    tab.append(makePisiTaskPanelElement('span', 'center-tab-icon', '✓'), makePisiTaskPanelElement('span', 'center-tab-title', t('Görevler')));
    const close = createPisiTaskPanelButton('center-tab-close', '×', { label: t('Sekmeyi kapat') });
    close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePisiTaskWorkspace();
    });
    tab.appendChild(close);
    tabsElement.prepend(tab);
    return true;
}

document.addEventListener('pisi:workspace-navigation', () => closePisiTaskWorkspace());

const moduleApi = {
    pisiTaskWorkspaceState,
    openPisiTaskWorkspace,
    closePisiTaskWorkspace,
    isPisiTaskWorkspaceOpen,
    renderPisiTaskWorkspaceTab
};

registerModule('tasks.workspace', moduleApi);

export { openPisiTaskWorkspace, closePisiTaskWorkspace, renderPisiTaskWorkspaceTab };
