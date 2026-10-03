import { getPisiSearchCurrentNodePath, invalidatePisiSearchIndex } from '../search/pisi-search-index.mjs';
import { PISI_NODE_PROPERTY_TYPES, PISI_ROLLUP_AGGREGATES, normalizePisiPropertyCollection } from './pisi-properties-core.mjs';
import {
    dispatchPisiNodePropertiesChanged,
    getPisiMapNodeLabel,
    getPisiNodePropertyMapContext,
    getPisiPropertyTypeLabel,
    makePisiRollupField,
    makePisiStructuredButton,
    pisiMapNodeMatchesValue,
    pisiPropertyNameKey,
    pisiStructuredTranslate
} from './pisi-structured-view-helpers.mjs';

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

export { appendPisiPropertyRow, collectPisiPropertyRows, createPisiPropertyRow, readPisiPropertyControlValue, renderPisiNodeProperties };
