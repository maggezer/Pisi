import { registerModule } from '../core/module-registry.mjs';
import { getPisiSearchCurrentNodePath, invalidatePisiSearchIndex } from '../search/pisi-search-index.mjs';
import { openPisiSearchResult } from '../search/pisi-global-search.mjs';
import {
    PISI_NODE_PROPERTY_TYPES,
    PISI_ROLLUP_AGGREGATES,
    collectPisiPropertyColumns,
    filterPisiPropertyDocuments,
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection
} from './pisi-properties-core.mjs';

const pisiStructuredViewState = {
    query: '',
    layout: 'table',
    savedViews: []
};

function pisiStructuredTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function dispatchPisiNodePropertiesChanged(path, reason, options = {}) {
    document.dispatchEvent(
        new CustomEvent('pisi:node-properties-changed', {
            detail: {
                path,
                reason,
                properties: options.properties || null,
                refreshEditor: options.refreshEditor === true
            }
        })
    );
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

function pisiPropertyPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function pisiPropertyNameKey(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

function getPisiActivePropertyMapPath(nodePath = '') {
    const targetKey = pisiPropertyPathKey(nodePath);
    for (const activeNode of [window.activeModalNode, window.activeCenterNode]) {
        if (activeNode?.mapPath && (!targetKey || pisiPropertyPathKey(activeNode.path) === targetKey)) {
            return activeNode.mapPath;
        }
    }
    return window.activeMapPath || null;
}

function collectPisiMapPropertyDefinitions(nodes = []) {
    const definitions = new Map();
    for (const node of nodes) {
        for (const property of normalizePisiPropertyCollection(node?.properties)) {
            const key = pisiPropertyNameKey(property.name);
            if (!key || definitions.has(key)) continue;
            definitions.set(key, {
                id: property.id,
                name: property.name,
                type: property.type,
                system: property.system === true
            });
        }
    }
    return Array.from(definitions.values()).sort((a, b) => {
        return a.name.localeCompare(b.name, 'tr');
    });
}

async function getPisiNodePropertyMapContext(nodePath) {
    const preferredMapPath = getPisiActivePropertyMapPath(nodePath);
    const result =
        typeof window.pisiProject?.getNodePropertyContext === 'function'
            ? await window.pisiProject.getNodePropertyContext(nodePath, preferredMapPath)
            : preferredMapPath
              ? await window.pisiProject?.listMapNodes?.(preferredMapPath)
              : { ok: true, nodes: [] };
    if (!result?.ok) {
        throw new Error(result?.error || 'Map özellikleri yüklenemedi.');
    }
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    return {
        mapPath: result.mapPath || preferredMapPath || null,
        nodes,
        propertyDefinitions: collectPisiMapPropertyDefinitions(nodes),
        nodePath
    };
}

async function getPisiActiveMapPropertyContext() {
    const nodePath = getPisiSearchCurrentNodePath();
    if (nodePath) return getPisiNodePropertyMapContext(nodePath);
    const mapPath = window.activeMapPath || null;
    if (!mapPath) {
        return {
            mapPath: null,
            nodes: [],
            propertyDefinitions: [],
            nodePath: null
        };
    }
    const result = await window.pisiProject?.listMapNodes?.(mapPath);
    if (!result?.ok) {
        throw new Error(result?.error || 'Map özellikleri yüklenemedi.');
    }
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    return {
        mapPath,
        nodes,
        propertyDefinitions: collectPisiMapPropertyDefinitions(nodes),
        nodePath: null
    };
}

function makePisiMapDatabaseDocuments(context) {
    return (context?.nodes || []).map((node) => ({
        ...node,
        path: node.fullPath,
        relativePath: node.fileName || node.fullPath,
        title: getPisiMapNodeLabel(node),
        nodeItem: {
            ...node,
            name: node.fileName,
            type: 'file',
            isFile: true,
            isDirectory: false,
            mapPath: context.mapPath
        },
        memberships: context.mapPath ? [{ mapPath: context.mapPath }] : []
    }));
}

function getPisiPropertyTypeLabel(type) {
    return PISI_NODE_PROPERTY_TYPES.find((item) => item.value === type)?.label || type;
}

function makePisiPropertyIconButton(label, iconName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-property-icon-button';
    button.title = pisiStructuredTranslate(label);
    button.setAttribute('aria-label', pisiStructuredTranslate(label));
    const icon = document.createElement('span');
    icon.className = `pisi-property-action-icon pisi-property-action-icon-${iconName}`;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    return button;
}

function getPisiMapNodeLabel(node) {
    return node?.metadata?.title || String(node?.fileName || '').replace(/\.node$/i, '') || node?.fullPath || pisiStructuredTranslate('Node');
}

function pisiMapNodeMatchesValue(node, value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const pathKey = pisiPropertyPathKey(text);
    return (
        [node?.fullPath, node?.fileName, node?.id, node?.metadata?.id].some((candidate) => pisiPropertyPathKey(candidate) === pathKey) ||
        pisiPropertyNameKey(getPisiMapNodeLabel(node)) === pisiPropertyNameKey(text)
    );
}

function makePisiRelationPropertyPicker(property, context) {
    const picker = document.createElement('details');
    picker.className = 'pisi-property-node-picker';
    picker.dataset.propertyValue = 'true';
    const summary = document.createElement('summary');
    const menu = document.createElement('div');
    menu.className = 'pisi-property-node-picker-menu';
    const rawValues = Array.isArray(property.value)
        ? property.value.map(String)
        : String(property.value || '')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean);
    const consumed = new Set();

    const updateSummary = () => {
        const labels = Array.from(menu.querySelectorAll('input:checked')).map((input) => input.dataset.nodeLabel || input.value);
        summary.textContent = labels.length ? labels.join(', ') : pisiStructuredTranslate('Node seçin');
        summary.title = summary.textContent;
    };
    const appendOption = (value, label, checked, legacy = false) => {
        const option = document.createElement('label');
        option.className = 'pisi-property-node-picker-option';
        if (legacy) option.dataset.legacy = 'true';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = checked;
        checkbox.dataset.nodeLabel = label;
        checkbox.addEventListener('change', updateSummary);
        const text = document.createElement('span');
        text.textContent = label;
        option.append(checkbox, text);
        menu.appendChild(option);
    };

    for (const node of context.nodes || []) {
        const matchedIndexes = rawValues.map((value, index) => (pisiMapNodeMatchesValue(node, value) ? index : -1)).filter((index) => index >= 0);
        matchedIndexes.forEach((index) => consumed.add(index));
        appendOption(node.fullPath, getPisiMapNodeLabel(node), matchedIndexes.length > 0);
    }
    rawValues.forEach((value, index) => {
        if (!consumed.has(index)) appendOption(value, value, true, true);
    });
    if (!menu.children.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-property-node-picker-empty';
        empty.textContent = pisiStructuredTranslate('Bu mapte seçilebilir node yok.');
        menu.appendChild(empty);
    }
    picker.append(summary, menu);
    updateSummary();
    return picker;
}

function makePisiRollupReferenceSelect(definitions, selectedValue, placeholder) {
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = pisiStructuredTranslate(placeholder);
    select.appendChild(empty);
    let selected = false;
    for (const definition of definitions) {
        const option = document.createElement('option');
        option.value = definition.id;
        option.textContent = definition.name;
        option.selected = [definition.id, definition.name].some((value) => pisiPropertyNameKey(value) === pisiPropertyNameKey(selectedValue));
        selected = selected || option.selected;
        select.appendChild(option);
    }
    if (selectedValue && !selected) {
        const legacy = document.createElement('option');
        legacy.value = selectedValue;
        legacy.textContent = selectedValue;
        legacy.selected = true;
        select.appendChild(legacy);
    }
    return select;
}

function makePisiPropertyValueControl(property, context = {}) {
    if (property.type === 'relation') {
        return makePisiRelationPropertyPicker(property, context);
    }
    if (property.type === 'rollup') {
        const host = document.createElement('div');
        host.className = 'pisi-rollup-control';
        host.dataset.propertyValue = 'true';
        const config = property.value && typeof property.value === 'object' ? property.value : {};
        const relation = makePisiRollupReferenceSelect(
            (context.propertyDefinitions || []).filter((item) => item.type === 'relation'),
            config.relationProperty || '',
            'Relation adı veya kimliği'
        );
        relation.dataset.rollupRelation = 'true';
        const target = makePisiRollupReferenceSelect(
            (context.propertyDefinitions || []).filter((item) => item.type !== 'rollup'),
            config.targetProperty || '',
            'Hedef özellik adı veya kimliği'
        );
        target.dataset.rollupTarget = 'true';
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
        help.textContent = pisiStructuredTranslate("Rollup, Relation alanındaki node'ların hedef özelliğini hesaplar.");
        host.append(
            makePisiRollupField('Relation özelliği', relation),
            makePisiRollupField('Hedef özellik', target),
            makePisiRollupField('Hesaplama', aggregate),
            help
        );
        return host;
    }
    const input = document.createElement('input');
    input.type = property.type === 'number' ? 'number' : 'text';
    input.value = Array.isArray(property.value) ? property.value.join(', ') : String(property.value ?? '');
    input.dataset.propertyValue = 'true';
    if (property.type === 'multiselect') {
        input.placeholder = pisiStructuredTranslate('Etiketleri virgülle ayırın');
    }
    return input;
}

function makePisiBlankPropertyValue(type) {
    if (type === 'multiselect' || type === 'relation') return [];
    if (type === 'number') return null;
    if (type === 'rollup') {
        return {
            relationProperty: '',
            targetProperty: '',
            aggregate: 'count',
            separator: ', '
        };
    }
    return '';
}

function createPisiPropertyRow(property = {}, context = {}) {
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
    row.dataset.propertyType = normalized.type;
    row.dataset.propertySystem = normalized.system ? 'true' : 'false';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'pisi-property-name';
    name.value = normalized.name;
    name.placeholder = pisiStructuredTranslate('Özellik adı');
    name.disabled = normalized.system;

    const nameControl = document.createElement('div');
    nameControl.className = 'pisi-property-name-control';
    const suggestionToggle = document.createElement('button');
    suggestionToggle.type = 'button';
    suggestionToggle.className = 'pisi-property-name-toggle';
    suggestionToggle.title = pisiStructuredTranslate('Var olan özellikleri göster');
    suggestionToggle.setAttribute('aria-label', suggestionToggle.title);
    suggestionToggle.setAttribute('aria-expanded', 'false');
    const isRollup = normalized.type === 'rollup';
    suggestionToggle.disabled = normalized.system || isRollup || !context.propertyDefinitions?.length;
    const suggestions = document.createElement('div');
    suggestions.className = 'pisi-property-suggestions';
    suggestions.hidden = true;

    const type = document.createElement(isRollup ? 'span' : 'select');
    type.className = isRollup ? 'pisi-property-type-readonly' : 'pisi-property-type';
    if (isRollup) {
        type.textContent = pisiStructuredTranslate('Rollup');
    } else {
        type.disabled = normalized.system;
        for (const optionRecord of PISI_NODE_PROPERTY_TYPES) {
            const option = document.createElement('option');
            option.value = optionRecord.value;
            option.textContent = pisiStructuredTranslate(optionRecord.label);
            option.selected = optionRecord.value === normalized.type;
            type.appendChild(option);
        }
    }

    let value = makePisiPropertyValueControl(normalized, context);
    const valueHost = document.createElement('div');
    valueHost.className = 'pisi-property-value-host';
    valueHost.appendChild(value);
    const replaceValue = (nextValue) => {
        normalized.value = nextValue;
        value = makePisiPropertyValueControl(normalized, context);
        valueHost.replaceChildren(value);
    };
    if (!isRollup) {
        type.addEventListener('change', () => {
            normalized.type = type.value;
            row.dataset.propertyType = normalized.type;
            replaceValue(makePisiBlankPropertyValue(normalized.type));
        });
    }

    const hideSuggestions = () => {
        suggestions.hidden = true;
        suggestionToggle.setAttribute('aria-expanded', 'false');
    };
    const applyDefinition = (definition) => {
        normalized.id = definition.id;
        normalized.name = definition.name;
        normalized.type = definition.type;
        row.dataset.propertyId = definition.id;
        row.dataset.propertyType = definition.type;
        name.value = definition.name;
        type.value = definition.type;
        replaceValue(makePisiBlankPropertyValue(definition.type));
        hideSuggestions();
    };
    const showSuggestions = (filter = '') => {
        if (isRollup) return;
        const needle = pisiPropertyNameKey(filter);
        const matches = (context.propertyDefinitions || []).filter((definition) => {
            return definition.type !== 'rollup' && (!needle || pisiPropertyNameKey(definition.name).includes(needle));
        });
        suggestions.replaceChildren();
        for (const definition of matches) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'pisi-property-suggestion';
            const label = document.createElement('strong');
            label.textContent = definition.name;
            const typeLabel = document.createElement('span');
            typeLabel.textContent = pisiStructuredTranslate(getPisiPropertyTypeLabel(definition.type));
            option.append(label, typeLabel);
            option.addEventListener('pointerdown', (event) => event.preventDefault());
            option.addEventListener('click', () => applyDefinition(definition));
            suggestions.appendChild(option);
        }
        suggestions.hidden = matches.length === 0;
        suggestionToggle.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
    };
    name.addEventListener('click', () => showSuggestions(name.value));
    name.addEventListener('focus', () => showSuggestions(name.value));
    name.addEventListener('input', () => showSuggestions(name.value));
    name.addEventListener('change', () => {
        if (isRollup) return;
        const exact = (context.propertyDefinitions || []).find((definition) => {
            return definition.type !== 'rollup' && pisiPropertyNameKey(definition.name) === pisiPropertyNameKey(name.value);
        });
        if (exact) applyDefinition(exact);
    });
    suggestionToggle.addEventListener('click', () => {
        if (suggestions.hidden) showSuggestions('');
        else hideSuggestions();
    });
    nameControl.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!nameControl.contains(document.activeElement)) hideSuggestions();
        }, 0);
    });
    nameControl.append(name, suggestionToggle, suggestions);

    const remove = makePisiStructuredButton('×', 'pisi-property-remove');
    remove.title = pisiStructuredTranslate('Özelliği kaldır');
    remove.disabled = normalized.system;
    remove.addEventListener('click', () => row.remove());
    row.append(nameControl, type, valueHost, remove);
    return row;
}

function readPisiPropertyControlValue(control, type) {
    if (type === 'rollup') {
        return {
            relationProperty: control?.querySelector?.('[data-rollup-relation]')?.value.trim() || '',
            targetProperty: control?.querySelector?.('[data-rollup-target]')?.value.trim() || '',
            aggregate: control?.querySelector?.('[data-rollup-aggregate]')?.value || 'count',
            separator: ', '
        };
    }
    if (type === 'relation') {
        return Array.from(control?.querySelectorAll?.('input:checked') || [])
            .map((input) => input.value)
            .filter(Boolean);
    }
    return control?.value ?? '';
}

function collectPisiPropertyRows(host) {
    const properties = [];
    host.querySelectorAll('.pisi-property-row').forEach((row) => {
        const name = row.querySelector('.pisi-property-name')?.value.trim();
        if (!name) return;
        const type = row.dataset.propertyType || row.querySelector('.pisi-property-type')?.value || 'text';
        const control = row.querySelector('[data-property-value]');
        let value = readPisiPropertyControlValue(control, type);
        if (type === 'number') value = value === '' ? null : Number(value);
        if (type === 'multiselect') {
            value = String(value || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
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

function appendPisiPropertyRow(rows, property = {}, context = rows?.pisiPropertyContext || {}) {
    const row = createPisiPropertyRow(property, context);
    rows.appendChild(row);
    row.querySelector('.pisi-property-name')?.focus();
    return row;
}

function makePisiPropertyTemplatePicker(templates, nodePath, status) {
    const picker = document.createElement('div');
    picker.className = 'pisi-property-template-picker';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pisi-property-template-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.className = 'pisi-property-template-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = pisiStructuredTranslate('Şablon seç');
    const chevron = document.createElement('span');
    chevron.className = 'pisi-property-template-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(icon, label, chevron);

    const menu = document.createElement('div');
    menu.className = 'pisi-property-template-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    for (const template of templates) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'pisi-property-template-option';
        option.setAttribute('role', 'menuitem');
        const name = document.createElement('span');
        name.textContent = template.name;
        const count = document.createElement('small');
        count.textContent = String(normalizePisiPropertyCollection(template.properties).length);
        option.append(name, count);
        option.addEventListener('click', async () => {
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            trigger.disabled = true;
            status.textContent = pisiStructuredTranslate('Şablon uygulanıyor…');
            const result = await window.pisiProject?.applyDatabaseTemplate?.(nodePath, template.id, { replaceProperties: false, applyContent: false });
            if (!result?.ok) {
                status.textContent = result?.error || pisiStructuredTranslate('Şablon uygulanamadı.');
                trigger.disabled = false;
                return;
            }
            status.textContent = pisiStructuredTranslate('Şablon uygulandı.');
            invalidatePisiSearchIndex('template');
            dispatchPisiNodePropertiesChanged(nodePath, 'template-apply', {
                refreshEditor: true
            });
        });
        menu.appendChild(option);
    }
    trigger.disabled = templates.length === 0;
    if (!templates.length) {
        trigger.title = pisiStructuredTranslate('Kaydedilmiş property şablonu yok.');
    }
    trigger.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        trigger.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
        if (!menu.hidden) menu.querySelector('button')?.focus();
    });
    picker.addEventListener('focusout', () => {
        setTimeout(() => {
            if (picker.contains(document.activeElement)) return;
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }, 0);
    });
    picker.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    });
    picker.append(trigger, menu);
    return picker;
}

async function renderPisiNodeProperties(container) {
    const section = document.createElement('section');
    section.className = 'pisi-properties-editor';

    const nodePath = getPisiSearchCurrentNodePath();
    if (!nodePath) {
        const empty = document.createElement('div');
        empty.className = 'pisi-command-empty';
        empty.textContent = pisiStructuredTranslate('Özellik düzenlemek için bir node açın.');
        section.appendChild(empty);
        container.appendChild(section);
        return;
    }
    const [documentResult, propertyContext, templateResult] = await Promise.all([
        window.pisiProject?.getPisiDocument?.(nodePath),
        getPisiNodePropertyMapContext(nodePath),
        window.pisiProject?.listDatabaseTemplates?.(window.currentProjectFolder)
    ]);
    if (!documentResult?.ok) throw new Error(documentResult?.error || 'Node okunamadı.');
    const rows = document.createElement('div');
    rows.className = 'pisi-property-rows';
    rows.pisiPropertyContext = propertyContext;
    normalizePisiPropertyCollection(documentResult.data?.properties).forEach((property) => {
        rows.appendChild(createPisiPropertyRow(property, propertyContext));
    });
    const controls = document.createElement('footer');
    controls.className = 'pisi-property-footer';
    const add = makePisiPropertyIconButton('Özellik ekle', 'add');
    add.addEventListener('click', () => appendPisiPropertyRow(rows));
    const save = makePisiPropertyIconButton('Özellikleri kaydet', 'save');
    const status = document.createElement('span');
    status.className = 'pisi-command-inline-status';
    save.addEventListener('click', async () => {
        save.disabled = true;
        status.textContent = pisiStructuredTranslate('Kaydediliyor…');
        const properties = collectPisiPropertyRows(rows);
        const result = await window.pisiProject?.saveNodeProperties?.(nodePath, properties);
        if (!result?.ok) {
            status.textContent = result?.error || pisiStructuredTranslate('Özellikler kaydedilemedi.');
            save.disabled = false;
            return;
        }
        invalidatePisiSearchIndex();
        status.textContent = pisiStructuredTranslate('Özellikler kaydedildi.');
        save.disabled = false;
        dispatchPisiNodePropertiesChanged(nodePath, 'save', { properties });
    });
    const templates = templateResult?.ok ? templateResult.templates : [];
    const templatePicker = makePisiPropertyTemplatePicker(templates, nodePath, status);
    controls.append(status, templatePicker, add, save);
    section.append(rows, controls);
    container.appendChild(section);
}

function formatPisiPropertyValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? '✓' : '—';
    return String(value ?? '');
}

function makePisiBaseOpenButton(documentRecord) {
    const button = makePisiStructuredButton(documentRecord.title, 'pisi-base-open');
    button.addEventListener('click', () => {
        window.closePisiBasesDialog?.();
        openPisiSearchResult({
            kind: 'node',
            nodePath: documentRecord.path,
            nodeTitle: documentRecord.title,
            nodeItem: documentRecord.nodeItem,
            mapPath: documentRecord.memberships?.[0]?.mapPath || null
        });
    });
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
        const properties = new Map(normalizePisiPropertyCollection(documentRecord.properties).map((item) => [item.id, item]));
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
        const result = await window.pisiProject?.saveView?.(window.currentProjectFolder, {
            name,
            query: pisiStructuredViewState.query,
            layout: pisiStructuredViewState.layout
        });
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Görünüm kaydedilemedi.'));
        await loadPisiSavedViews();
        rerender();
    });
    const remove = makePisiStructuredButton('Filtreyi sil', 'pisi-secondary-button');
    remove.addEventListener('click', async () => {
        if (!select.value) return;
        const result = await window.pisiProject?.deleteView?.(window.currentProjectFolder, select.value);
        if (!result?.ok) return alert(result?.error || pisiStructuredTranslate('Görünüm silinemedi.'));
        await loadPisiSavedViews();
        rerender();
    });
    host.append(select, save, remove);
}

async function renderPisiBases(container, options = {}) {
    const section = document.createElement('section');
    section.className = 'pisi-bases';
    const title = document.createElement('h2');
    title.textContent = pisiStructuredTranslate('Bases-lite');
    const propertyContext = await getPisiActiveMapPropertyContext();
    const mapDocuments = materializePisiDatabaseDocuments(makePisiMapDatabaseDocuments(propertyContext));
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
        const documents = filterPisiPropertyDocuments(mapDocuments, pisiStructuredViewState.query);
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
    renderPisiSavedViewControls(savedHost, () => {
        container.replaceChildren();
        void renderPisiBases(container, options);
    });
    const createMap = makePisiStructuredButton('Sonuçlardan map üret', 'pisi-primary-button');
    createMap.addEventListener('click', async () => {
        const documents = filterPisiPropertyDocuments(mapDocuments, pisiStructuredViewState.query);
        const titleValue = prompt(pisiStructuredTranslate('Map adı'), pisiStructuredTranslate('Özellik görünümü'));
        if (!titleValue) return;
        createMap.disabled = true;
        const result = await window.pisiProject?.createPropertyMap?.(window.currentProjectFolder, {
            title: titleValue,
            query: pisiStructuredViewState.query,
            nodePaths: documents.map((item) => item.path)
        });
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
    if (options.showTitle !== false) section.appendChild(title);
    section.append(toolbar, actions, results);
    container.appendChild(section);
    rerenderResults();
}

const moduleApi = {
    pisiStructuredViewState,
    appendPisiPropertyRow,
    collectPisiMapPropertyDefinitions,
    createPisiPropertyRow,
    collectPisiPropertyRows,
    getPisiNodePropertyMapContext,
    getPisiActiveMapPropertyContext,
    readPisiPropertyControlValue,
    renderPisiNodeProperties,
    renderPisiBases
};

registerModule('data.structuredViews', moduleApi);

export {
    appendPisiPropertyRow,
    collectPisiMapPropertyDefinitions,
    collectPisiPropertyRows,
    createPisiPropertyRow,
    getPisiNodePropertyMapContext,
    getPisiActiveMapPropertyContext,
    pisiStructuredViewState,
    renderPisiBases,
    renderPisiNodeProperties
};
