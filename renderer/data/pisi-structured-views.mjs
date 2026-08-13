import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage } from "../shell/pisi-command-center.mjs";
import {
    ensurePisiSearchIndex,
    getPisiSearchCurrentNodePath,
    invalidatePisiSearchIndex
} from "../search/pisi-search-index.mjs";
import { openPisiSearchResult } from "../search/pisi-global-search.mjs";
import {
    PISI_NODE_PROPERTY_TYPES,
    PISI_ROLLUP_AGGREGATES,
    collectPisiPropertyColumns,
    filterPisiPropertyDocuments,
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection
} from "./pisi-properties-core.mjs";

const pisiStructuredViewState = {
    query: '',
    layout: 'table',
    savedViews: []
};

function pisiStructuredTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function makePisiStructuredButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiStructuredTranslate(label);
    return button;
}

function makePisiRollupField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'pisi-rollup-field';
    const label = document.createElement('span');
    label.textContent = pisiStructuredTranslate(labelText);
    field.append(label, control);
    return field;
}

function makePisiPropertyValueControl(property) {
    if (property.type === 'checkbox') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = property.value === true;
        input.dataset.propertyValue = 'true';
        return input;
    }
    if (property.type === 'rollup') {
        const host = document.createElement('div');
        host.className = 'pisi-rollup-control';
        host.dataset.propertyValue = 'true';
        const config = property.value && typeof property.value === 'object'
            ? property.value
            : {};
        const relation = document.createElement('input');
        relation.type = 'text';
        relation.dataset.rollupRelation = 'true';
        relation.placeholder = pisiStructuredTranslate('Relation adı veya kimliği');
        relation.value = config.relationProperty || '';
        const target = document.createElement('input');
        target.type = 'text';
        target.dataset.rollupTarget = 'true';
        target.placeholder = pisiStructuredTranslate('Hedef özellik adı veya kimliği');
        target.value = config.targetProperty || '';
        const aggregate = document.createElement('select');
        aggregate.dataset.rollupAggregate = 'true';
        for (const item of PISI_ROLLUP_AGGREGATES) {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = pisiStructuredTranslate(item.label);
            option.selected = item.value === (config.aggregate || 'count');
            aggregate.appendChild(option);
        }
        const help = document.createElement('div');
        help.className = 'pisi-rollup-help';
        help.textContent = pisiStructuredTranslate(
            'Rollup, Relation alanındaki node\'ların hedef özelliğini hesaplar.'
        );
        host.append(
            makePisiRollupField('Relation özelliği', relation),
            makePisiRollupField('Hedef özellik', target),
            makePisiRollupField('Hesaplama', aggregate),
            help
        );
        return host;
    }
    const input = document.createElement('input');
    input.type = property.type === 'number'
        ? 'number'
        : (property.type === 'date' ? 'date' : 'text');
    input.value = Array.isArray(property.value)
        ? property.value.join(', ')
        : String(property.value ?? '');
    input.dataset.propertyValue = 'true';
    if (property.type === 'multiselect' || property.type === 'relation') {
        input.placeholder = pisiStructuredTranslate('Virgülle ayırın');
    }
    if (property.type === 'node') {
        input.placeholder = pisiStructuredTranslate('Node yolu veya başlığı');
    }
    if (property.type === 'relation') {
        input.placeholder = pisiStructuredTranslate('Node yollarını veya kimliklerini virgülle ayırın');
    }
    return input;
}

function createPisiPropertyRow(property = {}) {
    const normalized = {
        id: property.id || '',
        name: property.name || '',
        type: property.type || 'text',
        value: property.value ?? '',
        system: property.system === true
    };
    const row = document.createElement('div');
    row.className = 'pisi-property-row';
    row.dataset.propertyId = normalized.id;
    row.dataset.propertySystem = normalized.system ? 'true' : 'false';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'pisi-property-name';
    name.value = normalized.name;
    name.placeholder = pisiStructuredTranslate('Özellik adı');
    name.disabled = normalized.system;

    const type = document.createElement('select');
    type.className = 'pisi-property-type';
    type.disabled = normalized.system;
    for (const optionRecord of PISI_NODE_PROPERTY_TYPES) {
        const option = document.createElement('option');
        option.value = optionRecord.value;
        option.textContent = pisiStructuredTranslate(optionRecord.label);
        option.selected = optionRecord.value === normalized.type;
        type.appendChild(option);
    }

    let value = makePisiPropertyValueControl(normalized);
    const valueHost = document.createElement('div');
    valueHost.className = 'pisi-property-value-host';
    valueHost.appendChild(value);
    type.addEventListener('change', () => {
        const previous = readPisiPropertyControlValue(value, normalized.type);
        normalized.type = type.value;
        normalized.value = previous;
        value = makePisiPropertyValueControl(normalized);
        valueHost.replaceChildren(value);
    });

    const remove = makePisiStructuredButton('×', 'pisi-property-remove');
    remove.title = pisiStructuredTranslate('Özelliği kaldır');
    remove.disabled = normalized.system;
    remove.addEventListener('click', () => row.remove());
    row.append(name, type, valueHost, remove);
    return row;
}

function readPisiPropertyControlValue(control, type) {
    if (type === 'checkbox') return control?.checked === true;
    if (type === 'rollup') {
        return {
            relationProperty: control?.querySelector?.('[data-rollup-relation]')?.value.trim() || '',
            targetProperty: control?.querySelector?.('[data-rollup-target]')?.value.trim() || '',
            aggregate: control?.querySelector?.('[data-rollup-aggregate]')?.value || 'count',
            separator: ', '
        };
    }
    return control?.value ?? '';
}

function collectPisiPropertyRows(host) {
    const properties = [];
    host.querySelectorAll('.pisi-property-row').forEach((row) => {
        const name = row.querySelector('.pisi-property-name')?.value.trim();
        if (!name) return;
        const type = row.querySelector('.pisi-property-type')?.value || 'text';
        const control = row.querySelector('[data-property-value]');
        let value = readPisiPropertyControlValue(control, type);
        if (type === 'number') value = Number(value);
        if (type === 'multiselect' || type === 'relation') {
            value = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
        }
        properties.push({
            id: row.dataset.propertyId || name,
            name,
            type,
            value,
            system: row.dataset.propertySystem === 'true'
        });
    });
    return properties;
}

function appendPisiPropertyRow(rows, property = {}) {
    const row = createPisiPropertyRow(property);
    rows.appendChild(row);
    row.querySelector('.pisi-property-name')?.focus();
    return row;
}

async function renderPisiNodeProperties(container) {
    const section = document.createElement('section');
    section.className = 'pisi-properties-editor';
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = pisiStructuredTranslate('Node özellikleri');
    heading.appendChild(title);
    section.appendChild(heading);

    const nodePath = getPisiSearchCurrentNodePath();
    if (!nodePath) {
        const empty = document.createElement('div');
        empty.className = 'pisi-command-empty';
        empty.textContent = pisiStructuredTranslate('Özellik düzenlemek için bir node açın.');
        section.appendChild(empty);
        container.appendChild(section);
        return;
    }
    const documentResult = await window.pisiProject?.getPisiDocument?.(nodePath);
    if (!documentResult?.ok) throw new Error(documentResult?.error || 'Node okunamadı.');
    const subtitle = document.createElement('div');
    subtitle.className = 'pisi-property-node-title';
    subtitle.textContent = documentResult.metadata?.title || nodePath;
    const rows = document.createElement('div');
    rows.className = 'pisi-property-rows';
    normalizePisiPropertyCollection(documentResult.data?.properties)
        .forEach((property) => rows.appendChild(createPisiPropertyRow(property)));
    const controls = document.createElement('div');
    controls.className = 'pisi-property-actions';
    const add = makePisiStructuredButton('Özellik ekle', 'pisi-secondary-button');
    add.addEventListener('click', () => appendPisiPropertyRow(rows));
    const addRelation = makePisiStructuredButton(
        'Relation ekle',
        'pisi-secondary-button pisi-relation-add'
    );
    addRelation.addEventListener('click', () => appendPisiPropertyRow(rows, {
        type: 'relation',
        value: []
    }));
    const addRollup = makePisiStructuredButton(
        'Rollup ekle',
        'pisi-secondary-button pisi-rollup-add'
    );
    addRollup.addEventListener('click', () => appendPisiPropertyRow(rows, {
        type: 'rollup',
        value: {
            relationProperty: '',
            targetProperty: '',
            aggregate: 'count',
            separator: ', '
        }
    }));
    const save = makePisiStructuredButton('Özellikleri kaydet', 'pisi-primary-button');
    const status = document.createElement('span');
    status.className = 'pisi-command-inline-status';
    save.addEventListener('click', async () => {
        save.disabled = true;
        status.textContent = pisiStructuredTranslate('Kaydediliyor…');
        const result = await window.pisiProject?.saveNodeProperties?.(
            nodePath,
            collectPisiPropertyRows(rows)
        );
        if (!result?.ok) {
            status.textContent = result?.error || pisiStructuredTranslate('Özellikler kaydedilemedi.');
            save.disabled = false;
            return;
        }
        invalidatePisiSearchIndex();
        await ensurePisiSearchIndex({ force: true });
        status.textContent = pisiStructuredTranslate('Özellikler kaydedildi.');
        save.disabled = false;
    });
    const templateControls = document.createElement('div');
    templateControls.className = 'pisi-template-controls';
    const templateResult = await window.pisiProject?.listDatabaseTemplates?.(
        window.currentProjectFolder
    );
    const templates = templateResult?.ok ? templateResult.templates : [];
    const templateSelect = document.createElement('select');
    const templateEmpty = document.createElement('option');
    templateEmpty.value = '';
    templateEmpty.textContent = pisiStructuredTranslate('Veritabanı şablonları');
    templateSelect.appendChild(templateEmpty);
    templates.forEach((template) => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        templateSelect.appendChild(option);
    });
    const saveTemplate = makePisiStructuredButton('Şablon olarak kaydet', 'pisi-secondary-button');
    saveTemplate.addEventListener('click', async () => {
        const name = prompt(pisiStructuredTranslate('Şablon adı'));
        if (!name) return;
        const result = await window.pisiProject?.saveDatabaseTemplate?.(
            window.currentProjectFolder,
            {
                name,
                nodeType: documentResult.data?.pisi?.nodeType || 'note',
                properties: collectPisiPropertyRows(rows)
            }
        );
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Şablon kaydedilemedi.'));
        await window.renderPisiCommandCenterPage?.();
    });
    const applyTemplate = makePisiStructuredButton('Şablonu uygula', 'pisi-secondary-button');
    applyTemplate.addEventListener('click', async () => {
        if (!templateSelect.value) return;
        const result = await window.pisiProject?.applyDatabaseTemplate?.(
            nodePath,
            templateSelect.value,
            { replaceProperties: false, applyContent: false }
        );
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Şablon uygulanamadı.'));
        invalidatePisiSearchIndex('template');
        await ensurePisiSearchIndex({ force: true });
        await window.renderPisiCommandCenterPage?.();
    });
    const deleteTemplate = makePisiStructuredButton('Şablonu sil', 'pisi-secondary-button');
    deleteTemplate.addEventListener('click', async () => {
        if (!templateSelect.value) return;
        const result = await window.pisiProject?.deleteDatabaseTemplate?.(
            window.currentProjectFolder,
            templateSelect.value
        );
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Şablon silinemedi.'));
        await window.renderPisiCommandCenterPage?.();
    });
    templateControls.append(templateSelect, saveTemplate, applyTemplate, deleteTemplate);
    controls.append(add, addRelation, addRollup, save, status);
    section.append(subtitle, controls, rows, templateControls);
    container.appendChild(section);
}

function formatPisiPropertyValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? '✓' : '—';
    return String(value ?? '');
}

function makePisiBaseOpenButton(documentRecord) {
    const button = makePisiStructuredButton(documentRecord.title, 'pisi-base-open');
    button.addEventListener('click', () => openPisiSearchResult({
        kind: 'node',
        nodePath: documentRecord.path,
        nodeTitle: documentRecord.title,
        nodeItem: documentRecord.nodeItem,
        mapPath: documentRecord.memberships?.[0]?.mapPath || null
    }));
    return button;
}

function renderPisiBaseTable(host, documents) {
    const table = document.createElement('table');
    table.className = 'pisi-base-table';
    const columns = collectPisiPropertyColumns(documents);
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of [pisiStructuredTranslate('Node'), ...columns.map((item) => item.name)]) {
        const cell = document.createElement('th');
        cell.textContent = label;
        header.appendChild(cell);
    }
    head.appendChild(header);
    const body = document.createElement('tbody');
    for (const documentRecord of documents) {
        const row = document.createElement('tr');
        const titleCell = document.createElement('td');
        titleCell.appendChild(makePisiBaseOpenButton(documentRecord));
        row.appendChild(titleCell);
        const properties = new Map(normalizePisiPropertyCollection(
            documentRecord.properties
        ).map((item) => [item.id, item]));
        for (const column of columns) {
            const cell = document.createElement('td');
            cell.textContent = formatPisiPropertyValue(properties.get(column.id)?.value);
            row.appendChild(cell);
        }
        body.appendChild(row);
    }
    table.append(head, body);
    host.appendChild(table);
}

function renderPisiBaseCards(host, documents) {
    const grid = document.createElement('div');
    grid.className = 'pisi-base-cards';
    for (const documentRecord of documents) {
        const card = document.createElement('article');
        card.className = 'pisi-base-card';
        card.appendChild(makePisiBaseOpenButton(documentRecord));
        const path = document.createElement('small');
        path.textContent = documentRecord.relativePath;
        card.appendChild(path);
        for (const property of normalizePisiPropertyCollection(documentRecord.properties).slice(0, 8)) {
            const row = document.createElement('div');
            const name = document.createElement('span');
            name.textContent = property.name;
            const value = document.createElement('strong');
            value.textContent = formatPisiPropertyValue(property.value);
            row.append(name, value);
            card.appendChild(row);
        }
        grid.appendChild(card);
    }
    host.appendChild(grid);
}

async function loadPisiSavedViews() {
    const result = await window.pisiProject?.listSavedViews?.(window.currentProjectFolder);
    pisiStructuredViewState.savedViews = result?.ok ? result.views : [];
    return pisiStructuredViewState.savedViews;
}

function renderPisiSavedViewControls(host, rerender) {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = pisiStructuredTranslate('Kaydedilmiş filtreler');
    select.appendChild(empty);
    for (const view of pisiStructuredViewState.savedViews) {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const view = pisiStructuredViewState.savedViews.find((item) => item.id === select.value);
        if (!view) return;
        pisiStructuredViewState.query = view.query;
        pisiStructuredViewState.layout = view.layout;
        rerender();
    });
    const save = makePisiStructuredButton('Filtreyi kaydet', 'pisi-secondary-button');
    save.addEventListener('click', async () => {
        const name = prompt(pisiStructuredTranslate('Görünüm adı'));
        if (!name) return;
        const result = await window.pisiProject?.saveView?.(
            window.currentProjectFolder,
            {
                name,
                query: pisiStructuredViewState.query,
                layout: pisiStructuredViewState.layout
            }
        );
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Görünüm kaydedilemedi.'));
        await loadPisiSavedViews();
        rerender();
    });
    const remove = makePisiStructuredButton('Filtreyi sil', 'pisi-secondary-button');
    remove.addEventListener('click', async () => {
        if (!select.value) return;
        const result = await window.pisiProject?.deleteView?.(
            window.currentProjectFolder,
            select.value
        );
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Görünüm silinemedi.'));
        await loadPisiSavedViews();
        rerender();
    });
    host.append(select, save, remove);
}

async function renderPisiBases(container) {
    const section = document.createElement('section');
    section.className = 'pisi-bases';
    const title = document.createElement('h2');
    title.textContent = pisiStructuredTranslate('Bases-lite');
    const index = await ensurePisiSearchIndex();
    await loadPisiSavedViews();
    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-bases-toolbar';
    const query = document.createElement('input');
    query.type = 'search';
    query.value = pisiStructuredViewState.query;
    query.placeholder = pisiStructuredTranslate('Durum:"Devam ediyor" Öncelik:>=4');
    const tableButton = makePisiStructuredButton('Tablo', 'pisi-base-layout-button');
    const cardsButton = makePisiStructuredButton('Kart', 'pisi-base-layout-button');
    const results = document.createElement('div');
    results.className = 'pisi-bases-results';
    const actions = document.createElement('div');
    actions.className = 'pisi-bases-actions';
    const rerenderResults = () => {
        pisiStructuredViewState.query = query.value.trim();
        tableButton.classList.toggle('active', pisiStructuredViewState.layout === 'table');
        cardsButton.classList.toggle('active', pisiStructuredViewState.layout === 'cards');
        const documents = filterPisiPropertyDocuments(
            materializePisiDatabaseDocuments(index?.documents?.values?.() || []),
            pisiStructuredViewState.query
        );
        results.replaceChildren();
        if (pisiStructuredViewState.layout === 'cards') renderPisiBaseCards(results, documents);
        else renderPisiBaseTable(results, documents);
        results.dataset.count = String(documents.length);
    };
    query.addEventListener('input', rerenderResults);
    tableButton.addEventListener('click', () => {
        pisiStructuredViewState.layout = 'table';
        rerenderResults();
    });
    cardsButton.addEventListener('click', () => {
        pisiStructuredViewState.layout = 'cards';
        rerenderResults();
    });
    const savedHost = document.createElement('div');
    savedHost.className = 'pisi-saved-view-controls';
    renderPisiSavedViewControls(savedHost, () => window.renderPisiCommandCenterPage?.());
    const createMap = makePisiStructuredButton('Sonuçlardan map üret', 'pisi-primary-button');
    createMap.addEventListener('click', async () => {
        const documents = filterPisiPropertyDocuments(
            materializePisiDatabaseDocuments(index?.documents?.values?.() || []),
            pisiStructuredViewState.query
        );
        const titleValue = prompt(
            pisiStructuredTranslate('Map adı'),
            pisiStructuredTranslate('Özellik görünümü')
        );
        if (!titleValue) return;
        createMap.disabled = true;
        const result = await window.pisiProject?.createPropertyMap?.(
            window.currentProjectFolder,
            {
                title: titleValue,
                query: pisiStructuredViewState.query,
                nodePaths: documents.map((item) => item.path)
            }
        );
        if (!result?.ok) {
            alert(result?.error || pisiStructuredTranslate('Map oluşturulamadı.'));
            createMap.disabled = false;
            return;
        }
        await window.refreshCurrentProjectTree?.();
        alert(`${pisiStructuredTranslate('Map oluşturuldu')}: ${result.fileName}`);
        createMap.disabled = false;
    });
    toolbar.append(query, tableButton, cardsButton);
    actions.append(savedHost, createMap);
    section.append(title, toolbar, actions, results);
    container.appendChild(section);
    rerenderResults();
}

async function renderPisiStructuredPage(container) {
    await renderPisiNodeProperties(container);
    await renderPisiBases(container);
}

function initializePisiStructuredViews() {
    registerPisiCommandCenterPage({
        id: 'data',
        label: 'Özellikler',
        order: 20,
        render: renderPisiStructuredPage
    });
}

const moduleApi = {
    pisiStructuredViewState,
    createPisiPropertyRow,
    collectPisiPropertyRows,
    readPisiPropertyControlValue,
    renderPisiNodeProperties,
    renderPisiBases,
    renderPisiStructuredPage,
    initializePisiStructuredViews
};

registerModule('data.structuredViews', moduleApi);
initializePisiStructuredViews();

export {
    collectPisiPropertyRows,
    createPisiPropertyRow,
    pisiStructuredViewState,
    renderPisiBases,
    renderPisiNodeProperties,
    renderPisiStructuredPage
};
