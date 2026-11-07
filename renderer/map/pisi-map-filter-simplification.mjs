import { registerModule } from '../core/module-registry.mjs';
import { normalizePisiOperationalDisplay, normalizePisiOperationalScope } from './pisi-map-operational-core.mjs';

const filterText = {
    tr: {
        activeFilters: 'Aktif Filtreler',
        savedFilters: 'Kaydedilmiş Filtreler',
        addFilter: 'Filtre Ekle',
        save: 'Kaydet',
        apply: 'Uygula',
        remove: 'Sil',
        freeze: 'Sonuçları Dondur',
        returnLive: 'Canlıya Dön',
        saveFilter: 'Filtreyi Kaydet',
        filterName: 'Filtre adı',
        saveFailed: 'Filtre kaydedilemedi.'
    },
    eng: {
        activeFilters: 'Active Filters',
        savedFilters: 'Saved Filters',
        addFilter: 'Add Filter',
        save: 'Save',
        apply: 'Apply',
        remove: 'Delete',
        freeze: 'Freeze Results',
        returnLive: 'Return to Live',
        saveFilter: 'Save Filter',
        filterName: 'Filter name',
        saveFailed: 'Filter could not be saved.'
    }
};

let simplifiedFilterObserver = null;
let simplifiedFilterFrame = null;

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return filterText[language]?.[key] || filterText.eng[key] || key;
}

function operationalModule() {
    return window.Pisi?.modules?.['map.operational'] || null;
}

function scopedFiltersModule() {
    return window.Pisi?.modules?.['map.scopedFilters'] || null;
}

function operationalState() {
    return operationalModule()?.operationalState || null;
}

function ensureSimplifiedFilterStyle() {
    if (document.querySelector('link[data-pisi-filter-simplification-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-filter-simplification.css';
    link.dataset.pisiFilterSimplificationStyle = '1';
    document.head.appendChild(link);
}

function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
}

function ensureSectionLabel(group, section, beforeElement) {
    let label = group.querySelector(`[data-pisi-filter-section="${section}"]`);
    if (!label) {
        label = document.createElement('div');
        label.className = 'pisi-filter-section-label';
        label.dataset.pisiFilterSection = section;
        group.insertBefore(label, beforeElement || null);
    }
    setText(label, t(section === 'active' ? 'activeFilters' : 'savedFilters'));
    return label;
}

async function persistOperational(payload) {
    const current = operationalState();
    if (!current || !window.activeMapPath || !window.pisiProject?.saveMapCamera) return null;

    const result = await window.pisiProject.saveMapCamera(window.activeMapPath, {
        ...(window.activeMapCamera || { x: 0, y: 0, zoom: 1 }),
        collapsedHubs: Array.from(window.collapsedHubPorts || []),
        operationalPayload: payload
    });

    if (result?.operational) {
        current.scope = normalizePisiOperationalScope(result.operational.scope);
        current.display = normalizePisiOperationalDisplay(result.operational.display);
        const scoped = scopedFiltersModule()?.scopedMapState;
        if (scoped) {
            scoped.savedScopes = Array.isArray(result.operational.savedScopes) ? result.operational.savedScopes : [];
        }
    }

    operationalModule()?.schedulePisiOperationalRender?.();
    scheduleSimplifiedFilterSync();
    return result;
}

async function returnPisiFiltersToLive() {
    const current = operationalState();
    if (!current) return;
    current.scope = normalizePisiOperationalScope({
        ...current.scope,
        strategy: 'live'
    });
    const result = await persistOperational({
        op: 'update',
        scope: current.scope,
        display: current.display
    });
    if (result && !result.ok) console.error('[PISI]', t('saveFailed'), result.error);
}

async function togglePisiFrozenResults() {
    const current = operationalState();
    if (!current) return;
    if (current.scope.strategy === 'snapshot') {
        await returnPisiFiltersToLive();
        return;
    }
    await scopedFiltersModule()?.capturePisiScopeSnapshot?.();
    scheduleSimplifiedFilterSync();
}

async function savePisiFilterPreset() {
    const current = operationalState();
    const operational = operationalModule();
    if (!current || !operational) return;

    const name = await operational.requestPisiName?.({
        title: t('saveFilter'),
        label: t('filterName'),
        confirmLabel: t('save')
    });
    if (!name) return;

    const filterScope = normalizePisiOperationalScope({
        ...current.scope,
        strategy: 'live'
    });
    const result = await persistOperational({
        op: 'save-scope',
        savedScope: { name, scope: filterScope }
    });
    if (!result?.ok) {
        pisiNotifyError(result?.error || t('saveFailed'));
        return;
    }

    const select = document.getElementById('pisi-map-saved-scope');
    const saved = scopedFiltersModule()?.scopedMapState?.savedScopes || [];
    if (select && saved.length) select.value = saved.at(-1).id;
    scheduleSimplifiedFilterSync();
}

async function applyPisiFilterPreset() {
    const current = operationalState();
    const scoped = scopedFiltersModule()?.scopedMapState;
    const id = document.getElementById('pisi-map-saved-scope')?.value;
    const saved = scoped?.savedScopes?.find((item) => item.id === id);
    if (!current || !saved) return;

    current.scope = normalizePisiOperationalScope({
        ...saved.scope,
        strategy: 'live'
    });
    const result = await persistOperational({
        op: 'update',
        scope: current.scope,
        display: current.display
    });
    if (!result?.ok) pisiNotifyError(result?.error || t('saveFailed'));
}

function replaceActionButton(id, handler) {
    const button = document.getElementById(id);
    if (!button) return null;
    if (button.dataset.pisiSimplifiedFilterAction === '1') return button;

    const replacement = button.cloneNode(true);
    replacement.dataset.pisiSimplifiedFilterAction = '1';
    replacement.dataset.pisiFilterTextButton = '1';
    replacement.addEventListener('click', (event) => {
        event.preventDefault();
        void handler();
    });
    button.replaceWith(replacement);
    return replacement;
}

function markTextButton(id) {
    const button = document.getElementById(id);
    if (button) button.dataset.pisiFilterTextButton = '1';
    return button;
}

function syncSavedFilterLabels() {
    const select = document.getElementById('pisi-map-saved-scope');
    const placeholder = select?.querySelector('option[value=""]');
    setText(placeholder, t('savedFilters'));

    setText(document.getElementById('pisi-map-save-scope'), t('save'));
    setText(document.getElementById('pisi-map-apply-scope'), t('apply'));
    setText(document.getElementById('pisi-map-delete-scope'), t('remove'));
    markTextButton('pisi-map-delete-scope');
}

function syncFreezeButton() {
    const current = operationalState();
    const freeze = document.getElementById('pisi-map-freeze-scope');
    if (!current || !freeze) return;
    const frozen = current.scope.strategy === 'snapshot';
    const label = t(frozen ? 'returnLive' : 'freeze');
    setText(freeze, label);
    freeze.title = label;
    freeze.setAttribute('aria-label', label);
    freeze.setAttribute('aria-pressed', frozen ? 'true' : 'false');
}

function orderSimplifiedFilterControlsOnce(group, elements) {
    if (group.dataset.pisiSimplifiedFilterOrdered === '1') return;
    for (const element of elements.filter(Boolean)) group.appendChild(element);
    group.dataset.pisiSimplifiedFilterOrdered = '1';
}

function installSimplifiedFilterControls() {
    ensureSimplifiedFilterStyle();
    const group = document.getElementById('pisi-map-scope-controls');
    if (!group) return false;

    group.classList.add('pisi-simplified-filter-controls');
    document.getElementById('pisi-map-scope-strategy')?.remove();

    const freeze = replaceActionButton('pisi-map-freeze-scope', togglePisiFrozenResults);
    const save = replaceActionButton('pisi-map-save-scope', savePisiFilterPreset);
    const apply = replaceActionButton('pisi-map-apply-scope', applyPisiFilterPreset);
    const remove = markTextButton('pisi-map-delete-scope');
    const add = markTextButton('pisi-map-add-property-filter');

    const property = document.getElementById('pisi-map-scope-property');
    const operator = document.getElementById('pisi-map-scope-operator');
    const value = document.getElementById('pisi-map-scope-value');
    const chips = document.getElementById('pisi-map-scope-filter-chips');
    const saved = document.getElementById('pisi-map-saved-scope');

    const activeLabel = ensureSectionLabel(group, 'active', chips);
    const savedLabel = ensureSectionLabel(group, 'saved', saved);

    orderSimplifiedFilterControlsOnce(group, [property, operator, value, add, activeLabel, chips, savedLabel, saved, save, apply, remove, freeze]);

    setText(add, t('addFilter'));
    syncSavedFilterLabels();
    syncFreezeButton();
    return true;
}

function syncSimplifiedFilterControls() {
    if (!installSimplifiedFilterControls()) return false;
    const group = document.getElementById('pisi-map-scope-controls');
    setText(group?.querySelector('[data-pisi-filter-section="active"]'), t('activeFilters'));
    setText(group?.querySelector('[data-pisi-filter-section="saved"]'), t('savedFilters'));
    setText(document.getElementById('pisi-map-add-property-filter'), t('addFilter'));
    syncSavedFilterLabels();
    syncFreezeButton();
    return true;
}

function scheduleSimplifiedFilterSync() {
    if (simplifiedFilterFrame !== null) return;
    simplifiedFilterFrame = requestAnimationFrame(() => {
        simplifiedFilterFrame = null;
        syncSimplifiedFilterControls();
    });
}

function mutationTouchesFilterControls(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) => node?.nodeType === Node.ELEMENT_NODE && (node.id === 'pisi-map-scope-controls' || node.querySelector?.('#pisi-map-scope-controls'))
    );
}

function bindSimplifiedFilterControls() {
    syncSimplifiedFilterControls();
    document.addEventListener('pisi:language-changed', scheduleSimplifiedFilterSync);
    document.addEventListener('pisi:map-customization-context-changed', scheduleSimplifiedFilterSync);

    if (!simplifiedFilterObserver && document.body) {
        simplifiedFilterObserver = new MutationObserver((mutations) => {
            if (mutations.some(mutationTouchesFilterControls)) scheduleSimplifiedFilterSync();
        });
        simplifiedFilterObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSimplifiedFilterControls, { once: true });
} else {
    bindSimplifiedFilterControls();
}

registerModule('map.filterSimplification', {
    applyPisiFilterPreset,
    bindSimplifiedFilterControls,
    installSimplifiedFilterControls,
    mutationTouchesFilterControls,
    orderSimplifiedFilterControlsOnce,
    returnPisiFiltersToLive,
    savePisiFilterPreset,
    syncSimplifiedFilterControls,
    togglePisiFrozenResults
});

export {
    applyPisiFilterPreset,
    bindSimplifiedFilterControls,
    installSimplifiedFilterControls,
    mutationTouchesFilterControls,
    orderSimplifiedFilterControlsOnce,
    returnPisiFiltersToLive,
    savePisiFilterPreset,
    syncSimplifiedFilterControls,
    togglePisiFrozenResults
};
