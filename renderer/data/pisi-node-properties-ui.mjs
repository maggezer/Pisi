import { registerModule } from "../core/module-registry.mjs";
import { getPisiSearchCurrentNodePath } from "../search/pisi-search-index.mjs";
import {
    PISI_NODE_PROPERTY_TYPES,
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection
} from "./pisi-properties-core.mjs";
import {
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
    if (type === 'system') return pisiNodePropertiesTranslate('Sistem');
    if (type === 'rollup') return pisiNodePropertiesTranslate('Rollup');
    const record = PISI_NODE_PROPERTY_TYPES.find((item) => item.value === type);
    return pisiNodePropertiesTranslate(record?.label || type || 'Metin');
}

function formatPisiNodeSystemDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '—';
    const locale = window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-GB' : 'tr-TR';
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function getPisiNodeSystemProperties(metadata = {}) {
    return [
        {
            id: 'pisi-node-id',
            name: pisiNodePropertiesTranslate('Node ID'),
            type: 'system',
            value: metadata.id || '—',
            system: true
        },
        {
            id: 'pisi-created-at',
            name: pisiNodePropertiesTranslate('Oluşturulma tarihi'),
            type: 'system',
            value: formatPisiNodeSystemDate(metadata.createdAt),
            system: true
        },
        {
            id: 'pisi-updated-at',
            name: pisiNodePropertiesTranslate('Değiştirilme tarihi'),
            type: 'system',
            value: formatPisiNodeSystemDate(metadata.updatedAt),
            system: true
        }
    ];
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
        systemProperties: getPisiNodeSystemProperties(currentRecord.metadata),
        properties: normalizePisiPropertyCollection(
            materialized?.properties || currentRecord.properties
        )
    };
}

function getPisiVisibleNodeProperties(snapshot = {}) {
    return [
        ...(snapshot.systemProperties || []),
        ...(snapshot.properties || [])
    ].filter((property) => {
        return property.system !== true &&
            property.type !== 'system' &&
            property.type !== 'relation';
    });
}

function getPisiNodeDetailTags(properties = []) {
    return Array.from(new Set(properties
        .filter((property) => property.type === 'multiselect')
        .flatMap((property) => Array.isArray(property.value)
            ? property.value
            : String(property.value || '').split(','))
        .map((value) => String(value || '').replace(/^#/, '').trim())
        .filter(Boolean)));
}

function getPisiNodeBlockTagCounts(nodePath) {
    const counts = new Map();
    const records = Array.isArray(window.pisiTagsPanelState?.index)
        ? window.pisiTagsPanelState.index
        : [];
    for (const block of records) {
        if (
            pisiNodePropertiesPathKey(block?.nodePath) !==
            pisiNodePropertiesPathKey(nodePath)
        ) {
            continue;
        }
        for (const rawTag of Array.isArray(block.tags) ? block.tags : []) {
            const tag = String(rawTag || '')
                .replace(/^(?:#|\.\.|\/)/, '')
                .trim()
                .toLocaleLowerCase('tr-TR');
            if (!tag || tag === 'done' || /^todo\./i.test(tag)) continue;
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }
    return counts;
}

function makePisiNodeDetailsSection(titleText) {
    const section = document.createElement('section');
    section.className = 'pisi-node-details-section';
    const title = document.createElement('h3');
    title.className = 'pisi-node-details-section-title';
    title.textContent = pisiNodePropertiesTranslate(titleText);
    section.appendChild(title);
    return section;
}

function makePisiNodeDetailsTags(tags, emptyMessage, options = {}) {
    if (!tags.length) return makePisiNodePropertiesEmpty(emptyMessage);
    const list = document.createElement('div');
    list.className = 'pisi-node-details-tags';
    for (const tagRecord of tags) {
        const tag = typeof tagRecord === 'string' ? tagRecord : tagRecord.tag;
        const count = typeof tagRecord === 'string' ? null : tagRecord.count;
        const chip = document.createElement(options.interactive ? 'button' : 'span');
        chip.className = 'pisi-node-details-tag';
        if (options.interactive) {
            chip.type = 'button';
            chip.title = pisiNodePropertiesTranslate('Etiket gezgininde aç');
            chip.addEventListener('click', () => window.openPisiTagExplorer?.(tag));
        }
        chip.textContent = `#${tag}${count ? ` · ${count}` : ''}`;
        list.appendChild(chip);
    }
    return list;
}

async function renderPisiNodePropertiesInfo() {
    const host = document.getElementById('pisi-node-details-info');
    if (!host) return false;
    const nodePath = getPisiSearchCurrentNodePath();
    const generation = ++pisiNodePropertiesUiState.infoGeneration;
    if (!nodePath) {
        host.replaceChildren(
            makePisiNodePropertiesEmpty('Detayları görmek için bir node aç.')
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

        const visibleProperties = getPisiVisibleNodeProperties(snapshot);
        const nodeTags = getPisiNodeDetailTags(visibleProperties);
        const regularProperties = visibleProperties.filter((property) => {
            return property.type !== 'multiselect';
        });
        const blockTags = Array.from(getPisiNodeBlockTagCounts(nodePath))
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => a.tag.localeCompare(b.tag, 'tr'));

        const nodeTagsSection = makePisiNodeDetailsSection('Node etiketleri');
        nodeTagsSection.appendChild(makePisiNodeDetailsTags(
            nodeTags,
            'Bu node için etiket tanımlanmamış.'
        ));

        const blockTagsSection = makePisiNodeDetailsSection('Blok etiketleri');
        blockTagsSection.appendChild(makePisiNodeDetailsTags(
            blockTags,
            'Bu node’da blok etiketi yok.',
            { interactive: true }
        ));

        const propertiesSection = makePisiNodeDetailsSection('Özellikler');

        const list = document.createElement('div');
        list.className = 'pisi-properties-info-list';
        for (const property of regularProperties) {
            const row = document.createElement('div');
            row.className = 'pisi-properties-info-row';
            row.dataset.system = property.system === true ? 'true' : 'false';
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
        propertiesSection.appendChild(
            regularProperties.length
                ? list
                : makePisiNodePropertiesEmpty('Bu node için özellik tanımlanmamış.')
        );
        host.replaceChildren(
            header,
            nodeTagsSection,
            blockTagsSection,
            propertiesSection
        );
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
        '.right-panel-tab[data-right-tab="details"]'
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
        const host = document.getElementById('pisi-node-details-info');
        host?.replaceChildren(
            makePisiNodePropertiesEmpty('Detayları görmek için bir node aç.')
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
        '.right-panel-tab[data-right-tab="details"]'
    );
    tabButton?.addEventListener('click', () => {
        if (!tabButton.disabled) {
            void renderPisiNodePropertiesInfo();
            window.refreshPisiTagsPanelSoon?.();
        }
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
            '.right-panel-tab[data-right-tab="details"]'
        );
        if (propertiesTab?.classList.contains('active')) {
            void renderPisiNodePropertiesInfo();
        }
    });

    document.addEventListener('pisi:tags-index-updated', () => {
        const detailsTab = document.querySelector(
            '.right-panel-tab[data-right-tab="details"]'
        );
        if (detailsTab?.classList.contains('active')) {
            void renderPisiNodePropertiesInfo();
        }
    });

    syncPisiNodePropertiesTab();
}

const moduleApi = {
    pisiNodePropertiesUiState,
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
    initializePisiNodePropertiesUi,
    installPisiNodePropertyDrawers,
    pisiNodePropertiesUiState,
    renderPisiNodePropertiesInfo,
    syncPisiNodePropertiesTab,
    togglePisiNodePropertiesDrawer
};
