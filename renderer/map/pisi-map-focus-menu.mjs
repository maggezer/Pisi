import { registerModule } from '../core/module-registry.mjs';

const focusMenuState = {
    menu: null,
    button: null,
    installedButton: null,
    observer: null,
    outsideBound: false,
    lastDegree: '1'
};

const focusMenuText = {
    tr: {
        focus: 'Komşulara odaklan',
        first: '1st degree',
        second: '2nd degree',
        third: '3rd degree',
        all: 'All',
        noSelection: 'Bir node seç.'
    },
    eng: {
        focus: 'Focus neighbors',
        first: '1st degree',
        second: '2nd degree',
        third: '3rd degree',
        all: 'All',
        noSelection: 'Select a node.'
    }
};

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return focusMenuText[language]?.[key] || focusMenuText.eng[key] || key;
}

function getOperationalModule() {
    return window.Pisi?.modules?.['map.operational'] || null;
}

function getSelectedMapNodeBox() {
    const boxes = Array.from(document.querySelectorAll('.map-node-box.selected:not(.pisi-operational-filter-hidden)'));
    return boxes.length === 1 ? boxes[0] : null;
}

function collectConnectedNodeIds(rootNodeId) {
    const root = String(rootNodeId || '');
    if (!root) return [];
    const adjacency = new Map();
    const ensure = (id) => {
        if (!adjacency.has(id)) adjacency.set(id, new Set());
        return adjacency.get(id);
    };
    for (const edge of Array.isArray(window.activeMapEdges) ? window.activeMapEdges : []) {
        const sourceId = String(edge?.sourceId || '');
        const targetId = String(edge?.targetId || '');
        if (!sourceId || !targetId || sourceId === targetId) continue;
        ensure(sourceId).add(targetId);
        ensure(targetId).add(sourceId);
    }
    const visited = new Set([root]);
    const queue = [root];
    while (queue.length) {
        const current = queue.shift();
        for (const neighbor of adjacency.get(current) || []) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }
    return Array.from(visited);
}

function closeFocusMenu() {
    const menu = focusMenuState.menu;
    const button = focusMenuState.button;
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
}

function positionFocusMenu() {
    const menu = focusMenuState.menu;
    const button = focusMenuState.button;
    if (!menu || !button || menu.hidden) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = Math.max(138, menu.offsetWidth || 138);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
}

function syncFocusMenuSelection() {
    const current = String(focusMenuState.lastDegree || '1');
    focusMenuState.menu?.querySelectorAll('[data-pisi-focus-degree]').forEach((option) => {
        option.setAttribute('aria-checked', option.dataset.pisiFocusDegree === current ? 'true' : 'false');
    });
}

function rebuildFocusMenuLabels() {
    const menu = focusMenuState.menu;
    if (!menu) return;
    for (const [value, key] of [
        ['1', 'first'],
        ['2', 'second'],
        ['3', 'third'],
        ['all', 'all']
    ]) {
        const option = menu.querySelector(`[data-pisi-focus-degree="${value}"]`);
        if (option) option.textContent = t(key);
    }
    if (focusMenuState.button) {
        focusMenuState.button.title = t('focus');
        focusMenuState.button.setAttribute('aria-label', t('focus'));
    }
}

function ensureFocusMenu() {
    if (focusMenuState.menu?.isConnected) return focusMenuState.menu;
    const menu = document.createElement('div');
    menu.id = 'pisi-map-focus-degree-menu';
    menu.className = 'pisi-map-focus-degree-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    for (const [value, key] of [
        ['1', 'first'],
        ['2', 'second'],
        ['3', 'third'],
        ['all', 'all']
    ]) {
        const option = document.createElement('button');
        option.type = 'button';
        option.dataset.pisiFocusDegree = value;
        option.setAttribute('role', 'menuitemradio');
        option.setAttribute('aria-checked', 'false');
        option.textContent = t(key);
        option.addEventListener('click', () => {
            void applyFocusDegree(value);
        });
        menu.appendChild(option);
    }

    document.body.appendChild(menu);
    focusMenuState.menu = menu;
    syncFocusMenuSelection();
    return menu;
}

async function persistOperationalScope() {
    const operational = getOperationalModule();
    const state = operational?.operationalState;
    if (!state || !window.activeMapPath || !window.pisiProject?.saveMapCamera) return;
    const result = await window.pisiProject.saveMapCamera(window.activeMapPath, {
        ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
        collapsedHubs: Array.from(window.collapsedHubPorts || []),
        operationalPayload: {
            op: 'update',
            scope: state.scope,
            display: state.display
        }
    });
    if (!result?.operational) return;
    state.scope = result.operational.scope || state.scope;
    state.display = result.operational.display || state.display;
    state.savedLayouts = Array.isArray(result.operational.savedLayouts) ? result.operational.savedLayouts : state.savedLayouts;
}

async function applyFocusDegree(degree) {
    const selected = getSelectedMapNodeBox();
    if (!selected) {
        alert(t('noSelection'));
        closeFocusMenu();
        return;
    }
    const operational = getOperationalModule();
    const state = operational?.operationalState;
    if (!state?.scope) return;

    const rootNodeId = String(selected.dataset.nodeId || '');
    focusMenuState.lastDegree = degree;

    if (degree === 'all') {
        state.scope.mode = 'manual';
        state.scope.includedNodeIds = collectConnectedNodeIds(rootNodeId);
        state.scope.focusRootNodeId = null;
        state.scope.focusDepth = 1;
    } else {
        state.scope.mode = 'neighbors';
        state.scope.focusRootNodeId = rootNodeId;
        state.scope.focusDepth = Math.min(3, Math.max(1, Number(degree) || 1));
    }

    closeFocusMenu();
    syncFocusMenuSelection();
    operational.schedulePisiOperationalRender?.();
    await persistOperationalScope();
}

function bindFocusButton(button) {
    if (!button || button.dataset.pisiFocusDegreeMenu === '1') return button;

    const replacement = button.cloneNode(true);
    replacement.dataset.pisiFocusDegreeMenu = '1';
    replacement.setAttribute('aria-haspopup', 'menu');
    replacement.setAttribute('aria-controls', 'pisi-map-focus-degree-menu');
    replacement.setAttribute('aria-expanded', 'false');
    replacement.title = t('focus');
    replacement.setAttribute('aria-label', t('focus'));

    replacement.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (replacement.disabled) return;
        const menu = ensureFocusMenu();
        const opening = menu.hidden;
        menu.hidden = !opening;
        replacement.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) {
            syncFocusMenuSelection();
            positionFocusMenu();
        }
    });

    button.replaceWith(replacement);
    focusMenuState.button = replacement;
    focusMenuState.installedButton = replacement;
    return replacement;
}

function installFocusDegreeMenu() {
    document.getElementById('pisi-map-operational-depth')?.remove();
    const focusButton = document.getElementById('pisi-map-operational-focus');
    if (!focusButton) return false;
    bindFocusButton(focusButton);
    ensureFocusMenu();
    rebuildFocusMenuLabels();
    return true;
}

function bindGlobalFocusMenuHandlers() {
    if (focusMenuState.outsideBound) return;
    focusMenuState.outsideBound = true;

    document.addEventListener(
        'mousedown',
        (event) => {
            const menu = focusMenuState.menu;
            const button = focusMenuState.button;
            if (!menu || menu.hidden) return;
            if (menu.contains(event.target) || button?.contains(event.target)) return;
            closeFocusMenu();
        },
        true
    );

    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Escape' || !focusMenuState.menu || focusMenuState.menu.hidden) return;
            event.preventDefault();
            closeFocusMenu();
            focusMenuState.button?.focus();
        },
        true
    );

    window.addEventListener('resize', positionFocusMenu);
    window.addEventListener('scroll', positionFocusMenu, true);
    document.addEventListener('pisi:language-changed', rebuildFocusMenuLabels);
    document.addEventListener('pisi:map-customization-context-changed', () => {
        requestAnimationFrame(installFocusDegreeMenu);
    });
}

function initializeFocusDegreeMenu() {
    bindGlobalFocusMenuHandlers();
    installFocusDegreeMenu();
    const host = document.getElementById('right-panel-content') || document.body;
    if (!focusMenuState.observer && host) {
        focusMenuState.observer = new MutationObserver(() => {
            if (
                !document.getElementById('pisi-map-operational-depth') &&
                document.getElementById('pisi-map-operational-focus')?.dataset.pisiFocusDegreeMenu === '1'
            ) {
                return;
            }
            requestAnimationFrame(installFocusDegreeMenu);
        });
        focusMenuState.observer.observe(host, { childList: true, subtree: true });
    }
}

registerModule('map.focusMenu', {
    applyFocusDegree,
    closeFocusMenu,
    collectConnectedNodeIds,
    initializeFocusDegreeMenu,
    installFocusDegreeMenu
});

initializeFocusDegreeMenu();

export { applyFocusDegree, closeFocusMenu, collectConnectedNodeIds, initializeFocusDegreeMenu, installFocusDegreeMenu };
