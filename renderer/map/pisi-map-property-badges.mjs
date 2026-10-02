import { registerModule } from '../core/module-registry.mjs';
import { getPisiActiveMapPropertyContext } from '../data/pisi-structured-views.mjs';
import { normalizePisiPropertyCollection } from '../data/pisi-properties-core.mjs';

const PISI_MAP_PROPERTY_BADGES_STORAGE_KEY = 'pisi.map.propertyBadges.v1';
const PISI_MAP_PROPERTY_BADGE_TYPES = new Set(['text', 'number', 'multiselect']);
const PISI_MAP_PROPERTY_BADGE_LIMIT = 12;

let preferenceObserver = null;

const badgeText = {
    tr: {
        title: 'Badges',
        description: 'Mapteki node property değerlerini küçük badge olarak göster.',
        add: 'Add badge',
        text: 'Metin',
        number: 'Sayı',
        multiselect: 'Etiket',
        back: 'Geri',
        remove: 'Kaldır',
        noMap: 'Badge eklemek için orta alanda bir map aç.',
        noProperties: 'Bu tipte kullanılabilir property yok.',
        empty: 'Henüz badge seçilmedi.'
    },
    eng: {
        title: 'Badges',
        description: 'Show map node property values as small badges.',
        add: 'Add badge',
        text: 'Text',
        number: 'Number',
        multiselect: 'Tag',
        back: 'Back',
        remove: 'Remove',
        noMap: 'Open a map in the workspace to add a badge.',
        noProperties: 'There are no available properties of this type.',
        empty: 'No badges selected yet.'
    }
};

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return badgeText[language]?.[key] || badgeText.tr[key] || key;
}

function normalizePisiBadgePath(value = '') {
    const normalized = String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');
    return window.pisiEnvironment?.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizePisiBadgePropertyName(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

function normalizePisiMapPropertyBadgeSelection(raw = {}) {
    const name = String(raw.name || '')
        .trim()
        .slice(0, 160);
    const type = String(raw.type || '')
        .trim()
        .toLowerCase();
    if (!name || !PISI_MAP_PROPERTY_BADGE_TYPES.has(type)) return null;
    return {
        id: String(raw.id || '')
            .trim()
            .slice(0, 180),
        name,
        type
    };
}

function normalizePisiMapPropertyBadgeSelections(value = []) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(value) ? value : []) {
        const selection = normalizePisiMapPropertyBadgeSelection(raw);
        if (!selection) continue;
        const key = normalizePisiBadgePropertyName(selection.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(selection);
        if (result.length >= PISI_MAP_PROPERTY_BADGE_LIMIT) break;
    }
    return result;
}

function loadPisiMapPropertyBadgeStore() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PISI_MAP_PROPERTY_BADGES_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function getPisiMapPropertyBadgeSelections(mapPath = window.activeMapPath) {
    const key = normalizePisiBadgePath(mapPath);
    if (!key) return [];
    return normalizePisiMapPropertyBadgeSelections(loadPisiMapPropertyBadgeStore()[key]);
}

function savePisiMapPropertyBadgeSelections(selections, mapPath = window.activeMapPath) {
    const key = normalizePisiBadgePath(mapPath);
    if (!key) return [];
    const normalized = normalizePisiMapPropertyBadgeSelections(selections);
    const store = loadPisiMapPropertyBadgeStore();
    if (normalized.length) store[key] = normalized;
    else delete store[key];
    try {
        localStorage.setItem(PISI_MAP_PROPERTY_BADGES_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
        console.warn('[PISI] Map badge tercihleri kaydedilemedi:', error);
    }
    syncPisiMapPropertyBadges();
    refreshPisiPropertyBadgePreferences();
    document.dispatchEvent(
        new CustomEvent('pisi:map-property-badges-changed', {
            detail: { mapPath, selections: normalized }
        })
    );
    return normalized;
}

function findPisiBadgeProperty(node, selection) {
    const wantedId = String(selection?.id || '').trim();
    const wantedName = normalizePisiBadgePropertyName(selection?.name);
    return (
        normalizePisiPropertyCollection(node?.properties).find((property) => {
            if (!PISI_MAP_PROPERTY_BADGE_TYPES.has(property.type)) return false;
            return (wantedId && property.id === wantedId) || normalizePisiBadgePropertyName(property.name) === wantedName;
        }) || null
    );
}

function getPisiBadgePropertyValues(property) {
    if (!property) return [];
    if (property.type === 'multiselect') {
        const values = Array.isArray(property.value) ? property.value : String(property.value ?? '').split(',');
        return values.map((value) => String(value ?? '').trim()).filter(Boolean);
    }
    if (property.type === 'number') {
        if (property.value === null || property.value === undefined || property.value === '') return [];
        return [String(property.value)];
    }
    const value = Array.isArray(property.value) ? property.value.map(String).join(', ') : String(property.value ?? '').trim();
    return value ? [value] : [];
}

function syncPisiMapPropertyBadgeForNode(box, node, selections = null) {
    if (!box) return;
    box.querySelector('.pisi-map-property-badges')?.remove();
    const activeSelections = selections || getPisiMapPropertyBadgeSelections();
    if (!activeSelections.length || !node) return;

    const host = document.createElement('div');
    host.className = 'pisi-map-property-badges';
    let visibleCount = 0;
    let overflowCount = 0;
    for (const selection of activeSelections) {
        const property = findPisiBadgeProperty(node, selection);
        for (const value of getPisiBadgePropertyValues(property)) {
            if (visibleCount >= 2) {
                overflowCount += 1;
                continue;
            }
            const badge = document.createElement('span');
            badge.className = `pisi-map-property-badge pisi-map-property-badge-${selection.type}`;
            badge.textContent = value;
            badge.title = `${selection.name}: ${value}`;
            host.appendChild(badge);
            visibleCount += 1;
        }
    }
    if (overflowCount > 0) {
        const overflow = document.createElement('span');
        overflow.className = 'pisi-map-property-badge pisi-map-property-badge-overflow';
        overflow.textContent = `+${overflowCount}`;
        overflow.title = `${overflowCount} ek özellik`;
        host.appendChild(overflow);
    }
    if (host.childElementCount) box.appendChild(host);
}

function syncPisiMapPropertyBadges() {
    const selections = getPisiMapPropertyBadgeSelections();
    const nodes = new Map((Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []).map((node) => [String(node?.id || ''), node]));
    document.querySelectorAll('.map-node-box[data-node-id]').forEach((box) => {
        syncPisiMapPropertyBadgeForNode(box, nodes.get(String(box.dataset.nodeId || '')), selections);
    });
}

function ensurePisiMapPropertyBadgeStyles() {
    // Consolidated CSS is loaded statically through style.css.
}

function makeBadgePreferenceButton(text, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
}

function getBadgeTypeLabel(type) {
    return t(type === 'multiselect' ? 'multiselect' : type);
}

async function getPisiBadgePropertyDefinitions() {
    if (!window.activeMapPath) return [];
    try {
        const context = await getPisiActiveMapPropertyContext();
        return (context.propertyDefinitions || []).filter((definition) => {
            return PISI_MAP_PROPERTY_BADGE_TYPES.has(String(definition?.type || ''));
        });
    } catch (error) {
        console.warn('[PISI] Badge property listesi okunamadı:', error);
        return [];
    }
}

function renderPisiBadgeTypeMenu(menu, definitions, onChooseType) {
    menu.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'pisi-badge-picker-grid';
    for (const type of ['text', 'number', 'multiselect']) {
        const button = makeBadgePreferenceButton(getBadgeTypeLabel(type), 'pisi-badge-picker-option');
        button.dataset.badgeType = type;
        button.addEventListener('click', () => onChooseType(type));
        grid.appendChild(button);
    }
    menu.appendChild(grid);
}

function renderPisiBadgePropertyMenu(menu, definitions, type, onBack, onChoose) {
    menu.replaceChildren();
    const header = document.createElement('div');
    header.className = 'pisi-badge-picker-header';
    const back = makeBadgePreferenceButton(`← ${t('back')}`, 'pisi-badge-picker-back');
    back.addEventListener('click', onBack);
    const title = document.createElement('strong');
    title.textContent = getBadgeTypeLabel(type);
    header.append(back, title);
    menu.appendChild(header);

    const selectedNames = new Set(getPisiMapPropertyBadgeSelections().map((item) => normalizePisiBadgePropertyName(item.name)));
    const matches = definitions.filter((definition) => definition.type === type);
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-badge-picker-empty';
        empty.textContent = t('noProperties');
        menu.appendChild(empty);
        return;
    }

    const list = document.createElement('div');
    list.className = 'pisi-badge-property-list';
    for (const definition of matches) {
        const button = makeBadgePreferenceButton(definition.name, 'pisi-badge-picker-option pisi-badge-property-option');
        const alreadySelected = selectedNames.has(normalizePisiBadgePropertyName(definition.name));
        button.disabled = alreadySelected;
        button.dataset.propertyId = definition.id;
        button.dataset.propertyType = definition.type;
        button.addEventListener('click', () => onChoose(definition));
        list.appendChild(button);
    }
    menu.appendChild(list);
}

function renderPisiSelectedBadgeList(host) {
    host.replaceChildren();
    const selections = getPisiMapPropertyBadgeSelections();
    if (!window.activeMapPath) {
        const empty = document.createElement('div');
        empty.className = 'pisi-badge-preference-empty';
        empty.textContent = t('noMap');
        host.appendChild(empty);
        return;
    }
    if (!selections.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-badge-preference-empty';
        empty.textContent = t('empty');
        host.appendChild(empty);
        return;
    }
    for (const selection of selections) {
        const row = document.createElement('div');
        row.className = 'pisi-badge-preference-item';
        const copy = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = selection.name;
        const type = document.createElement('small');
        type.textContent = getBadgeTypeLabel(selection.type);
        copy.append(name, type);
        const remove = makeBadgePreferenceButton('×', 'pisi-badge-preference-remove');
        remove.title = `${t('remove')}: ${selection.name}`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => {
            savePisiMapPropertyBadgeSelections(
                getPisiMapPropertyBadgeSelections().filter(
                    (item) => normalizePisiBadgePropertyName(item.name) !== normalizePisiBadgePropertyName(selection.name)
                )
            );
        });
        row.append(copy, remove);
        host.appendChild(row);
    }
}

function installPisiPropertyBadgePreferences() {
    const commandCenter = window.Pisi?.modules?.['shell.commandCenter']?.pisiCommandCenterState;
    if (!commandCenter || commandCenter.activePage !== 'preferences') return false;
    const panel = commandCenter.body?.querySelector('#pisi-customize-preferences');
    if (!panel) return false;

    let group = panel.querySelector('#pisi-map-property-badge-preferences');
    if (group) {
        renderPisiSelectedBadgeList(group.querySelector('.pisi-badge-preference-list'));
        const add = group.querySelector('#pisi-add-map-property-badge');
        if (add) add.disabled = !window.activeMapPath;
        return true;
    }

    group = document.createElement('details');
    group.id = 'pisi-map-property-badge-preferences';
    group.className = 'pisi-customize-group pisi-preference-group pisi-badge-preference-group';
    group.open = true;
    const summary = document.createElement('summary');
    summary.textContent = t('title');
    const description = document.createElement('div');
    description.className = 'pisi-customize-note';
    description.textContent = t('description');
    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-badge-preference-toolbar';
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'pisi-badge-preference-picker-wrap';
    const add = makeBadgePreferenceButton(t('add'), 'pisi-badge-preference-add');
    add.id = 'pisi-add-map-property-badge';
    add.disabled = !window.activeMapPath;
    const picker = document.createElement('div');
    picker.className = 'pisi-badge-picker';
    picker.hidden = true;
    pickerWrap.append(add, picker);
    toolbar.appendChild(pickerWrap);
    const list = document.createElement('div');
    list.className = 'pisi-badge-preference-list';

    add.addEventListener('click', async () => {
        if (!window.activeMapPath) return;
        const definitions = await getPisiBadgePropertyDefinitions();
        const showTypes = () =>
            renderPisiBadgeTypeMenu(picker, definitions, (type) =>
                renderPisiBadgePropertyMenu(picker, definitions, type, showTypes, (definition) => {
                    const next = [...getPisiMapPropertyBadgeSelections(), definition];
                    savePisiMapPropertyBadgeSelections(next);
                    picker.hidden = true;
                })
            );
        showTypes();
        picker.hidden = false;
    });

    group.append(summary, description, toolbar, list);
    const reset = panel.querySelector('#pisi-customize-reset');
    if (reset) panel.insertBefore(group, reset);
    else panel.appendChild(group);
    renderPisiSelectedBadgeList(list);
    return true;
}

function refreshPisiPropertyBadgePreferences() {
    const commandCenter = window.Pisi?.modules?.['shell.commandCenter']?.pisiCommandCenterState;
    if (!commandCenter || commandCenter.activePage !== 'preferences') return;
    const existing = commandCenter.body?.querySelector('#pisi-map-property-badge-preferences');
    if (existing) {
        existing.remove();
    }
    installPisiPropertyBadgePreferences();
}

function handlePisiBadgeNodePropertiesChanged(event) {
    const detail = event?.detail || {};
    const pathKey = normalizePisiBadgePath(detail.path);
    if (pathKey && detail.properties && Array.isArray(window.activeMapNodes)) {
        const node = window.activeMapNodes.find((item) => normalizePisiBadgePath(item?.fullPath) === pathKey);
        if (node) node.properties = detail.properties;
    }
    syncPisiMapPropertyBadges();
}

function bindPisiMapPropertyBadges() {
    ensurePisiMapPropertyBadgeStyles();
    syncPisiMapPropertyBadges();
    installPisiPropertyBadgePreferences();

    document.addEventListener('pisi:map-customization-context-changed', () => {
        requestAnimationFrame(() => {
            syncPisiMapPropertyBadges();
            refreshPisiPropertyBadgePreferences();
        });
    });
    document.addEventListener('pisi:node-properties-changed', handlePisiBadgeNodePropertiesChanged);
    document.addEventListener('pisi:language-changed', refreshPisiPropertyBadgePreferences);

    if (!preferenceObserver && document.body) {
        preferenceObserver = new MutationObserver((mutations) => {
            const preferencesAdded = mutations.some((mutation) =>
                [...mutation.addedNodes].some(
                    (node) =>
                        node?.nodeType === Node.ELEMENT_NODE &&
                        (node.matches?.('.pisi-preferences-page, #pisi-customize-preferences') ||
                            node.querySelector?.('.pisi-preferences-page, #pisi-customize-preferences'))
                )
            );
            if (preferencesAdded) requestAnimationFrame(installPisiPropertyBadgePreferences);
        });
        preferenceObserver.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('mousedown', (event) => {
        const picker = document.querySelector('#pisi-map-property-badge-preferences .pisi-badge-picker');
        if (picker && !picker.hidden && !event.target.closest?.('.pisi-badge-preference-picker-wrap')) {
            picker.hidden = true;
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiMapPropertyBadges, { once: true });
} else {
    bindPisiMapPropertyBadges();
}

registerModule('map.propertyBadges', {
    PISI_MAP_PROPERTY_BADGES_STORAGE_KEY,
    bindPisiMapPropertyBadges,
    getPisiBadgePropertyValues,
    getPisiMapPropertyBadgeSelections,
    installPisiPropertyBadgePreferences,
    normalizePisiMapPropertyBadgeSelections,
    savePisiMapPropertyBadgeSelections,
    syncPisiMapPropertyBadgeForNode,
    syncPisiMapPropertyBadges
});

export {
    bindPisiMapPropertyBadges,
    getPisiBadgePropertyValues,
    getPisiMapPropertyBadgeSelections,
    installPisiPropertyBadgePreferences,
    normalizePisiMapPropertyBadgeSelections,
    savePisiMapPropertyBadgeSelections,
    syncPisiMapPropertyBadgeForNode,
    syncPisiMapPropertyBadges
};
