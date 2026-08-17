import { registerModule } from '../core/module-registry.mjs';
import {
    normalizePisiOperationalDisplay,
    normalizePisiOperationalPropertyFilter,
    normalizePisiOperationalScope
} from './pisi-map-operational-core.mjs';

const scopedMapState = { mapPath: null, savedScopes: [], loading: false, persistTimer: null, observer: null };
const text = {
    tr: {
        live: 'Canlı scope', snapshot: 'Snapshot', freeze: 'Görünümü dondur', refresh: 'Snapshot yenile',
        property: 'Özellik', value: 'Değer', add: 'Filtre ekle', saved: 'Kaydedilmiş scope', save: 'Scope kaydet',
        apply: 'Uygula', remove: 'Sil', dim: 'Filtrelenenleri soldur', scopeName: 'Scope adı',
        noVisible: 'Dondurulacak görünür node yok.', saveFailed: 'Scope kaydedilemedi.',
        contains: 'içerir', equals: 'eşittir', notEquals: 'eşit değildir', oneOf: 'şunlardan biri',
        exists: 'var', notEmpty: 'boş değil', gt: '>', gte: '≥', lt: '<', lte: '≤'
    },
    eng: {
        live: 'Live scope', snapshot: 'Snapshot', freeze: 'Freeze view', refresh: 'Refresh snapshot',
        property: 'Property', value: 'Value', add: 'Add filter', saved: 'Saved scope', save: 'Save scope',
        apply: 'Apply', remove: 'Delete', dim: 'Dim filtered', scopeName: 'Scope name',
        noVisible: 'There are no visible nodes to freeze.', saveFailed: 'Scope could not be saved.',
        contains: 'contains', equals: 'equals', notEquals: 'does not equal', oneOf: 'is one of',
        exists: 'exists', notEmpty: 'is not empty', gt: '>', gte: '≥', lt: '<', lte: '≤'
    }
};

const operatorKeys = {
    contains: 'contains', equals: 'equals', 'not-equals': 'notEquals', 'one-of': 'oneOf',
    exists: 'exists', 'not-empty': 'notEmpty', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte'
};

function t(key) {
    const lang = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return text[lang][key] || text.tr[key] || key;
}

function operational() { return window.Pisi?.modules?.['map.operational'] || null; }
function state() { return operational()?.operationalState || null; }
function option(value, label) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    return el;
}

function ensureStyle() {
    if (document.querySelector('link[data-pisi-map-scopes-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-scopes.css';
    link.dataset.pisiMapScopesStyle = '1';
    document.head.appendChild(link);
}

async function persist(payload) {
    const current = state();
    if (!current || !window.activeMapPath || !window.pisiProject?.saveMapCamera) return null;
    const result = await window.pisiProject.saveMapCamera(window.activeMapPath, {
        ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
        collapsedHubs: Array.from(window.collapsedHubPorts || []),
        operationalPayload: payload
    });
    if (result?.operational) {
        current.scope = normalizePisiOperationalScope(result.operational.scope);
        current.display = normalizePisiOperationalDisplay(result.operational.display);
        scopedMapState.savedScopes = Array.isArray(result.operational.savedScopes) ? result.operational.savedScopes : [];
    }
    syncControls();
    operational()?.schedulePisiOperationalRender?.();
    return result;
}

function persistSoon() {
    clearTimeout(scopedMapState.persistTimer);
    scopedMapState.persistTimer = setTimeout(async () => {
        scopedMapState.persistTimer = null;
        const current = state();
        if (!current) return;
        const result = await persist({ op: 'update', scope: current.scope, display: current.display });
        if (result && !result.ok) console.error('[PISI]', t('saveFailed'), result.error);
    }, 300);
}

function propertyOptions() {
    const seen = new Map();
    for (const node of Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []) {
        for (const [rawId, prop] of Object.entries(node?.properties || {})) {
            const id = String(prop?.id || rawId || '').trim().toLowerCase();
            if (id && !seen.has(id)) seen.set(id, String(prop?.name || rawId || id).trim());
        }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function renderPropertyOptions() {
    const select = document.getElementById('pisi-map-scope-property');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(option('', t('property')), ...propertyOptions().map(([id, name]) => option(id, name)));
    if ([...select.options].some((item) => item.value === current)) select.value = current;
}

function renderFilterChips() {
    const current = state();
    const host = document.getElementById('pisi-map-scope-filter-chips');
    if (!current || !host) return;
    host.replaceChildren();
    const filters = Array.isArray(current.scope.propertyFilters) ? current.scope.propertyFilters : [];
    filters.forEach((filter, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pisi-map-scope-filter-chip';
        const suffix = ['exists', 'not-empty'].includes(filter.operator) ? '' : ` ${filter.value}`;
        chip.textContent = `${filter.property} ${t(operatorKeys[filter.operator] || filter.operator)}${suffix} ×`;
        chip.addEventListener('click', () => {
            current.scope.propertyFilters = filters.filter((_item, i) => i !== index);
            current.scope.strategy = 'live';
            syncControls();
            operational()?.schedulePisiOperationalRender?.();
            persistSoon();
        });
        host.appendChild(chip);
    });
}

function renderSavedScopes() {
    const select = document.getElementById('pisi-map-saved-scope');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(option('', t('saved')), ...scopedMapState.savedScopes.map((item) => option(item.id, item.name)));
    if (scopedMapState.savedScopes.some((item) => item.id === current)) select.value = current;
    const enabled = Boolean(select.value);
    document.getElementById('pisi-map-apply-scope')?.toggleAttribute('disabled', !enabled);
    document.getElementById('pisi-map-delete-scope')?.toggleAttribute('disabled', !enabled);
}

function syncControls() {
    const current = state();
    if (!current) return;
    const strategy = document.getElementById('pisi-map-scope-strategy');
    const freeze = document.getElementById('pisi-map-freeze-scope');
    const dim = document.getElementById('pisi-map-dim-filtered');
    if (strategy) strategy.value = current.scope.strategy || 'live';
    if (freeze) {
        freeze.textContent = current.scope.strategy === 'snapshot' ? t('refresh') : t('freeze');
        freeze.setAttribute('aria-pressed', current.scope.strategy === 'snapshot' ? 'true' : 'false');
    }
    if (dim) {
        dim.textContent = t('dim');
        dim.setAttribute('aria-pressed', current.display.dimFiltered ? 'true' : 'false');
    }
    renderPropertyOptions();
    renderFilterChips();
    renderSavedScopes();
}

function rebuildLabels() {
    const strategy = document.getElementById('pisi-map-scope-strategy');
    if (strategy) {
        const current = strategy.value || 'live';
        strategy.replaceChildren(option('live', t('live')), option('snapshot', t('snapshot')));
        strategy.value = current;
    }
    const operator = document.getElementById('pisi-map-scope-operator');
    if (operator) {
        const current = operator.value || 'contains';
        operator.replaceChildren(...Object.entries(operatorKeys).map(([value, key]) => option(value, t(key))));
        operator.value = current;
    }
    const value = document.getElementById('pisi-map-scope-value');
    if (value) value.placeholder = t('value');
    const labels = {
        'pisi-map-add-property-filter': 'add', 'pisi-map-save-scope': 'save',
        'pisi-map-apply-scope': 'apply', 'pisi-map-delete-scope': 'remove'
    };
    for (const [id, key] of Object.entries(labels)) {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    }
    syncControls();
}

async function capturePisiScopeSnapshot() {
    const current = state();
    const visible = current?.lastRender?.visibleNodeIds;
    const ids = visible instanceof Set ? [...visible] : [];
    if (!ids.length) return alert(t('noVisible'));
    current.scope = normalizePisiOperationalScope({ ...current.scope, strategy: 'snapshot', includedNodeIds: ids });
    const result = await persist({ op: 'update', scope: current.scope, display: current.display });
    if (!result?.ok) alert(result?.error || t('saveFailed'));
}

function refreshPisiScopeSnapshot() {
    const current = state();
    if (!current) return;
    if (current.scope.strategy !== 'snapshot') {
        void capturePisiScopeSnapshot();
        return;
    }
    current.scope.strategy = 'live';
    operational()?.schedulePisiOperationalRender?.();
    requestAnimationFrame(() => void capturePisiScopeSnapshot());
}

function addPisiPropertyFilter() {
    const current = state();
    const property = document.getElementById('pisi-map-scope-property');
    const operator = document.getElementById('pisi-map-scope-operator');
    const value = document.getElementById('pisi-map-scope-value');
    if (!current || !property?.value) return;
    const op = operator?.value || 'contains';
    if (!['exists', 'not-empty'].includes(op) && !String(value?.value || '').trim()) return;
    const filter = normalizePisiOperationalPropertyFilter({ property: property.value, operator: op, value: value?.value });
    if (!filter) return;
    current.scope.propertyFilters = [...(current.scope.propertyFilters || []), filter].slice(-20);
    current.scope.strategy = 'live';
    if (value) value.value = '';
    syncControls();
    operational()?.schedulePisiOperationalRender?.();
    persistSoon();
}

async function savePisiCurrentScope() {
    const current = state();
    if (!current) return;
    const name = await operational()?.requestPisiName?.({
        title: t('save'),
        label: t('scopeName'),
        confirmLabel: t('save')
    });
    if (!name) return;
    const result = await persist({ op: 'save-scope', savedScope: { name, scope: current.scope } });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    const select = document.getElementById('pisi-map-saved-scope');
    if (select && result.operational?.savedScopes?.length) select.value = result.operational.savedScopes.at(-1).id;
    renderSavedScopes();
}

async function applyPisiSavedScope() {
    const current = state();
    const id = document.getElementById('pisi-map-saved-scope')?.value;
    const saved = scopedMapState.savedScopes.find((item) => item.id === id);
    if (!current || !saved) return;
    current.scope = normalizePisiOperationalScope(saved.scope);
    const result = await persist({ op: 'update', scope: current.scope, display: current.display });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    void operational()?.loadPisiOperationalMapState?.(true);
}

async function deletePisiSavedScope() {
    const id = document.getElementById('pisi-map-saved-scope')?.value;
    if (!id) return;
    const result = await persist({ op: 'delete-scope', scopeId: id });
    if (!result?.ok) return alert(result?.error || t('saveFailed'));
    renderSavedScopes();
}

function bindExistingCriteria() {
    const bindings = [
        ['pisi-map-operational-scope', 'change'], ['pisi-map-operational-query', 'input'],
        ['pisi-map-operational-depth', 'change'], ['pisi-map-operational-focus', 'click']
    ];
    for (const [id, eventName] of bindings) {
        const el = document.getElementById(id);
        if (!el || el.dataset.pisiScopeLiveBound === '1') continue;
        el.dataset.pisiScopeLiveBound = '1';
        el.addEventListener(eventName, () => {
            const current = state();
            if (current) current.scope.strategy = 'live';
            syncControls();
        });
    }
    const reset = document.getElementById('pisi-map-operational-reset');
    if (reset && reset.dataset.pisiScopeResetBound !== '1') {
        reset.dataset.pisiScopeResetBound = '1';
        reset.addEventListener('click', () => setTimeout(syncControls, 0));
    }
}

function bindNewControls() {
    document.getElementById('pisi-map-scope-strategy')?.addEventListener('change', async (event) => {
        if (event.currentTarget.value === 'snapshot') return capturePisiScopeSnapshot();
        const current = state();
        if (!current) return;
        current.scope.strategy = 'live';
        syncControls();
        operational()?.schedulePisiOperationalRender?.();
        persistSoon();
    });
    document.getElementById('pisi-map-freeze-scope')?.addEventListener('click', refreshPisiScopeSnapshot);
    document.getElementById('pisi-map-add-property-filter')?.addEventListener('click', addPisiPropertyFilter);
    document.getElementById('pisi-map-scope-value')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') addPisiPropertyFilter();
    });
    document.getElementById('pisi-map-scope-operator')?.addEventListener('change', (event) => {
        const input = document.getElementById('pisi-map-scope-value');
        if (input) input.disabled = ['exists', 'not-empty'].includes(event.currentTarget.value);
    });
    document.getElementById('pisi-map-dim-filtered')?.addEventListener('click', () => {
        const current = state();
        if (!current) return;
        current.display.dimFiltered = !current.display.dimFiltered;
        syncControls();
        operational()?.schedulePisiOperationalRender?.();
        persistSoon();
    });
    document.getElementById('pisi-map-save-scope')?.addEventListener('click', savePisiCurrentScope);
    document.getElementById('pisi-map-apply-scope')?.addEventListener('click', applyPisiSavedScope);
    document.getElementById('pisi-map-delete-scope')?.addEventListener('click', deletePisiSavedScope);
    document.getElementById('pisi-map-saved-scope')?.addEventListener('change', renderSavedScopes);
    bindExistingCriteria();
}

function createControls() {
    const bar = document.getElementById('pisi-map-operational-bar');
    if (!bar || document.getElementById('pisi-map-scope-controls')) return false;
    const group = document.createElement('div');
    group.id = 'pisi-map-scope-controls';
    group.className = 'pisi-map-scope-controls';
    group.innerHTML = '<select id="pisi-map-scope-strategy"></select><button type="button" id="pisi-map-freeze-scope"></button><select id="pisi-map-scope-property"></select><select id="pisi-map-scope-operator"></select><input id="pisi-map-scope-value" type="text"><button type="button" id="pisi-map-add-property-filter"></button><div id="pisi-map-scope-filter-chips" class="pisi-map-scope-filter-chips"></div><select id="pisi-map-saved-scope"></select><button type="button" id="pisi-map-save-scope"></button><button type="button" id="pisi-map-apply-scope"></button><button type="button" id="pisi-map-delete-scope"></button><button type="button" id="pisi-map-dim-filtered"></button>';
    bar.appendChild(group);
    bindNewControls();
    rebuildLabels();
    return true;
}

async function loadScopedMapState(force = false) {
    const mapPath = window.activeMapPath;
    if (!mapPath) {
        scopedMapState.mapPath = null;
        scopedMapState.savedScopes = [];
        return;
    }
    if (!force && scopedMapState.mapPath === mapPath) {
        createControls();
        syncControls();
        return;
    }
    if (scopedMapState.loading) return;
    scopedMapState.loading = true;
    try {
        const result = await window.pisiProject?.getPisiDocument?.(mapPath);
        if (window.activeMapPath !== mapPath) return;
        scopedMapState.mapPath = mapPath;
        const raw = result?.data?.map?.operational || {};
        scopedMapState.savedScopes = Array.isArray(raw.savedScopes) ? raw.savedScopes : [];
        createControls();
        syncControls();
    } finally {
        scopedMapState.loading = false;
    }
}

function bindScopedFilterableMaps() {
    ensureStyle();
    createControls();
    void loadScopedMapState(true);
    document.addEventListener('pisi:map-customization-context-changed', () => void loadScopedMapState(false));
    document.addEventListener('pisi:language-changed', rebuildLabels);
    document.addEventListener('pisi:task-store-updated', syncControls);
    const target = document.getElementById('workspace');
    if (target && !scopedMapState.observer) {
        scopedMapState.observer = new MutationObserver((mutations) => {
            if (createControls()) {
                void loadScopedMapState(false);
                return;
            }
            const mapNodesChanged = mutations.some((mutation) => {
                return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
                    return node?.nodeType === Node.ELEMENT_NODE && (
                        node.matches?.('.map-node-box') || node.querySelector?.('.map-node-box')
                    );
                });
            });
            if (mapNodesChanged) renderPropertyOptions();
            bindExistingCriteria();
        });
        scopedMapState.observer.observe(target, { childList: true, subtree: true });
    }
}

registerModule('map.scopedFilters', {
    addPisiPropertyFilter, applyPisiSavedScope, bindScopedFilterableMaps, capturePisiScopeSnapshot,
    refreshPisiScopeSnapshot, deletePisiSavedScope, loadScopedMapState, savePisiCurrentScope, scopedMapState
});
bindScopedFilterableMaps();

export {
    addPisiPropertyFilter, applyPisiSavedScope, bindScopedFilterableMaps, capturePisiScopeSnapshot,
    refreshPisiScopeSnapshot, deletePisiSavedScope, loadScopedMapState, savePisiCurrentScope, scopedMapState
};