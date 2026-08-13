import { registerModule } from "../core/module-registry.mjs";
import { getPisiSearchCurrentNodePath } from "../search/pisi-search-index.mjs";
import {
    PISI_NODE_PROPERTY_TYPES,
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection
} from "./pisi-properties-core.mjs";
import {
    appendPisiPropertyRow,
    getPisiNodePropertyMapContext,
    renderPisiNodeProperties
} from "./pisi-structured-views.mjs";

const pisiNodePropertiesUiState = {
    bound: false,
    drawers: new Map(),
    infoGeneration: 0
};

function pisiNodePropertiesTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function pisiNodePropertiesPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function makePisiNodePropertiesEmpty(message) {
    const empty = document.createElement('div');
    empty.className = 'right-panel-empty';
    empty.textContent = pisiNodePropertiesTranslate(message);
    return empty;
}

function setPisiNodePropertiesDrawerOpen(record, open) {
    record.open = open;
    record.frame.dataset.propertiesOpen = open ? 'true' : 'false';
    record.drawer.hidden = !open;
    record.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    const label = pisiNodePropertiesTranslate(
        open ? 'Özellikleri gizle' : 'Özellikleri göster'
    );
    record.button.title = label;
    record.button.setAttribute('aria-label', label);
    if (!open) record.renderGeneration += 1;
}

function closePisiNodePropertiesDrawers(exceptRecord = null) {
    for (const record of pisiNodePropertiesUiState.drawers.values()) {
        if (record !== exceptRecord && record.open) {
            setPisiNodePropertiesDrawerOpen(record, false);
        }
    }
}

async function renderPisiNodePropertiesDrawer(record) {
    if (!record?.open) return false;
    const generation = ++record.renderGeneration;
    const loading = document.createElement('div');
    loading.className = 'pisi-node-properties-loading';
    loading.textContent = pisiNodePropertiesTranslate('Yükleniyor…');
    record.drawer.setAttribute('aria-busy', 'true');
    record.drawer.replaceChildren(loading);

    try {
        const staging = document.createElement('div');
        await renderPisiNodeProperties(staging);
        if (!record.open || generation !== record.renderGeneration) return false;
        record.drawer.replaceChildren(...staging.childNodes);
        return true;
    } catch (error) {
        if (!record.open || generation !== record.renderGeneration) return false;
        console.error('[PISI] Node Properties drawer could not be rendered:', error);
        record.drawer.replaceChildren(
            makePisiNodePropertiesEmpty('Özellikler yüklenemedi.')
        );
        return false;
    } finally {
        if (generation === record.renderGeneration) {
            record.drawer.removeAttribute('aria-busy');
        }
    }
}

function resolvePisiNodePropertiesDrawer(target) {
    if (typeof target === 'string') {
        return pisiNodePropertiesUiState.drawers.get(target) || null;
    }
    if (target?.drawer && target?.button) return target;
    const frame = target?.closest?.('.pisi-node-toolbar-frame');
    return frame
        ? pisiNodePropertiesUiState.drawers.get(frame.dataset.editorTarget)
        : null;
}

async function togglePisiNodePropertiesDrawer(target) {
    const record = resolvePisiNodePropertiesDrawer(target);
    if (!record) return false;
    if (record.open) {
        setPisiNodePropertiesDrawerOpen(record, false);
        return false;
    }
    closePisiNodePropertiesDrawers(record);
    setPisiNodePropertiesDrawerOpen(record, true);
    await renderPisiNodePropertiesDrawer(record);
    return true;
}

function installPisiNodePropertyDrawers() {
    const toolbars = document.querySelectorAll(
        '.pisi-editor-toolbar[data-editor-target]'
    );
    for (const toolbar of toolbars) {
        if (toolbar.closest('.pisi-node-toolbar-frame')) continue;
        const editorTarget = toolbar.dataset.editorTarget;
        if (!editorTarget) continue;

        const frame = document.createElement('div');
        frame.className = 'pisi-node-toolbar-frame';
        frame.dataset.editorTarget = editorTarget;
        frame.dataset.propertiesOpen = 'false';

        const drawer = document.createElement('div');
        drawer.id = `pisi-node-properties-drawer-${editorTarget}`;
        drawer.className = 'pisi-node-properties-drawer';
        drawer.setAttribute('role', 'region');
        drawer.setAttribute(
            'aria-label',
            pisiNodePropertiesTranslate('Node özellikleri')
        );
        drawer.hidden = true;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-node-properties-toggle';
        button.setAttribute('aria-controls', drawer.id);
        button.setAttribute('aria-expanded', 'false');
        const icon = document.createElement('span');
        icon.className = 'pisi-node-properties-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);

        const toggleRail = document.createElement('div');
        toggleRail.className = 'pisi-node-properties-toggle-rail';
        toggleRail.appendChild(button);

        toolbar.before(frame);
        frame.append(toolbar, toggleRail, drawer);

        const record = {
            button,
            drawer,
            editorTarget,
            frame,
            open: false,
            renderGeneration: 0,
            source: editorTarget === 'node-modal-content' ? 'modal' : 'center',
            toggleRail
        };
        pisiNodePropertiesUiState.drawers.set(editorTarget, record);
        setPisiNodePropertiesDrawerOpen(record, false);
        button.addEventListener('click', () => {
            void togglePisiNodePropertiesDrawer(record);
        });
    }
    return pisiNodePropertiesUiState.drawers.size;
}

function formatPisiNodePropertyValue(property) {
    const value = property?.value;
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (typeof value === 'boolean') return value ? '✓' : '—';
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function getPisiNodePropertyTypeLabel(type) {
    const record = PISI_NODE_PROPERTY_TYPES.find((item) => item.value === type);
    return pisiNodePropertiesTranslate(record?.label || type || 'Metin');
}

async function getPisiNodePropertiesSnapshot(nodePath) {
    const [documentResult, propertyContext] = await Promise.all([
        window.pisiProject?.getPisiDocument?.(nodePath),
        getPisiNodePropertyMapContext(nodePath)
    ]);
    if (!documentResult?.ok) {
        throw new Error(documentResult?.error || 'Node okunamadı.');
    }

    const targetKey = pisiNodePropertiesPathKey(nodePath);
    const mapDocuments = (propertyContext.nodes || []).map((item) => ({
        ...item,
        path: item.fullPath,
        title: item.metadata?.title ||
            String(item.fileName || '').replace(/\.node$/i, '') ||
            item.fullPath
    }));
    const indexedRecord = mapDocuments.find((item) => {
        return pisiNodePropertiesPathKey(item?.path) === targetKey;
    });
    const currentRecord = {
        ...(indexedRecord || {}),
        path: nodePath,
        title: documentResult.metadata?.title || indexedRecord?.title || nodePath,
        metadata: documentResult.metadata || indexedRecord?.metadata || {},
        properties: documentResult.data?.properties || {}
    };
    const databaseDocuments = indexedRecord
        ? mapDocuments.map((item) => (
            pisiNodePropertiesPathKey(item?.path) === targetKey
                ? currentRecord
                : item
        ))
        : [...mapDocuments, currentRecord];
    const materialized = databaseDocuments.length
        ? materializePisiDatabaseDocuments(databaseDocuments)
            .find((item) => pisiNodePropertiesPathKey(item?.path) === targetKey)
        : null;

    return {
        path: nodePath,
        title: currentRecord.title,
        properties: normalizePisiPropertyCollection(
            materialized?.properties || currentRecord.properties
        )
    };
}

async function addPisiToolbarRollup(editorTarget) {
    let record = resolvePisiNodePropertiesDrawer(editorTarget);
    if (!record) {
        const activeSource = window.activeModalNode
            ? 'modal'
            : (window.activeCenterNode ? 'center' : null);
        record = Array.from(pisiNodePropertiesUiState.drawers.values())
            .find((item) => item.source === activeSource) || null;
    }
    if (!record || !getPisiSearchCurrentNodePath()) return false;

    closePisiNodePropertiesDrawers(record);
    if (!record.open) {
        setPisiNodePropertiesDrawerOpen(record, true);
        const rendered = await renderPisiNodePropertiesDrawer(record);
        if (!rendered) return false;
    }
    const rows = record.drawer.querySelector('.pisi-property-rows');
    if (!rows) return false;
    appendPisiPropertyRow(rows, {
        type: 'rollup',
        value: {
            relationProperty: '',
            targetProperty: '',
            aggregate: 'count',
            separator: ', '
        }
    });
    return true;
}

async function renderPisiNodePropertiesInfo() {
    const host = document.getElementById('pisi-node-properties-info');
    if (!host) return false;
    const nodePath = getPisiSearchCurrentNodePath();
    const generation = ++pisiNodePropertiesUiState.infoGeneration;
    if (!nodePath) {
        host.replaceChildren(
            makePisiNodePropertiesEmpty('Özellikleri görmek için bir node aç.')
        );
        return false;
    }

    host.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div');
    loading.className = 'pisi-node-properties-loading';
    loading.textContent = pisiNodePropertiesTranslate('Yükleniyor…');
    host.replaceChildren(loading);

    try {
        const snapshot = await getPisiNodePropertiesSnapshot(nodePath);
        if (
            generation !== pisiNodePropertiesUiState.infoGeneration ||
            pisiNodePropertiesPathKey(getPisiSearchCurrentNodePath()) !==
                pisiNodePropertiesPathKey(nodePath)
        ) {
            return false;
        }

        const header = document.createElement('div');
        header.className = 'pisi-properties-info-header';
        const title = document.createElement('strong');
        title.textContent = snapshot.title;
        const badge = document.createElement('span');
        badge.className = 'pisi-properties-readonly-badge';
        badge.textContent = pisiNodePropertiesTranslate('Salt okunur');
        header.append(title, badge);

        if (!snapshot.properties.length) {
            host.replaceChildren(
                header,
                makePisiNodePropertiesEmpty('Bu node için özellik tanımlanmamış.')
            );
            return true;
        }

        const list = document.createElement('div');
        list.className = 'pisi-properties-info-list';
        for (const property of snapshot.properties) {
            const row = document.createElement('div');
            row.className = 'pisi-properties-info-row';
            const rowHeading = document.createElement('div');
            rowHeading.className = 'pisi-properties-info-row-heading';
            const name = document.createElement('strong');
            name.textContent = property.name;
            const type = document.createElement('span');
            type.className = 'pisi-properties-info-type';
            type.textContent = getPisiNodePropertyTypeLabel(property.type);
            rowHeading.append(name, type);
            const value = document.createElement('div');
            value.className = 'pisi-properties-info-value';
            value.textContent = formatPisiNodePropertyValue(property);
            row.append(rowHeading, value);
            list.appendChild(row);
        }
        host.replaceChildren(header, list);
        return true;
    } catch (error) {
        if (generation !== pisiNodePropertiesUiState.infoGeneration) return false;
        console.error('[PISI] Read-only Node Properties could not be rendered:', error);
        host.replaceChildren(
            makePisiNodePropertiesEmpty('Özellikler yüklenemedi.')
        );
        return false;
    } finally {
        if (generation === pisiNodePropertiesUiState.infoGeneration) {
            host.removeAttribute('aria-busy');
        }
    }
}

function syncPisiNodePropertiesTab(detail = {}) {
    const button = document.querySelector(
        '.right-panel-tab[data-right-tab="properties"]'
    );
    if (!button) return false;
    const nodePath = Object.prototype.hasOwnProperty.call(detail, 'path')
        ? detail.path
        : getPisiSearchCurrentNodePath();
    const enabled = Boolean(nodePath);
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true');

    if (!enabled) {
        pisiNodePropertiesUiState.infoGeneration += 1;
        const host = document.getElementById('pisi-node-properties-info');
        host?.replaceChildren(
            makePisiNodePropertiesEmpty('Özellikleri görmek için bir node aç.')
        );
        if (button.classList.contains('active')) {
            document.querySelector(
                '.right-panel-tab[data-right-tab="missions"]'
            )?.click();
        }
    } else if (button.classList.contains('active')) {
        void renderPisiNodePropertiesInfo();
    }
    return enabled;
}

function initializePisiNodePropertiesUi() {
    installPisiNodePropertyDrawers();
    if (pisiNodePropertiesUiState.bound) {
        syncPisiNodePropertiesTab();
        return;
    }
    pisiNodePropertiesUiState.bound = true;

    const tabButton = document.querySelector(
        '.right-panel-tab[data-right-tab="properties"]'
    );
    tabButton?.addEventListener('click', () => {
        if (!tabButton.disabled) void renderPisiNodePropertiesInfo();
    });

    document.addEventListener('pisi:active-node-changed', (event) => {
        const source = event.detail?.source || null;
        for (const record of pisiNodePropertiesUiState.drawers.values()) {
            if (!event.detail?.path || record.source !== source) {
                setPisiNodePropertiesDrawerOpen(record, false);
            } else if (record.open) {
                void renderPisiNodePropertiesDrawer(record);
            }
        }
        syncPisiNodePropertiesTab(event.detail || {});
    });

    document.addEventListener('pisi:node-properties-changed', (event) => {
        const activePath = getPisiSearchCurrentNodePath();
        if (
            pisiNodePropertiesPathKey(event.detail?.path) !==
            pisiNodePropertiesPathKey(activePath)
        ) {
            return;
        }
        if (event.detail?.refreshEditor) {
            for (const record of pisiNodePropertiesUiState.drawers.values()) {
                if (record.open) void renderPisiNodePropertiesDrawer(record);
            }
        }
        const propertiesTab = document.querySelector(
            '.right-panel-tab[data-right-tab="properties"]'
        );
        if (propertiesTab?.classList.contains('active')) {
            void renderPisiNodePropertiesInfo();
        }
    });

    document.addEventListener('pisi:property-rollup-request', (event) => {
        void addPisiToolbarRollup(event.detail?.editorTarget || null);
    });

    syncPisiNodePropertiesTab();
}

const moduleApi = {
    pisiNodePropertiesUiState,
    addPisiToolbarRollup,
    installPisiNodePropertyDrawers,
    togglePisiNodePropertiesDrawer,
    renderPisiNodePropertiesInfo,
    syncPisiNodePropertiesTab,
    initializePisiNodePropertiesUi
};

registerModule('data.nodePropertiesUi', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiNodePropertiesUi, {
        once: true
    });
} else {
    initializePisiNodePropertiesUi();
}

export {
    addPisiToolbarRollup,
    initializePisiNodePropertiesUi,
    installPisiNodePropertyDrawers,
    pisiNodePropertiesUiState,
    renderPisiNodePropertiesInfo,
    syncPisiNodePropertiesTab,
    togglePisiNodePropertiesDrawer
};
