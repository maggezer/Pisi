import { registerModule } from '../core/module-registry.mjs';
import {
    normalizePisiOperationalPropertyFilter,
    normalizePisiOperationalScope
} from './pisi-map-operational-core.mjs';

const scopedMapState = {
    savedScopes: [],
    initialized: false,
    loading: false
};

const text = {
    tr: {
        live: 'Canlı scope', snapshot: 'Snapshot', freeze: 'Görünümü dondur', refresh: 'Snapshot yenile',
        property: 'Özellik seç', operator: 'Koşul', value: 'Değer', add: 'Filtre ekle',
        saved: 'Scope seç', save: 'Scope kaydet', apply: 'Uygula', remove: 'Sil',
        dim: 'Filtrelenenleri soldur', name: 'Scope adı', saveFailed: 'Scope kaydedilemedi.',
        noVisible: 'Dondurulacak görünür node yok.', contains: 'içerir', equals: 'eşittir',
        notEquals: 'eşit değildir', oneOf: 'şunlardan biri', exists: 'var', notEmpty: 'boş değil'
    },
    eng: {
        live: 'Live scope', snapshot: 'Snapshot', freeze: 'Freeze view', refresh: 'Refresh snapshot',
        property: 'Choose property', operator: 'Condition', value: 'Value', add: 'Add filter',
        saved: 'Choose scope', save: 'Save scope', apply: 'Apply', remove: 'Delete',
        dim: 'Dim filtered', name: 'Scope name', saveFailed: 'Scope could not be saved.',
        noVisible: 'There are no visible nodes to freeze.', contains: 'contains', equals: 'equals',
        notEquals: 'not equals', oneOf: 'one of', exists: 'exists', notEmpty: 'not empty'
    }
};

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return text[language][key] || text.tr[key] || key;
}

function getOperationalModule() {
    return window.Pisi?.modules?.['map.operational'] || null;
}

function ensureScopedMapStyles() {
    if (document.querySelector('link[data-pisi-map-scopes-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-scopes.css';
    link.dataset.pisiMapScopesStyle = '1';
    document.head.appendChild(link);
}

function makeOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function getMapCameraPayload() {
    return {
        ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
        collapsedHubs: Array.from(window.collapsedHubPorts || [])
    };
}

async function persistOperationalPayload(payload) {
    const current = getOperationalModule()?.operationalState;
    if (!window.activeMapPath || !current || !window.pisiProject?.saveMapCamera) return null;
    const result = await window.pisiProject.saveMapCamera(
        window.activeMapPath,
        {
            ...getMapCameraPayload(),
            operationalPayload: payload
        }
    );
    if (result?.operational) {
        current.scope = normalizePisiOperationalScope(result.operational.scope);
        current.display = result.operational.display || current.display;
        current.savedLayouts = Array.isArray(result.operational.savedLayouts)
            ? result.operational.savedLayouts
            : current.savedLayouts;
        scopedMapState.savedScopes = Array.isArray(result.operational.savedScopes)
            ? result.operational.savedScopes
            : [];
    }
    return result;
}

function scheduleOperationalRender() {
    getOperationalModule()?.schedulePisiOperationalRender?.();
}

function collectPropertyOptions() {
    const properties = new Map();
    for (const node of Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []) {
        const entries = node?.properties && typeof node.properties === 'object'
            ? Object.values(node.properties)
            : [];
        for (const property of entries) {
            const id = String(property?.id || '').trim().toLowerCase();
            const name = String(property?.name || property?.id || '').trim();
            if (!id || !name || properties.has(id)) continue;
            properties.set(id, { id, name, type: String(property?.type || 'text') });
        }
    }
    return [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderPropertyOptions() {
    const select = document.getElementById('pisi-map-scope-property');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(makeOption('', t('property')));
    for (const property of collectPropertyOptions()) {
        select.appendChild(makeOption(property.id, property.name));
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function operatorLabel(operator) {
    const labels = {
        contains: t('contains'),
        equals: t('equals'),
        'not-equals': t('notEquals'),
        'one-of': t('oneOf'),
        exists: t('exists'),
        'not-empty': t('notEmpty'),
        gt: '>', gte: '≥', lt: '<', lte: '≤'
    };
    return labels[operator] || operator;
}

function renderOperatorOptions() {
    const select = document.getElementById('pisi-map-scope-operator');
    if (!select) return;
    const current = select.value || 'contains';
    select.replaceChildren(...[
        'contains', 'equals', 'not-equals', 'one-of', 'exists', 'not-empty', 'gt', 'gte', 'lt', 'lte'
    ].map((operator) => makeOption(operator, operatorLabel(operator))));
    select.value = current;
    updateValueInputState();
}

function updateValueInputState() {
    const operator = document.getElementById('pisi-map-scope-operator')?.value || 'contains';
    const input = document.getElementById('pisi-map-scope-value');
    if (input) input.disabled = ['exists', 'not-empty'].includes(operator);
}

function filterChipLabel(filter) {
    const property = collectPropertyOptions().find((item) => item.id === filter.property);
    const left = property?.name || filter.property;
    return ['exists', 'not-empty'].includes(filter.operator)
        ? `${left} ${operatorLabel(filter.operator)}`
        : `${left} ${operatorLabel(filter.operator)} ${filter.value}`;
}

function renderFilterChips() {
    const container = document.getElementById('pisi-map-scope-filter-chips');
    const scope = getOperationalModule()?.operationalState?.scope;
    if (!container || !scope) return;
    container.replaceChildren();
    (scope.propertyFilters || []).forEach((filter, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-map-scope-filter-chip';
        button.title = `${filterChipLabel(filter)} ×`;
        button.textContent = `${filterChipLabel(filter)} ×`;
        button.addEventListener('click', () => {
            const current = getOperationalModule()?.operationalState;
            if (!current) return;
            current.scope.propertyFilters = current.scope.propertyFilters.filter((_, i) => i !== index);
            current.scope.strategy = 'live';
            renderFilterChips();
            syncScopeControls();
            scheduleOperationalRender();
            void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
        });
        container.appendChild(button);
    });
}

function renderSavedScopes() {
    const select = document.getElementById('pisi-map-saved-scope');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(makeOption('', t('saved')));
    for (const item of scopedMapState.savedScopes) {
        select.appendChild(makeOption(item.id, item.name));
    }
    if (scopedMapState.savedScopes.some((item) => item.id === current)) select.value = current;
    const enabled = Boolean(select.value);
    const apply = document.getElementById('pisi-map-apply-scope');
    const remove = document.getElementById('pisi-map-delete-scope');
    if (apply) apply.disabled = !enabled;
    if (remove) remove.disabled = !enabled;
}

function syncScopeControls() {
    const current = getOperationalModule()?.operationalState;
    if (!current) return;
    const strategy = document.getElementById('pisi-map-scope-strategy');
    const freeze = document.getElementById('pisi-map-freeze-scope');
    const dim = document.getElementById('pisi-map-dim-filtered');
    if (strategy) strategy.value = current.scope.strategy || 'live';
    if (freeze) {
        const snapshot = current.scope.strategy === 'snapshot';
        freeze.textContent = snapshot ? t('refresh') : t('freeze');
        freeze.setAttribute('aria-pressed', snapshot ? 'true' : 'false');
    }
    if (dim) dim.setAttribute('aria-pressed', current.display.dimFiltered ? 'true' : 'false');
    renderPropertyOptions();
    renderOperatorOptions();
    renderFilterChips();
    renderSavedScopes();
}

function freezeCurrentScope() {
    const current = getOperationalModule()?.operationalState;
    if (!current) return;
    const visible = current.lastRender?.visibleNodeIds;
    const ids = visible instanceof Set ? [...visible] : [];
    if (!ids.length) return alert(t('noVisible'));
    current.scope = normalizePisiOperationalScope({
        ...current.scope,
        strategy: 'snapshot',
        includedNodeIds: ids
    });
    syncScopeControls();
    scheduleOperationalRender();
    void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
}

function addPropertyFilter() {
    const current = getOperationalModule()?.operationalState;
    const property = document.getElementById('pisi-map-scope-property')?.value || '';
    const operator = document.getElementById('pisi-map-scope-operator')?.value || 'contains';
    const value = document.getElementById('pisi-map-scope-value')?.value || '';
    if (!current || !property) return;
    const filter = normalizePisiOperationalPropertyFilter({ property, operator, value });
    if (!filter) return;
    current.scope.propertyFilters = [...(current.scope.propertyFilters || []), filter].slice(0, 20);
    current.scope.strategy = 'live';
    const input = document.getElementById('pisi-map-scope-value');
    if (input) input.value = '';
    syncScopeControls();
    scheduleOperationalRender();
    void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
}

async function savePisiCurrentScope() {
    const current = getOperationalModule()?.operationalState;
    if (!current) return;
    const name = window.prompt(t('name'))?.trim();
    if (!name) return;
    const result = await persistOperationalPayload({
        op: 'save-scope',
        savedScope: { name, scope: current.scope }
    });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    renderSavedScopes();
    const select = document.getElementById('pisi-map-saved-scope');
    if (select && result.operational?.savedScopes?.length) {
        select.value = result.operational.savedScopes.at(-1).id;
        renderSavedScopes();
    }
}

function applyPisiSavedScope() {
    const current = getOperationalModule()?.operationalState;
    const selectedId = document.getElementById('pisi-map-saved-scope')?.value;
    const saved = scopedMapState.savedScopes.find((item) => item.id === selectedId);
    if (!current || !saved) return;
    current.scope = normalizePisiOperationalScope(saved.scope);
    getOperationalModule()?.loadPisiOperationalMapState?.(false);
    syncScopeControls();
    scheduleOperationalRender();
    void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
}

async function deletePisiSavedScope() {
    const scopeId = document.getElementById('pisi-map-saved-scope')?.value;
    if (!scopeId) return;
    const result = await persistOperationalPayload({ op: 'delete-scope', scopeId });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    renderSavedScopes();
}

function bindExistingCriteria() {
    for (const id of [
        'pisi-map-operational-scope',
        'pisi-map-operational-query',
        'pisi-map-operational-depth',
        'pisi-map-operational-focus'
    ]) {
        document.getElementById(id)?.addEventListener('input', () => {
            const current = getOperationalModule()?.operationalState;
            if (!current || current.scope.strategy !== 'snapshot') return;
            current.scope.strategy = 'live';
            syncScopeControls();
        });
        document.getElementById(id)?.addEventListener('change', () => {
            const current = getOperationalModule()?.operationalState;
            if (!current || current.scope.strategy !== 'snapshot') return;
            current.scope.strategy = 'live';
            syncScopeControls();
        });
    }
    document.getElementById('pisi-map-operational-reset')?.addEventListener('click', () => {
        setTimeout(syncScopeControls, 0);
    });
}

function createScopeControls() {
    const bar = document.getElementById('pisi-map-operational-bar');
    if (!bar || document.getElementById('pisi-map-scope-controls')) return;
    const group = document.createElement('div');
    group.id = 'pisi-map-scope-controls';
    group.className = 'pisi-map-scope-controls';
    group.innerHTML = `
        <select id="pisi-map-scope-strategy"></select>
        <button type="button" id="pisi-map-freeze-scope"></button>
        <select id="pisi-map-scope-property"></select>
        <select id="pisi-map-scope-operator"></select>
        <input id="pisi-map-scope-value" type="text">
        <button type="button" id="pisi-map-add-property-filter"></button>
        <span id="pisi-map-scope-filter-chips" class="pisi-map-scope-filter-chips"></span>
        <select id="pisi-map-saved-scope"></select>
        <button type="button" id="pisi-map-save-scope"></button>
        <button type="button" id="pisi-map-apply-scope"></button>
        <button type="button" id="pisi-map-delete-scope"></button>
        <button type="button" id="pisi-map-dim-filtered"></button>
    `;
    bar.insertBefore(group, document.getElementById('pisi-map-operational-summary'));

    document.getElementById('pisi-map-scope-strategy')?.addEventListener('change', (event) => {
        const current = getOperationalModule()?.operationalState;
        if (!current) return;
        if (event.target.value === 'snapshot') return freezeCurrentScope();
        current.scope.strategy = 'live';
        syncScopeControls();
        scheduleOperationalRender();
        void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
    });
    document.getElementById('pisi-map-freeze-scope')?.addEventListener('click', freezeCurrentScope);
    document.getElementById('pisi-map-scope-operator')?.addEventListener('change', updateValueInputState);
    document.getElementById('pisi-map-add-property-filter')?.addEventListener('click', addPropertyFilter);
    document.getElementById('pisi-map-saved-scope')?.addEventListener('change', renderSavedScopes);
    document.getElementById('pisi-map-save-scope')?.addEventListener('click', savePisiCurrentScope);
    document.getElementById('pisi-map-apply-scope')?.addEventListener('click', applyPisiSavedScope);
    document.getElementById('pisi-map-delete-scope')?.addEventListener('click', deletePisiSavedScope);
    document.getElementById('pisi-map-dim-filtered')?.addEventListener('click', () => {
        const current = getOperationalModule()?.operationalState;
        if (!current) return;
        current.display.dimFiltered = !current.display.dimFiltered;
        syncScopeControls();
        scheduleOperationalRender();
        void persistOperationalPayload({ op: 'update', scope: current.scope, display: current.display });
    });
    bindExistingCriteria();
    rebuildScopeLabels();
}

function rebuildScopeLabels() {
    const strategy = document.getElementById('pisi-map-scope-strategy');
    if (strategy) {
        const value = strategy.value || 'live';
        strategy.replaceChildren(makeOption('live', t('live')), makeOption('snapshot', t('snapshot')));
        strategy.value = value;
    }
    const value = document.getElementById('pisi-map-scope-value');
    if (value) value.placeholder = t('value');
    const labels = [
        ['pisi-map-add-property-filter', 'add'],
        ['pisi-map-save-scope', 'save'],
        ['pisi-map-apply-scope', 'apply'],
        ['pisi-map-delete-scope', 'remove'],
        ['pisi-map-dim-filtered', 'dim']
    ];
    labels.forEach(([id, key]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = t(key);
    });
    syncScopeControls();
}

async function loadScopedMapState() {
    if (!window.activeMapPath || scopedMapState.loading) return;
    scopedMapState.loading = true;
    try {
        const result = await window.pisiProject?.getPisiDocument?.(window.activeMapPath);
        scopedMapState.savedScopes = Array.isArray(result?.data?.map?.operational?.savedScopes)
            ? result.data.map.operational.savedScopes
            : [];
        createScopeControls();
        syncScopeControls();
    } finally {
        scopedMapState.loading = false;
    }
}

function bindScopedFilterableMap() {
    ensureScopedMapStyles();
    const observer = new MutationObserver(() => {
        if (document.getElementById('pisi-map-operational-bar')) {
            void loadScopedMapState();
            renderPropertyOptions();
        }
    });
    const target = document.getElementById('workspace');
    if (target) observer.observe(target, { childList: true, subtree: true });
    document.addEventListener('pisi:map-customization-context-changed', () => void loadScopedMapState());
    document.addEventListener('pisi:language-changed', rebuildScopeLabels);
    document.addEventListener('pisi:task-store-updated', syncScopeControls);
    void loadScopedMapState();
    scopedMapState.initialized = true;
}

registerModule('map.scopedFilters', {
    addPropertyFilter,
    applyPisiSavedScope,
    bindScopedFilterableMap,
    deletePisiSavedScope,
    freezeCurrentScope,
    loadScopedMapState,
    savePisiCurrentScope,
    scopedMapState
});

bindScopedFilterableMap();

export {
    addPropertyFilter,
    applyPisiSavedScope,
    bindScopedFilterableMap,
    deletePisiSavedScope,
    freezeCurrentScope,
    loadScopedMapState,
    savePisiCurrentScope,
    scopedMapState
};
