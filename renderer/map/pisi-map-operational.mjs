import { registerModule } from '../core/module-registry.mjs';
import { normalizePisiOperationalDisplay, normalizePisiOperationalScope } from './pisi-map-operational-core.mjs';
import { clearPisiOperationalMapRender, renderPisiOperationalMap } from './pisi-map-operational-render.mjs';

const operationalState = {
    mapPath: null,
    scope: normalizePisiOperationalScope({}),
    display: normalizePisiOperationalDisplay({}),
    savedLayouts: [],
    initialized: false,
    loading: false,
    persistTimer: null,
    renderFrame: null,
    lastRender: null,
    observer: null
};

const operationalText = {
    tr: {
        search: 'Map içinde ara',
        all: 'Tümü',
        active: 'Aktif iş',
        blocked: 'Blocked',
        overdue: 'Geciken',
        missing: 'Next action yok',
        relations: 'Tüm ilişkiler',
        hierarchy: 'Hierarchy',
        flow: 'Flow',
        peer: 'Peer',
        focus: 'Komşulara odaklan',
        linked: 'Bağlı node oluştur',
        deps: 'Dependencies',
        labels: 'Labels',
        work: 'Work badges',
        layout: 'Layout seç',
        save: 'Layout kaydet',
        restore: 'Geri yükle',
        remove: 'Sil',
        reset: 'Reset',
        layoutName: 'Layout adı',
        cancel: 'İptal',
        noSelection: 'Bir node seç.',
        createFailed: 'Bağlı node oluşturulamadı.',
        saveFailed: 'Operational map kaydedilemedi.',
        visible: 'görünür',
        blockedShort: 'blocked',
        overdueShort: 'geciken'
    },
    eng: {
        search: 'Search map',
        all: 'All',
        active: 'Active work',
        blocked: 'Blocked',
        overdue: 'Overdue',
        missing: 'Missing next action',
        relations: 'All relationships',
        hierarchy: 'Hierarchy',
        flow: 'Flow',
        peer: 'Peer',
        focus: 'Focus neighbors',
        linked: 'Create linked node',
        deps: 'Dependencies',
        labels: 'Labels',
        work: 'Work badges',
        layout: 'Choose layout',
        save: 'Save layout',
        restore: 'Restore',
        remove: 'Delete',
        reset: 'Reset',
        layoutName: 'Layout name',
        cancel: 'Cancel',
        noSelection: 'Select a node.',
        createFailed: 'Linked node could not be created.',
        saveFailed: 'Operational map could not be saved.',
        visible: 'visible',
        blockedShort: 'blocked',
        overdueShort: 'overdue'
    }
};

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return operationalText[language][key] || operationalText.tr[key] || key;
}

function ensurePisiOperationalStyles() {
    // Consolidated CSS is loaded statically through style.css.
}

function getPisiOperationalMapItem() {
    if (!window.activeMapPath) return null;
    const fileName = String(window.activeMapPath).split(/[\\/]/).pop() || 'Map.map';
    return { name: fileName, fileName, fullPath: window.activeMapPath };
}

function getSelectedOperationalNodeBox() {
    const boxes = Array.from(document.querySelectorAll('.map-node-box.selected:not(.pisi-operational-filter-hidden)'));
    return boxes.length === 1 ? boxes[0] : null;
}

function getOperationalPayload(op, extra = {}) {
    return {
        op,
        scope: operationalState.scope,
        display: operationalState.display,
        ...extra
    };
}

function requestPisiName({ title = '', label = '', initialValue = '', confirmLabel = '', cancelLabel = '' } = {}) {
    return new Promise((resolve) => {
        document.getElementById('pisi-map-name-dialog')?.remove();

        const dialog = document.createElement('dialog');
        dialog.id = 'pisi-map-name-dialog';
        dialog.className = 'pisi-map-name-dialog';

        const form = document.createElement('form');
        form.method = 'dialog';
        form.className = 'pisi-map-name-dialog-form';

        const heading = document.createElement('strong');
        heading.id = 'pisi-map-name-dialog-title';
        heading.textContent = title || label;
        dialog.setAttribute('aria-labelledby', heading.id);

        const field = document.createElement('label');
        field.className = 'pisi-map-name-dialog-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const input = document.createElement('input');
        input.type = 'text';
        input.required = true;
        input.autocomplete = 'off';
        input.value = String(initialValue || '');
        field.append(caption, input);

        const actions = document.createElement('div');
        actions.className = 'pisi-map-name-dialog-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = cancelLabel || t('cancel');
        const confirm = document.createElement('button');
        confirm.type = 'submit';
        confirm.textContent = confirmLabel || t('save');
        actions.append(cancel, confirm);
        form.append(heading, field, actions);
        dialog.appendChild(form);

        cancel.addEventListener('click', () => dialog.close('cancel'));
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            dialog.close('cancel');
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!input.value.trim()) {
                input.focus();
                return;
            }
            dialog.close('save');
        });
        dialog.addEventListener(
            'close',
            () => {
                const value = dialog.returnValue === 'save' ? input.value.trim() : '';
                dialog.remove();
                resolve(value || null);
            },
            { once: true }
        );

        document.body.appendChild(dialog);
        dialog.showModal();
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    });
}

async function persistPisiOperationalPayload(payload) {
    if (!window.activeMapPath || !window.pisiProject?.saveMapCamera) return null;
    const result = await window.pisiProject.saveMapCamera(window.activeMapPath, {
        ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
        collapsedHubs: Array.from(window.collapsedHubPorts || []),
        operationalPayload: payload
    });
    if (result?.operational) {
        operationalState.scope = normalizePisiOperationalScope(result.operational.scope);
        operationalState.display = normalizePisiOperationalDisplay(result.operational.display);
        operationalState.savedLayouts = Array.isArray(result.operational.savedLayouts) ? result.operational.savedLayouts : [];
    }
    return result;
}

function schedulePisiOperationalPersistence() {
    clearTimeout(operationalState.persistTimer);
    operationalState.persistTimer = setTimeout(async () => {
        operationalState.persistTimer = null;
        const result = await persistPisiOperationalPayload(getOperationalPayload('update'));
        if (result && !result.ok) console.error('[PISI]', t('saveFailed'), result.error);
    }, 350);
}

function updatePisiOperationalSummary() {
    const summaryEl = document.getElementById('pisi-map-operational-summary');
    const summary = operationalState.lastRender?.summary;
    if (!summaryEl || !summary) return;
    summaryEl.textContent = [
        `${summary.visible}/${summary.total} ${t('visible')}`,
        summary.blocked ? `${summary.blocked} ${t('blockedShort')}` : '',
        summary.overdue ? `${summary.overdue} ${t('overdueShort')}` : ''
    ]
        .filter(Boolean)
        .join(' · ');
}

function schedulePisiOperationalRender() {
    if (!window.activeMapPath) return;
    if (operationalState.renderFrame !== null) return;
    operationalState.renderFrame = requestAnimationFrame(() => {
        operationalState.renderFrame = null;
        operationalState.lastRender = renderPisiOperationalMap(operationalState.scope, operationalState.display);
        updatePisiOperationalSummary();
        updatePisiOperationalControlState();
    });
}

function updatePisiOperationalControlState() {
    const selected = getSelectedOperationalNodeBox();
    const focus = document.getElementById('pisi-map-operational-focus');
    if (focus) focus.disabled = !selected;
    for (const [id, enabled] of /** @type {Array<[string, boolean]>} */ ([
        ['pisi-map-operational-deps', operationalState.display.showTaskDependencies],
        ['pisi-map-operational-labels', operationalState.display.showRelationshipLabels],
        ['pisi-map-operational-work', operationalState.display.showWorkBadges]
    ])) {
        const button = document.getElementById(id);
        if (button) button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
}

function syncPisiOperationalControlsFromState() {
    const scope = document.getElementById('pisi-map-operational-scope');
    const query = document.getElementById('pisi-map-operational-query');
    const relation = document.getElementById('pisi-map-operational-relation');
    const depth = document.getElementById('pisi-map-operational-depth');
    if (scope) scope.value = operationalState.scope.mode === 'neighbors' ? 'all' : operationalState.scope.mode;
    if (query) query.value = operationalState.scope.query || '';
    if (relation) relation.value = operationalState.scope.relationshipTypes[0] || 'all';
    if (depth) depth.value = String(operationalState.scope.focusDepth || 1);
    renderPisiOperationalLayoutOptions();
    updatePisiOperationalControlState();
}

function makeOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function renderPisiOperationalLayoutOptions() {
    const select = document.getElementById('pisi-map-operational-layout');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(makeOption('', t('layout')));
    for (const layout of operationalState.savedLayouts) {
        select.appendChild(makeOption(layout.id, layout.name));
    }
    if (operationalState.savedLayouts.some((item) => item.id === current)) {
        select.value = current;
    }
    const hasSelection = Boolean(select.value);
    const restore = document.getElementById('pisi-map-operational-restore');
    const remove = document.getElementById('pisi-map-operational-delete-layout');
    if (restore) restore.disabled = !hasSelection;
    if (remove) remove.disabled = !hasSelection;
}

function rebuildPisiOperationalControlLabels() {
    const scope = document.getElementById('pisi-map-operational-scope');
    if (scope) {
        const value = scope.value;
        scope.replaceChildren(
            makeOption('all', t('all')),
            makeOption('active', t('active')),
            makeOption('blocked', t('blocked')),
            makeOption('overdue', t('overdue')),
            makeOption('missing-next-action', t('missing'))
        );
        scope.value = value || 'all';
    }
    const relation = document.getElementById('pisi-map-operational-relation');
    if (relation) {
        const value = relation.value;
        relation.replaceChildren(
            makeOption('all', t('relations')),
            makeOption('down-hub', t('hierarchy')),
            makeOption('stream', t('flow')),
            makeOption('co-level', t('peer'))
        );
        relation.value = value || 'all';
    }
    const query = document.getElementById('pisi-map-operational-query');
    if (query) query.placeholder = t('search');
    for (const [id, key] of [
        ['pisi-map-operational-focus', 'focus'],
        ['pisi-map-operational-deps', 'deps'],
        ['pisi-map-operational-labels', 'labels'],
        ['pisi-map-operational-work', 'work'],
        ['pisi-map-operational-save-layout', 'save'],
        ['pisi-map-operational-restore', 'restore'],
        ['pisi-map-operational-delete-layout', 'remove'],
        ['pisi-map-operational-reset', 'reset']
    ]) {
        const button = document.getElementById(id);
        if (button) button.textContent = t(key);
    }
    renderPisiOperationalLayoutOptions();
    updatePisiOperationalSummary();
}

function createPisiOperationalBar() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || document.getElementById('pisi-map-operational-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'pisi-map-operational-bar';
    bar.className = 'pisi-map-operational-bar pisi-map-overlay-control';

    const scope = document.createElement('select');
    scope.id = 'pisi-map-operational-scope';
    const query = document.createElement('input');
    query.id = 'pisi-map-operational-query';
    query.type = 'search';
    const relation = document.createElement('select');
    relation.id = 'pisi-map-operational-relation';
    const depth = document.createElement('select');
    depth.id = 'pisi-map-operational-depth';
    depth.append(makeOption('1', '1-hop'), makeOption('2', '2-hop'), makeOption('3', '3-hop'));

    const ids = ['focus', 'deps', 'labels', 'work', 'save-layout', 'restore', 'delete-layout', 'reset'];
    const buttons = Object.fromEntries(
        ids.map((id) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `pisi-map-operational-${id}`;
            return [id, button];
        })
    );
    const layout = document.createElement('select');
    layout.id = 'pisi-map-operational-layout';
    const summary = document.createElement('span');
    summary.id = 'pisi-map-operational-summary';
    summary.className = 'pisi-map-operational-summary';

    bar.append(
        scope,
        query,
        relation,
        depth,
        buttons.focus,
        buttons.deps,
        buttons.labels,
        buttons.work,
        layout,
        buttons['save-layout'],
        buttons.restore,
        buttons['delete-layout'],
        buttons.reset,
        summary
    );
    canvas.appendChild(bar);
    bindPisiOperationalControls();
    rebuildPisiOperationalControlLabels();
}

function bindPisiOperationalControls() {
    const scope = document.getElementById('pisi-map-operational-scope');
    const query = document.getElementById('pisi-map-operational-query');
    const relation = document.getElementById('pisi-map-operational-relation');
    const depth = document.getElementById('pisi-map-operational-depth');

    scope?.addEventListener('change', () => {
        operationalState.scope.mode = scope.value;
        operationalState.scope.focusRootNodeId = null;
        schedulePisiOperationalRender();
        schedulePisiOperationalPersistence();
    });
    query?.addEventListener('input', () => {
        operationalState.scope.query = String(query.value || '')
            .trim()
            .toLowerCase();
        schedulePisiOperationalRender();
        schedulePisiOperationalPersistence();
    });
    relation?.addEventListener('change', () => {
        operationalState.scope.relationshipTypes = relation.value === 'all' ? [] : [relation.value];
        schedulePisiOperationalRender();
        schedulePisiOperationalPersistence();
    });
    depth?.addEventListener('change', () => {
        operationalState.scope.focusDepth = Number(depth.value) || 1;
        if (operationalState.scope.focusRootNodeId) {
            operationalState.scope.mode = 'neighbors';
            schedulePisiOperationalRender();
            schedulePisiOperationalPersistence();
        }
    });

    document.getElementById('pisi-map-operational-focus')?.addEventListener('click', () => {
        const selected = getSelectedOperationalNodeBox();
        if (!selected) return alert(t('noSelection'));
        operationalState.scope.focusRootNodeId = selected.dataset.nodeId;
        operationalState.scope.focusDepth = Number(depth?.value) || 1;
        operationalState.scope.mode = 'neighbors';
        schedulePisiOperationalRender();
        schedulePisiOperationalPersistence();
    });
    document.getElementById('pisi-map-operational-deps')?.addEventListener('click', () => togglePisiOperationalDisplay('showTaskDependencies'));
    document.getElementById('pisi-map-operational-labels')?.addEventListener('click', () => togglePisiOperationalDisplay('showRelationshipLabels'));
    document.getElementById('pisi-map-operational-work')?.addEventListener('click', () => togglePisiOperationalDisplay('showWorkBadges'));
    document.getElementById('pisi-map-operational-save-layout')?.addEventListener('click', savePisiOperationalLayout);
    document.getElementById('pisi-map-operational-restore')?.addEventListener('click', restorePisiOperationalLayout);
    document.getElementById('pisi-map-operational-delete-layout')?.addEventListener('click', deletePisiOperationalLayout);
    document.getElementById('pisi-map-operational-layout')?.addEventListener('change', renderPisiOperationalLayoutOptions);
    document.getElementById('pisi-map-operational-reset')?.addEventListener('click', resetPisiOperationalScope);
}

function togglePisiOperationalDisplay(key) {
    operationalState.display[key] = !operationalState.display[key];
    schedulePisiOperationalRender();
    schedulePisiOperationalPersistence();
}

async function createPisiOperationalLinkedNode() {
    const sourceBox = getSelectedOperationalNodeBox();
    if (!sourceBox || !window.activeMapPath) return alert(t('noSelection'));
    const mapPath = window.activeMapPath;
    const sourceId = sourceBox.dataset.nodeId;
    const created = await window.pisiProject?.createNodeUnderMap?.(mapPath);
    if (!created?.ok || !created.node?.id) {
        return alert(created?.error || t('createFailed'));
    }
    const x = parseFloat(sourceBox.style.left || '0') + sourceBox.offsetWidth + 120;
    const y = parseFloat(sourceBox.style.top || '0');
    await window.pisiProject?.saveMapLayout?.(mapPath, [
        {
            id: created.node.id,
            x,
            y,
            width: Number(created.node.layout?.width || 220),
            height: Number(created.node.layout?.height || 92)
        }
    ]);
    const linked = await window.pisiProject?.upsertMapConnection?.(mapPath, {
        sourceId,
        targetId: created.node.id,
        sourcePort: 'right',
        targetPort: 'left',
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    });
    if (!linked?.ok) return alert(linked?.error || t('createFailed'));
    await window.openMapInWorkspace?.(getPisiOperationalMapItem());
}

async function savePisiOperationalLayout() {
    if (!window.activeMapPath) return;
    const name = await requestPisiName({
        title: t('save'),
        label: t('layoutName'),
        confirmLabel: t('save')
    });
    if (!name) return;
    const nodes = window.Pisi?.modules?.['map.workspace']?.collectMapLayout?.() || [];
    const result = await persistPisiOperationalPayload({
        op: 'save-layout',
        layout: {
            name,
            nodes,
            camera: {
                ...(window.activeMapCamera || {}),
                collapsedHubs: Array.from(window.collapsedHubPorts || [])
            },
            scope: operationalState.scope,
            display: operationalState.display
        }
    });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    renderPisiOperationalLayoutOptions();
    const select = document.getElementById('pisi-map-operational-layout');
    if (select && result.operational?.savedLayouts?.length) {
        select.value = result.operational.savedLayouts.at(-1).id;
        renderPisiOperationalLayoutOptions();
    }
}

async function restorePisiOperationalLayout() {
    const select = document.getElementById('pisi-map-operational-layout');
    const layout = operationalState.savedLayouts.find((item) => item.id === select?.value);
    if (!layout || !window.activeMapPath) return;
    await window.pisiProject?.saveMapLayout?.(window.activeMapPath, layout.nodes || []);
    operationalState.scope = normalizePisiOperationalScope(layout.scope);
    operationalState.display = normalizePisiOperationalDisplay(layout.display);
    const result = await window.pisiProject?.saveMapCamera?.(window.activeMapPath, {
        ...(layout.camera || {}),
        collapsedHubs: Array.isArray(layout.camera?.collapsedHubs) ? layout.camera.collapsedHubs : [],
        operationalPayload: getOperationalPayload('update')
    });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    await window.openMapInWorkspace?.(getPisiOperationalMapItem());
}

async function deletePisiOperationalLayout() {
    const select = document.getElementById('pisi-map-operational-layout');
    if (!select?.value) return;
    const result = await persistPisiOperationalPayload({
        op: 'delete-layout',
        layoutId: select.value
    });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    renderPisiOperationalLayoutOptions();
}

function resetPisiOperationalScope() {
    operationalState.scope = normalizePisiOperationalScope({});
    operationalState.display = normalizePisiOperationalDisplay({});
    syncPisiOperationalControlsFromState();
    schedulePisiOperationalRender();
    schedulePisiOperationalPersistence();
}

async function loadPisiOperationalMapState(force = false) {
    const mapPath = window.activeMapPath;
    if (!mapPath) {
        operationalState.mapPath = null;
        clearPisiOperationalMapRender();
        return;
    }
    if (!force && operationalState.mapPath === mapPath) {
        schedulePisiOperationalRender();
        return;
    }
    if (operationalState.loading) return;
    operationalState.loading = true;
    try {
        const result = await window.pisiProject?.getPisiDocument?.(mapPath);
        if (window.activeMapPath !== mapPath) return;
        operationalState.mapPath = mapPath;
        const raw = result?.data?.map?.operational || {};
        operationalState.scope = normalizePisiOperationalScope(raw.scope);
        operationalState.display = normalizePisiOperationalDisplay(raw.display);
        operationalState.savedLayouts = Array.isArray(raw.savedLayouts) ? raw.savedLayouts : [];
        createPisiOperationalBar();
        syncPisiOperationalControlsFromState();
        schedulePisiOperationalRender();
    } finally {
        operationalState.loading = false;
    }
}

function mutationTouchesOperationalMap(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        return (
            node?.nodeType === Node.ELEMENT_NODE && (node.matches?.('.map-node-box, .map-edge-group') || node.querySelector?.('.map-node-box, .map-edge-group'))
        );
    });
}

function bindPisiOperationalMap() {
    ensurePisiOperationalStyles();
    document.addEventListener('pisi:task-store-updated', schedulePisiOperationalRender);
    document.addEventListener('pisi:map-customization-context-changed', () => {
        void loadPisiOperationalMapState(false);
        updatePisiOperationalControlState();
    });
    document.addEventListener('pisi:language-changed', rebuildPisiOperationalControlLabels);
    window.addEventListener('mouseup', () => setTimeout(schedulePisiOperationalRender, 0));
    document.getElementById('map-canvas')?.addEventListener('wheel', schedulePisiOperationalRender, { passive: true });
    document.getElementById('map-canvas')?.addEventListener('mousemove', (event) => {
        if (event.buttons) schedulePisiOperationalRender();
    });

    const target = document.getElementById('workspace');
    if (target && !operationalState.observer) {
        operationalState.observer = new MutationObserver((mutations) => {
            if (mutations.some(mutationTouchesOperationalMap)) {
                schedulePisiOperationalRender();
            }
        });
        operationalState.observer.observe(target, { childList: true, subtree: true });
    }
    void loadPisiOperationalMapState(true);
}

registerModule('map.operational', {
    bindPisiOperationalMap,
    createPisiOperationalLinkedNode,
    loadPisiOperationalMapState,
    operationalState,
    requestPisiName,
    resetPisiOperationalScope,
    restorePisiOperationalLayout,
    savePisiOperationalLayout,
    schedulePisiOperationalRender
});

bindPisiOperationalMap();

export {
    bindPisiOperationalMap,
    createPisiOperationalLinkedNode,
    loadPisiOperationalMapState,
    operationalState,
    requestPisiName,
    resetPisiOperationalScope,
    restorePisiOperationalLayout,
    savePisiOperationalLayout,
    schedulePisiOperationalRender
};
